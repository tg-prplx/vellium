import { randomUUID } from "crypto";
import type { NovelConfig, NovelIllustration, NovelStory } from "../../../src/shared/types/novels.js";
import { assertNovelEndpoint } from "./endpoint.js";
import { novelImageTargets } from "./images.js";
import { record, text } from "./normalize.js";
import { patchNovelWorkflow } from "./workflow.js";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const reset = (item: { status: string; url: string | null; jobId?: string; jobEndpoint?: string; error?: string }) => {
  item.status = "pending"; item.url = null; delete item.jobId; delete item.jobEndpoint; delete item.error;
};

/** Reader actions, always started by the user: change a picture's description
 * and/or seed and queue it for rendering again. Nothing is redrawn on its own. */
export function editNovelImage(story: NovelStory, id: string, input: { prompt?: unknown; reseed?: unknown }) {
  const target = novelImageTargets(story).find((item) => item.item.id === id);
  if (!target) throw fail("Illustration not found", 404);
  const prompt = typeof input.prompt === "string" ? text(input.prompt, 4000) : undefined;
  if (prompt === "" ) throw fail("Describe the picture first");
  if (prompt === undefined && input.reseed !== true) throw fail("Nothing to change");
  if (prompt !== undefined) target.item.prompt = prompt;
  if (input.reseed === true) target.item.seed = Math.floor(Math.random() * 2147483647);
  if (target.asset) { delete target.asset.cut; delete target.asset.attempts; }
  reset(target.item);
  return story;
}

/** Add (or replace) the picture that starts at one line. An empty description
 * uses the line itself; no language model is involved. */
export function addNovelFrame(story: NovelStory, sceneId: string, atLine: number, prompt: string) {
  const scene = story.scenes.find((item) => item.id === sceneId);
  if (!scene) throw fail("Scene not found", 404);
  const line = scene.lines[atLine];
  if (!Number.isInteger(atLine) || !line) throw fail("Line not found", 404);
  const description = text(prompt, 4000) || text(line.text, 4000);
  const speaker = line.speaker.trim().toLocaleLowerCase();
  const characterIds = speaker ? scene.memory.characters.filter((c) => c.name.toLocaleLowerCase() === speaker).map((c) => c.id).slice(0, 1) : [];
  const existing = scene.illustrations.find((frame) => frame.atLine === atLine);
  if (existing) { existing.prompt = description; existing.seed = Math.floor(Math.random() * 2147483647); reset(existing); return { story, frameId: existing.id }; }
  if (scene.illustrations.length >= 8) throw fail("This scene already has the maximum number of pictures");
  const frame: NovelIllustration = { id: randomUUID(), prompt: description, characterIds, atLine, seed: Math.floor(Math.random() * 2147483647), url: null, status: "pending" };
  scene.illustrations = [...scene.illustrations, frame].sort((a, b) => a.atLine - b.atLine);
  return { story, frameId: frame.id };
}

export interface ComfyCheck { reachable: boolean; workflowOk: boolean; positiveNode?: string; negativeNode?: string; error?: string }
/** Check the server and the imported workflow without queueing any job. */
export async function checkComfy(config: NovelConfig, signal: AbortSignal): Promise<ComfyCheck> {
  const result: ComfyCheck = { reachable: false, workflowOk: false };
  try {
    const url = assertNovelEndpoint(config.comfyUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/system_stats`;
    const response = await fetch(url, { signal, redirect: "error" });
    result.reachable = response.ok;
    if (!response.ok) result.error = `ComfyUI answered ${response.status}`;
  } catch (error) { result.error = error instanceof Error ? error.message.slice(0, 300) : "ComfyUI is unreachable"; }
  if (!config.workflow) return { ...result, error: result.error || "Import a ComfyUI API workflow first" };
  try {
    const marker = "__vellium_check__";
    const graph = patchNovelWorkflow(config.workflow, config, marker, 1);
    result.positiveNode = Object.entries(graph).find(([, node]) => record(record(node).inputs).text === marker)?.[0];
    const negative = config.negativeNode && record(record(graph[config.negativeNode]).inputs).text !== undefined ? config.negativeNode : undefined;
    if (negative) result.negativeNode = negative;
    result.workflowOk = true;
  } catch (error) { result.error = result.error || (error instanceof Error ? error.message.slice(0, 300) : "Workflow is not usable"); }
  return result;
}
