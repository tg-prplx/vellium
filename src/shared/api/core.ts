const BASE = "/api";
const PROD_FALLBACK_BASES = ["http://127.0.0.1:3001/api", "http://localhost:3001/api"];
const REQUEST_TIMEOUT_MS = 6000;

type RequestOptions = {
  timeoutMs?: number;
};

function requestBases(): string[] {
  return import.meta.env.DEV ? [BASE] : [BASE, ...PROD_FALLBACK_BASES];
}

function resolveDesktopApiBase(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location?.protocol !== "file:") return null;
  return PROD_FALLBACK_BASES.find((candidate) => /^https?:\/\//i.test(candidate)) ?? null;
}

export function resolveApiAssetUrl(url: string | null | undefined): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(\/|\.{1,2}\/)/.test(trimmed)) {
    const desktopBase = resolveDesktopApiBase();
    if (desktopBase) {
      try {
        return new URL(trimmed, desktopBase).toString();
      } catch {
        return trimmed;
      }
    }
  }
  return trimmed;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TypeError" ||
    /failed to fetch|fetch failed|networkerror|network error|load failed|terminated/i.test(err.message)
  );
}

function isStreamTerminationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || isNetworkError(err);
}

function extractStructuredErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const direct = typeof record.error === "string" && record.error.trim()
    ? record.error.trim()
    : typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : "";
  if (direct) return direct;
  return null;
}

async function readErrorResponseMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}`;
  const text = (await res.text()).trim();
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as unknown;
    return extractStructuredErrorMessage(parsed) || text;
  } catch {
    return text;
  }
}

export async function request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const bases = requestBases();
  let lastErr: unknown = new Error("Request failed");
  const timeoutMs = Math.max(0, Math.floor(options?.timeoutMs ?? REQUEST_TIMEOUT_MS));

  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeout = timeoutMs > 0
        ? window.setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
        : null;
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(await readErrorResponseMessage(res));
        }
        return res.json();
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
      }
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err) || import.meta.env.DEV) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export const get = <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options);
export const post = <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options);
export const patchReq = <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options);
export const put = <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body, options);
export const del = <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options);

export async function requestBlob(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<Blob> {
  const bases = requestBases();
  let lastErr: unknown = new Error("Request failed");
  const timeoutMs = Math.max(0, Math.floor(options?.timeoutMs ?? REQUEST_TIMEOUT_MS));

  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeout = timeoutMs > 0
        ? window.setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
        : null;
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error(await readErrorResponseMessage(res));
        }
        return await res.blob();
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
      }
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
  onReasoningDelta?: (delta: string) => void;
  onToolEvent?: (event: {
    phase: "start" | "delta" | "done";
    callId: string;
    name: string;
    args?: string;
    result?: string;
  }) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  onDone?: () => void;
};

function isStandaloneSseDataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return false;
  const payload = trimmed.slice(5).trimStart();
  if (!payload) return false;
  if (payload === "[DONE]") return true;
  try {
    JSON.parse(payload);
    return true;
  } catch {
    return false;
  }
}

function consumeSseEventBlocks(buffer: string, flush = false): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const pending = flush ? [] : [lines.pop() ?? ""];
  const completeLines = flush ? lines : lines;
  const events: string[] = [];
  let currentEvent: string[] = [];

  const emitCurrentEvent = () => {
    if (currentEvent.length === 0) return;
    events.push(currentEvent.join("\n"));
    currentEvent = [];
  };

  for (const line of completeLines) {
    if (line.length === 0) {
      emitCurrentEvent();
      continue;
    }

    if (currentEvent.length === 0 && isStandaloneSseDataLine(line)) {
      events.push(line);
      continue;
    }

    currentEvent.push(line);
  }

  if (flush) {
    emitCurrentEvent();
    return { events, rest: "" };
  }

  return {
    events,
    rest: [...currentEvent, ...pending].join("\n")
  };
}

function extractSseEventData(eventBlock: string): string {
  return eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

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
        throw new Error(await readErrorResponseMessage(candidate));
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
    let sawEvent = false;

    const processEventBlock = (eventBlock: string) => {
      const payload = extractSseEventData(eventBlock);
      if (!payload) return;
      try {
        const parsed = JSON.parse(payload) as {
          type: string;
          delta?: string;
          phase?: "start" | "delta" | "done";
          callId?: string;
          name?: string;
          args?: string;
          result?: string;
        };
        sawEvent = true;
        if (parsed.type === "delta" && parsed.delta) {
          callbacks.onDelta?.(parsed.delta);
        } else if (parsed.type === "reasoning_delta" && parsed.delta) {
          callbacks.onReasoningDelta?.(parsed.delta);
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
        } else {
          callbacks.onEvent?.(parsed as Record<string, unknown>);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const consumed = consumeSseEventBlocks(buffer);
        buffer = consumed.rest;
        for (const eventBlock of consumed.events) {
          processEventBlock(eventBlock);
        }
      }
    } catch (err) {
      if (!isStreamTerminationError(err) || (!doneEmitted && !sawEvent)) {
        throw err;
      }
    }

    const flushed = consumeSseEventBlocks(buffer, true);
    for (const eventBlock of flushed.events) {
      processEventBlock(eventBlock);
    }

    if (!doneEmitted) callbacks.onDone?.();
  } else {
    callbacks.onDone?.();
  }
}
