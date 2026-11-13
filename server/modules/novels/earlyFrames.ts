import type { NovelStory } from "../../../src/shared/types/novels.js";
import type { LiteBatch } from "./liteFormat.js";
import { applyDirectorPlan } from "./liteDirector.js";
import { inlinePlan } from "./liteInline.js";
import { buildLiteScenes } from "./liteScenes.js";
import { novelImagePrompt } from "./imagePrompt.js";
import { submitComfyJob } from "./images.js";
import { patchNovelWorkflow } from "./workflow.js";

const host = (raw: string) => {
  try {
    const name = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return /^(?:localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/.test(name) ? "loopback" : name;
  } catch { return ""; }
};
/** Rendering while the model writes only helps when ComfyUI and the language
 * model use different machines; on one GPU they would slow each other down. */
export const sameMachine = (providerUrl: string, comfyUrl: string) => { const a = host(providerUrl), b = host(comfyUrl); return !a || !b || a === b; };

/** Queues each inline [pic] frame in ComfyUI as soon as its line is complete.
 * The saved frame adopts the queued job only if its final prompt and seed are
 * exactly what was queued; otherwise it renders normally afterwards. */
export class EarlyFrames {
  private queued = new Map<string, { prompt: string; seed: number; job: Promise<string | null> }>();
  constructor(private story: NovelStory, private picIds: string[], private signal: AbortSignal) {}

  consider(batch: LiteBatch, sceneIds: string[]) {
    const config = this.story.config;
    if (!config.workflow || !batch.markers.some((m) => m.kind === "pic")) return;
    try {
      const scenes = buildLiteScenes(this.story, batch, sceneIds);
      const provisional = { ...this.story, scenes: [...this.story.scenes, ...scenes] };
      const plan = inlinePlan(provisional, batch, scenes.length, this.picIds);
      const applied = applyDirectorPlan(provisional, scenes.length, plan, { choices: false, visuals: true });
      // Wait until everyone in a picture is described; an earlier prompt would
      // miss their looks and the job would be thrown away on save.
      const described = (name: string) => applied.memory.characters.some((c) => c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase() && (c.appearance || c.description));
      const wanted = new Set(plan.shots.filter((shot) => shot.who.every(described)).map((shot) => shot.id));
      for (const scene of applied.scenes.slice(-scenes.length)) for (const frame of scene.illustrations) {
        if (!wanted.has(frame.id) || this.queued.has(frame.id)) continue;
        const prompt = novelImagePrompt(applied, scene, frame);
        const graph = patchNovelWorkflow(config.workflow, config, prompt, frame.seed);
        this.queued.set(frame.id, { prompt, seed: frame.seed, job: submitComfyJob(config, graph, this.story.id, this.signal).catch(() => null) });
      }
    } catch { /* A partial batch can be unusable; the saved story renders normally. */ }
  }

  /** Mark saved frames whose queued job still matches; mutates `story`. */
  async adopt(story: NovelStory, count: number) {
    for (const scene of story.scenes.slice(-count)) for (const frame of scene.illustrations) {
      const queued = this.queued.get(frame.id);
      if (!queued) continue;
      const job = await queued.job;
      if (job && queued.seed === frame.seed && queued.prompt === novelImagePrompt(story, scene, frame)) {
        frame.jobId = job; frame.jobEndpoint = story.config.comfyUrl; frame.status = "pending";
      }
    }
    return story;
  }
  get size() { return this.queued.size; }
}
