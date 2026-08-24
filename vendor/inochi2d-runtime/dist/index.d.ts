export interface Inochi2dModelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export declare class OfficialInochi2dRuntime {
  static create(
    canvas: HTMLCanvasElement,
    options: { initialScale: number },
    wasmUrl: URL,
    signal?: AbortSignal
  ): Promise<OfficialInochi2dRuntime>;
  loadModel(bytes: Uint8Array): void;
  modelBounds(): Inochi2dModelBounds | undefined;
  setParameterScalar(id: string, value: number): void;
  setParameterVector(id: string, x: number, y: number): void;
  setCameraTransform(x: number, y: number, scale: number): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  renderFrame(timestampMs: number): void;
  destroy(): void;
}
