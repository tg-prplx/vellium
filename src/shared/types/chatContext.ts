export interface GenerationStats {
  inputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  tokenSource: "provider" | "estimate";
  totalMs: number;
  firstTokenMs?: number;
  decodeMs?: number;
  tokensPerSecond?: number;
  speedSource?: "provider" | "measured";
  requests?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export interface ChatContextConfig {
  contextWindowSize?: number;
  maxMessages?: number;
  maxOutputTokens?: number;
  includeReasoning?: boolean;
  excludedMessageIds?: string[];
  summary?: string;
}

export type ContextSource = "instructions" | "character" | "persona" | "scene" | "lore" | "rag" | "summary" | "authorNote" | "history" | "attachments" | "reasoning" | "formatting";

export interface ContextSection {
  source: ContextSource;
  tokens: number;
  text: string;
}

export interface ChatContextBudget {
  branchId: string;
  contextWindowSize: number;
  reservedOutputTokens: number;
}

export interface ChatContextPreview {
  branchId: string;
  model: string | null;
  config: ChatContextConfig;
  effective: { contextWindowSize: number; maxMessages: number; includeReasoning: boolean; summary: string };
  inputTokens: number;
  reservedOutputTokens: number;
  availableTokens: number;
  overBudget: boolean;
  countSource: "estimate" | "tokenizer";
  transport?: { prompt: string; memory: string };
  sections: ContextSection[];
  messages: Array<{ role: string; content: unknown; reasoning_content?: string }>;
  history: Array<{ id: string; role: string; content: string; tokens: number; included: boolean; reason?: "manual" | "limit" | "budget"; characterName?: string }>;
  hasImages: boolean;
  hasTools: boolean;
  lastGeneration?: GenerationStats;
}
