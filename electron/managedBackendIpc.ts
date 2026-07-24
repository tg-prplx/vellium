import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ManagedBackendConfig } from "../src/shared/types/contracts";
import type { ManagedBackendManager } from "./managedBackends";

type SenderGuard = (event: IpcMainInvokeEvent, allowDesktopPet?: boolean) => void;

export function registerManagedBackendIpc(manager: ManagedBackendManager, assertTrustedSender: SenderGuard) {
  ipcMain.handle("managed-backends:list", (event) => {
    assertTrustedSender(event);
    return manager.listRuntimeStates();
  });
  ipcMain.handle("managed-backends:start", async (event, rawConfig: unknown) => {
    assertTrustedSender(event);
    return manager.start(rawConfig as ManagedBackendConfig);
  });
  ipcMain.handle("managed-backends:stop", async (event, backendId: unknown) => {
    assertTrustedSender(event);
    return manager.stop(String(backendId || "").trim());
  });
  ipcMain.handle("managed-backends:stop-active", async (event) => {
    assertTrustedSender(event);
    await manager.stopActive();
    return { ok: true };
  });
  ipcMain.handle("managed-backends:logs", (event, backendId: unknown) => {
    assertTrustedSender(event);
    return manager.getLogs(String(backendId || "").trim());
  });
}
