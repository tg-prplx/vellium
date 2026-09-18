import type { SamplerConfig, SamplerPreset } from "./types/contracts";

const MAX_PRESETS = 64;
const MAX_ID_LENGTH = 120;
const MAX_NAME_LENGTH = 80;
const MAX_TARGET_LENGTH = 500;

function normalizeSamplerSnapshot(raw: unknown, fallback: SamplerConfig): SamplerConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const snapshot: Record<string, unknown> = {};

  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const candidate = source[key];
    if (typeof fallbackValue === "number") {
      snapshot[key] = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallbackValue;
    } else if (typeof fallbackValue === "boolean") {
      snapshot[key] = typeof candidate === "boolean" ? candidate : fallbackValue;
    } else if (typeof fallbackValue === "string") {
      snapshot[key] = typeof candidate === "string" ? candidate.slice(0, 20_000) : fallbackValue;
    } else if (Array.isArray(fallbackValue)) {
      const value = Array.isArray(candidate) ? candidate : fallbackValue;
      snapshot[key] = value
        .filter((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))
        .slice(0, 256);
    }
  }

  return snapshot as unknown as SamplerConfig;
}

export function normalizeSamplerPresets(raw: unknown, fallback: SamplerConfig): SamplerPreset[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const presets: SamplerPreset[] = [];

  for (let index = 0; index < raw.length && presets.length < MAX_PRESETS; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name || "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name) continue;
    let id = String(row.id || `sampler-preset-${index + 1}`).trim().slice(0, MAX_ID_LENGTH);
    if (!id || seenIds.has(id)) id = `sampler-preset-${index + 1}`;
    while (seenIds.has(id)) id = `${id}-${presets.length + 1}`.slice(0, MAX_ID_LENGTH);
    seenIds.add(id);

    const providerId = String(row.providerId || "").trim().slice(0, MAX_TARGET_LENGTH);
    const modelId = String(row.modelId || "").trim().slice(0, MAX_TARGET_LENGTH);
    presets.push({
      id,
      name,
      samplerConfig: normalizeSamplerSnapshot(row.samplerConfig, fallback),
      providerId: providerId && modelId ? providerId : null,
      modelId: providerId && modelId ? modelId : null
    });
  }

  return presets;
}

export function samplerConfigsEqual(left: SamplerConfig, right: SamplerConfig): boolean {
  const stable = (config: SamplerConfig) => JSON.stringify(
    Object.entries(config).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  );
  return stable(left) === stable(right);
}

export function findMatchingSamplerPresetId(presets: SamplerPreset[], config: SamplerConfig): string {
  return presets.find((preset) => samplerConfigsEqual(preset.samplerConfig, config))?.id || "";
}

export function resolveModelSamplerPreset(
  presets: SamplerPreset[],
  providerId: string,
  modelId: string
): SamplerPreset | null {
  for (let index = presets.length - 1; index >= 0; index -= 1) {
    const preset = presets[index];
    if (preset.providerId === providerId && preset.modelId === modelId) return preset;
  }
  return null;
}
