const DEFAULT_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000, 5_000];
const DEFAULT_RETRY_STATUSES = new Set([502, 503, 504]);
const SAFE_CONNECT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT"
]);
const PRIVATE_SOCKET_ERROR_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET"
]);

export interface ProviderFetchOptions {
  retryDelaysMs?: number[];
  retryStatuses?: number[];
}

function getErrorCause(error: unknown): unknown {
  if (!error || typeof error !== "object") return null;
  return (error as { cause?: unknown }).cause ?? null;
}

function getErrorCode(error: unknown): string {
  const cause = getErrorCause(error);
  if (cause && typeof cause === "object") {
    const code = String((cause as { code?: unknown }).code || "").trim();
    if (code) return code;
  }
  if (error && typeof error === "object") {
    return String((error as { code?: unknown }).code || "").trim();
  }
  return "";
}

function isAbortError(error: unknown, signal?: AbortSignal | null) {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function isPrivateProviderUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    const match172 = /^172\.(\d{1,3})\./.exec(hostname);
    if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
    const matchCarrier = /^100\.(\d{1,3})\./.exec(hostname);
    return Boolean(matchCarrier && Number(matchCarrier[1]) >= 64 && Number(matchCarrier[1]) <= 127);
  } catch {
    return false;
  }
}

function isRetryableNetworkError(error: unknown, url: string): boolean {
  const code = getErrorCode(error);
  if (SAFE_CONNECT_ERROR_CODES.has(code)) return true;
  return isPrivateProviderUrl(url) && PRIVATE_SOCKET_ERROR_CODES.has(code);
}

function endpointForError(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function describeProviderFetchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unknown network error");
  const cause = getErrorCause(error);
  const code = getErrorCode(error);
  if (cause instanceof Error && cause.message) {
    return [message, code, cause.message].filter((item, index, array) => item && array.indexOf(item) === index).join(": ");
  }
  if (cause && typeof cause === "object") {
    const syscall = String((cause as { syscall?: unknown }).syscall || "").trim();
    const address = String((cause as { address?: unknown }).address || "").trim();
    const port = String((cause as { port?: unknown }).port || "").trim();
    const target = address && port ? `${address}:${port}` : address || port;
    const details = [code, syscall, target].filter(Boolean).join(" ");
    if (details) return `${message}: ${details}`;
  }
  return [message, code].filter(Boolean).join(": ");
}

function abortReason(signal?: AbortSignal | null): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

async function waitForRetry(delayMs: number, signal?: AbortSignal | null) {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout.unref?.();
  });
}

/**
 * Provider requests must recover from network-interface changes without reusing
 * stale pooled sockets. Only connection failures that could not reach a public
 * provider are retried; ambiguous socket resets are retried only for local/private
 * endpoints. Explicit 502/503/504 responses are safe to retry before streaming.
 */
export async function fetchProviderResponse(
  url: string,
  init: RequestInit = {},
  options: ProviderFetchOptions = {}
): Promise<Response> {
  const retryDelays = options.retryDelaysMs?.length
    ? options.retryDelaysMs.map((value) => Math.max(0, Number(value) || 0))
    : DEFAULT_RETRY_DELAYS_MS;
  const retryStatuses = new Set(options.retryStatuses ?? [...DEFAULT_RETRY_STATUSES]);
  const headers = new Headers(init.headers);
  if (!headers.has("Connection")) headers.set("Connection", "close");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    await waitForRetry(retryDelays[attempt] ?? 0, init.signal);
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        cache: init.cache ?? "no-store"
      });
      if (retryStatuses.has(response.status) && attempt < retryDelays.length - 1) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      if (isAbortError(error, init.signal)) throw error;
      lastError = error;
      if (!isRetryableNetworkError(error, url) || attempt >= retryDelays.length - 1) break;
    }
  }

  const method = String(init.method || "GET").toUpperCase();
  throw new Error(
    `Provider request failed: ${method} ${endpointForError(url)} (${describeProviderFetchFailure(lastError)})`,
    { cause: lastError }
  );
}
