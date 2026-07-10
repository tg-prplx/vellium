import { pathToFileURL } from "url";
import { applyServerRuntimeEnv, formatServerUrl, parseServerRuntimeOptions } from "./runtimeConfig.js";
import { createApp } from "./app/createApp.js";

const runtimeOptions = parseServerRuntimeOptions();
applyServerRuntimeEnv(runtimeOptions);
const app = createApp();
const PORT_RETRY_DELAYS_MS = [0, 120, 260, 520, 900];

export { app };

export function startServer(
  port: number = runtimeOptions.port,
  host: string = runtimeOptions.host
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const attemptListen = (attempt: number) => {
      const server = app.listen(port, host);
      server.once("listening", () => {
        if (settled) return;
        settled = true;
        console.log(`Server running on ${formatServerUrl({ host, port })}`);
        resolve(port);
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        const nextAttempt = attempt + 1;
        if (error.code === "EADDRINUSE" && nextAttempt < PORT_RETRY_DELAYS_MS.length) {
          const delay = PORT_RETRY_DELAYS_MS[nextAttempt] ?? 0;
          setTimeout(() => attemptListen(nextAttempt), delay);
          return;
        }
        settled = true;
        reject(error);
      });
    };

    attemptListen(0);
  });
}

const isDirectRun = (() => {
  if (process.env.SLV_SERVER_AUTOSTART === "1") {
    return true;
  }
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startServer(runtimeOptions.port, runtimeOptions.host).catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
