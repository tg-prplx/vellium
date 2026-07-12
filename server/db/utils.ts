import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { v4 as uuidv4 } from "uuid";

export function newId(): string {
  return uuidv4();
}

export function now(): string {
  return new Date().toISOString();
}

export function hashSecret(secret: string): string {
  const normalized = normalizeSecret(secret);
  const salt = randomBytes(16);
  const derived = scryptSync(normalized, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifySecret(secret: string, storedHash: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeSecret(secret);
  } catch {
    return false;
  }
  const stored = String(storedHash || "").trim();
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const legacy = Buffer.from(createHash("sha256").update(normalized).digest("hex"), "utf8");
    const expected = Buffer.from(stored.toLowerCase(), "utf8");
    return legacy.length === expected.length && timingSafeEqual(legacy, expected);
  }
  const [scheme, saltRaw, hashRaw, extra] = stored.split("$");
  if (scheme !== "scrypt" || !saltRaw || !hashRaw || extra !== undefined) return false;
  try {
    const salt = Buffer.from(saltRaw, "base64");
    const expected = Buffer.from(hashRaw, "base64");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = scryptSync(normalized, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function needsSecretRehash(storedHash: string): boolean {
  return !String(storedHash || "").startsWith("scrypt$");
}

function normalizeSecret(secret: string): string {
  const value = typeof secret === "string" ? secret : "";
  if (!value || value.length > 1024) throw new Error("Secret must contain between 1 and 1024 characters");
  return value;
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
