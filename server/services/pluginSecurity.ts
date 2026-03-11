export const MAX_PLUGIN_SETTINGS_DEPTH = 6;
export const MAX_PLUGIN_SETTINGS_KEYS = 200;
export const MAX_PLUGIN_SETTINGS_ARRAY = 200;
export const MAX_PLUGIN_SETTINGS_STRING = 20_000;
export const MAX_PLUGIN_SETTINGS_BYTES = 64 * 1024;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, MAX_PLUGIN_SETTINGS_STRING);
  if (depth >= MAX_PLUGIN_SETTINGS_DEPTH) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PLUGIN_SETTINGS_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_PLUGIN_SETTINGS_KEYS);
    return Object.fromEntries(
      entries
        .map(([key, item]) => [String(key).slice(0, 200), sanitizeValue(item, depth + 1)] as const)
        .filter(([, item]) => item !== undefined)
    );
  }
  return undefined;
}

export function sanitizePluginSettingsPatch(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("settings patch must be an object");
  }
  const sanitized = sanitizeValue(raw, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new Error("settings patch must be an object");
  }
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_PLUGIN_SETTINGS_BYTES) {
    throw new Error(`settings patch exceeds ${MAX_PLUGIN_SETTINGS_BYTES} bytes`);
  }
  return sanitized as Record<string, unknown>;
}

export function buildPluginAssetHeaders(ext: string): Record<string, string> {
  const common = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer"
  };
  if (ext === "html") {
    return {
      ...common,
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
    };
  }
  if (ext === "js") {
    return {
      ...common,
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'"
    };
  }
  return common;
}
