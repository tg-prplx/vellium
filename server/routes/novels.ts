import {defaultNovelSystemPrompt} from "../modules/novels/systemPrompt.js";
import { prepareNovelIllustrations } from "../modules/novels/illustrationPlan.js";
import { Router, type Request, type Response } from "express";
import { createNovel, resetNovelHistory, deleteNovel, getNovel, listNovels, saveNovelProgress, writeNovel } from "../modules/novels/repository.js";
import { integer, normalizeConfig, record, text } from "../modules/novels/normalize.js";
import { generateNovel } from "../modules/novels/generation.js";
import { renderNovelImages } from "../modules/novels/images.js";

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
router.post("/prompt-preview",(req,res)=>{try{res.json({defaultPrompt:defaultNovelSystemPrompt(normalizeConfig(req.body?.config))});}catch(error){fail(res,error);}});
router.get("/:id", (req, res) => { try { res.json(getNovel(req.params.id)); } catch (error) { fail(res, error); } });
router.patch("/:id", (req, res) => {
  try {
    const story = getNovel(req.params.id); const input = record(req.body);
    unlocked(story.id);
    if (input.revision !== story.revision) throw Object.assign(new Error("Novel changed; reload before saving"), { status: 409 });
    if (input.config) {
      story.config = normalizeConfig({ ...story.config, ...record(input.config), characterIds: story.config.characterIds });
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
async function run(req: Request, res: Response, images: boolean) {
  const id = String(req.params.id); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const abortDisconnected = () => { if (!res.writableEnded) controller.abort(); };
  try {
    unlocked(id); const story = getNovel(id);
    if (req.body?.revision !== story.revision) throw Object.assign(new Error("Novel changed; reload before generating"), { status: 409 });
    active.set(id, controller);
    res.once("close", abortDisconnected);
    timer = setTimeout(() => controller.abort(), images ? 25 * 60 * 1000 : 3 * 60 * 1000);
    if(images && req.body?.prepareOnly === true) {
      if(!story.config.workflow)throw new Error("Import a ComfyUI API workflow first");
      res.json(prepareNovelIllustrations(story)?writeNovel(story,story.revision):story);return;
    }
    const result = images
      ? await renderNovelImages(story, controller.signal, text(req.body?.illustrationId, 100) || undefined)
      : await generateNovel(story, text(req.body?.action, 4000), controller.signal);
    res.json(result);
  } catch (error) { if (!res.destroyed) fail(res, controller.signal.aborted ? new Error("Generation cancelled; completed scenes and images are saved") : error); }
  finally { if (timer) clearTimeout(timer); if (active.get(id) === controller) active.delete(id); res.removeListener("close", abortDisconnected); }
}
router.post("/:id/generate", (req, res) => void run(req, res, false));
router.post("/:id/images", (req, res) => void run(req, res, true));
export default router;
