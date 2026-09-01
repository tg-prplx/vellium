export interface LlamaCppExecutableCandidate {
  path: string;
  source: "bundled" | "path" | "known" | "selected";
}

export interface LlamaCppModelCandidate {
  path: string;
  name: string;
  sizeBytes: number;
  source: "vellium" | "downloads" | "documents" | "lmstudio" | "huggingface" | "selected";
}

export interface LlamaCppEndpointCandidate {
  baseUrl: string;
  models: string[];
}

export interface LlamaCppDiscoveryResult {
  available: boolean;
  platform: string;
  arch: string;
  accelerator: "metal" | "vulkan" | "cpu";
  executableCandidates: LlamaCppExecutableCandidate[];
  modelCandidates: LlamaCppModelCandidate[];
  endpointCandidates: LlamaCppEndpointCandidate[];
  scannedAt: string;
}

export interface LlamaCppPickedFile {
  canceled: boolean;
  path?: string;
}

export type LlamaCppEndpointState = "ready" | "loading" | "sleeping" | "unreachable" | "unauthorized" | "not-detected";

export interface LlamaCppEndpointModel {
  id: string;
  path?: string;
  state: "loaded" | "loading" | "sleeping" | "unloaded" | "unknown";
  args: string[];
  failed: boolean;
  exitCode?: number;
}

export interface LlamaCppEndpointStatus {
  detected: boolean;
  state: LlamaCppEndpointState;
  baseUrl: string;
  modelPath?: string;
  contextSize?: number;
  chatTemplate?: string;
  modalities: string[];
  slotCount: number;
  busySlots: number;
  samplerDefaults: {
    temperature?: number;
    topP?: number;
    topK?: number;
    minP?: number;
    repeatPenalty?: number;
    maxTokens?: number;
  };
  models: LlamaCppEndpointModel[];
  supportsModelControl: boolean;
  checkedAt: string;
  error?: string;
}
