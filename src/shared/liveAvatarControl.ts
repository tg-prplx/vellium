import type {
  InochiParameter,
  LiveAvatarControlCapabilities,
  LiveAvatarControlCue,
  LiveAvatarParameterValue
} from "./types/inochiAvatar";

const TAG_START = "<vellium-avatar";
const COMPLETE_TAG = /<vellium-avatar\b[^>]*>/gi;
const ATTRIBUTE = /([a-z]+)\s*=\s*"([^"]*)"/gi;

function numberPair(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value)) return fallback;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return [Number.isFinite(x) ? x : fallback[0], Number.isFinite(y) ? y : fallback[1]];
}

function normalizeParameter(value: unknown): InochiParameter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = String(row.name || "").trim().slice(0, 240);
  if (!name) return null;
  const dimensions: 1 | 2 = Number(row.dimensions) === 2 ? 2 : 1;
  const min = numberPair(row.min, [0, 0]);
  const max = numberPair(row.max, [1, dimensions === 2 ? 1 : 0]);
  return { name, dimensions, min, max, defaults: numberPair(row.defaults, min) };
}

export function normalizeLiveAvatarCapabilities(value: unknown): LiveAvatarControlCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const raw = Array.isArray(row.parameters) ? row.parameters : [];
  const names = new Set<string>();
  const parameters = raw.flatMap((item): InochiParameter[] => {
    const parameter = normalizeParameter(item);
    if (!parameter || names.has(parameter.name)) return [];
    names.add(parameter.name);
    return [parameter];
  }).slice(0, 48);
  return parameters.length ? { parameters } : null;
}

export function buildLiveAvatarControlPrompt(capabilities: LiveAvatarControlCapabilities): string {
  const catalog = capabilities.parameters.map((parameter, index) => {
    const range = parameter.dimensions === 2
      ? `[${parameter.min[0]}..${parameter.max[0]}, ${parameter.min[1]}..${parameter.max[1]}]`
      : `[${parameter.min[0]}..${parameter.max[0]}]`;
    return `P${index}=${JSON.stringify(parameter.name)} ${range}`;
  }).join(", ");
  return [
    "[Inochi2D avatar control — mandatory hidden protocol]",
    "Animate the avatar while writing the reply. Emit a control tag immediately before the words or action where the emotion changes. Multiple changes inside one reply are allowed. Vellium removes these tags from chat history and speech.",
    "Format: <vellium-avatar params=\"P0:0.8,P2:-0.4\"/>. For a 2D parameter use P1:x:y. Use <vellium-avatar reset=\"true\"/> to return emotional parameters to their model defaults.",
    `Available parameters: ${catalog}.`,
    "Begin with the closest available state and update it only when the emotional beat changes. Use only catalog IDs, finite values inside their listed ranges, and no other avatar markup. Never explain the tags."
  ].join("\n");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));
}

export function resolveLiveAvatarCue(cue: LiveAvatarControlCue, capabilities: LiveAvatarControlCapabilities): LiveAvatarControlCue | null {
  const parameters = (cue.parameters || []).flatMap((raw): LiveAvatarParameterValue[] => {
    const match = /^P(\d+)$/i.exec(raw.name);
    const definition = match
      ? capabilities.parameters[Number(match[1])]
      : capabilities.parameters.find((item) => item.name.toLocaleLowerCase() === raw.name.toLocaleLowerCase());
    if (!definition || !Number.isFinite(raw.value)) return [];
    const value = clamp(raw.value, definition.min[0], definition.max[0]);
    if (definition.dimensions === 2) {
      if (!Number.isFinite(raw.y)) return [];
      return [{ name: definition.name, value, y: clamp(Number(raw.y), definition.min[1], definition.max[1]) }];
    }
    return [{ name: definition.name, value }];
  });
  return cue.reset || parameters.length ? { ...(cue.reset ? { reset: true } : {}), ...(parameters.length ? { parameters } : {}) } : null;
}

function parseControlTag(tag: string): LiveAvatarControlCue | null {
  const values: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) values[match[1].toLowerCase()] = match[2].trim();
  const parameters = String(values.params || "").split(",").flatMap((entry): LiveAvatarParameterValue[] => {
    const parts = entry.trim().split(":");
    if (!/^P\d+$/i.test(parts[0] || "") || parts.length < 2 || parts.length > 3) return [];
    const value = Number(parts[1]);
    const y = parts.length === 3 ? Number(parts[2]) : undefined;
    if (!Number.isFinite(value) || (y !== undefined && !Number.isFinite(y))) return [];
    return [{ name: parts[0], value, ...(y !== undefined ? { y } : {}) }];
  });
  const reset = /^(true|1|yes)$/i.test(values.reset || "");
  return reset || parameters.length ? { ...(reset ? { reset: true } : {}), ...(parameters.length ? { parameters } : {}) } : null;
}

export class LiveAvatarControlStreamParser {
  private buffer = "";

  constructor(private readonly onCue: (cue: LiveAvatarControlCue) => void) {}

  push(delta: string): string {
    this.buffer += delta;
    let visible = "";
    while (this.buffer) {
      const start = this.buffer.toLocaleLowerCase().indexOf(TAG_START);
      if (start < 0) {
        let held = 0;
        const lower = this.buffer.toLocaleLowerCase();
        for (let length = 1; length < TAG_START.length; length += 1) {
          if (lower.endsWith(TAG_START.slice(0, length))) held = length;
        }
        visible += this.buffer.slice(0, this.buffer.length - held);
        this.buffer = this.buffer.slice(this.buffer.length - held);
        break;
      }
      visible += this.buffer.slice(0, start);
      this.buffer = this.buffer.slice(start);
      const end = this.buffer.indexOf(">");
      if (end < 0) break;
      const cue = parseControlTag(this.buffer.slice(0, end + 1));
      if (cue) this.onCue(cue);
      this.buffer = this.buffer.slice(end + 1);
    }
    return visible;
  }

  finish(): string {
    const visible = this.buffer.replace(COMPLETE_TAG, "");
    this.buffer = "";
    return visible.toLocaleLowerCase().startsWith(TAG_START) ? "" : visible;
  }
}

export function stripLiveAvatarControlMarkup(content: string): string {
  return String(content || "").replace(COMPLETE_TAG, "").replace(/<vellium-avatar\b[^>]*$/i, "");
}
