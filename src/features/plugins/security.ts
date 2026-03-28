interface PluginFrameMessageEventLike {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function normalizePluginApiRequest(raw: unknown, origin: string): { fetchPath: string; pathname: string } {
  const value = String(raw || "").trim();
  if (!value) {
    throw new Error("Plugin API path is required");
  }
  const url = new URL(value, origin);
  if (url.origin !== origin) {
    throw new Error("Plugin API access is restricted to the current origin");
  }
  const pathname = decodePathname(url.pathname);
  if (!pathname.startsWith("/api/")) {
    throw new Error("Plugin API access is restricted to /api/* routes");
  }
  return {
    fetchPath: `${url.pathname}${url.search}`,
    pathname
  };
}

export function isTrustedPluginFrameMessage(
  event: PluginFrameMessageEventLike,
  frameSource: MessageEventSource | null,
  expectedOrigin: string,
  pluginId: string,
  frameId: string
): boolean {
  const msg = event.data as Record<string, unknown> | null;
  if (!msg || msg.__velliumPlugin !== true) return false;
  if (!frameSource || event.source !== frameSource) return false;
  if (event.origin !== expectedOrigin) return false;
  return String(msg.pluginId || "").trim() === pluginId && String(msg.frameId || "").trim() === frameId;
}
