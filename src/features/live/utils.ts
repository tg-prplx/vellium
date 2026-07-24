import type { ChatMessage, FileAttachment } from "../../shared/types/contracts";

export type LiveTtsSource = "system" | "custom";
export type LiveSttSource = "system" | "whisper";

export function normalizeLiveTtsSource(value: unknown): LiveTtsSource | null {
  return value === "system" || value === "custom" ? value : null;
}

export function resolveLiveTtsSource(
  preference: LiveTtsSource | null,
  customTtsConfigured: boolean
): LiveTtsSource {
  return preference || (customTtsConfigured ? "custom" : "system");
}

export function normalizeLiveSttSource(value: unknown): LiveSttSource {
  return value === "whisper" ? "whisper" : "system";
}

export function makeLiveSessionTitle(date = new Date(), characterName = ""): string {
  const stamp = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  const speaker = characterName.trim().replace(/\s+/g, " ").slice(0, 48);
  return `Live · ${speaker ? `${speaker} · ` : ""}${stamp}`;
}

export function makeLiveScreenAttachment(dataUrl: string, capturedAt = Date.now()): FileAttachment | null {
  if (!dataUrl.startsWith("data:image/")) return null;
  return {
    id: `live-screen-${capturedAt}`,
    filename: `live-screen-${capturedAt}.jpg`,
    type: "image",
    url: "",
    mimeType: "image/jpeg",
    dataUrl
  };
}

export function latestAssistantText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim()) return message.content.trim();
  }
  return "";
}

export function isAddressedToCharacter(transcript: string, characterName: string): boolean {
  const normalize = (value: string) => value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  const spoken = ` ${normalize(transcript)} `;
  const fullName = normalize(characterName);
  if (!spoken.trim() || !fullName) return false;
  if (spoken.includes(` ${fullName} `)) return true;
  const firstName = fullName.split(" ")[0] || "";
  return firstName.length >= 3 && spoken.includes(` ${firstName} `);
}
