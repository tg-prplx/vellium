import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

type SenderGuard = (event: IpcMainInvokeEvent, allowDesktopPet?: boolean) => void;

/** Relaunch after switching data profiles: the embedded server reads the active profile only at startup. */
export function registerAppLifecycleIpc(assertTrustedSender: SenderGuard) {
  ipcMain.handle("app:relaunch", (event) => {
    assertTrustedSender(event);
    app.relaunch();
    // quit (not exit) so before-quit handlers stop managed backends and flush state.
    setTimeout(() => app.quit(), 50);
    return { ok: true };
  });
}
