import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { discoverLlamaCpp } from "./llamaCppDiscovery";

type SenderGuard = (event: IpcMainInvokeEvent, allowDesktopPet?: boolean) => void;

export function registerLlamaCppIpc(
  assertTrustedSender: SenderGuard,
  getMainWindow: () => BrowserWindow | null
) {
  ipcMain.handle("llama-cpp:discover", (event) => {
    assertTrustedSender(event);
    return discoverLlamaCpp();
  });
  ipcMain.handle("llama-cpp:pick-executable", async (event) => {
    assertTrustedSender(event);
    const mainWindow = getMainWindow();
    const options = {
      title: "Select llama-server",
      properties: ["openFile"] as Array<"openFile">,
      ...(process.platform === "win32" ? { filters: [{ name: "llama-server", extensions: ["exe"] }] } : {})
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, path: result.filePaths[0] };
  });
  ipcMain.handle("llama-cpp:pick-model", async (event) => {
    assertTrustedSender(event);
    const mainWindow = getMainWindow();
    const options = {
      title: "Select a GGUF model",
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "GGUF model", extensions: ["gguf"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, path: result.filePaths[0] };
  });
}
