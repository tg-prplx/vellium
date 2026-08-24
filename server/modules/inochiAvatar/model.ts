import path from "path";
import type { InochiParameter } from "../../../src/shared/types/inochiAvatar.js";

const MAGIC = Buffer.from("TRNSRTS\0", "ascii");
const TEXTURE_SECTION = Buffer.from("TEX_SECT", "ascii");
const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_PARAMETERS = 512;

const EMOTION_PARAMETER = /emotion|expression|smil|happy|joy|sad|angry|anger|blush|tear|brow|eyebrow|mouth.*(form|width|smil|frown)|eye.*(shape|happy|sad|angry)|cheek|head.*roll|body.*roll|arm|hand|ear/i;
const DRIVING_PARAMETER = /physics|blink|mouth.*(open|shape|phoneme|ah|a$)|head.*(yaw|pitch)|body.*(yaw|pitch)|breath|look|gaze|eye.*move|tail/i;

function finitePair(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value)) return fallback;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return [Number.isFinite(x) ? x : fallback[0], Number.isFinite(y) ? y : fallback[1]];
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 240) : fallback;
}

function parseParameters(value: unknown): InochiParameter[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): InochiParameter[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const name = safeString(row.name);
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const dimensions: 1 | 2 = row.is_vec2 === true ? 2 : 1;
    const min = finitePair(row.min, [0, 0]);
    const max = finitePair(row.max, [1, dimensions === 2 ? 1 : 0]);
    const defaults = finitePair(row.defaults, min);
    return [{ name, dimensions, min, max, defaults }];
  }).slice(0, MAX_PARAMETERS);
}

export interface ParsedInochiModel {
  displayName: string;
  filename: string;
  metadata: Record<string, unknown>;
  parameters: InochiParameter[];
  emotionParameters: InochiParameter[];
}

export function parseInochiModel(buffer: Buffer, originalFilename: string): ParsedInochiModel {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.length > MAX_MODEL_BYTES) {
    throw new Error("Inochi2D model must be a non-empty .inp or .inx file no larger than 256 MB");
  }
  const extension = path.extname(originalFilename).toLowerCase();
  if (extension !== ".inp" && extension !== ".inx") {
    throw new Error("Choose an Inochi2D .inp or .inx model");
  }
  if (!buffer.subarray(0, 8).equals(MAGIC)) {
    throw new Error("The selected file is not an Inochi2D .inp/.inx model");
  }
  const jsonLength = buffer.readUInt32BE(8);
  const jsonStart = 12;
  const jsonEnd = jsonStart + jsonLength;
  if (jsonLength === 0 || jsonLength > MAX_JSON_BYTES || jsonEnd + 12 > buffer.length) {
    throw new Error("The Inochi2D model payload is truncated or too large");
  }
  if (!buffer.subarray(jsonEnd, jsonEnd + 8).equals(TEXTURE_SECTION)) {
    throw new Error("The Inochi2D model has no valid texture section");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(buffer.subarray(jsonStart, jsonEnd).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("The Inochi2D model contains invalid UTF-8 JSON metadata");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The Inochi2D model metadata is invalid");
  }
  if (!payload.nodes || typeof payload.nodes !== "object" || Array.isArray(payload.nodes)
    || !payload.physics || typeof payload.physics !== "object" || Array.isArray(payload.physics)
    || !Array.isArray(payload.param)) {
    throw new Error("The Inochi2D file does not contain a complete puppet structure");
  }
  const textureCount = buffer.readUInt32BE(jsonEnd + 8);
  let offset = jsonEnd + 12;
  for (let index = 0; index < textureCount; index += 1) {
    if (offset + 5 > buffer.length) throw new Error("The Inochi2D texture section is truncated");
    const length = buffer.readUInt32BE(offset);
    const encoding = buffer[offset + 4];
    if (encoding > 2 || length > MAX_MODEL_BYTES || offset + 5 + length > buffer.length) {
      throw new Error("The Inochi2D texture section is invalid");
    }
    offset += 5 + length;
  }
  const metadata = payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)
    ? payload.meta as Record<string, unknown>
    : {};
  const parameters = parseParameters(payload.param);
  const emotionParameters = parameters
    .filter((parameter) => EMOTION_PARAMETER.test(parameter.name) && !DRIVING_PARAMETER.test(parameter.name))
    .slice(0, 48);
  const filename = path.basename(originalFilename).replace(/[^\p{L}\p{N}._ -]+/gu, "-").slice(0, 180) || `avatar${extension}`;
  const displayName = safeString(metadata.name)
    || path.basename(filename, path.extname(filename)).slice(0, 120)
    || "Inochi2D avatar";
  return { displayName, filename, metadata, parameters, emotionParameters };
}
