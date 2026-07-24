import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { LocalModelComponentId, LocalModelInstallRequest } from "../src/shared/types/localModels";
import { LocalModelInstaller } from "./localModelInstaller";

type SenderGuard = (event: IpcMainInvokeEvent, allowDesktopPet?: boolean) => void;

export function registerLocalModelIpc(installer: LocalModelInstaller, assertTrustedSender: SenderGuard) {
  ipcMain.handle("local-models:catalog", (event) => {
    assertTrustedSender(event);
    return installer.catalog();
  });
  ipcMain.handle("local-models:install", (event, request: LocalModelInstallRequest) => {
    assertTrustedSender(event);
    return installer.install(request);
  });
  ipcMain.handle("local-models:cancel", (event, componentId?: LocalModelComponentId) => {
    assertTrustedSender(event);
    installer.cancel(componentId);
    return { ok: true };
  });
  ipcMain.handle("local-models:remove", (event, componentId: LocalModelComponentId) => {
    assertTrustedSender(event);
    return installer.remove(componentId);
  });
}
