import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { pathToFileURL } from "url";
import { ManagedBackendManager } from "./managedBackends";
import type { ManagedBackendConfig } from "../src/shared/types/contracts";
import { applyServerRuntimeEnv, formatServerUrl, parseServerRuntimeOptions } from "../server/runtimeConfig";

const isDev = !app.isPackaged;
const runtimeOptions = parseServerRuntimeOptions(process.argv.slice(1));
const isHeadless = runtimeOptions.headless;

// Prevent multiple production instances, but allow a local dev build
// to run alongside the packaged app.
const gotTheLock = isDev || isHeadless ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Set data directory — use userData in packaged app, ./data in dev
if (!isDev) {
  process.env.SLV_DATA_DIR = path.join(app.getPath("userData"), "data");
}

let mainWindow: BrowserWindow | null = null;
let creatingWindow = false;
let embeddedServerStart: Promise<void> | null = null;
const managedBackendManager = new ManagedBackendManager();

const SERVER_PORT = runtimeOptions.port;
const SERVER_HOST = runtimeOptions.host;
const SERVER_START_TIMEOUT_MS = 20000;

function sanitizeFilename(name: string, fallback = "export.txt"): string {
  const trimmed = String(name || "").trim();
  const normalized = trimmed.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isAllowedAppNavigation(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) {
      return parsed.origin === "http://localhost:1420";
    }
    return parsed.origin === new URL(formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).origin;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBundledServerScript(): string {
  if (isDev) {
    return path.join(__dirname, "..", "server-bundle.mjs");
  }
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "server-bundle.mjs");
  if (existsSync(unpacked)) return unpacked;
  return path.join(__dirname, "..", "server-bundle.mjs");
}

function resolveBundledDistPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "dist");
  }
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
  if (existsSync(unpacked)) return unpacked;
  return path.join(__dirname, "..", "dist");
}

function resolveBundledPluginsPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "data", "bundled-plugins");
  }
  return path.join(process.resourcesPath, "data", "bundled-plugins");
}

async function isServerHealthy(): Promise<boolean> {
  const healthUrl = `${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}/api/health`;
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady(timeoutMs = SERVER_START_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  const healthUrl = `${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}/api/health`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is not ready yet.
    }
    await sleep(150);
  }

  throw new Error(`Timed out waiting for bundled server at ${healthUrl}`);
}

/** In production, boot the bundled server directly in the Electron main process. */
function startProductionServer(): Promise<void> {
  if (embeddedServerStart) return embeddedServerStart;
  embeddedServerStart = (async () => {
    if (await isServerHealthy()) return;

    const serverScript = resolveBundledServerScript();
    const distPath = resolveBundledDistPath();

    // These are read at module init time in the bundled server.
    process.env.SLV_DATA_DIR = process.env.SLV_DATA_DIR || path.join(app.getPath("userData"), "data");
    applyServerRuntimeEnv({
      ...runtimeOptions,
      headless: isHeadless || runtimeOptions.headless,
      serveStatic: true
    });
    process.env.SLV_SERVER_AUTOSTART = "0";
    process.env.ELECTRON_SERVE_STATIC = "1";
    process.env.ELECTRON_DIST_PATH = distPath;
    process.env.SLV_DIST_PATH = distPath;
    process.env.SLV_BUNDLED_PLUGINS_DIR = resolveBundledPluginsPath();
    process.env.NODE_ENV = "production";

    const moduleUrl = pathToFileURL(serverScript).href;
    const mod = await import(moduleUrl) as { startServer?: (port?: number, host?: string) => Promise<number> };
    if (typeof mod.startServer !== "function") {
      throw new Error(`Bundled server missing startServer(): ${serverScript}`);
    }
    await mod.startServer(SERVER_PORT, SERVER_HOST);
    await waitForServerReady();
  })();
  return embeddedServerStart;
}

async function createWindow() {
  if (mainWindow || creatingWindow) {
    mainWindow?.focus();
    return;
  }
  creatingWindow = true;

  // In dev mode, the server is already running via concurrently
  // In production, start the server as a child process
  try {
    if (!isDev) {
      await startProductionServer();
    }

    const isMac = process.platform === "darwin";

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      frame: isMac, // macOS uses native frame with hidden title bar; Windows/Linux fully frameless
      titleBarStyle: isMac ? "hiddenInset" : undefined,
      trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
      transparent: false,
      backgroundColor: "#0f0f14",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    managedBackendManager.attachWindow(mainWindow);

    const forceShowTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 8000);

    mainWindow.once("ready-to-show", () => {
      clearTimeout(forceShowTimer);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Renderer failed to load URL "${validatedURL}" (${errorCode}): ${errorDescription}`
      );
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("Renderer process exited:", details.reason, details.exitCode);
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isAllowedAppNavigation(url)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      }
    });

    if (isDev) {
      // In dev, Vite proxies /api to the server, so load Vite dev server
      void mainWindow.loadURL("http://localhost:1420").catch((error) => {
        console.error("Failed to load Vite URL:", error);
      });
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      // In prod, server serves both API and static frontend
      void mainWindow.loadURL(formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).catch((error) => {
        console.error("Failed to load bundled app URL:", error);
      });
    }

    // Forward maximize/unmaximize events to renderer
    mainWindow.on("maximize", () => {
      mainWindow?.webContents.send("window:maximized", true);
    });
    mainWindow.on("unmaximize", () => {
      mainWindow?.webContents.send("window:maximized", false);
    });

    mainWindow.on("closed", () => {
      clearTimeout(forceShowTimer);
      mainWindow = null;
    });
  } finally {
    creatingWindow = false;
  }
}

// IPC handlers for window controls
ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:isMaximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("window:getPlatform", () => {
  return process.platform;
});

ipcMain.handle("file:save", async (_event, payload: { filename?: unknown; base64Data?: unknown }) => {
  if (!payload || typeof payload !== "object") {
    return { ok: false, canceled: true };
  }
  const filename = sanitizeFilename(String(payload.filename || "export.txt"), "export.txt");
  const base64Data = String(payload.base64Data || "").trim();
  if (!base64Data) {
    throw new Error("Missing file payload");
  }

  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    defaultPath: filename,
    buttonLabel: "Save"
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const buffer = Buffer.from(base64Data, "base64");
  await writeFile(result.filePath, buffer);
  return { ok: true, canceled: false, filePath: result.filePath };
});

ipcMain.handle("shell:openExternal", async (_event, rawUrl: unknown) => {
  const url = String(rawUrl || "").trim();
  if (!isAllowedExternalUrl(url)) {
    return { ok: false };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("managed-backends:list", () => {
  return managedBackendManager.listRuntimeStates();
});

ipcMain.handle("managed-backends:start", async (_event, rawConfig: unknown) => {
  return managedBackendManager.start(rawConfig as ManagedBackendConfig);
});

ipcMain.handle("managed-backends:stop", async (_event, backendId: unknown) => {
  return managedBackendManager.stop(String(backendId || "").trim());
});

ipcMain.handle("managed-backends:stop-active", async () => {
  await managedBackendManager.stopActive();
  return { ok: true };
});

ipcMain.handle("managed-backends:logs", (_event, backendId: unknown) => {
  return managedBackendManager.getLogs(String(backendId || "").trim());
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (isHeadless) {
    app.dock?.hide();
    void startProductionServer()
      .then(() => {
        console.log(`Vellium headless mode running at ${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}`);
      })
      .catch((error) => {
        console.error("Failed to start headless server:", error);
        app.quit();
      });
    return;
  }
  void createWindow().catch((error) => {
    console.error("Failed to create main window:", error);
    const message = error instanceof Error ? error.stack || error.message : String(error);
    dialog.showErrorBox("Vellium startup error", message);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (isHeadless) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => {
      console.error("Failed to recreate main window:", error);
    });
  }
});

// Bundled server runs in-process; no child teardown needed.
app.on("before-quit", () => {
  void managedBackendManager.stopActive();
});
