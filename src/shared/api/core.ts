const BASE = import.meta.env.DEV ? "http://localhost:3001/api" : "/api";
const PROD_FALLBACK_BASES = ["http://127.0.0.1:3001/api", "http://localhost:3001/api"];

function requestBases(): string[] {
  return import.meta.env.DEV ? [BASE] : [BASE, ...PROD_FALLBACK_BASES];
}

export function resolveApiAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  if (!import.meta.env.DEV) return url;
  return `http://localhost:3001${url}`;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TypeError" ||
    /failed to fetch|networkerror|network error|load failed/i.test(err.message)
  );
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const bases = requestBases();
  let lastErr: unknown = new Error("Request failed");

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer"
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err) || import.meta.env.DEV) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const patchReq = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);

export async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  const bases = requestBases();
  let lastErr: unknown = new Error("Request failed");

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer"
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      return await res.blob();
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err) || import.meta.env.DEV) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export type StreamCallbacks = {
  onDelta?: (delta: string) => void;
  onToolEvent?: (event: {
    phase: "start" | "delta" | "done";
    callId: string;
    name: string;
    args?: string;
    result?: string;
  }) => void;
  onDone?: () => void;
};

export async function streamPost(path: string, body: unknown, callbacks: StreamCallbacks): Promise<void> {
  let res: Response | null = null;
  let lastErr: unknown = new Error("Request failed");

  for (const base of requestBases()) {
    try {
      const candidate = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer"
      });
      if (!candidate.ok) {
        const text = await candidate.text();
        throw new Error(text || `HTTP ${candidate.status}`);
      }
      res = candidate;
      break;
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err) || import.meta.env.DEV) {
        throw err;
      }
    }
  }

  if (!res) throw lastErr;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let doneEmitted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as {
            type: string;
            delta?: string;
            phase?: "start" | "delta" | "done";
            callId?: string;
            name?: string;
            args?: string;
            result?: string;
          };
          if (parsed.type === "delta" && parsed.delta) {
            callbacks.onDelta?.(parsed.delta);
          } else if (parsed.type === "tool" && parsed.phase && parsed.callId && parsed.name) {
            callbacks.onToolEvent?.({
              phase: parsed.phase,
              callId: parsed.callId,
              name: parsed.name,
              args: parsed.args,
              result: parsed.result
            });
          } else if (parsed.type === "done") {
            doneEmitted = true;
            callbacks.onDone?.();
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      }
    }

    if (!doneEmitted) callbacks.onDone?.();
  } else {
    callbacks.onDone?.();
  }
}
