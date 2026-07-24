export function splitRealtimeTtsInput(input: string, maxChunkChars = 320): string[] {
  const normalized = String(input || "").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((item) => item.trim()).filter(Boolean) || [normalized];
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    const parts = sentence.length <= maxChunkChars
      ? [sentence]
      : sentence.match(new RegExp(`.{1,${maxChunkChars}}(?:\\s+|$)`, "g"))?.map((item) => item.trim()).filter(Boolean) || [sentence];
    for (const part of parts) {
      if (current && current.length + 1 + part.length > maxChunkChars) push();
      current = current ? `${current} ${part}` : part;
    }
  }
  push();
  return chunks;
}
