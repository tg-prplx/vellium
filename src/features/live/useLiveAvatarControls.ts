import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LiveAvatarControlStreamParser,
  normalizeLiveAvatarCapabilities,
  resolveLiveAvatarCue
} from "../../shared/liveAvatarControl";
import type { InochiAvatarModel, LiveAvatarControlCue } from "../../shared/types/inochiAvatar";

export interface SequencedLiveAvatarCue extends LiveAvatarControlCue {
  sequence: number;
}

export function useLiveAvatarControls(avatar: InochiAvatarModel | null) {
  const capabilities = useMemo(() => normalizeLiveAvatarCapabilities(
    avatar ? { parameters: avatar.emotionParameters } : null
  ), [avatar]);
  const [cue, setCue] = useState<SequencedLiveAvatarCue | null>(null);

  useEffect(() => {
    setCue((current) => ({ reset: true, sequence: (current?.sequence || 0) + 1 }));
  }, [avatar?.assetId]);

  const createStreamParser = useCallback(() => new LiveAvatarControlStreamParser((rawCue) => {
    if (!capabilities) return;
    const resolved = resolveLiveAvatarCue(rawCue, capabilities);
    if (resolved) setCue((current) => ({ ...resolved, sequence: (current?.sequence || 0) + 1 }));
  }), [capabilities]);

  return { capabilities, cue, createStreamParser };
}
