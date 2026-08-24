import { useMemo, useState } from "react";
import { api } from "../../shared/api";
import { resolveApiAssetUrl } from "../../shared/api/core";
import {
  LIVE_AVATAR_OVERRIDES_KEY,
  liveAvatarOwnerKey,
  parseLiveAvatarOverrides,
  type LiveAvatarOverrides
} from "./avatarState";

interface UseLiveAvatarOptions {
  characterId: string;
  fallbackUrl?: string | null;
  imageOnlyError: string;
  onError: (message: string) => void;
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read avatar image"));
    reader.readAsDataURL(file);
  });
}

export function useLiveAvatar({ characterId, fallbackUrl, imageOnlyError, onError }: UseLiveAvatarOptions) {
  const [uploading, setUploading] = useState(false);
  const [overrides, setOverrides] = useState<LiveAvatarOverrides>(() => {
    try {
      return parseLiveAvatarOverrides(window.localStorage.getItem(LIVE_AVATAR_OVERRIDES_KEY));
    } catch {
      return {};
    }
  });
  const ownerKey = liveAvatarOwnerKey(characterId);
  const overrideUrl = overrides[ownerKey] || "";
  const avatarUrl = useMemo(
    () => resolveApiAssetUrl(overrideUrl || fallbackUrl),
    [fallbackUrl, overrideUrl]
  );

  const persist = (next: LiveAvatarOverrides) => {
    try {
      window.localStorage.setItem(LIVE_AVATAR_OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      // Keep the in-memory selection when local storage is unavailable.
    }
  };

  const upload = async (file: File) => {
    if (uploading || !file.type.startsWith("image/")) {
      if (!file.type.startsWith("image/")) onError(imageOnlyError);
      return;
    }
    setUploading(true);
    onError("");
    try {
      const base64 = await readFileAsBase64(file);
      const uploaded = await api.uploadFile(base64, file.name || `live-avatar-${Date.now()}.png`);
      if (uploaded.type !== "image") throw new Error(imageOnlyError);
      const nextUrl = uploaded.url || `data:${uploaded.mimeType || file.type};base64,${base64}`;
      setOverrides((current) => {
        const next = { ...current, [ownerKey]: nextUrl };
        persist(next);
        return next;
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const reset = () => setOverrides((current) => {
    const next = { ...current };
    delete next[ownerKey];
    persist(next);
    return next;
  });

  return { avatarUrl, overrideUrl, uploading, upload, reset };
}
