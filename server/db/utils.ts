import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

export function newId(): string {
  return uuidv4();
}

export function now(): string {
  return new Date().toISOString();
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function roughTokenCount(text: string): number {
  return Math.ceil(text.length / 3.7);
}

export function maskApiKey(raw: string): string {
  if (raw.length <= 8) return "********";
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
