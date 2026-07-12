import { BrowserWindow, type IpcMainInvokeEvent, type WebContents } from "electron";

interface IpcSenderGuardOptions {
  getMainWindow: () => BrowserWindow | null;
  getDesktopPetWindow: (sender: WebContents) => BrowserWindow | null;
  isAllowedMainUrl: (url: string) => boolean;
}

export function createIpcSenderGuard(options: IpcSenderGuardOptions) {
  return (event: IpcMainInvokeEvent, allowDesktopPet = false) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    const frame = event.senderFrame;
    if (!target || !frame || frame !== event.sender.mainFrame) throw new Error("Unauthorized IPC sender");
    const trustedMain = target === options.getMainWindow() && options.isAllowedMainUrl(frame.url);
    const trustedPet = allowDesktopPet
      && target === options.getDesktopPetWindow(event.sender)
      && frame.url.startsWith("data:text/html");
    if (trustedMain || trustedPet) return;
    throw new Error("Unauthorized IPC sender");
  };
}

export function isAllowedExternalUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.length > 4096) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function decodeBoundedBase64(raw: string, maxBytes: number): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Missing file payload");
  if (value.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    throw new Error("Invalid or oversized file payload");
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length > maxBytes) throw new Error(`File payload exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
  return buffer;
}
