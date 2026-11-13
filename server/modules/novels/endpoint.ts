import { DEFAULT_SETTINGS, db, isLocalhostUrl } from "../../db.js";

export function novelSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.payload) };
}
/** Provider and ComfyUI URLs: plain HTTP(S), no credentials, and loopback only
 * in Full Local Mode or for local-only providers. */
export function assertNovelEndpoint(raw: string, localOnly = false) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTP(S) endpoint without credentials, query or fragment");
  if ((novelSettings().fullLocalMode || localOnly) && !isLocalhostUrl(url.toString())) throw new Error("Endpoint blocked by local-only mode");
  return url;
}
