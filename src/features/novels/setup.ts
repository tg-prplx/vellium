import {MAX_NOVEL_SCENES_PER_TURN} from "../../shared/types/novels";
import type { NovelConfig } from "../../shared/types/novels";
import type { TranslationKey } from "../../shared/i18n";
export type NovelSetupStep = "story" | "generation" | "visuals" | "review";
export const NOVEL_SETUP_STEPS: NovelSetupStep[] = ["story", "generation", "visuals", "review"];
export interface NovelDraft { title: string; config: NovelConfig; step: NovelSetupStep }
export function isNovelWorkflow(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || "nodes" in value) return false;
  return Object.values(value).some((node) => node && typeof node === "object" && !Array.isArray(node)
    && typeof node.class_type === "string" && node.inputs && typeof node.inputs === "object");
}
export function novelStepProblem(step: NovelSetupStep, config: NovelConfig): TranslationKey | null {
  if (step === "story" && !config.premise.trim()&&!config.settingCardIds?.length) return "novel.setup.needPremise";
  if (step === "generation") {
    if (!config.providerId) return "novel.setup.needProvider";
    if (!config.modelId.trim()) return "novel.setup.needModel";
    if (!config.language.trim()) return "novel.setup.needLanguage";
  }
  if (step === "visuals" && config.imagesEnabled) {
    try { const url = new URL(config.comfyUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "novel.setup.needComfyUrl"; }
    catch { return "novel.setup.needComfyUrl"; }
    if (!isNovelWorkflow(config.workflow)) return "novel.setup.needWorkflow";
  }
  if (step === "generation" && (!Number.isFinite(config.scenesPerTurn) || config.scenesPerTurn < 1 || config.scenesPerTurn > MAX_NOVEL_SCENES_PER_TURN || !Number.isFinite(config.maxTokens) || config.maxTokens < 1000 || config.maxTokens > 16000 || !Number.isFinite(config.contextChars) || config.contextChars < 8000 || config.contextChars > 120000)) return "novel.setup.invalidLimits";
  if (step === "visuals" && config.imagesEnabled && (!Number.isFinite(config.imagesPerScene) || config.imagesPerScene < 1 || config.imagesPerScene > 4 || !Number.isFinite(config.width) || config.width < 256 || config.width > 2048 || !Number.isFinite(config.height) || config.height < 256 || config.height > 2048)) return "novel.setup.invalidDimensions";
  return null;
}
export function firstNovelProblem(config: NovelConfig) {
  for (const step of NOVEL_SETUP_STEPS) { const problem = novelStepProblem(step, config); if (problem) return { step, problem }; }
  return null;
}
