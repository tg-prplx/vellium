import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { existsSync } from "fs";

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
let serverProcess: ChildProcess | null = null;
let creatingWindow = false;

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
    if (serverProcess && serverProcess.exitCode !== null && serverProcess.exitCode !== undefined) {
      throw new Error(`Bundled server exited with code ${serverProcess.exitCode} before it became ready`);
    }
    await sleep(150);
  }

  throw new Error(`Timed out waiting for bundled server at ${healthUrl}`);
}

/** In production, spawn the server as a child process using the bundled Node */
function startProductionServer(): Promise<void> {
  if (serverProcess && !serverProcess.killed && serverProcess.exitCode === null) {
    return waitForServerReady();
  }

  return (async () => {
    if (await isServerHealthy()) return;

    return new Promise<void>((resolve, reject) => {
      const serverScript = resolveBundledServerScript();
      const distPath = resolveBundledDistPath();
      let settled = false;

      const safeResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      // Set env vars for the server child process
      const env = {
        ...process.env,
        SLV_DATA_DIR: process.env.SLV_DATA_DIR,
        SLV_SERVER_PORT: String(SERVER_PORT),
        SLV_SERVER_AUTOSTART: "1",
        ELECTRON_SERVE_STATIC: "1",
        ELECTRON_DIST_PATH: distPath,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production"
      };

      serverProcess = spawn(process.execPath, [serverScript], {
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const msg = data.toString();
        console.log("[server]", msg.trim());
        if (msg.includes("Server running")) {
          safeResolve();
        }
      });

      serverProcess.stderr?.on("data", (data: Buffer) => {
        console.error("[server-err]", data.toString().trim());
      });

      serverProcess.on("error", safeReject);
      serverProcess.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.error(`Server exited with code ${code}`);
        }
        serverProcess = null;
      });

      void waitForServerReady().then(safeResolve).catch(safeReject);
    });
  })();
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
    dialog.showErrorBox("Vellum startup error", message);
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

// Clean up server process on quit
app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
