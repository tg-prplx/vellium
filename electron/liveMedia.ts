import {
  desktopCapturer,
  ipcMain,
  screen,
  systemPreferences,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type Session
} from "electron";
import {
  canGrantLiveAudioPermission,
  decideMicrophonePermission,
  isTrustedMainMediaRequest
} from "./mediaPermissions";

let liveMediaIpcRegistered = false;

export function registerLiveMediaIpc(
  assertTrustedIpcSender: (event: IpcMainInvokeEvent) => void,
  getMainWindow: () => BrowserWindow | null
) {
  if (liveMediaIpcRegistered) return;
  liveMediaIpcRegistered = true;
  ipcMain.handle("live:microphone-permission", async (event) => {
    assertTrustedIpcSender(event);
    if (process.platform !== "darwin") {
      return { granted: true, status: "granted" };
    }
    const currentStatus = systemPreferences.getMediaAccessStatus("microphone");
    const decision = decideMicrophonePermission(currentStatus);
    if (decision !== "prompt") {
      return { granted: decision === "granted", status: currentStatus };
    }
    const granted = await systemPreferences.askForMediaAccess("microphone");
    return {
      granted,
      status: systemPreferences.getMediaAccessStatus("microphone")
    };
  });
  ipcMain.handle("live:screen-context", async (event) => {
    assertTrustedIpcSender(event);
    const target = getMainWindow();
    if (!target || target.isDestroyed()) {
      return { ok: false, error: "Main window is unavailable" };
    }
    try {
      const display = screen.getDisplayMatching(target.getBounds());
      const scaleFactor = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.min(2560, Math.round(display.size.width * scaleFactor)),
          height: Math.min(1600, Math.round(display.size.height * scaleFactor))
        },
        fetchWindowIcons: false
      });
      const source = sources.find((item) => String(item.display_id || "") === String(display.id)) || sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        return { ok: false, error: "Screen capture is unavailable" };
      }
      const sourceSize = source.thumbnail.getSize();
      const image = sourceSize.width > 1440
        ? source.thumbnail.resize({ width: 1440, quality: "best" })
        : source.thumbnail;
      const size = image.getSize();
      return {
        ok: true,
        dataUrl: `data:image/jpeg;base64,${image.toJPEG(78).toString("base64")}`,
        width: size.width,
        height: size.height
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Screen capture failed"
      };
    }
  });
}

export function configureLiveMediaPermissions(options: {
  session: Session;
  getMainWindow: () => BrowserWindow | null;
  isAllowedAppUrl: (url: string) => boolean;
}) {
  const { session, getMainWindow, isAllowedAppUrl } = options;
  session.setPermissionCheckHandler?.((webContents, permission, requestingOrigin, details) => (
    canGrantLiveAudioPermission({
      trustedMainRenderer: webContents === getMainWindow()?.webContents && details.isMainFrame,
      allowedOrigin: isAllowedAppUrl(requestingOrigin),
      permission,
      mediaTypes: details.mediaType ? [details.mediaType] : [],
      allowUnknownMediaType: true
    })
  ));
  session.setPermissionRequestHandler?.((webContents, permission, callback, details) => {
    const requestingUrl = "requestingUrl" in details && details.requestingUrl
      ? details.requestingUrl
      : webContents.getURL();
    callback(canGrantLiveAudioPermission({
      trustedMainRenderer: isTrustedMainMediaRequest({
        sameWebContents: webContents === getMainWindow()?.webContents,
        mainDocumentUrl: webContents.getURL(),
        requestingUrl
      }),
      allowedOrigin: isAllowedAppUrl(requestingUrl),
      permission,
      mediaTypes: "mediaTypes" in details ? details.mediaTypes || [] : []
    }));
  });
  session.setDevicePermissionHandler?.(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}
