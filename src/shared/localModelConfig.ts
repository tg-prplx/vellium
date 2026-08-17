import type { ManagedBackendConfig } from "./types/contracts";
import type { LocalModelHardwareProfile } from "./types/localModels";
import type { LocalLlmVariant } from "./localLlmVariants";

export const LOCAL_LLAMA_BACKEND_ID = "vellium-local-llama-backend";
export const LOCAL_LLAMA_PROVIDER_ID = "vellium-local-llama";
export const LOCAL_INFERENCE_SETTINGS_URL = "vellium-local://inference";
export const LOCAL_PIPER_VERSION = "1.6.0";
export const LOCAL_TERATTS_RUNTIME_VERSION = "1";
export const LOCAL_TERATTS_MODEL_REVISION = "f05ea799094571a3553904a555df3834fb0b963b";
export const LOCAL_TERATTS_MODEL_ID = "teratts-v2-distilled";
export const LOCAL_TERATTS_DEFAULT_VOICE = "ru_f1";

export const LOCAL_TERATTS_VOICES = [
  "ru_f1",
  "ru_m5",
  "ru_f2",
  "ru_m1",
  "eng_f3",
  "eng_f4_whisper",
  "eng_f5",
  "eng_m2_whisper",
  "eng_m3",
  "eng_m4"
] as const;

export function localPiperRuntimeId(platform: string, arch: string) {
  return `ohf-piper-v${LOCAL_PIPER_VERSION}-${platform}-${arch}`;
}

export function localTeraTtsRuntimeId(platform: string, arch: string) {
  return `teratts-v2-runtime-v${LOCAL_TERATTS_RUNTIME_VERSION}-${LOCAL_TERATTS_MODEL_REVISION.slice(0, 8)}-${platform}-${arch}`;
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
