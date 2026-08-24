export const LIVE_AVATAR_OVERRIDES_KEY = "vellium.live.avatar-overrides.v1";

export type LiveAvatarOverrides = Record<string, string>;

export function liveAvatarOwnerKey(characterId: string): string {
  return characterId || "__assistant__";
}

export function parseLiveAvatarOverrides(raw: string | null): LiveAvatarOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => (
      Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1].trim())
    )));
  } catch {
    return {};
  }
}
