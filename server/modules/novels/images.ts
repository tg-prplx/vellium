import { novelImagePrompt } from "./imagePrompt.js";
import { setTimeout as pause } from "node:timers/promises";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { UPLOADS_DIR } from "../../db.js";
import type { NovelAsset, NovelIllustration, NovelScene, NovelStory } from "../../../src/shared/types/novels.js";
import { assertNovelEndpoint } from "./endpoint.js";
import { patchNovelWorkflow } from "./workflow.js";
import { record, text } from "./normalize.js";
import { writeNovel } from "./repository.js";
import { decodePng, encodePng } from "./png.js";
import { cutoutBackground } from "./cutout.js";

async function comfyFetch(base: string, path: string, signal: AbortSignal, init?: RequestInit) {
  const root = assertNovelEndpoint(base);
  const [pathname, query] = path.split("?");
  root.pathname = `${root.pathname.replace(/\/$/, "")}/${pathname}`;
  root.search = query || "";
  const response = await fetch(root, { ...init, signal, redirect: "error" });
  if (!response.ok) throw new Error(`ComfyUI request failed (${response.status})`);
  return response;
}

type Job = NovelIllustration | NovelAsset;

/** Queue one patched workflow in ComfyUI and return its prompt ID. */
export async function submitComfyJob(config: NovelStory["config"], graph: Record<string, unknown>, storyId: string, signal: AbortSignal) {
  const accepted = await (await comfyFetch(config.comfyUrl, "prompt", signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: `vellium-novel-${storyId}` }) })).json();
  const promptId = text(accepted.prompt_id, 200);
  if (!promptId || accepted.error || Object.keys(record(accepted.node_errors)).length) throw new Error("ComfyUI rejected the workflow; check its models and nodes");
  return promptId;
}
interface Target { item: Job; scene?: NovelScene; asset?: NovelAsset }

/** Backgrounds first (the stage is usable soonest), then sprites, then frames. */
export function novelImageTargets(story: NovelStory): Target[] {
  return [
    ...Object.values(story.backgrounds || {}).map((asset) => ({ item: asset, asset })),
    ...Object.values(story.sprites || {}).map((asset) => ({ item: asset, asset })),
    ...story.scenes.flatMap((scene) => scene.illustrations.map((frame) => ({ item: frame as Job, scene })))
  ];
}

/** Submit (or resume) one ComfyUI job and download its image. Job IDs are
 * persisted as soon as ComfyUI accepts the prompt so a cancelled render can
 * resume without submitting a duplicate. */
async function renderJob(story: NovelStory, item: Job, prompt: string, size: { width: number; height: number } | undefined, persist: () => void, signal: AbortSignal) {
  const config = story.config;
  const graph = patchNovelWorkflow(config.workflow!, config, prompt, item.seed, size);
  let promptId = item.status === "pending" && item.jobEndpoint === config.comfyUrl ? item.jobId : undefined;
  if (!promptId) {
    promptId = await submitComfyJob(config, graph, story.id, signal);
    item.jobId = promptId; item.jobEndpoint = config.comfyUrl; item.status = "pending";
    persist();
  }
  let image: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 600; attempt++) {
    signal.throwIfAborted();
    const history = record(await (await comfyFetch(config.comfyUrl, `history/${encodeURIComponent(promptId)}`, signal)).json());
    const job = record(history[promptId]); const status = record(job.status);
    if (status.status_str === "error") throw new Error("ComfyUI image job failed");
    const outputs = Object.entries(record(job.outputs)).sort(([a], [b]) => {
      const score = (id: string) => record(graph[id]).class_type === "SaveImage" ? 0 : 1;
      return score(a) - score(b);
    });
    for (const [, output] of outputs) {
      const images = record(output).images;
      if (Array.isArray(images) && images.length) { image = record(images[0]); break; }
    }
    if (image) break;
    if (status.completed === true) throw new Error("Workflow finished without an image output");
    await pause(2000, undefined, { signal });
  }
  if (!image) throw new Error("ComfyUI image timed out after 20 minutes");
  const query = new URLSearchParams({ filename: text(image.filename, 500), subfolder: text(image.subfolder, 500), type: image.type === "temp" ? "temp" : "output" });
  const response = await comfyFetch(config.comfyUrl, `view?${query}`, signal);
  const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[mime];
  if (!ext) throw new Error("ComfyUI returned an unsupported image type");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty image response");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MB"); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return { data: Buffer.concat(chunks), ext };
}

/** Remove a sprite's chroma backdrop. One fresh seed is tried when the result
 * does not look like a single figure; after that the plain image is kept. */
function cutSprite(data: Buffer, ext: string) {
  if (ext !== "png") return null;
  const image = decodePng(data);
  if (!image) return null;
  const result = cutoutBackground(image.rgba, image.width, image.height);
  return result.ok ? encodePng({ width: image.width, height: image.height, rgba: result.rgba }) : null;
}

export async function renderNovelImages(story: NovelStory, signal: AbortSignal, retryId?: string): Promise<NovelStory> {
  const config = story.config;
  if (!config.workflow) throw Object.assign(new Error("Import a ComfyUI API workflow first"), { status: 400 });
  assertNovelEndpoint(config.comfyUrl);
  if (retryId && !novelImageTargets(story).some((target) => target.item.id === retryId)) throw Object.assign(new Error("Illustration not found"), { status: 404 });
  let current = story;
  const persist = () => { current = writeNovel(current, current.revision); };
  // Sequential jobs keep a shared ComfyUI queue usable, and each image is durable independently.
  for (const { item, scene, asset } of novelImageTargets(current)) {
    if (retryId ? item.id !== retryId : item.status !== "pending") continue;
    signal.throwIfAborted();
    try {
      let output: { data: Buffer; ext: string };
      for (;;) {
        const prompt = asset ? asset.prompt : novelImagePrompt(current, scene!, item as NovelIllustration);
        const rendered = await renderJob(current, item, prompt, asset ? { width: asset.width, height: asset.height } : undefined, persist, signal);
        if (asset?.kind !== "sprite") { output = rendered; break; }
        const cut = cutSprite(rendered.data, rendered.ext);
        if (cut) { output = { data: cut, ext: "png" }; asset.cut = true; break; }
        if ((asset.attempts || 0) < 1) {
          asset.attempts = (asset.attempts || 0) + 1; asset.seed = Math.floor(Math.random() * 2147483647);
          delete asset.jobId; delete asset.jobEndpoint; persist(); continue;
        }
        output = rendered; asset.cut = false; break;
      }
      const name = `novel-${randomUUID()}.${output.ext}`;
      await mkdir(UPLOADS_DIR, { recursive: true }); await writeFile(join(UPLOADS_DIR, name), output.data);
      item.url = `/api/uploads/${name}`; item.status = "ready"; delete item.error;
    } catch (error) {
      if (signal.aborted) throw error;
      item.status = "error"; item.error = error instanceof Error ? error.message : String(error);
    }
    persist();
  }
  return current;
}
