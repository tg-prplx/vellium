export type Id = string;

export type CensorshipMode = "Filtered" | "Unfiltered";

export interface ProviderProfile {
  id: Id;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  proxyUrl?: string | null;
  fullLocalOnly: boolean;
}

export interface ProviderModel {
  id: string;
}

export interface SamplerConfig {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxTokens: number;
  stop: string[];
}

export interface PromptBlock {
  id: Id;
  kind: "system" | "jailbreak" | "character" | "author_note" | "lore" | "scene" | "history";
  enabled: boolean;
  order: number;
  content: string;
}

export interface ChatMessage {
  id: Id;
  chatId: Id;
  branchId: Id;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  createdAt: string;
  parentId?: Id | null;
  characterName?: string;
}

export interface BranchNode {
  id: Id;
  chatId: Id;
  name: string;
  parentMessageId?: Id | null;
  createdAt: string;
}

export interface ChatSession {
  id: Id;
  title: string;
  characterId?: Id | null;
  characterIds?: Id[];
  autoConversation?: boolean;
  createdAt: string;
}

export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: string;
  data: Record<string, unknown>;
}

export interface RpSceneState {
  chatId: Id;
  variables: Record<string, string>;
  mood: string;
  pacing: "slow" | "balanced" | "fast";
  intensity: number;
}

export interface RpPreset {
  id: Id;
  name: string;
  description: string;
  styleHints: string[];
}

export interface WriterStyleProfile {
  id: Id;
  name: string;
  tone: string;
  pov: string;
  constraints: string[];
}

export interface BookProject {
  id: Id;
  name: string;
  description: string;
  createdAt: string;
}

export interface Chapter {
  id: Id;
  projectId: Id;
  title: string;
  position: number;
  createdAt: string;
}

export interface Scene {
  id: Id;
  chapterId: Id;
  title: string;
  content: string;
  goals: string;
  conflicts: string;
  outcomes: string;
  createdAt: string;
}

export interface BeatNode {
  id: Id;
  projectId: Id;
  label: string;
  beatType: "setup" | "inciting" | "midpoint" | "climax" | "resolution";
  sequence: number;
}

export interface ConsistencyIssue {
  id: Id;
  projectId: Id;
  severity: "low" | "medium" | "high";
  category: "names" | "facts" | "timeline" | "pov";
  message: string;
}

export interface PromptTemplates {
  jailbreak: string;
  compressSummary: string;
  writerGenerate: string;
  writerExpand: string;
  writerRewrite: string;
  writerSummarize: string;
  creativeWriting: string;
}

export interface RpPresetConfig {
  id: string;
  name: string;
  description: string;
  mood: string;
  pacing: "slow" | "balanced" | "fast";
  intensity: number;
  jailbreakOverride?: string;
}

export interface FileAttachment {
  id: string;
  filename: string;
  type: "image" | "text";
  url: string;
  content?: string;
}

export interface AppSettings {
  theme: "dark" | "light" | "custom";
  fontScale: number;
  density: "comfortable" | "compact";
  censorshipMode: CensorshipMode;
  fullLocalMode: boolean;
  responseLanguage: string;
  interfaceLanguage: "en" | "ru";
  activeProviderId?: string | null;
  activeModel?: string | null;
  compressProviderId?: string | null;
  compressModel?: string | null;
  mergeConsecutiveRoles: boolean;
  samplerConfig: SamplerConfig;
  defaultSystemPrompt: string;
  contextWindowSize: number;
  promptTemplates: PromptTemplates;
}

export interface ChatCharacterLink {
  characterId: Id;
  displayName: string;
  avatarUrl: string | null;
  order: number;
}

export interface UserPersona {
  id: Id;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CharacterListItem {
  id: Id;
  name: string;
  avatarUrl: string | null;
  tags: string[];
  greeting: string;
  systemPrompt: string;
  createdAt: string;
}

export interface CharacterDetail extends CharacterListItem {
  description: string;
  personality: string;
  scenario: string;
  mesExample: string;
  creatorNotes: string;
  cardJson: string;
}
