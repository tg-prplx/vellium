import type { TtsStreamEvent } from "./api/chatClient";

interface RealtimeTtsPlayerOptions {
  onPlaybackStart?: () => void;
  onError?: (error: Error) => void;
}

function decodeBase64Bytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcm16ToWav(bytes: Uint8Array, sampleRate: number) {
  const wav = new ArrayBuffer(44 + bytes.byteLength);
  const view = new DataView(wav);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + bytes.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, bytes.byteLength, true);
  new Uint8Array(wav, 44).set(bytes);
  return new Blob([wav], { type: "audio/wav" });
}

function decodeBase64Audio(value: string, contentType: string) {
  return new Blob([decodeBase64Bytes(value)], { type: contentType || "audio/mpeg" });
}

export class RealtimeTtsPlayer {
  private readonly controller = new AbortController();
  private readonly queue: Array<{ blob: Blob }> = [];
  private readonly pcmSources = new Set<AudioBufferSourceNode>();
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl = "";
  private audioContext: AudioContext | null = null;
  private pcmScheduledUntil = 0;
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
    this.prepareAudioContext();
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
    this.cleanupPcm();
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
    if (event.format === "pcm" || event.contentType === "audio/pcm") {
      this.acceptPcm(event.audioBase64, event.sampleRate || 24_000);
      return;
    }
    this.queue.push({ blob: decodeBase64Audio(event.audioBase64, event.contentType) });
    if (!this.currentAudio) this.playNext();
  }

  private prepareAudioContext() {
    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.audioContext = new AudioContextClass();
    void this.audioContext.resume().catch(() => {});
  }

  private acceptPcm(value: string, sampleRate: number) {
    const bytes = decodeBase64Bytes(value);
    if (!this.audioContext) {
      this.queue.push({ blob: pcm16ToWav(bytes, sampleRate) });
      if (!this.currentAudio) this.playNext();
      return;
    }

    const frameCount = Math.floor(bytes.byteLength / 2);
    if (frameCount === 0) return;
    const buffer = this.audioContext.createBuffer(1, frameCount, sampleRate);
    const samples = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * 2);
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const startsAt = Math.max(this.audioContext.currentTime + 0.025, this.pcmScheduledUntil);
    this.pcmScheduledUntil = startsAt + buffer.duration;
    this.pcmSources.add(source);
    source.onended = () => {
      source.disconnect();
      this.pcmSources.delete(source);
      this.maybeComplete();
    };
    source.start(startsAt);
    if (!this.playbackStarted) {
      this.playbackStarted = true;
      this.options.onPlaybackStart?.();
    }
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
    if (this.streamFinished && !this.currentAudio && this.queue.length === 0 && this.pcmSources.size === 0) this.resolve();
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
    this.cleanupPcm();
    this.options.onError?.(error);
    this.settled = true;
    this.rejectCompletion(error);
  }

  private resolve() {
    if (this.settled) return;
    this.cleanupPcm();
    this.settled = true;
    this.resolveCompletion();
  }

  private cleanupPcm() {
    for (const source of this.pcmSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
    this.pcmSources.clear();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
