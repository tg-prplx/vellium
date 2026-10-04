export const MAX_PLUGIN_SETTINGS_DEPTH = 6;
export const MAX_PLUGIN_SETTINGS_KEYS = 200;
export const MAX_PLUGIN_SETTINGS_ARRAY = 200;
export const MAX_PLUGIN_SETTINGS_STRING = 20_000;
export const MAX_PLUGIN_SETTINGS_BYTES = 64 * 1024;
const BLOCKED_PLUGIN_SETTINGS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DISALLOWED_OBJECT_KEY_CHARS = /[\u0000-\u001f\u007f]/;

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
        .map(([key, item]) => {
          const normalizedKey = String(key).trim().slice(0, 200);
          if (!normalizedKey || BLOCKED_PLUGIN_SETTINGS_KEYS.has(normalizedKey) || DISALLOWED_OBJECT_KEY_CHARS.test(normalizedKey)) {
            return null;
          }
          return [normalizedKey, sanitizeValue(item, depth + 1)] as const;
        })
        .filter((entry): entry is readonly [string, unknown] => entry !== null)
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

// Mirrors the PluginHost iframe sandbox so an asset opened as a top-level page
// still runs in an opaque origin instead of the application origin.
const PLUGIN_DOCUMENT_SANDBOX = "sandbox allow-scripts allow-forms allow-downloads";
const PLUGIN_HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);
const PLUGIN_SCRIPTABLE_IMAGE_EXTENSIONS = new Set(["svg", "xml", "xsl"]);

export function buildPluginAssetHeaders(ext: string): Record<string, string> {
  const common = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer"
  };
  if (PLUGIN_HTML_EXTENSIONS.has(ext)) {
    return {
      ...common,
      "Content-Security-Policy": `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; ${PLUGIN_DOCUMENT_SANDBOX}`
    };
  }
  if (PLUGIN_SCRIPTABLE_IMAGE_EXTENSIONS.has(ext)) {
    return {
      ...common,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; sandbox"
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
