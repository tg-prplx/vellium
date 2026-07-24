import { Router } from "express";
import { db, DEFAULT_SETTINGS, isLocalhostUrl } from "../db.js";
import { transcribeSpeech } from "../services/speechToText.js";

const router = Router();

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  try {
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.payload) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

router.post("/transcribe", async (req, res) => {
  const settings = getSettings();
  const baseUrl = String(settings.sttBaseUrl || "").trim();
  const model = String(settings.sttModel || "").trim();
  if (!baseUrl || !model) {
    res.status(400).json({ error: "Whisper-compatible STT endpoint and model are not configured" });
    return;
  }
  if (settings.fullLocalMode && !isLocalhostUrl(baseUrl)) {
    res.status(403).json({ error: "STT endpoint blocked by Full Local Mode" });
    return;
  }

  const body = req.body as {
    audioBase64?: unknown;
    mimeType?: unknown;
    filename?: unknown;
  } | undefined;
  try {
    const text = await transcribeSpeech({
      baseUrl,
      apiKey: String(settings.sttApiKey || ""),
      model,
      language: String(settings.sttLanguage || ""),
      audioBase64: String(body?.audioBase64 || ""),
      mimeType: String(body?.mimeType || ""),
      filename: String(body?.filename || "")
    });
    res.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isInputError = /payload|audio type|not configured|must use|credentials/i.test(message);
    res.status(isInputError ? 400 : 502).json({ error: message || "STT request failed" });
  }
});

export default router;
