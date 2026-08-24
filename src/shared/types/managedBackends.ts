export interface ManagedBackendLlamaCppOptions {
  executable: string;
  modelPath: string;
  host: string;
  port: number;
  contextSize: number;
  gpuLayers: number;
  threads: number;
  batchSize: number;
  ubatchSize: number;
  flashAttention: boolean;
  jinja: boolean;
}
