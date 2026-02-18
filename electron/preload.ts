import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  getPlatform: () => ipcRenderer.invoke("window:getPlatform"),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on("window:maximized", (_event, maximized: boolean) => {
      callback(maximized);
    });
  }
});
