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
