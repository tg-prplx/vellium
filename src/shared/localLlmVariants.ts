import type { LocalLlmVariantId, LocalModelHardwareProfile } from "./types/localModels";

const GIB = 1024 ** 3;

export interface LocalLlmVariant {
  id: LocalLlmVariantId;
  label: string;
  modelName: string;
  repo: string;
  revision: string;
  file: string;
  bytes: number;
  digest: string;
  /** Parameters touched per token. Dense models pay their full size; MoE models pay far less. */
  activeParametersBillions: number;
  minimumMemoryBytes: number;
  recommendedMemoryBytes: number;
  contextSize: number;
}

/** Dense models above this size are too slow to hold a conversation without an accelerator. */
const CPU_ACTIVE_PARAMETER_LIMIT_BILLIONS = 8;

/** Ordered from lightest to heaviest; the picker walks this ladder from the top. */
export const LOCAL_LLM_VARIANTS: readonly LocalLlmVariant[] = [
  {
    id: "e2b",
    label: "Gemma 4 E2B",
    modelName: "Gemma 4 E2B IT Q4_K_M",
    repo: "unsloth/gemma-4-E2B-it-GGUF",
    revision: "0314792d7f1f7e229411f620751375812bb9faf2",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    bytes: 3_106_738_272,
    digest: "sha256:740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8",
    activeParametersBillions: 2,
    minimumMemoryBytes: 6 * GIB,
    recommendedMemoryBytes: 8 * GIB,
    contextSize: 4096
  },
  {
    id: "e4b",
    label: "Gemma 4 E4B",
    modelName: "Gemma 4 E4B IT Q4_K_M",
    repo: "unsloth/gemma-4-E4B-it-GGUF",
    revision: "bfc15c382204943c3a8fff0c750b94ae2364d7a3",
    file: "gemma-4-E4B-it-Q4_K_M.gguf",
    bytes: 4_977_171_584,
    digest: "sha256:85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
    activeParametersBillions: 4,
    minimumMemoryBytes: 8 * GIB,
    recommendedMemoryBytes: 16 * GIB,
    contextSize: 8192
  },
  {
    id: "12b",
    label: "Gemma 4 12B StyleTune",
    modelName: "Gemma 4 12B StyleTune Q4_K_M",
    repo: "mradermacher/Gemma-4-12B-StyleTune-GGUF",
    revision: "ea929a5eaf3c14da988fa7fd7b71d18c24e87c31",
    file: "Gemma-4-12B-StyleTune.Q4_K_M.gguf",
    bytes: 7_947_613_824,
    digest: "sha256:d3e487063f62cf1ed37f7317c93a8e709e6e072a877779ff86b7a73fe904c4a3",
    activeParametersBillions: 12,
    minimumMemoryBytes: 12 * GIB,
    recommendedMemoryBytes: 24 * GIB,
    contextSize: 8192
  },
  {
    id: "26b",
    label: "Gemma 4 26B A4B StyleTune",
    modelName: "Gemma 4 26B A4B StyleTune V2 Q4_K_M",
    repo: "Kraekin/Gemma-4-26B-A4B-StyleTune-V2-Q4_K_M-GGUF",
    revision: "1c49854aee1a3a6551f6ac0e5c9bccae4a1f66e2",
    file: "gemma-4-26b-a4b-styletune-v2-q4_k_m-imat.gguf",
    bytes: 17_211_235_552,
    digest: "sha256:0d7c6006e8c767f55e4f18252f28e25537d72f8c1b5dd01fa0450408a707bcf8",
    activeParametersBillions: 4,
    minimumMemoryBytes: 20 * GIB,
    recommendedMemoryBytes: 32 * GIB,
    contextSize: 8192
  }
] as const;

type HardwareBudget = Pick<LocalModelHardwareProfile, "memoryBytes" | "accelerator">;

/** Reported memory is rarely a round number, so a 15.7 GiB machine still counts as 16 GB. */
function memoryBudget(hardware: HardwareBudget) {
  return Math.ceil(Math.max(0, hardware.memoryBytes) / GIB) * GIB;
}

export function findLocalLlmVariant(id: LocalLlmVariantId | null | undefined) {
  return LOCAL_LLM_VARIANTS.find((variant) => variant.id === id) || null;
}

export function localLlmVariantFits(variant: LocalLlmVariant, hardware: HardwareBudget) {
  if (hardware.accelerator === "cpu" && variant.activeParametersBillions > CPU_ACTIVE_PARAMETER_LIMIT_BILLIONS) return false;
  return memoryBudget(hardware) >= variant.minimumMemoryBytes;
}

/** The heaviest variant this machine can run comfortably, falling back to the lightest one. */
export function recommendedLocalLlmVariant(hardware: HardwareBudget): LocalLlmVariant {
  const budget = memoryBudget(hardware);
  const affordable = LOCAL_LLM_VARIANTS.filter((variant) =>
    (hardware.accelerator !== "cpu" || variant.activeParametersBillions <= CPU_ACTIVE_PARAMETER_LIMIT_BILLIONS)
    && budget >= variant.recommendedMemoryBytes);
  return affordable[affordable.length - 1] || LOCAL_LLM_VARIANTS[0];
}

export function localLlmModelUrl(variant: LocalLlmVariant) {
  return `https://huggingface.co/${variant.repo}/resolve/${variant.revision}/${variant.file}?download=true`;
}
