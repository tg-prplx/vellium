import { novelImagePrompt } from "./imagePrompt.js";
import { setTimeout as pause } from "node:timers/promises";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { UPLOADS_DIR } from "../../db.js";
import type { NovelStory } from "../../../src/shared/types/novels.js";
import { assertNovelEndpoint } from "./generation.js";
import { patchNovelWorkflow } from "./workflow.js";
import { record, text } from "./normalize.js";
import { writeNovel } from "./repository.js";

async function comfyFetch(base: string, path: string, signal: AbortSignal, init?: RequestInit) {
  const root = assertNovelEndpoint(base);
  const [pathname, query] = path.split("?");
  root.pathname = `${root.pathname.replace(/\/$/, "")}/${pathname}`;
  root.search = query || "";
  const response = await fetch(root, { ...init, signal, redirect: "error" });
  if (!response.ok) throw new Error(`ComfyUI request failed (${response.status})`);
  return response;
}
export async function renderNovelImages(story: NovelStory, signal: AbortSignal, retryId?: string): Promise<NovelStory> {
  const config = story.config;
  if (!config.workflow) throw Object.assign(new Error("Import a ComfyUI API workflow first"), { status: 400 });
  assertNovelEndpoint(config.comfyUrl);
  if (retryId && !story.scenes.some((scene) => scene.illustrations.some((frame) => frame.id === retryId))) throw Object.assign(new Error("Illustration not found"), { status: 404 });
  let current = story;
  // Sequential jobs keep a shared ComfyUI queue usable, and each frame is durable independently.
  for (const scene of current.scenes) for (const frame of scene.illustrations) {
    if (retryId ? frame.id !== retryId : frame.status !== "pending") continue;
    signal.throwIfAborted();
    try {
      const prompt = novelImagePrompt(current,scene,frame);
      const graph = patchNovelWorkflow(config.workflow, config, prompt, frame.seed);
      let promptId = frame.status === "pending" && frame.jobEndpoint === config.comfyUrl ? frame.jobId : undefined;
      if (!promptId) {
        const accepted = await (await comfyFetch(config.comfyUrl, "prompt", signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: `vellium-novel-${story.id}` }) })).json();
        promptId = text(accepted.prompt_id, 200);
        if (!promptId || accepted.error || Object.keys(record(accepted.node_errors)).length) throw new Error("ComfyUI rejected the workflow; check its models and nodes");
        frame.jobId = promptId; frame.jobEndpoint = config.comfyUrl; frame.status = "pending";
        current = writeNovel(current, current.revision);
      }
      let image: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 600; attempt++) {
        signal.throwIfAborted();
        const history = record(await (await comfyFetch(config.comfyUrl, `history/${encodeURIComponent(promptId)}`, signal)).json());
        const job = record(history[promptId]); const status = record(job.status);
        if (status.status_str === "error") throw new Error("ComfyUI image job failed");
        for (const output of Object.values(record(job.outputs))) {
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
      const name = `novel-${randomUUID()}.${ext}`;
      await mkdir(UPLOADS_DIR, { recursive: true }); await writeFile(join(UPLOADS_DIR, name), Buffer.concat(chunks));
      frame.url = `/api/uploads/${name}`; frame.status = "ready"; delete frame.error;
    } catch (error) {
      if (signal.aborted) throw error;
      frame.status = "error"; frame.error = error instanceof Error ? error.message : String(error);
    }
    current = writeNovel(current, current.revision);
  }
  return current;
}
