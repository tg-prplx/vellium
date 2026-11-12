import {expandNovelCharacters} from "./castMembers.js";
import {normalizeNovelArtStyle} from "../../../src/shared/novelVisualDefaults.js";
import { DEFAULT_NOVEL_CONFIG, MAX_NOVEL_SCENES_PER_TURN, type NovelConfig, type NovelMemory, type NovelCharacter } from "../../../src/shared/types/novels.js";
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown, max = 6000): string => typeof value === "string" ? value.trim().slice(0, max) : "";
export const strings = (value: unknown, max = 40): string[] => Array.isArray(value) ? value.slice(0, max).map((v) => text(v, 1000)).filter(Boolean) : [];
export const integer = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
export function normalizeConfig(value: unknown): NovelConfig {
  const r = record(value); const d = DEFAULT_NOVEL_CONFIG;
  let workflow = null;
  if (r.workflow && typeof r.workflow === "object" && !Array.isArray(r.workflow)) {
    if (JSON.stringify(r.workflow).length > 300000) throw new Error("Workflow exceeds 300 KB");
    workflow = r.workflow as Record<string, unknown>;
  }
  return {
    imagePov:['first','third','over-shoulder','dynamic'].includes(String(r.imagePov))?r.imagePov as NovelConfig['imagePov']:'dynamic',
    imagePovCharacter:text(r.imagePovCharacter,200),
    systemPrompt: text(r.systemPrompt,40000),
    structuredOutput:r.structuredOutput==='off'||r.structuredOutput==='json_schema'?r.structuredOutput:'auto',
    premise: text(r.premise, 16000), protagonist: text(r.protagonist), tone: text(r.tone), artStyle: normalizeNovelArtStyle(text(r.artStyle)),
    direction: text(r.direction), language: text(r.language, 80) || d.language,
    providerId: text(r.providerId, 200), modelId: text(r.modelId, 200), characterIds: [...new Set(strings(r.characterIds, 12))],
    pov: ["first", "second", "third", "dynamic"].includes(String(r.pov)) ? r.pov as NovelConfig["pov"] : d.pov,
    povCharacter: text(r.povCharacter, 200), questionFrequency: ["off", "rare", "balanced", "frequent"].includes(String(r.questionFrequency)) ? r.questionFrequency as NovelConfig["questionFrequency"] : d.questionFrequency,
    scenesPerTurn: integer(r.scenesPerTurn, d.scenesPerTurn, 1, MAX_NOVEL_SCENES_PER_TURN), imagesPerScene: integer(r.imagesPerScene, d.imagesPerScene, 1, 4),
    contextChars: integer(r.contextChars, d.contextChars, 8000, 120000), maxTokens: integer(r.maxTokens, d.maxTokens, 1000, 16000),
    imagesEnabled: r.imagesEnabled === true, comfyUrl: text(r.comfyUrl, 2000) || d.comfyUrl, workflow,
    overrideWorkflowSize: r.overrideWorkflowSize === true, overrideWorkflowNegative: r.overrideWorkflowNegative === true,
    positiveNode: text(r.positiveNode, 100), negativeNode: text(r.negativeNode, 100), negativePrompt: text(r.negativePrompt) || d.negativePrompt,
    width: Math.round(integer(r.width, d.width, 256, 2048) / 8) * 8, height: Math.round(integer(r.height, d.height, 256, 2048) / 8) * 8
  };
}
export function normalizeCharacter(value: unknown): NovelCharacter {
  const r = record(value);
  return { ...(r.isGroup===true?{isGroup:true}:{}), ...(text(r.sourceCharacterId,100)?{sourceCharacterId:text(r.sourceCharacterId,100)}:{}), ...(text(r.outfit,500) ? {outfit:text(r.outfit,500)} : {}), id: text(r.id, 100), name: text(r.name, 120), description: text(r.description, 4000), appearance: text(r.appearance, 2000), personality: text(r.personality, 2000), relationships: text(r.relationships, 2000), state: text(r.state, 2000) };
}
export function mergeMemory(previous: NovelMemory, value: unknown): NovelMemory {
  const r = record(value);
  const characters = new Map(previous.characters.map((c) => [c.id, c]));
  for (const item of expandNovelCharacters(r.characters,[...characters.values()]).slice(0,40)) {
    const c = normalizeCharacter(item); if (!c.id) continue;
    const names = [...characters.values()].filter(item=>item.name.toLocaleLowerCase()===c.name.toLocaleLowerCase());
    const prior = characters.get(c.id) || names.find(item=>item.sourceCharacterId===c.sourceCharacterId) || (!c.sourceCharacterId && names.length===1?names[0]:undefined);
    if (!prior && !c.name) continue;
    const patch = record(item);
    // Immutable appearance and identity anchors survive model rewrites; state can evolve.
    characters.set(prior?.id || c.id, prior ? { ...prior, ...(c.isGroup?{isGroup:true}:{}), ...(!prior.outfit && c.outfit ? {outfit:c.outfit} : {}), state: typeof patch.state === "string" ? c.state : prior.state, relationships: typeof patch.relationships === "string" ? c.relationships : prior.relationships } : c);
  }
  // Legacy fields remain on disk for compatibility, but are never generated,
  // appended, or sent as another parallel plot-memory structure.
  return { summary: previous.summary, facts: previous.facts, threads: previous.threads,
    characters: [...characters.values()].slice(0, 40) };
}
