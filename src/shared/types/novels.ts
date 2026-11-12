import {DEFAULT_NOVEL_ART_STYLE} from "../novelVisualDefaults.js";
export type NovelPov = "first" | "second" | "third" | "dynamic";
export type NovelQuestionFrequency = "off" | "rare" | "balanced" | "frequent";
export interface NovelConfig {
  premise: string; protagonist: string; tone: string; artStyle: string; direction: string; language: string;
  providerId: string; modelId: string; characterIds: string[];
  pov: NovelPov; povCharacter: string; questionFrequency: NovelQuestionFrequency;
  scenesPerTurn: number; imagesPerScene: number; contextChars: number; maxTokens: number;
  imagesEnabled: boolean; comfyUrl: string; workflow: Record<string, unknown> | null;
  overrideWorkflowSize?: boolean; overrideWorkflowNegative?: boolean;
  positiveNode: string; negativeNode: string; negativePrompt: string; width: number; height: number;
}
export interface NovelCharacter {
  id: string; sourceCharacterId?: string; name: string; description: string; appearance: string;
  personality: string; relationships: string; state: string; outfit?: string;
}
export interface NovelMemory { summary: string; facts: string[]; threads: string[]; characters: NovelCharacter[] }
export interface NovelIllustration {
  id: string; prompt: string; characterIds: string[]; atLine: number; seed: number;
  jobId?: string; jobEndpoint?: string; camera?: "first-person" | "external"; viewpointCharacterId?: string;
  url: string | null; status: "pending" | "ready" | "error"; error?: string;
}
export interface NovelScene {
  id: string; title: string; location: string; pov: string;
  lines: Array<{ speaker: string; text: string }>; question: string; choices: string[];
  illustrations: NovelIllustration[]; memory: NovelMemory; visuals?: {location?:string;setting:string;outfits:Record<string,string>}; createdAt: string;
}
export interface NovelTurn { user: string; assistant: string; throughSceneId: string }
export interface NovelStory {
  id: string; title: string; config: NovelConfig; cast: NovelCharacter[]; memory: NovelMemory;
  scenes: NovelScene[]; turns: NovelTurn[]; cursor: { scene: number; line: number };
  contextCheckpoint?: {text:string;throughTurn:number;turnOffset?:number;updatedAt:string;passes:number};
  revision: number; createdAt: string; updatedAt: string;
  cache: { inputTokens: number; cachedTokens: number; cachedTokensReported?: boolean; outputTokens?: number; reasoningTokens?: number; cacheWriteTokens?: number; strategy: "stable-prefix" } | null;
}
export interface NovelSummary { id: string; title: string; sceneCount: number; updatedAt: string; cover: string | null }
export const DEFAULT_NOVEL_CONFIG: NovelConfig = {
  premise: "", protagonist: "", tone: "", artStyle: DEFAULT_NOVEL_ART_STYLE,
  direction: "", language: "English", providerId: "", modelId: "", characterIds: [], pov: "first", povCharacter: "",
  questionFrequency: "balanced", scenesPerTurn: 3, imagesPerScene: 2, contextChars: 48000, maxTokens: 6000,
  imagesEnabled: false, comfyUrl: "http://127.0.0.1:8188", workflow: null, positiveNode: "", negativeNode: "",
  negativePrompt: "text, watermark, bad anatomy, low quality", width: 1344, height: 768
};
