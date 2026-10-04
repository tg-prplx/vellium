export interface RequestOriginPolicy {
  publicMode: boolean;
  serveStatic: boolean;
  serverHost: string;
  serverPort: number;
  allowedOrigins?: readonly string[];
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeConfiguredHost(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function toHttpOrigin(hostname: string, port: number): string | null {
  const formattedHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  try {
    return new URL(`http://${formattedHostname}:${port}`).origin;
  } catch {
    return null;
  }
}

function configuredApplicationOrigins(policy: RequestOriginPolicy): Set<string> {
  const origins = new Set<string>();
  const configuredHost = normalizeConfiguredHost(policy.serverHost);
  const hostnames = isLoopbackHostname(configuredHost) || configuredHost === "0.0.0.0" || configuredHost === "::"
    ? ["127.0.0.1", "localhost", "::1"]
    : [configuredHost];

  for (const hostname of hostnames) {
    const origin = toHttpOrigin(hostname, policy.serverPort);
    if (origin) origins.add(origin);
  }
  for (const rawOrigin of policy.allowedOrigins || []) {
    try {
      origins.add(new URL(rawOrigin).origin);
    } catch {
      // Ignore malformed allowlist entries instead of weakening the check.
    }
  }
  return origins;
}

function isTrustedDevelopmentOrigin(origin: URL): boolean {
  return origin.protocol === "http:" && isLoopbackHostname(origin.hostname) && origin.port === "1420";
}

function parseHostHeaderHostname(rawHost: string): string | null {
  try {
    return normalizeConfiguredHost(new URL(`http://${rawHost.trim()}`).hostname);
  } catch {
    return null;
  }
}

/**
 * DNS-rebinding guard: a browser that reaches the local server through an
 * attacker-controlled domain sends that domain as Host (and omits Origin on
 * same-origin GETs), so local mode only answers loopback/configured hosts.
 * Public mode is gated by mandatory Basic Auth, whose browser credentials are
 * never sent to a rebinding origin.
 */
export function isAllowedRequestHost(
  rawHost: string | undefined,
  policy: RequestOriginPolicy
): boolean {
  if (policy.publicMode) return true;
  if (rawHost === undefined) return true;
  const hostname = parseHostHeaderHostname(rawHost);
  if (!hostname) return false;
  if (isLoopbackHostname(hostname)) return true;
  const configuredHost = normalizeConfiguredHost(policy.serverHost);
  if (configuredHost && configuredHost !== "0.0.0.0" && configuredHost !== "::" && hostname === configuredHost) {
    return true;
  }
  for (const rawOrigin of policy.allowedOrigins || []) {
    try {
      if (normalizeConfiguredHost(new URL(rawOrigin).hostname) === hostname) return true;
    } catch {
      // Ignore malformed allowlist entries instead of weakening the check.
    }
  }
  return false;
}

export function isAllowedRequestOrigin(
  rawOrigin: string | undefined,
  policy: RequestOriginPolicy
): boolean {
  if (!rawOrigin) return true;
  try {
    const origin = new URL(rawOrigin);
    if (configuredApplicationOrigins(policy).has(origin.origin)) return true;
    return !policy.publicMode && !policy.serveStatic && isTrustedDevelopmentOrigin(origin);
  } catch {
    return false;
  }
}
