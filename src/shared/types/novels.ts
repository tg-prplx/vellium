import {DEFAULT_NOVEL_ART_STYLE,DEFAULT_NOVEL_NEGATIVE_PROMPT} from "../novelVisualDefaults.js";
export const MAX_NOVEL_SCENES_PER_TURN=20;
export type NovelPov = "first" | "second" | "third" | "dynamic";
export type NovelImagePov = "first" | "third" | "over-shoulder" | "dynamic";
export type NovelQuestionFrequency = "off" | "rare" | "balanced" | "frequent";
export interface NovelConfig {
  systemPrompt?:string;
  imagePov?:NovelImagePov; imagePovCharacter?:string;
  structuredOutput?:"auto"|"json_schema"|"off";
  /** "lite": plain-text story lines parsed by the server (small models). "json": one structured reply. Stories saved before the mode existed are "json". */
  generationMode?:"lite"|"json";
  /** "layers": one background per place and one cut-out sprite per person and
   * outfit, composed by the reader; full frames only for key moments. Lite mode only. */
  visualMode?:"shots"|"layers";
  /** Lite mode: the narrator marks pictures, new people, clothing and places with [..] lines inside the story text. */
  inlinePictures?:boolean;
  /** User persona playing the protagonist; "" means the free-text field is used. */
  personaId?:string;
  /** Lite mode: knowledge collections searched each turn. */
  ragEnabled?:boolean; ragCollectionIds?:string[];
  premise: string; protagonist: string; tone: string; artStyle: string; direction: string; language: string;
  providerId: string; modelId: string; characterIds: string[]; settingCardIds?:string[];
  pov: NovelPov; povCharacter: string; questionFrequency: NovelQuestionFrequency;
  scenesPerTurn: number; imagesPerScene: number; contextChars: number; maxTokens: number;
  imagesEnabled: boolean; comfyUrl: string; workflow: Record<string, unknown> | null;
  overrideWorkflowSize?: boolean; overrideWorkflowNegative?: boolean;
  positiveNode: string; negativeNode: string; negativePrompt: string; width: number; height: number;
}
export interface NovelSettingCard {
  sourceCharacterId:string; name:string; description?:string; scenario?:string; personality?:string;
  instructions?:string; continuationInstructions?:string; opening?:string; examples?:string;
}
export interface NovelPersona { id: string; name: string; description: string; personality: string }
export interface NovelCharacter {
  id: string; sourceCharacterId?: string; isGroup?:boolean; name: string; description: string; appearance: string;
  personality: string; relationships: string; state: string; outfit?: string;
  /** Short English description for pictures (age, skin tone, face, hair, eyes, build); card prose is not drawable. */
  look?: string;
}
export interface NovelMemory { summary: string; facts: string[]; threads: string[]; characters: NovelCharacter[] }
export interface NovelIllustration {
  id: string; prompt: string; characterIds: string[]; atLine: number; seed: number;
  subjectNames?:string[];
  /** Outfits that differ from the scene's: a frame before a mid-scene change keeps the earlier clothes. */
  outfits?: Record<string, string>;
  jobId?: string; jobEndpoint?: string; camera?: "first-person" | "external" | "over-shoulder"; viewpointCharacterId?: string;
  url: string | null; status: "pending" | "ready" | "error"; error?: string;
}
/** A background or sprite rendered once and reused across scenes. */
export interface NovelAsset {
  id: string; kind: "background" | "sprite"; prompt: string; seed: number; url: string | null;
  status: "pending" | "ready" | "error"; error?: string; jobId?: string; jobEndpoint?: string;
  characterId?: string; width: number; height: number;
  /** Sprite background removed. False when the cut-out failed and the plain image is shown. */
  cut?: boolean; attempts?: number;
}
export interface NovelScene {
  id: string; title: string; location: string; pov: string;
  /** Layers mode: people on screen, in order of appearance, with their sprite key. */
  present?: Array<{ characterId: string; sprite: string }>;
  /** Layers mode: key into `backgrounds`. */
  background?: string;
  lines: Array<{ speaker: string; text: string }>; question: string; choices: string[];
  illustrations: NovelIllustration[]; memory: NovelMemory; visuals?: {location?:string;setting:string;outfits:Record<string,string>}; createdAt: string;
}
export interface NovelTurn {
  user: string; assistant: string; throughSceneId: string;
  /** Lite mode: the user message exactly as sent and the reply as it is replayed. */
  lite?: { user: string; assistant: string; director?: string[] };
}
export interface NovelStory {
  id: string; title: string; config: NovelConfig; cast: NovelCharacter[]; settingCards?:NovelSettingCard[]; memory: NovelMemory;
  scenes: NovelScene[]; turns: NovelTurn[]; cursor: { scene: number; line: number };
  backgrounds?: Record<string, NovelAsset>; sprites?: Record<string, NovelAsset>;
  /** Snapshot of the persona chosen in config.personaId. */
  persona?: NovelPersona;
  contextCheckpoint?: {text:string;throughTurn:number;turnOffset?:number;updatedAt:string;passes:number};
  revision: number; createdAt: string; updatedAt: string;
  cache: { inputTokens: number; cachedTokens: number; cachedTokensReported?: boolean; outputTokens?: number; reasoningTokens?: number; cacheWriteTokens?: number; strategy: "stable-prefix" } | null;
}
export interface NovelPreviewScene { id: string; location: string; lines: Array<{ speaker: string; text: string }> }
export type NovelStreamEvent =
  | { type: "preview"; scenes: NovelPreviewScene[] }
  | { type: "stage"; stage: "director"; reasons?: string[] }
  | { type: "done"; story: NovelStory }
  | { type: "error"; error: string };
export interface NovelSummary { id: string; title: string; sceneCount: number; updatedAt: string; cover: string | null }
export const DEFAULT_NOVEL_CONFIG: NovelConfig = {
  imagePov:"dynamic", imagePovCharacter:"", structuredOutput:"auto", generationMode:"json", inlinePictures:true, premise: "", protagonist: "", tone: "", artStyle: DEFAULT_NOVEL_ART_STYLE,
  direction: "", language: "English", providerId: "", modelId: "", characterIds: [], settingCardIds:[], pov: "first", povCharacter: "",
  questionFrequency: "balanced", scenesPerTurn: 6, imagesPerScene: 2, contextChars: 48000, maxTokens: 6000,
  imagesEnabled: false, comfyUrl: "http://127.0.0.1:8188", workflow: null, positiveNode: "", negativeNode: "",
  negativePrompt: DEFAULT_NOVEL_NEGATIVE_PROMPT, width: 1344, height: 768
};
