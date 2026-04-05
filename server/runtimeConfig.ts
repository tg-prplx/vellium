export interface ServerRuntimeOptions {
  headless: boolean;
  serveStatic: boolean;
  host: string;
  port: number;
  allowRemote: boolean;
  basicAuth: string | null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function readArgValue(argv: string[], index: number, arg: string): { value: string | null; nextIndex: number } {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return {
      value: arg.slice(equalsIndex + 1).trim() || null,
      nextIndex: index
    };
  }
  const nextValue = argv[index + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    return { value: null, nextIndex: index };
  }
  return {
    value: nextValue.trim() || null,
    nextIndex: index + 1
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(String(host || "").trim().toLowerCase());
}

export function parseServerRuntimeOptions(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ServerRuntimeOptions {
  let headless = env.SLV_HEADLESS === "1";
  let serveStatic = env.SLV_SERVE_STATIC === "1" || env.ELECTRON_SERVE_STATIC === "1";
  let host = String(env.SLV_SERVER_HOST || "").trim() || "127.0.0.1";
  let requestedPort = String(env.SLV_SERVER_PORT || "").trim() || undefined;
  let allowRemote = env.SLV_SERVER_PUBLIC === "1";
  let basicAuth = String(env.SLV_BASIC_AUTH || "").trim() || null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headless") {
      headless = true;
      serveStatic = true;
      continue;
    }
    if (arg === "--serve-static") {
      serveStatic = true;
      continue;
    }
    if (arg === "--allow-remote" || arg === "--public") {
      allowRemote = true;
      continue;
    }
    if (arg === "--host" || arg.startsWith("--host=")) {
      const { value, nextIndex } = readArgValue(argv, index, arg);
      if (value) host = value;
      index = nextIndex;
      continue;
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      const { value, nextIndex } = readArgValue(argv, index, arg);
      if (value) requestedPort = value;
      index = nextIndex;
      continue;
    }
    if (arg === "--basic-auth" || arg === "--auth" || arg.startsWith("--basic-auth=") || arg.startsWith("--auth=")) {
      const { value, nextIndex } = readArgValue(argv, index, arg);
      if (value) basicAuth = value;
      index = nextIndex;
    }
  }

  if (headless) {
    serveStatic = true;
  }

  const fallbackPort = serveStatic ? 3001 : 3002;
  const port = parsePort(requestedPort, fallbackPort);

  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(`Refusing to bind ${host} without --allow-remote. Use a loopback host or pass --allow-remote explicitly.`);
  }
  if (basicAuth && !basicAuth.includes(":")) {
    throw new Error("Basic auth must use the format username:password.");
  }

  return {
    headless,
    serveStatic,
    host,
    port,
    allowRemote,
    basicAuth
  };
}

export function applyServerRuntimeEnv(
  options: ServerRuntimeOptions,
  env: NodeJS.ProcessEnv = process.env
) {
  env.SLV_HEADLESS = options.headless ? "1" : "0";
  env.SLV_SERVE_STATIC = options.serveStatic ? "1" : "0";
  env.SLV_SERVER_HOST = options.host;
  env.SLV_SERVER_PORT = String(options.port);
  env.SLV_SERVER_PUBLIC = options.allowRemote ? "1" : "0";
  env.SLV_BASIC_AUTH = options.basicAuth || "";
}

export function formatServerUrl(options: Pick<ServerRuntimeOptions, "host" | "port">): string {
  const host = options.host === "0.0.0.0"
    ? "127.0.0.1"
    : options.host === "::"
      ? "[::1]"
      : options.host;
  return `http://${host}:${options.port}`;
}
