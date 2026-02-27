import { pathToFileURL } from "url";
import { createApp } from "./app/createApp.js";

const DEFAULT_PORT = Number(process.env.SLV_SERVER_PORT || 3001);
const app = createApp();

export { app };

export function startServer(port: number = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`Server running on http://127.0.0.1:${port}`);
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
  startServer(DEFAULT_PORT).catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
