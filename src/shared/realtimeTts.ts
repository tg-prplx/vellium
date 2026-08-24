import type { TtsStreamEvent } from "./api/chatClient";

interface RealtimeTtsPlayerOptions {
  onPlaybackStart?: () => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
}

export function pcm16AudioLevel(bytes: Uint8Array): number {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount === 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  let squareSum = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32_768;
    squareSum += sample * sample;
  }
  return Math.min(1, Math.sqrt(squareSum / sampleCount) * 2.8);
}

export function speechEnvelopeTarget(samples: Uint8Array, noiseFloor = 0.008): number {
  if (!samples.length) return 0;
  let squareSum = 0;
  let peak = 0;
  for (const sample of samples) {
    const normalized = Math.abs((sample - 128) / 128);
    squareSum += normalized * normalized;
    peak = Math.max(peak, normalized);
  }
  const rms = Math.sqrt(squareSum / samples.length);
  const active = Math.max(0, rms - Math.max(0.004, noiseFloor) * 1.35);
  if (active < 0.004 && peak < 0.025) return 0;
  return Math.min(1, Math.pow(Math.min(1, active * 6.2 + peak * 0.32), 0.68));
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
  private analyser: AnalyserNode | null = null;
  private currentMediaSource: MediaElementAudioSourceNode | null = null;
  private levelAnimationFrame: number | null = null;
  private pcmScheduledUntil = 0;
  private streamFinished = false;
  private playbackStarted = false;
  private stopped = false;
  private settled = false;
  private lipLevel = 0;
  private noiseFloor = 0.008;
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
    if (this.options.onAudioLevel) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.18;
      this.analyser.connect(this.audioContext.destination);
      this.startLevelMeter();
    }
    void this.audioContext.resume().catch(() => {});
  }

  private startLevelMeter() {
    if (!this.analyser || !this.options.onAudioLevel || this.levelAnimationFrame !== null) return;
    const samples = new Uint8Array(this.analyser.fftSize);
    const update = () => {
      if (!this.analyser || this.stopped || this.settled) {
        this.levelAnimationFrame = null;
        return;
      }
      this.analyser.getByteTimeDomainData(samples);
      let squareSum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        squareSum += normalized * normalized;
      }
      const rms = Math.sqrt(squareSum / samples.length);
      if (rms < this.noiseFloor * 2.2) this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
      else this.noiseFloor = Math.max(0.006, this.noiseFloor * 0.9995);
      const target = speechEnvelopeTarget(samples, this.noiseFloor);
      this.lipLevel += (target - this.lipLevel) * (target > this.lipLevel ? 0.68 : 0.52);
      if (this.lipLevel < 0.008) this.lipLevel = 0;
      this.options.onAudioLevel?.(this.lipLevel);
      this.levelAnimationFrame = window.requestAnimationFrame(update);
    };
    this.levelAnimationFrame = window.requestAnimationFrame(update);
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
    source.connect(this.analyser || this.audioContext.destination);
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
    if (this.audioContext && this.analyser) {
      this.currentMediaSource = this.audioContext.createMediaElementSource(audio);
      this.currentMediaSource.connect(this.analyser);
    }
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
    if (this.currentMediaSource) {
      this.currentMediaSource.disconnect();
      this.currentMediaSource = null;
    }
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
    if (this.levelAnimationFrame !== null) {
      window.cancelAnimationFrame(this.levelAnimationFrame);
      this.levelAnimationFrame = null;
    }
    this.options.onAudioLevel?.(0);
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
