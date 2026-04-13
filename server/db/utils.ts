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

function isPrivateIpv4Host(hostname: string): boolean {
  const parts = hostname.split(".").map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIpv6Host(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost"
      || hostname.endsWith(".local")
      || isPrivateIpv4Host(hostname)
      || isPrivateIpv6Host(hostname);
  } catch {
    return false;
  }
}
