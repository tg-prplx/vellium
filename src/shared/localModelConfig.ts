import type { ManagedBackendConfig } from "./types/contracts";
import type { LocalModelHardwareProfile } from "./types/localModels";
import type { LocalLlmVariant } from "./localLlmVariants";

export const LOCAL_LLAMA_BACKEND_ID = "vellium-local-llama-backend";
export const LOCAL_LLAMA_PROVIDER_ID = "vellium-local-llama";
export const LOCAL_INFERENCE_SETTINGS_URL = "vellium-local://inference";
export const LOCAL_WHISPER_MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
export const LOCAL_WHISPER_MODEL_FILE = "ggml-large-v3-turbo-q5_0.bin";
export const LOCAL_WHISPER_MODEL_ID = "whisper-large-v3-turbo-q5_0";
export const LOCAL_WHISPER_MODEL_NAME = "Whisper Large v3 Turbo Q5_0 (multilingual)";
export const LOCAL_WHISPER_MODEL_BYTES = 574_041_195;
export const LOCAL_WHISPER_MODEL_SHA256 = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
export const LOCAL_PIPER_VERSION = "1.6.0";
export const LOCAL_TERATTS_RUNTIME_VERSION = "2";
export const LOCAL_TERATTS_MODEL_REVISION = "f05ea799094571a3553904a555df3834fb0b963b";
export const LOCAL_TERATTS_MODEL_ID = "teratts-v2-distilled";
export const LOCAL_TERATTS_DEFAULT_VOICE = "ru_f1";

export const LOCAL_TERATTS_VOICE_PROFILES = [
  { id: "ru_f1", language: "ru", gender: "female", variant: 1, recommended: true, whisperReference: false },
  { id: "ru_m5", language: "ru", gender: "male", variant: 5, recommended: true, whisperReference: false },
  { id: "ru_f2", language: "ru", gender: "female", variant: 2, recommended: false, whisperReference: false },
  { id: "ru_m1", language: "ru", gender: "male", variant: 1, recommended: false, whisperReference: false },
  { id: "eng_f3", language: "en", gender: "female", variant: 3, recommended: false, whisperReference: false },
  { id: "eng_f4_whisper", language: "en", gender: "female", variant: 4, recommended: false, whisperReference: true },
  { id: "eng_f5", language: "en", gender: "female", variant: 5, recommended: false, whisperReference: false },
  { id: "eng_m2_whisper", language: "en", gender: "male", variant: 2, recommended: false, whisperReference: true },
  { id: "eng_m3", language: "en", gender: "male", variant: 3, recommended: false, whisperReference: false },
  { id: "eng_m4", language: "en", gender: "male", variant: 4, recommended: false, whisperReference: false }
] as const;

export type LocalTeraTtsVoiceProfile = (typeof LOCAL_TERATTS_VOICE_PROFILES)[number];
export type LocalTeraTtsVoiceId = LocalTeraTtsVoiceProfile["id"];
export const LOCAL_TERATTS_VOICES = LOCAL_TERATTS_VOICE_PROFILES.map((profile) => profile.id);

export function localPiperRuntimeId(platform: string, arch: string) {
  return `ohf-piper-v${LOCAL_PIPER_VERSION}-${platform}-${arch}`;
}

export function localTeraTtsRuntimeId(platform: string, arch: string) {
  return `teratts-v2-runtime-v${LOCAL_TERATTS_RUNTIME_VERSION}-${LOCAL_TERATTS_MODEL_REVISION.slice(0, 8)}-${platform}-${arch}`;
}

export function localWhisperModelUrl() {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/${LOCAL_WHISPER_MODEL_REVISION}/${LOCAL_WHISPER_MODEL_FILE}?download=true`;
}

export function buildLocalLlamaManagedBackend(
  executable: string,
  model: string,
  hardware: Pick<LocalModelHardwareProfile, "accelerator">,
  threadCount: number,
  variant: LocalLlmVariant
): ManagedBackendConfig {
  const threads = Math.max(2, Math.min(16, Math.floor(threadCount)));
  const launchArgs = `--model "${model}" --host 127.0.0.1 --port 8088 --ctx-size ${variant.contextSize} --threads ${threads} --threads-batch ${threads} --batch-size 512 --ubatch-size 256 --jinja --flash-attn on --n-gpu-layers ${hardware.accelerator === "cpu" ? 0 : 999}`;
  return {
    id: LOCAL_LLAMA_BACKEND_ID,
    name: `${variant.label} (llama.cpp)`,
    enabled: true,
    providerId: LOCAL_LLAMA_PROVIDER_ID,
    providerType: "openai",
    adapterId: null,
    backendKind: "generic",
    baseUrl: "http://127.0.0.1:8088",
    commandOverride: `"${executable}" ${launchArgs}`,
    extraArgs: "",
    workingDirectory: executable.replace(/[\\/][^\\/]+$/, ""),
    envText: "",
    defaultModel: variant.file,
    autoStopOnSwitch: true,
    startTimeoutSeconds: 600,
    statusMode: "api",
    healthPath: "/health",
    modelsPath: "/v1/models",
    statusPath: "",
    statusTextPath: "",
    statusProgressPath: "",
    stdoutProgressRegex: ""
  };
}
