import type { TtsStreamEvent } from "./api/chatClient";

interface RealtimeTtsPlayerOptions {
  onPlaybackStart?: () => void;
  onError?: (error: Error) => void;
}

function decodeBase64Audio(value: string, contentType: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType || "audio/mpeg" });
}

export class RealtimeTtsPlayer {
  private readonly controller = new AbortController();
  private readonly queue: Array<{ blob: Blob }> = [];
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl = "";
  private streamFinished = false;
  private playbackStarted = false;
  private stopped = false;
  private settled = false;
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: Error) => void;
  private readonly completion = new Promise<void>((resolve, reject) => {
    this.resolveCompletion = resolve;
    this.rejectCompletion = reject;
  });

  constructor(private readonly options: RealtimeTtsPlayerOptions = {}) {}

  get signal() {
    return this.controller.signal;
  }

  async play(stream: (onEvent: (event: TtsStreamEvent) => void, signal: AbortSignal) => Promise<void>) {
    void stream((event) => this.accept(event), this.controller.signal)
      .then(() => {
        this.streamFinished = true;
        this.maybeComplete();
      })
      .catch((reason) => {
        if (this.stopped || this.controller.signal.aborted) return;
        this.fail(reason instanceof Error ? reason : new Error(String(reason)));
      });
    return this.completion;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort(new Error("Realtime TTS stopped"));
    this.queue.length = 0;
    this.cleanupCurrent();
    this.resolve();
  }

  private accept(event: TtsStreamEvent) {
    if (this.stopped) return;
    if (event.type === "error") {
      this.fail(new Error(event.message || "Realtime TTS failed"));
      return;
    }
    if (event.type === "done") {
      this.streamFinished = true;
      this.maybeComplete();
      return;
    }
    if (!event.audioBase64) return;
    this.queue.push({ blob: decodeBase64Audio(event.audioBase64, event.contentType) });
    if (!this.currentAudio) this.playNext();
  }

  private playNext() {
    if (this.stopped) return;
    const next = this.queue.shift();
    if (!next) {
      this.maybeComplete();
      return;
    }
    const url = URL.createObjectURL(next.blob);
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentUrl = url;
    audio.onended = () => {
      this.cleanupCurrent();
      this.playNext();
    };
    audio.onerror = () => this.fail(new Error("Realtime TTS audio could not be played"));
    void audio.play()
      .then(() => {
        if (!this.playbackStarted) {
          this.playbackStarted = true;
          this.options.onPlaybackStart?.();
        }
      })
      .catch((reason) => this.fail(reason instanceof Error ? reason : new Error("Realtime TTS playback failed")));
  }

  private maybeComplete() {
    if (this.streamFinished && !this.currentAudio && this.queue.length === 0) this.resolve();
  }

  private cleanupCurrent() {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = "";
    }
  }

  private fail(error: Error) {
    if (this.settled) return;
    this.stopped = true;
    this.controller.abort(error);
    this.queue.length = 0;
    this.cleanupCurrent();
    this.options.onError?.(error);
    this.settled = true;
    this.rejectCompletion(error);
  }

  private resolve() {
    if (this.settled) return;
    this.settled = true;
    this.resolveCompletion();
  }
}
