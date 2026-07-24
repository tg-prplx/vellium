export function canGrantLiveAudioPermission(input: {
  trustedMainRenderer: boolean;
  allowedOrigin: boolean;
  permission: string;
  mediaTypes: string[];
  allowUnknownMediaType?: boolean;
}): boolean {
  return input.trustedMainRenderer
    && input.allowedOrigin
    && input.permission === "media"
    && (
      (input.mediaTypes.length > 0 && input.mediaTypes.every((type) => type === "audio"))
      || (input.allowUnknownMediaType === true && input.mediaTypes.every((type) => type === "unknown"))
    );
}

export function isTrustedMainMediaRequest(input: {
  sameWebContents: boolean;
  mainDocumentUrl: string;
  requestingUrl: string;
}): boolean {
  if (!input.sameWebContents) return false;
  try {
    const main = new URL(input.mainDocumentUrl);
    const requesting = new URL(input.requestingUrl || input.mainDocumentUrl);
    return requesting.origin === main.origin && requesting.pathname === main.pathname;
  } catch {
    return false;
  }
}

export function decideMicrophonePermission(status: string): "granted" | "denied" | "prompt" {
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  return "prompt";
}
