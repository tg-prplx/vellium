/** Fallback only. Model tokenizers and provider usage take precedence. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let weight = 0;
  for (const run of text.matchAll(/[\x00-\x7f]+|[^\x00-\x7f]/gu)) {
    const value = run[0];
    if (value.charCodeAt(0) < 128) weight += value.length / 4;
    else if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)) weight += 1.5;
    else if (/\p{Extended_Pictographic}/u.test(value)) weight += 3;
    else weight += 0.65;
  }
  return Math.ceil(weight);
}
