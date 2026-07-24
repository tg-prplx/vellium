import type { ManagedBackendConfig } from "./types/contracts";
import type { LocalModelHardwareProfile } from "./types/localModels";

export const LOCAL_LLAMA_BACKEND_ID = "vellium-local-llama-backend";
export const LOCAL_LLAMA_PROVIDER_ID = "vellium-local-llama";
export const LOCAL_INFERENCE_SETTINGS_URL = "vellium-local://inference";
export const LOCAL_PIPER_VERSION = "1.6.0";

export function localPiperRuntimeId(platform: string, arch: string) {
  return `ohf-piper-v${LOCAL_PIPER_VERSION}-${platform}-${arch}`;
}

export function buildLocalLlamaManagedBackend(
  executable: string,
  model: string,
  hardware: Pick<LocalModelHardwareProfile, "accelerator">,
  threadCount: number
): ManagedBackendConfig {
  const threads = Math.max(2, Math.min(16, Math.floor(threadCount)));
  const launchArgs = `--model "${model}" --host 127.0.0.1 --port 8088 --ctx-size 8192 --threads ${threads} --threads-batch ${threads} --batch-size 512 --ubatch-size 256 --jinja --flash-attn on --n-gpu-layers ${hardware.accelerator === "cpu" ? 0 : 999}`;
  return {
    id: LOCAL_LLAMA_BACKEND_ID,
    name: "Gemma 4 26B StyleTune (llama.cpp)",
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
    defaultModel: "gemma-4-26b-a4b-styletune-v2-q4_k_m-imat.gguf",
    autoStopOnSwitch: true,
    statusMode: "api",
    healthPath: "/health",
    modelsPath: "/v1/models",
    statusPath: "",
    statusTextPath: "",
    statusProgressPath: "",
    stdoutProgressRegex: ""
  };
}
