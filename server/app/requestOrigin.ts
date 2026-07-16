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
