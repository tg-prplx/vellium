export const CHARACTER_SCENE_DEFAULTS_EXTENSION_KEY = "vellium_scene_state";

export interface CharacterSceneDefaultsPayload {
  chatId: string;
  variables: Record<string, string>;
  mood: string;
  pacing: "slow" | "balanced" | "fast";
  intensity: number;
  chatMode: "rp";
  pureChatMode: false;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clampPercent(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return String(Math.max(0, Math.min(100, Math.round(parsed))));
}

function normalizeVariables(value: unknown): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(toRecord(value)).slice(0, 64)) {
    const key = rawKey.trim().slice(0, 64);
    if (!key) continue;
    if (["initiative", "descriptiveness", "unpredictability", "emotionalDepth"].includes(key)) {
      const percent = clampPercent(rawValue);
      if (percent !== null) variables[key] = percent;
      continue;
    }
    if (typeof rawValue === "string") {
      variables[key] = rawValue.trim().slice(0, 500);
    }
  }
  return variables;
}

export function readCharacterSceneDefaults(
  cardJson: string | null | undefined,
  chatId: string
): CharacterSceneDefaultsPayload | null {
  let card: Record<string, unknown>;
  try {
    card = toRecord(JSON.parse(String(cardJson || "{}")));
  } catch {
    return null;
  }
  const data = toRecord(card.data);
  const extensions = toRecord(data.extensions);
  const rawDefaults = toRecord(extensions[CHARACTER_SCENE_DEFAULTS_EXTENSION_KEY]);
  if (rawDefaults.enabled !== true) return null;

  const rawIntensity = typeof rawDefaults.intensity === "number"
    ? rawDefaults.intensity
    : Number(rawDefaults.intensity);
  const intensity = Number.isFinite(rawIntensity)
    ? Math.max(0, Math.min(1, rawIntensity))
    : 0.7;
  const pacing = rawDefaults.pacing === "slow" || rawDefaults.pacing === "fast" || rawDefaults.pacing === "balanced"
    ? rawDefaults.pacing
    : "slow";
  const mood = typeof rawDefaults.mood === "string"
    ? rawDefaults.mood.trim().slice(0, 500) || "teasing"
    : "teasing";

  return {
    chatId,
    variables: normalizeVariables(rawDefaults.variables),
    mood,
    pacing,
    intensity,
    chatMode: "rp",
    pureChatMode: false
  };
}
