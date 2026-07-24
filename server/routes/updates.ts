import { Router } from "express";
import { db, DEFAULT_SETTINGS } from "../db.js";
import { getLatestAppUpdate } from "../services/appUpdates.js";

const router = Router();

function updateChecksAllowed(): { allowed: boolean; reason?: string } {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const stored = row?.payload ? JSON.parse(row.payload) as Record<string, unknown> : {};
    if (stored.checkForUpdates === false) {
      return { allowed: false, reason: "Update checks are disabled in Settings" };
    }
    if (stored.fullLocalMode === true) {
      return { allowed: false, reason: "Update checks are disabled in Full Local Mode" };
    }
    return { allowed: DEFAULT_SETTINGS.checkForUpdates };
  } catch {
    return { allowed: false, reason: "Update settings are unavailable" };
  }
}

router.get("/latest", async (_req, res) => {
  const policy = updateChecksAllowed();
  if (!policy.allowed) {
    res.status(403).json({ error: policy.reason || "Update checks are disabled" });
    return;
  }

  try {
    res.json(await getLatestAppUpdate());
  } catch {
    res.status(502).json({ error: "Could not check GitHub Releases for updates" });
  }
});

export default router;
