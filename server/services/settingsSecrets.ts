import { maskApiKey } from "../db/utils.js";
import { decryptSecret, encryptSecret } from "./secretVault.js";

export const MASKED_SETTINGS_SECRET_KEYS = ["ttsApiKey", "sttApiKey"] as const;

/** Plaintext of a stored settings secret (encrypted at rest, legacy plaintext accepted). */
export function readSettingsSecret(stored: unknown): string {
  return decryptSecret(stored).trim();
}

export function maskSettingsSecret(raw: unknown): string {
  const value = decryptSecret(raw);
  return value ? maskApiKey(value) : "";
}

/** Replaces stored secrets with their masked form before a settings payload leaves the server. */
export function maskSettingsSecrets<T extends Record<string, unknown>>(settings: T): T {
  const masked: Record<string, unknown> = { ...settings };
  for (const key of MASKED_SETTINGS_SECRET_KEYS) {
    if (key in masked) masked[key] = maskSettingsSecret(masked[key]);
  }
  return masked as T;
}

/**
 * Renderer code round-trips the masked value it received; treat that echo as
 * "unchanged" so a full-settings PATCH never overwrites the real secret.
 */
export function resolveSettingsSecretPatch(patchValue: unknown, currentValue: unknown): string {
  const current = readSettingsSecret(currentValue);
  if (patchValue === undefined || patchValue === null) return current;
  const next = String(patchValue).trim();
  if (current && next === maskSettingsSecret(current)) return current;
  return next;
}

/** Value to persist for a settings secret: the resolved plaintext, encrypted at rest. */
export function storeSettingsSecret(patchValue: unknown, currentValue: unknown, maxLength = 4096): string {
  return encryptSecret(resolveSettingsSecretPatch(patchValue, currentValue).slice(0, maxLength));
}

/**
 * Endpoint discovery may only reuse a stored secret for the endpoint it was
 * saved for, otherwise any caller could forward the key to an arbitrary host.
 */
export function resolveDiscoverySecret(params: {
  requestedKey: unknown;
  requestedBaseUrl: string;
  storedKey: unknown;
  storedBaseUrl: unknown;
}): string {
  const stored = readSettingsSecret(params.storedKey);
  const sameEndpoint = params.requestedBaseUrl.trim() === String(params.storedBaseUrl ?? "").trim();
  if (params.requestedKey === undefined || params.requestedKey === null) {
    return sameEndpoint ? stored : "";
  }
  const requested = String(params.requestedKey).trim();
  if (stored && requested === maskSettingsSecret(stored)) {
    return sameEndpoint ? stored : "";
  }
  return requested;
}
