export interface RequestOriginContext {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface RequestOriginPolicy {
  publicMode: boolean;
  serveStatic: boolean;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.split(",")[0]?.trim() || null : null;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveRequestOrigin(req: RequestOriginContext, trustForwarded: boolean): string | null {
  const forwardedProto = trustForwarded ? firstHeaderValue(req.headers["x-forwarded-proto"]) : null;
  const forwardedHost = trustForwarded ? firstHeaderValue(req.headers["x-forwarded-host"]) : null;
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || firstHeaderValue(req.headers.host);
  if (!host) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function isTrustedDevelopmentOrigin(origin: URL): boolean {
  return origin.protocol === "http:" && isLoopbackHostname(origin.hostname) && origin.port === "1420";
}

export function isAllowedRequestOrigin(
  req: RequestOriginContext,
  rawOrigin: string | undefined,
  policy: RequestOriginPolicy
): boolean {
  if (!rawOrigin) return true;
  try {
    const origin = new URL(rawOrigin);
    const requestOrigin = resolveRequestOrigin(req, policy.publicMode);
    if (requestOrigin && origin.origin === requestOrigin) return true;
    return !policy.publicMode && !policy.serveStatic && isTrustedDevelopmentOrigin(origin);
  } catch {
    return false;
  }
}
