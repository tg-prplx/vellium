import { maskApiKey } from "../db/utils.js";

export const MASKED_SETTINGS_SECRET_KEYS = ["ttsApiKey", "sttApiKey"] as const;

export function maskSettingsSecret(raw: unknown): string {
  const value = String(raw ?? "");
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
  const current = String(currentValue ?? "").trim();
  if (patchValue === undefined || patchValue === null) return current;
  const next = String(patchValue).trim();
  if (current && next === maskSettingsSecret(current)) return current;
  return next;
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
  const stored = String(params.storedKey ?? "").trim();
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
