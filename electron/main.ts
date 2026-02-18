import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

const isDev = !app.isPackaged;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Set data directory — use userData in packaged app, ./data in dev
if (!isDev) {
  process.env.SLV_DATA_DIR = path.join(app.getPath("userData"), "data");
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const SERVER_PORT = 3001;

/** In production, spawn the server as a child process using the bundled Node */
function startProductionServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, "..", "server-bundle.cjs");

    // Set env vars for the server child process
    const env = {
      ...process.env,
      SLV_DATA_DIR: process.env.SLV_DATA_DIR,
      ELECTRON_SERVE_STATIC: "1",
      ELECTRON_DIST_PATH: path.join(__dirname, "..", "dist"),
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
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error("[server-err]", data.toString().trim());
    });

    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Server exited with code ${code}`);
      }
      serverProcess = null;
    });

    // Timeout fallback — resolve anyway after 5s
    setTimeout(resolve, 5000);
  });
}

async function createWindow() {
  // In dev mode, the server is already running via concurrently
  // In production, start the server as a child process
  if (!isDev) {
    await startProductionServer();
  }

  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
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

  if (isDev) {
    // In dev, Vite proxies /api to the server, so load Vite dev server
    mainWindow.loadURL("http://localhost:1420");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // In prod, server serves both API and static frontend
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  // Forward maximize/unmaximize events to renderer
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized", false);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up server process on quit
app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
