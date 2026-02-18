import type { PromptBlock } from "./types/contracts";

export function buildOrderedPrompt(blocks: PromptBlock[]): PromptBlock[] {
  return [...blocks].sort((a, b) => a.order - b.order).filter((b) => b.enabled);
}
