import { pathToFileURL } from "url";
import { applyServerRuntimeEnv, formatServerUrl, parseServerRuntimeOptions } from "./runtimeConfig.js";
import { createApp } from "./app/createApp.js";

const runtimeOptions = parseServerRuntimeOptions();
applyServerRuntimeEnv(runtimeOptions);
const app = createApp();

export { app };

export function startServer(
  port: number = runtimeOptions.port,
  host: string = runtimeOptions.host
): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`Server running on ${formatServerUrl({ host, port })}`);
      resolve(port);
    });
    server.on("error", reject);
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
