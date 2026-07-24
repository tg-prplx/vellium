import type { ManagedBackendConfig } from "./contracts";

export type LocalModelComponentId = "llm" | "stt" | "tts";
export type LocalLlmVariantId = "e2b" | "e4b" | "12b" | "26b";
export type LocalModelInstallPhase = "idle" | "downloading" | "extracting" | "verifying" | "installed" | "error" | "cancelled";

export interface LocalModelCatalogItem {
  id: LocalModelComponentId;
  name: string;
  modelName: string;
  modelBytes: number;
  auxiliaryBytes: number;
  installed: boolean;
  recommended: boolean;
  warning?: string;
}

export interface LocalLlmVariantOption {
  id: LocalLlmVariantId;
  label: string;
  modelName: string;
  modelBytes: number;
  minimumMemoryBytes: number;
  recommendedMemoryBytes: number;
  contextSize: number;
  /** The machine meets this variant's minimum requirements. */
  fits: boolean;
  /** The auto-selected default for this machine. */
  recommended: boolean;
  installed: boolean;
}

export interface LocalModelHardwareProfile {
  platform: string;
  arch: string;
  memoryBytes: number;
  gpuLabel: string;
  accelerator: "metal" | "cuda" | "vulkan" | "rocm" | "cpu";
}

export interface LocalModelCatalog {
  available: boolean;
  reason?: string;
  hardware: LocalModelHardwareProfile;
  items: LocalModelCatalogItem[];
  llmVariants: LocalLlmVariantOption[];
}

export interface LocalModelProgress {
  componentId: LocalModelComponentId;
  phase: LocalModelInstallPhase;
  receivedBytes: number;
  totalBytes: number;
  label: string;
  error?: string;
}

export interface LocalModelInstallRequest {
  componentIds: LocalModelComponentId[];
  locale: "en" | "ru" | "zh" | "ja";
  /** Defaults to the variant recommended for the detected hardware. */
  llmVariantId?: LocalLlmVariantId;
}

export interface LocalModelInstallResult {
  installed: LocalModelComponentId[];
  errors?: Partial<Record<LocalModelComponentId, string>>;
  managedBackend?: ManagedBackendConfig;
  provider?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    fullLocalOnly: boolean;
    providerType: "openai";
  };
  settingsPatch: {
    sttSource?: "whisper";
    sttBaseUrl?: string;
    sttApiKey?: string;
    sttModel?: string;
    ttsBaseUrl?: string;
    ttsApiKey?: string;
    ttsModel?: string;
    ttsVoice?: string;
    ttsRealtime?: boolean;
  };
}
