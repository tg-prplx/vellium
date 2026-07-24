import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../../shared/api";
import { RealtimeTtsPlayer } from "../../../shared/realtimeTts";

export function useTtsPlayback(realtime: boolean, setError: Dispatch<SetStateAction<string>>) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const realtimePlayerRef = useRef<RealtimeTtsPlayer | null>(null);

  const stop = useCallback((messageId?: string) => {
    realtimePlayerRef.current?.stop();
    realtimePlayerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    if (!messageId) {
      setLoadingId(null);
      setPlayingId(null);
    } else {
      setLoadingId((current) => current === messageId ? null : current);
      setPlayingId((current) => current === messageId ? null : current);
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const play = useCallback(async (messageId: string) => {
    if (playingId === messageId || loadingId === messageId) {
      stop(messageId);
      return;
    }
    if (loadingId) return;
    stop();
    setLoadingId(messageId);
    try {
      if (realtime) {
        const player = new RealtimeTtsPlayer({
          onPlaybackStart: () => setLoadingId((current) => current === messageId ? null : current)
        });
        realtimePlayerRef.current = player;
        setPlayingId(messageId);
        await player.play((onEvent, signal) => api.chatTtsMessageRealtime(messageId, onEvent, signal));
        if (realtimePlayerRef.current === player) realtimePlayerRef.current = null;
        setPlayingId((current) => current === messageId ? null : current);
        return;
      }
      const blob = await api.chatTtsMessage(messageId);
      const objectUrl = URL.createObjectURL(blob);
      audioUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => setPlayingId((current) => current === messageId ? null : current);
      audio.onerror = () => setPlayingId((current) => current === messageId ? null : current);
      setPlayingId(messageId);
      await audio.play();
    } catch (error) {
      setPlayingId(null);
      setError(String(error));
    } finally {
      setLoadingId(null);
    }
  }, [loadingId, playingId, realtime, setError, stop]);

  return { ttsLoadingId: loadingId, ttsPlayingId: playingId, handleTts: play };
}
