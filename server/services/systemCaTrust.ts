import * as tls from "node:tls";

interface SystemCaRuntime {
  getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
  setDefaultCACertificates?: (certificates: readonly string[]) => void;
}

export interface SystemCaTrustResult {
  supported: boolean;
  applied: boolean;
  addedCertificates: number;
}

/**
 * Add operating-system trusted roots to Node's normal Mozilla/extra CA set.
 *
 * Electron's embedded Node runtime does not enable `--use-system-ca` by
 * default. Consequently, HTTPS providers signed by a CA trusted in macOS,
 * Windows, or Linux can work in curl/the browser while failing in Vellium.
 * This keeps certificate verification enabled and only extends trust with the
 * same roots the operating system already trusts.
 *
 * Node 20 does not expose these APIs, so older headless/CI runtimes safely keep
 * their existing CA behavior.
 */
export function enableSystemCaTrust(
  runtime: SystemCaRuntime = tls as SystemCaRuntime
): SystemCaTrustResult {
  if (
    typeof runtime.getCACertificates !== "function"
    || typeof runtime.setDefaultCACertificates !== "function"
  ) {
    return { supported: false, applied: false, addedCertificates: 0 };
  }

  try {
    const current = runtime.getCACertificates("default");
    const known = new Set(current);
    const missing = runtime.getCACertificates("system")
      .filter((certificate) => !known.has(certificate));

    if (missing.length === 0) {
      return { supported: true, applied: false, addedCertificates: 0 };
    }

    runtime.setDefaultCACertificates([...current, ...missing]);
    return { supported: true, applied: true, addedCertificates: missing.length };
  } catch {
    // System CA discovery is best-effort. A platform-specific store failure must
    // not prevent Vellium from starting or remove Node's bundled CA roots.
    return { supported: true, applied: false, addedCertificates: 0 };
  }
}
