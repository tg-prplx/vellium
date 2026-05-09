import type { CharacterDetail } from "../../shared/types/contracts";
import { resolveApiAssetUrl } from "../../shared/api";

export type DesktopPetVoice = "soft" | "playful" | "quiet";
export type DesktopPetAnimation = "none" | "idle" | "hop" | "pop" | "sway" | "spin" | "shake" | "bounce";
export type DesktopPetCodexState = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

export type DesktopPetStatePreset = {
  id: string;
  label: string;
  animation: DesktopPetAnimation;
  codexState: DesktopPetCodexState;
  assetUrl: string;
  soundUrl: string;
};

export type DesktopPetConfig = {
  characterId?: string;
  name: string;
  spriteUrl: string;
  spriteSheetUrl: string;
  scale: number;
  voice: DesktopPetVoice;
  autonomyEnabled: boolean;
  actions: DesktopPetStatePreset[];
  emotions: DesktopPetStatePreset[];
  assistantInstructions: string;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  systemPrompt?: string;
};

export type DesktopPetExtension = {
  spriteUrl?: string;
  spriteSheetUrl?: string;
  scale?: number;
  voice?: DesktopPetVoice;
  autonomyEnabled?: boolean;
  actions?: unknown;
  emotions?: unknown;
  assistantInstructions?: string;
};

export const DESKTOP_PET_STORAGE_KEY = "vellium.desktopPet.config";
export const DESKTOP_PET_EXTENSION_KEY = "velliumPet";
export const CODEX_PET_STATES: DesktopPetCodexState[] = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
];

export const DEFAULT_DESKTOP_PET_CONFIG: DesktopPetConfig = {
  name: "Velli",
  spriteUrl: "",
  spriteSheetUrl: "",
  scale: 1,
  voice: "soft",
  autonomyEnabled: false,
  actions: [
    { id: "idle", label: "Idle", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", codexState: "jumping", assetUrl: "", soundUrl: "" },
    { id: "alert", label: "Alert", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
    { id: "spin", label: "Spin", animation: "spin", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "shake", label: "Shake", animation: "shake", codexState: "failed", assetUrl: "", soundUrl: "" }
  ],
  emotions: [
    { id: "calm", label: "Calm", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", codexState: "waving", assetUrl: "", soundUrl: "" },
    { id: "curious", label: "Curious", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
    { id: "excited", label: "Excited", animation: "bounce", codexState: "jumping", assetUrl: "", soundUrl: "" }
  ],
  assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help."
};

function clampScale(value: unknown): number {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.max(0.75, Math.min(1.35, scale)) : DEFAULT_DESKTOP_PET_CONFIG.scale;
}

export function normalizeDesktopPetVoice(value: unknown): DesktopPetVoice {
  return value === "playful" || value === "quiet" || value === "soft" ? value : "soft";
}

export function normalizeDesktopPetAnimation(value: unknown): DesktopPetAnimation {
  return value === "none" || value === "hop" || value === "pop" || value === "sway" || value === "spin" || value === "shake" || value === "bounce" || value === "idle"
    ? value
    : "idle";
}

export function normalizeDesktopPetCodexState(value: unknown, fallback?: DesktopPetCodexState): DesktopPetCodexState {
  return CODEX_PET_STATES.includes(value as DesktopPetCodexState) ? value as DesktopPetCodexState : fallback || "idle";
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeDesktopPetList(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  const items = raw
    .map((item) => String(item || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 12);
  return items.length ? Array.from(new Set(items)) : fallback;
}

function defaultAnimationForId(id: string): DesktopPetAnimation {
  if (/happy|joy|excited|play/.test(id)) return "hop";
  if (/alert|curious|think|focus/.test(id)) return "pop";
  if (/sleep|tired|calm/.test(id)) return "sway";
  if (/spin/.test(id)) return "spin";
  if (/shake|no|angry/.test(id)) return "shake";
  if (/bounce/.test(id)) return "bounce";
  return "idle";
}

function defaultCodexStateForId(id: string, animation?: DesktopPetAnimation): DesktopPetCodexState {
  if (/running-right|right/.test(id)) return "running-right";
  if (/running-left|left/.test(id)) return "running-left";
  if (/running|working|progress|busy|task/.test(id)) return "running";
  if (/review|alert|curious|think|focus|inspect/.test(id)) return "review";
  if (/wait|waiting|idle2|patient/.test(id)) return "waiting";
  if (/sleep|sad|failed|fail|tired|shake|angry/.test(id)) return "failed";
  if (/jump|excited|bounce/.test(id)) return "jumping";
  if (/happy|joy|play|wave|hello|hi/.test(id)) return animation === "bounce" ? "jumping" : "waving";
  if (animation === "hop" || animation === "bounce") return "jumping";
  if (animation === "pop") return "review";
  if (animation === "sway") return "waiting";
  return normalizeDesktopPetCodexState(id, "idle");
}

function normalizePresetId(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

export function normalizeDesktopPetPresets(value: unknown, fallback: DesktopPetStatePreset[]): DesktopPetStatePreset[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  const presets = raw.flatMap((item): DesktopPetStatePreset[] => {
    if (typeof item === "string") {
      const id = normalizePresetId(item);
      const animation = defaultAnimationForId(id);
      return id ? [{ id, label: id, animation, codexState: defaultCodexStateForId(id, animation), assetUrl: "", soundUrl: "" }] : [];
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = normalizePresetId(record.id);
    if (!id) return [];
    const animation = normalizeDesktopPetAnimation(record.animation);
    return [{
      id,
      label: stringValue(record.label, 48) || id,
      animation,
      codexState: normalizeDesktopPetCodexState(record.codexState, defaultCodexStateForId(id, animation)),
      assetUrl: resolveDesktopPetAssetUrl(stringValue(record.assetUrl, 4000)),
      soundUrl: resolveDesktopPetAssetUrl(stringValue(record.soundUrl, 4000))
    }];
  });
  const unique = new Map<string, DesktopPetStatePreset>();
  for (const preset of presets) {
    if (!unique.has(preset.id)) unique.set(preset.id, preset);
  }
  return unique.size ? [...unique.values()].slice(0, 12) : fallback;
}

function resolveDesktopPetAssetUrl(url: string | null | undefined): string {
  const resolved = resolveApiAssetUrl(url);
  if (!resolved) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(resolved)) return resolved;
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    try {
      return new URL(resolved, window.location.origin).toString();
    } catch {
      return resolved;
    }
  }
  return resolved;
}

export function readStoredDesktopPetConfig(): DesktopPetConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(DESKTOP_PET_STORAGE_KEY) || "{}") as Partial<DesktopPetConfig>;
    const spriteUrl = stringValue(parsed.spriteUrl, 4000);
    const spriteSheetUrl = stringValue(parsed.spriteSheetUrl, 4000);
    return {
      characterId: stringValue(parsed.characterId, 120) || undefined,
      name: stringValue(parsed.name, 32) || DEFAULT_DESKTOP_PET_CONFIG.name,
      spriteUrl,
      spriteSheetUrl,
      scale: clampScale(parsed.scale),
      voice: normalizeDesktopPetVoice(parsed.voice),
      autonomyEnabled: parsed.autonomyEnabled === true,
      actions: normalizeDesktopPetPresets(parsed.actions, DEFAULT_DESKTOP_PET_CONFIG.actions),
      emotions: normalizeDesktopPetPresets(parsed.emotions, DEFAULT_DESKTOP_PET_CONFIG.emotions),
      assistantInstructions: stringValue(parsed.assistantInstructions, 3000) || DEFAULT_DESKTOP_PET_CONFIG.assistantInstructions,
      description: stringValue(parsed.description, 2000),
      personality: stringValue(parsed.personality, 4000),
      scenario: stringValue(parsed.scenario, 4000),
      greeting: stringValue(parsed.greeting, 1000),
      systemPrompt: stringValue(parsed.systemPrompt, 4000)
    };
  } catch {
    return { ...DEFAULT_DESKTOP_PET_CONFIG };
  }
}

export function storeDesktopPetConfig(config: DesktopPetConfig, notify = true) {
  const normalized = {
    ...config,
    scale: clampScale(config.scale),
    voice: normalizeDesktopPetVoice(config.voice),
    autonomyEnabled: config.autonomyEnabled === true,
    spriteUrl: resolveDesktopPetAssetUrl(stringValue(config.spriteUrl, 4000)),
    spriteSheetUrl: resolveDesktopPetAssetUrl(stringValue(config.spriteSheetUrl, 4000)),
    actions: normalizeDesktopPetPresets(config.actions, DEFAULT_DESKTOP_PET_CONFIG.actions),
    emotions: normalizeDesktopPetPresets(config.emotions, DEFAULT_DESKTOP_PET_CONFIG.emotions),
    assistantInstructions: stringValue(config.assistantInstructions, 3000) || DEFAULT_DESKTOP_PET_CONFIG.assistantInstructions
  };
  localStorage.setItem(DESKTOP_PET_STORAGE_KEY, JSON.stringify(normalized));
  if (notify) {
    window.dispatchEvent(new CustomEvent<DesktopPetConfig>("desktop-pet-config-change", { detail: normalized }));
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function getDesktopPetExtension(character: Pick<CharacterDetail, "extensions"> | null | undefined): DesktopPetExtension {
  const extensions = toRecord(character?.extensions);
  const raw = toRecord(extensions[DESKTOP_PET_EXTENSION_KEY]);
  return {
    spriteUrl: stringValue(raw.spriteUrl, 4000),
    spriteSheetUrl: stringValue(raw.spriteSheetUrl, 4000),
    scale: raw.scale === undefined ? undefined : clampScale(raw.scale),
    voice: raw.voice === undefined ? undefined : normalizeDesktopPetVoice(raw.voice),
    autonomyEnabled: raw.autonomyEnabled === undefined ? undefined : raw.autonomyEnabled === true,
    actions: raw.actions,
    emotions: raw.emotions,
    assistantInstructions: stringValue(raw.assistantInstructions, 3000)
  };
}

export function buildDesktopPetConfigFromCharacter(character: CharacterDetail, fallback?: DesktopPetConfig): DesktopPetConfig {
  const pet = getDesktopPetExtension(character);
  const fallbackForCharacter = fallback?.characterId === character.id ? fallback : undefined;
  return {
    characterId: character.id,
    name: stringValue(character.name, 32) || DEFAULT_DESKTOP_PET_CONFIG.name,
    spriteUrl: resolveDesktopPetAssetUrl(pet.spriteUrl || fallbackForCharacter?.spriteUrl || character.avatarUrl),
    spriteSheetUrl: resolveDesktopPetAssetUrl(pet.spriteSheetUrl || fallbackForCharacter?.spriteSheetUrl || ""),
    scale: clampScale(pet.scale ?? fallbackForCharacter?.scale),
    voice: normalizeDesktopPetVoice(pet.voice ?? fallbackForCharacter?.voice),
    autonomyEnabled: pet.autonomyEnabled ?? fallbackForCharacter?.autonomyEnabled ?? DEFAULT_DESKTOP_PET_CONFIG.autonomyEnabled,
    actions: normalizeDesktopPetPresets(pet.actions ?? fallbackForCharacter?.actions, DEFAULT_DESKTOP_PET_CONFIG.actions),
    emotions: normalizeDesktopPetPresets(pet.emotions ?? fallbackForCharacter?.emotions, DEFAULT_DESKTOP_PET_CONFIG.emotions),
    assistantInstructions: stringValue(pet.assistantInstructions, 3000) || fallbackForCharacter?.assistantInstructions || DEFAULT_DESKTOP_PET_CONFIG.assistantInstructions,
    description: stringValue(character.description, 2000),
    personality: stringValue(character.personality, 4000),
    scenario: stringValue(character.scenario, 4000),
    greeting: stringValue(character.greeting, 1000),
    systemPrompt: stringValue(character.systemPrompt, 4000)
  };
}

export function mergeDesktopPetExtension(
  extensions: Record<string, unknown>,
  pet: DesktopPetExtension
): Record<string, unknown> {
  return {
    ...extensions,
    [DESKTOP_PET_EXTENSION_KEY]: {
      ...toRecord(extensions[DESKTOP_PET_EXTENSION_KEY]),
      spriteUrl: stringValue(pet.spriteUrl, 4000),
      spriteSheetUrl: stringValue(pet.spriteSheetUrl, 4000),
      scale: clampScale(pet.scale),
      voice: normalizeDesktopPetVoice(pet.voice),
      autonomyEnabled: pet.autonomyEnabled === true,
      actions: normalizeDesktopPetPresets(pet.actions, DEFAULT_DESKTOP_PET_CONFIG.actions),
      emotions: normalizeDesktopPetPresets(pet.emotions, DEFAULT_DESKTOP_PET_CONFIG.emotions),
      assistantInstructions: stringValue(pet.assistantInstructions, 3000) || DEFAULT_DESKTOP_PET_CONFIG.assistantInstructions
    }
  };
}
