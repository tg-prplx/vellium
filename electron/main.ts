import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";

const isDev = !app.isPackaged;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
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

const SERVER_PORT = 3001;
const SERVER_START_TIMEOUT_MS = 20000;

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

async function isServerHealthy(): Promise<boolean> {
  const healthUrl = `http://127.0.0.1:${SERVER_PORT}/api/health`;
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady(timeoutMs = SERVER_START_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  const healthUrl = `http://127.0.0.1:${SERVER_PORT}/api/health`;

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
    process.env.SLV_SERVER_PORT = String(SERVER_PORT);
    process.env.SLV_SERVER_AUTOSTART = "0";
    process.env.ELECTRON_SERVE_STATIC = "1";
    process.env.ELECTRON_DIST_PATH = distPath;
    process.env.NODE_ENV = "production";

    const moduleUrl = pathToFileURL(serverScript).href;
    const mod = await import(moduleUrl) as { startServer?: (port?: number) => Promise<number> };
    if (typeof mod.startServer !== "function") {
      throw new Error(`Bundled server missing startServer(): ${serverScript}`);
    }
    await mod.startServer(SERVER_PORT);
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
        nodeIntegration: false
      }
    });

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

    if (isDev) {
      // In dev, Vite proxies /api to the server, so load Vite dev server
      void mainWindow.loadURL("http://localhost:1420").catch((error) => {
        console.error("Failed to load Vite URL:", error);
      });
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      // In prod, server serves both API and static frontend
      void mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`).catch((error) => {
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

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
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
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => {
      console.error("Failed to recreate main window:", error);
    });
  }
});

// Bundled server runs in-process; no child teardown needed.
app.on("before-quit", () => {
  // no-op
});
