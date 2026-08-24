import type { Inochi2dWasmRuntime, ModelBounds } from "../types.js";
import { MissingModelParameterError } from "../errors.js";
import { OfficialWebGlRenderer } from "./renderer.js";
import {
  type OfficialDrawList,
  OfficialInochi2dSdk,
  type OfficialParameter,
  type OfficialPuppet,
} from "./sdk.js";

const MAX_PHYSICS_DELTA_SECONDS = 1 / 15;

/** Keeps resumed/background tabs from feeding an unstable time jump to physics. */
export function boundedFrameDeltaSeconds(
  previousTimestampMs: number | undefined,
  timestampMs: number,
): number {
  if (
    previousTimestampMs === undefined ||
    !Number.isFinite(previousTimestampMs) ||
    !Number.isFinite(timestampMs)
  ) {
    return 0;
  }
  return Math.min(
    MAX_PHYSICS_DELTA_SECONDS,
    Math.max(0, timestampMs - previousTimestampMs) / 1_000,
  );
}

export class OfficialInochi2dRuntime implements Inochi2dWasmRuntime {
  readonly #sdk: OfficialInochi2dSdk;
  readonly #renderer: OfficialWebGlRenderer;
  #puppet: OfficialPuppet | undefined;
  #modelBounds: ModelBounds | undefined;
  #lastTimestampMs: number | undefined;
  #destroyed = false;

  private constructor(
    sdk: OfficialInochi2dSdk,
    renderer: OfficialWebGlRenderer,
  ) {
    this.#sdk = sdk;
    this.#renderer = renderer;
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: { initialScale: number },
    wasmUrl: URL,
    signal?: AbortSignal,
  ): Promise<OfficialInochi2dRuntime> {
    const sdk = await OfficialInochi2dSdk.create(wasmUrl, signal);
    try {
      return new OfficialInochi2dRuntime(
        sdk,
        new OfficialWebGlRenderer(canvas, options.initialScale),
      );
    } catch (error) {
      sdk.destroy();
      throw error;
    }
  }

  loadModel(bytes: Uint8Array): void {
    this.#assertActive();
    const next = this.#sdk.loadPuppet(bytes);
    try {
      const textures = this.#sdk.readTextures(next);
      const modelBounds = drawListBounds(this.#sdk.updateAndDraw(next, 0));
      this.#renderer.uploadTextures(textures);
      this.#modelBounds = modelBounds;
    } catch (error) {
      this.#sdk.freePuppet(next);
      throw error;
    }
    this.#sdk.freePuppet(this.#puppet);
    this.#puppet = next;
    this.#lastTimestampMs = undefined;
  }

  modelBounds(): ModelBounds | undefined {
    const bounds = this.#modelBounds;
    return bounds ? { ...bounds } : undefined;
  }

  setParameterScalar(id: string, value: number): void {
    this.#sdk.setParameter(this.#parameter(id), value);
  }

  setParameterVector(id: string, x: number, y: number): void {
    this.#sdk.setParameter(this.#parameter(id), [x, y]);
  }

  /** Internal capability used to avoid treating an ineffective parameter as visible motion. */
  parameterHasVisibleEffect(id: string, axis?: "x" | "y"): boolean | undefined {
    const puppet = this.#puppet;
    const parameter = puppet?.parameters.get(id);
    if (!puppet || !parameter) {
      return undefined;
    }
    return this.#sdk.parameterHasDrawEffect(puppet, parameter, axis);
  }

  setCameraTransform(x: number, y: number, scale: number): void {
    this.#renderer.setCameraTransform(x, y, scale);
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.#renderer.resize(width, height, devicePixelRatio);
  }

  renderFrame(timestampMs: number): void {
    this.#assertActive();
    const puppet = this.#puppet;
    if (!puppet) {
      throw new Error("no Inochi2D model is loaded");
    }
    const deltaSeconds = boundedFrameDeltaSeconds(
      this.#lastTimestampMs,
      timestampMs,
    );
    if (Number.isFinite(timestampMs)) {
      this.#lastTimestampMs = timestampMs;
    }
    this.#renderer.render(this.#sdk.updateAndDraw(puppet, deltaSeconds));
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    try {
      this.#renderer.destroy();
    } catch (error) {
      firstError = error;
    }
    try {
      this.#sdk.freePuppet(this.#puppet);
    } catch (error) {
      firstError ??= error;
    } finally {
      this.#puppet = undefined;
      this.#modelBounds = undefined;
    }
    try {
      this.#sdk.destroy();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #parameter(id: string): OfficialParameter {
    this.#assertActive();
    const parameter = this.#puppet?.parameters.get(id);
    if (!parameter) {
      throw new MissingModelParameterError(id);
    }
    return parameter;
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("official Inochi2D runtime is destroyed");
    }
  }
}

/** Compute visible model-space bounds from mesh commands in an SDK draw list. */
export function drawListBounds(
  drawList: OfficialDrawList,
): ModelBounds | undefined {
  const vertexCount = drawList.vertices.length / 4;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let referenced = 0;

  for (const command of drawList.commands) {
    if (
      (command.state !== 0 && command.state !== 1) ||
      command.elementCount === 0
    ) {
      continue;
    }
    const indexEnd = command.indexOffset + command.elementCount;
    for (let position = command.indexOffset; position < indexEnd; position += 1) {
      const localIndex = drawList.indices[position];
      if (localIndex === undefined) {
        throw new Error("official draw command references a missing mesh index");
      }
      const vertexIndex = command.vertexOffset + localIndex;
      if (vertexIndex >= vertexCount) {
        throw new Error(
          `official draw command references vertex ${vertexIndex}/${vertexCount}`,
        );
      }
      const x = drawList.vertices[vertexIndex * 4];
      const y = drawList.vertices[vertexIndex * 4 + 1];
      if (x === undefined || y === undefined) {
        throw new Error("official draw command references missing vertex coordinates");
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      referenced += 1;
    }
  }

  if (referenced === 0 || maxX <= minX || maxY <= minY) {
    return undefined;
  }
  return { minX, minY, maxX, maxY };
}
