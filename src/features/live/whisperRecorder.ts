export interface WhisperRecorderController {
  stop: (submit?: boolean) => void;
  abort: () => void;
}

interface WhisperRecorderOptions {
  onComplete: (audio: Blob, filename: string) => void;
  onEmpty: () => void;
  onError: (error: Error) => void;
  silenceMs?: number;
  noSpeechMs?: number;
  maxDurationMs?: number;
}

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4"
];

export function chooseWhisperRecorderMimeType(
  isSupported: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType)
): string {
  return RECORDER_MIME_CANDIDATES.find((mimeType) => isSupported(mimeType)) || "";
}

export function extensionForAudioMimeType(mimeType: string): string {
  const normalized = mimeType.split(";")[0].toLowerCase();
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mp4") return "mp4";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return "wav";
  return "webm";
}

export function encodeMonoPcmWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function convertRecordingToWhisperWav(recording: Blob): Promise<Blob> {
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(await recording.arrayBuffer());
    const sampleRate = 16_000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeMonoPcmWav(rendered.getChannelData(0), sampleRate);
  } finally {
    await decodeContext.close().catch(() => {});
  }
}

export function createWhisperRecorder(
  stream: MediaStream,
  options: WhisperRecorderOptions
): WhisperRecorderController {
  const mimeType = chooseWhisperRecorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  const silenceMs = options.silenceMs ?? 1_050;
  const noSpeechMs = options.noSpeechMs ?? 12_000;
  const maxDurationMs = options.maxDurationMs ?? 30_000;
  let speechStarted = false;
  let lastSpeechAt = startedAt;
  let shouldSubmit = true;
  let stopped = false;
  let failed = false;
  let analyserTimer: number | null = null;
  let audioContext: AudioContext | null = null;

  const cleanup = () => {
    if (analyserTimer !== null) window.clearInterval(analyserTimer);
    analyserTimer = null;
    void audioContext?.close().catch(() => {});
    audioContext = null;
    stream.getTracks().forEach((track) => track.stop());
  };

  const stop = (submit = true) => {
    if (stopped) return;
    stopped = true;
    shouldSubmit = submit;
    if (recorder.state !== "inactive") recorder.stop();
    else cleanup();
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    const cause = (event as Event & { error?: Error }).error;
    failed = true;
    stop(false);
    options.onError(cause || new Error("Audio recording failed"));
  };
  recorder.onstop = async () => {
    cleanup();
    if (failed) return;
    if (!shouldSubmit) {
      options.onEmpty();
      return;
    }
    const resolvedMimeType = recorder.mimeType || mimeType || "audio/webm";
    const audio = new Blob(chunks, { type: resolvedMimeType });
    if (!audio.size) {
      options.onEmpty();
      return;
    }
    try {
      const wav = await convertRecordingToWhisperWav(audio);
      options.onComplete(wav, "live-recording.wav");
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error("Audio conversion failed"));
    }
  };

  try {
    const AudioContextConstructor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor) {
      audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      analyserTimer = window.setInterval(() => {
        const now = performance.now();
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        if (rms >= 0.022) {
          speechStarted = true;
          lastSpeechAt = now;
        } else if (speechStarted && now - lastSpeechAt >= silenceMs) {
          stop(true);
        } else if (!speechStarted && now - startedAt >= noSpeechMs) {
          stop(false);
        }
        if (now - startedAt >= maxDurationMs) stop(speechStarted);
      }, 80);
    } else {
      analyserTimer = window.setInterval(() => {
        if (performance.now() - startedAt >= maxDurationMs) stop(true);
      }, 250);
    }
    recorder.start(250);
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    stop,
    abort: () => stop(false)
  };
}
