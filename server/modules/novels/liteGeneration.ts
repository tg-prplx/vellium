import { randomUUID } from "crypto";
import { MAX_NOVEL_SCENES_PER_TURN, type NovelStory } from "../../../src/shared/types/novels.js";
import { unifiedGenerateText, type UnifiedGenerateMessage, type UnifiedProviderRow } from "../../services/unifiedGeneration.js";
import { applyDirectorPlan, directorFallback, directorInstruction, directorLineInstruction, directorNeeds, directorResponseFormat, parseDirectorReply, type DirectorNeeds, type DirectorPlan } from "./liteDirector.js";
import { inlinePlan, mergePlans, peopleToDescribe, replayMarkers, sparseScenes } from "./liteInline.js";
import { EarlyFrames, sameMachine } from "./earlyFrames.js";
import { buildLiteScenes, knownNames } from "./liteScenes.js";
import { parseLiteText, renderLiteScenes, type LiteBatch } from "./liteFormat.js";
import { inlinePicturesOn, liteAssistantText, liteMessages } from "./litePrompt.js";
import { novelQuestionPolicy } from "./questionPolicy.js";
import { writeNovel } from "./repository.js";
import { protagonistName } from "./protagonist.js";

export interface LitePreviewScene { id: string; location: string; lines: Array<{ speaker: string; text: string }> }
export interface LiteContext {
  provider: UnifiedProviderRow; modelId: string; signal: AbortSignal; apiParamPolicy: unknown; samplerConfig: Record<string, unknown>;
  lore?: string;
  /** Retrieved knowledge for this turn, already bounded. */
  reference?: string;
  /** Called with the scenes parsed so far after each completed line. */
  onPreview?: (scenes: LitePreviewScene[]) => void;
  /** The follow-up is about to run, and why: "choice", "pictures", or "describe:<names>". */
  onStage?: (stage: "director", reasons: string[]) => void;
}

export { buildLiteScenes, knownNames } from "./liteScenes.js";

/** Parse only complete lines, and nothing inside an unfinished reasoning block. */
export function previewText(buffer: string) {
  const complete = buffer.slice(0, buffer.lastIndexOf("\n") + 1);
  const open = complete.toLowerCase().lastIndexOf("<think>");
  if (open >= 0 && complete.toLowerCase().indexOf("</think>", open) < 0) return "";
  return complete;
}

/** One technical turn appended to the same conversation: the cached prefix is
 * reused and the model keeps the instructions it wrote the story under.
 * Returns null when the follow-up fails; the caller degrades gracefully. */
async function askDirector(saved: NovelStory, count: number, messages: UnifiedGenerateMessage[], reply: string, needs: DirectorNeeds, ctx: LiteContext): Promise<DirectorPlan | null> {
  const responseFormat = directorResponseFormat(saved, ctx.provider, needs, count);
  const instruction = responseFormat ? directorInstruction(saved, needs, count) : directorLineInstruction(saved, needs, count);
  try {
    const result = await unifiedGenerateText({ provider: ctx.provider, modelId: ctx.modelId, signal: ctx.signal, apiParamPolicy: ctx.apiParamPolicy,
      promptCacheKey: `novel:${saved.id}`, responseFormat, allowUnstructuredFallback: true,
      samplerConfig: { ...ctx.samplerConfig, temperature: 0.3, stop: [], koboldMemory: "", maxTokens: 700 },
      messages: [...messages, { role: "assistant", content: reply }, { role: "user", content: instruction }] });
    return parseDirectorReply(result.content);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return null;
  }
}

export async function generateLiteNovel(story: NovelStory, action: string, ctx: LiteContext): Promise<NovelStory> {
  const { messages, user } = liteMessages(story, action, { lore: ctx.lore, reference: ctx.reference });
  const names = knownNames(story), ids: string[] = [], picIds: string[] = [];
  const inline = inlinePicturesOn(story.config);
  const early = inline && ctx.onPreview && story.config.workflow && !sameMachine(ctx.provider.base_url, story.config.comfyUrl) ? new EarlyFrames(story, picIds, ctx.signal) : null;
  let buffer = "", parsedUpTo = 0;
  const onText = ctx.onPreview ? (delta: string) => {
    buffer += delta;
    if (!delta.includes("\n")) return;
    const complete = previewText(buffer);
    if (!complete || complete.length === parsedUpTo) return;
    parsedUpTo = complete.length;
    try {
      const batch = parseLiteText(complete, names);
      ctx.onPreview!(batch.scenes.slice(0, MAX_NOVEL_SCENES_PER_TURN).map((scene, i) => ({ id: (ids[i] ||= randomUUID()), location: scene.location, lines: scene.lines })));
      early?.consider(batch, ids);
    } catch { /* Nothing readable yet. */ }
  } : undefined;
  const result = await unifiedGenerateText({ provider: ctx.provider, modelId: ctx.modelId, messages, signal: ctx.signal, promptCacheKey: `novel:${story.id}`, apiParamPolicy: ctx.apiParamPolicy,
    samplerConfig: { ...ctx.samplerConfig, stop: [], koboldMemory: "", maxTokens: story.config.maxTokens }, onText });
  let batch: LiteBatch;
  try { batch = parseLiteText(result.content, names); }
  catch { throw new Error("The model returned an empty reply. No automatic paid retry was made; the story is unchanged."); }
  ctx.signal.throwIfAborted();
  const scenes = buildLiteScenes(story, batch, ids);
  const last = scenes[scenes.length - 1], count = scenes.length;
  const replay = liteAssistantText(result.content, scenes.map((s) => ({ location: s.location, lines: s.lines, question: s.question, choices: s.choices })), story.scenes.at(-1)?.location || "", inline ? batch.markers : []);
  // `user`/`assistant` stay JSON so compaction and JSON mode read them unchanged.
  const saved = writeNovel({ ...story, scenes: [...story.scenes, ...scenes],
    turns: [...story.turns, { user: JSON.stringify({ action }), throughSceneId: last.id, lite: { user, assistant: replay },
      assistant: JSON.stringify({ scenes: scenes.map((s) => ({ location: s.location, lines: s.lines, ...(s.question ? { question: s.question } : {}), ...(s.choices.length ? { choices: s.choices } : {}) })) }) }],
    cache: result.usage ? { ...result.usage, strategy: "stable-prefix" } : null }, story.revision);

  const visuals = story.config.imagesEnabled;
  const planned = inline ? inlinePlan(saved, batch, count, picIds) : null;
  const needs = directorNeeds(story.config, novelQuestionPolicy(story).required, scenes);
  const reasons: string[] = needs.choices ? ["choice"] : [];
  // With inline lines the follow-up only fills gaps: no pictures at all (full
  // frames mode), or people in a picture (sprites, in layers mode) nobody described.
  if (planned) {
    const layers = story.config.visualMode === "layers";
    const missing = visuals ? peopleToDescribe(saved, count, planned, layers) : [];
    needs.describe = missing;
    const noPictures = visuals && !layers && !planned.shots.length;
    // Too few pictures for the amount of text also needs filling.
    const sparse = visuals && !layers && !noPictures && sparseScenes(saved, count, planned).length > 0;
    needs.visuals = noPictures || sparse || missing.length > 0;
    if (noPictures) reasons.push("pictures");
    if (sparse) reasons.push("more-pictures");
    if (missing.length) reasons.push(`describe:${missing.join(", ")}`);
  } else if (needs.visuals) reasons.push("pictures");
  if (!needs.choices && !needs.visuals && !planned) return saved;
  let plan = planned;
  if (needs.choices || needs.visuals) {
    ctx.onStage?.("director", reasons);
    const directed = await askDirector(saved, count, messages, result.content, needs, ctx);
    plan = planned ? mergePlans(planned, directed) : directed;
  }
  ctx.signal.throwIfAborted();
  let next = plan ? applyDirectorPlan(saved, count, plan, { choices: needs.choices, visuals }) : directorFallback(saved, count, { choices: false, visuals });
  if (needs.choices || needs.visuals) {
    // Replay the turn as finally drawn: picture lines and the choice the
    // follow-up supplied, so the next turn imitates the full format. Costs one
    // re-read of this reply on the next request, only after a follow-up.
    const final = next, scenesNow = final.scenes.slice(-count);
    const assistant = inline ? renderLiteScenes(scenesNow.map((s) => ({ location: s.location, lines: s.lines, question: s.question, choices: s.choices })), story.scenes.at(-1)?.location || "", replayMarkers(final, story, count, batch.markers)) : undefined;
    // Keep why the follow-up ran on the turn, for the reader and for debugging.
    next = { ...final, turns: final.turns.map((turn, i) => i === final.turns.length - 1 && turn.lite ? { ...turn, lite: { ...turn.lite, ...(assistant ? { assistant } : {}), director: reasons } } : turn) };
  }
  if (early) next = await early.adopt(next, count);
  return writeNovel(next, saved.revision);
}
