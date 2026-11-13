import {snapshotSettingCards,hasNovelPremise} from "../modules/novels/settingCards.js";
import {defaultNovelSystemPrompt} from "../modules/novels/systemPrompt.js";
import {defaultLiteSystemPrompt} from "../modules/novels/litePrompt.js";
import { prepareNovelIllustrations } from "../modules/novels/illustrationPlan.js";
import { Router, type Request, type Response } from "express";
import { createNovel, resetNovelHistory, deleteNovel, getNovel, listNovels, saveNovelProgress, writeNovel } from "../modules/novels/repository.js";
import { integer, normalizeConfig, record, text } from "../modules/novels/normalize.js";
import { generateNovel } from "../modules/novels/generation.js";
import { renderNovelImages } from "../modules/novels/images.js";
import type { NovelStory } from "../../src/shared/types/novels.js";
import { addNovelFrame, checkComfy, editNovelImage } from "../modules/novels/frameEdits.js";
import { snapshotPersona } from "../modules/novels/protagonist.js";
import { novelFromChat, novelToChat } from "../modules/novels/chatBridge.js";
import { exportNovelToWriter } from "../modules/novels/writerExport.js";

const router = Router();
const active = new Map<string, AbortController>();
function fail(res: Response, error: unknown) {
  const status = Number(record(error).status) || 400;
  // Provider errors can contain request data; never echo model output or secrets.
  res.status(status).json({ error: error instanceof Error ? error.message.slice(0, 500) : "Novel operation failed" });
}
function unlocked(id: string) { if (active.has(id)) throw Object.assign(new Error("Novel generation is already running"), { status: 409 }); }
router.get("/", (_req, res) => { res.json(listNovels()); });
router.post("/", (req, res) => { try { res.status(201).json(createNovel(req.body)); } catch (error) { fail(res, error); } });
router.post("/prompt-preview",(req,res)=>{try{const config=normalizeConfig(req.body?.config);res.json({defaultPrompt:config.generationMode==='lite'?defaultLiteSystemPrompt(config):defaultNovelSystemPrompt(config)});}catch(error){fail(res,error);}});
// POST: it contacts the ComfyUI server. No job is queued.
router.post("/comfy-check", async (req, res) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try { res.json(await checkComfy(normalizeConfig(record(req.body).config), controller.signal)); } catch (error) { fail(res, error); } finally { clearTimeout(timer); }
});
router.post("/from-chat", (req, res) => {
  try { const input = record(req.body); res.status(201).json(novelFromChat(text(input.chatId, 100), text(input.branchId, 100) || undefined)); } catch (error) { fail(res, error); }
});
router.post("/:id/export-writer", (req, res) => {
  try { const story = getNovel(req.params.id); res.status(201).json(exportNovelToWriter(story)); } catch (error) { fail(res, error); }
});
router.post("/:id/to-chat", (req, res) => {
  try { const story = getNovel(req.params.id); unlocked(story.id); res.status(201).json(novelToChat(story)); } catch (error) { fail(res, error); }
});
router.get("/:id", (req, res) => { try { res.json(getNovel(req.params.id)); } catch (error) { fail(res, error); } });
router.patch("/:id", (req, res) => {
  try {
    const story = getNovel(req.params.id); const input = record(req.body);
    unlocked(story.id);
    if (input.revision !== story.revision) throw Object.assign(new Error("Novel changed; reload before saving"), { status: 409 });
    if (input.config) {
      const config=normalizeConfig({ ...story.config, ...record(input.config), characterIds: story.config.characterIds });
      const settingCards=snapshotSettingCards(config.settingCardIds||[],story.settingCards||[]);
      if(!hasNovelPremise(config.premise,settingCards))throw Object.assign(new Error("A premise or a story foundation card with content is required"),{status:400});
      const persona=snapshotPersona(config.personaId,story.persona);
      story.config=config;story.settingCards=settingCards;
      if(persona)story.persona=persona;else delete story.persona;
    }
    if (typeof input.title === "string") story.title = text(input.title, 160) || story.title;
    if (input.cursor) {
      const c = record(input.cursor); const scene = integer(c.scene, story.cursor.scene, 0, Math.max(0, story.scenes.length - 1));
      story.cursor = { scene, line: integer(c.line, 0, 0, Math.max(0, (story.scenes[scene]?.lines.length || 1) - 1)) };
    }
    const saved = writeNovel(story, story.revision);
    if (input.cursor) saved.cursor = saveNovelProgress(story.id, input.cursor);
    res.json(saved);
  } catch (error) { fail(res, error); }
});
function editable(req: Request) {
  unlocked(String(req.params.id)); const story = getNovel(String(req.params.id));
  if (record(req.body).revision !== story.revision) throw Object.assign(new Error("Novel changed; reload before editing"), { status: 409 });
  return story;
}
router.patch("/:id/illustrations/:frameId", (req, res) => {
  try { const story = editable(req); res.json(writeNovel(editNovelImage(story, String(req.params.frameId), record(req.body)), story.revision)); }
  catch (error) { fail(res, error); }
});
router.post("/:id/illustrations", (req, res) => {
  try {
    const story = editable(req), input = record(req.body);
    const added = addNovelFrame(story, text(input.sceneId, 100), typeof input.atLine === "number" ? input.atLine : -1, text(input.prompt, 4000));
    res.json({ story: writeNovel(added.story, story.revision), frameId: added.frameId });
  } catch (error) { fail(res, error); }
});
router.post("/:id/reset",(req,res)=>{
  try{
    unlocked(req.params.id);const story=getNovel(req.params.id);
    if(req.body?.revision!==story.revision)throw Object.assign(new Error("Novel changed; reload before resetting"),{status:409});
    res.json(resetNovelHistory(story));
  }catch(error){fail(res,error);}
});
router.delete("/:id", (req, res) => { try { unlocked(req.params.id); deleteNovel(req.params.id); res.json({ ok: true }); } catch (error) { fail(res, error); } });
router.post("/:id/progress", (req, res) => {
  try { res.json(saveNovelProgress(req.params.id, req.body)); } catch (error) { fail(res, error); }
});
router.post("/:id/abort", (req, res) => { active.get(req.params.id)?.abort(); res.json({ ok: true }); });
type RunMode = "text" | "images" | "stream";
async function run(req: Request, res: Response, mode: RunMode) {
  const images = mode === "images";
  const id = String(req.params.id); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const abortDisconnected = () => { if (!res.writableEnded) controller.abort(); };
  try {
    unlocked(id); const story = getNovel(id);
    if (req.body?.revision !== story.revision) throw Object.assign(new Error("Novel changed; reload before generating"), { status: 409 });
    active.set(id, controller);
    res.once("close", abortDisconnected);
    // Local models at ~20 tokens/s need minutes for one batch; the reader can cancel.
    timer = setTimeout(() => controller.abort(), images ? 25 * 60 * 1000 : 20 * 60 * 1000);
    if(images && req.body?.prepareOnly === true) {
      if(!story.config.workflow)throw new Error("Import a ComfyUI API workflow first");
      res.json(prepareNovelIllustrations(story)?writeNovel(story,story.revision):story);return;
    }
    if (mode === "stream") { await streamStory(res, story, text(req.body?.action, 4000), controller.signal); return; }
    const result = images
      ? await renderNovelImages(story, controller.signal, text(req.body?.illustrationId, 100) || undefined)
      : await generateNovel(story, text(req.body?.action, 4000), controller.signal);
    res.json(result);
  } catch (error) {
    const reported = controller.signal.aborted ? new Error("Generation cancelled; completed scenes and images are saved") : error;
    if (res.destroyed) return;
    if (res.headersSent) { if (!res.writableEnded) res.end(`${JSON.stringify({ type: "error", error: reported instanceof Error ? reported.message.slice(0, 500) : "Novel operation failed" })}\n`); }
    else fail(res, reported);
  }
  finally { if (timer) clearTimeout(timer); if (active.get(id) === controller) active.delete(id); res.removeListener("close", abortDisconnected); }
}
/** NDJSON: `preview` events carry the scenes parsed so far, `stage` marks the
 * illustration/choice follow-up, `done` carries the saved story. */
async function streamStory(res: Response, story: NovelStory, action: string, signal: AbortSignal) {
  res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event: Record<string, unknown>) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  const saved = await generateNovel(story, action, signal, { onPreview: (scenes) => send({ type: "preview", scenes }), onStage: (stage, reasons) => send({ type: "stage", stage, reasons }) });
  send({ type: "done", story: saved });
  res.end();
}
router.post("/:id/generate", (req, res) => void run(req, res, "text"));
router.post("/:id/generate-stream", (req, res) => void run(req, res, "stream"));
router.post("/:id/images", (req, res) => void run(req, res, "images"));
export default router;
