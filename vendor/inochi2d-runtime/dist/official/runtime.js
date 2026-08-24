import { MissingModelParameterError } from "../errors.js";
import { OfficialWebGlRenderer } from "./renderer.js";
import { OfficialInochi2dSdk, } from "./sdk.js";
const MAX_PHYSICS_DELTA_SECONDS = 1 / 15;
/** Keeps resumed/background tabs from feeding an unstable time jump to physics. */
export function boundedFrameDeltaSeconds(previousTimestampMs, timestampMs) {
    if (previousTimestampMs === undefined ||
        !Number.isFinite(previousTimestampMs) ||
        !Number.isFinite(timestampMs)) {
        return 0;
    }
    return Math.min(MAX_PHYSICS_DELTA_SECONDS, Math.max(0, timestampMs - previousTimestampMs) / 1_000);
}
export class OfficialInochi2dRuntime {
    #sdk;
    #renderer;
    #puppet;
    #modelBounds;
    #lastTimestampMs;
    #destroyed = false;
    constructor(sdk, renderer) {
        this.#sdk = sdk;
        this.#renderer = renderer;
    }
    static async create(canvas, options, wasmUrl, signal) {
        const sdk = await OfficialInochi2dSdk.create(wasmUrl, signal);
        try {
            return new OfficialInochi2dRuntime(sdk, new OfficialWebGlRenderer(canvas, options.initialScale));
        }
        catch (error) {
            sdk.destroy();
            throw error;
        }
    }
    loadModel(bytes) {
        this.#assertActive();
        const next = this.#sdk.loadPuppet(bytes);
        try {
            const textures = this.#sdk.readTextures(next);
            const modelBounds = drawListBounds(this.#sdk.updateAndDraw(next, 0));
            this.#renderer.uploadTextures(textures);
            this.#modelBounds = modelBounds;
        }
        catch (error) {
            this.#sdk.freePuppet(next);
            throw error;
        }
        this.#sdk.freePuppet(this.#puppet);
        this.#puppet = next;
        this.#lastTimestampMs = undefined;
    }
    modelBounds() {
        const bounds = this.#modelBounds;
        return bounds ? { ...bounds } : undefined;
    }
    setParameterScalar(id, value) {
        this.#sdk.setParameter(this.#parameter(id), value);
    }
    setParameterVector(id, x, y) {
        this.#sdk.setParameter(this.#parameter(id), [x, y]);
    }
    /** Internal capability used to avoid treating an ineffective parameter as visible motion. */
    parameterHasVisibleEffect(id, axis) {
        const puppet = this.#puppet;
        const parameter = puppet?.parameters.get(id);
        if (!puppet || !parameter) {
            return undefined;
        }
        return this.#sdk.parameterHasDrawEffect(puppet, parameter, axis);
    }
    setCameraTransform(x, y, scale) {
        this.#renderer.setCameraTransform(x, y, scale);
    }
    resize(width, height, devicePixelRatio) {
        this.#renderer.resize(width, height, devicePixelRatio);
    }
    renderFrame(timestampMs) {
        this.#assertActive();
        const puppet = this.#puppet;
        if (!puppet) {
            throw new Error("no Inochi2D model is loaded");
        }
        const deltaSeconds = boundedFrameDeltaSeconds(this.#lastTimestampMs, timestampMs);
        if (Number.isFinite(timestampMs)) {
            this.#lastTimestampMs = timestampMs;
        }
        this.#renderer.render(this.#sdk.updateAndDraw(puppet, deltaSeconds));
    }
    destroy() {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        let firstError;
        try {
            this.#renderer.destroy();
        }
        catch (error) {
            firstError = error;
        }
        try {
            this.#sdk.freePuppet(this.#puppet);
        }
        catch (error) {
            firstError ??= error;
        }
        finally {
            this.#puppet = undefined;
            this.#modelBounds = undefined;
        }
        try {
            this.#sdk.destroy();
        }
        catch (error) {
            firstError ??= error;
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    }
    #parameter(id) {
        this.#assertActive();
        const parameter = this.#puppet?.parameters.get(id);
        if (!parameter) {
            throw new MissingModelParameterError(id);
        }
        return parameter;
    }
    #assertActive() {
        if (this.#destroyed) {
            throw new Error("official Inochi2D runtime is destroyed");
        }
    }
}
/** Compute visible model-space bounds from mesh commands in an SDK draw list. */
export function drawListBounds(drawList) {
    const vertexCount = drawList.vertices.length / 4;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let referenced = 0;
    for (const command of drawList.commands) {
        if ((command.state !== 0 && command.state !== 1) ||
            command.elementCount === 0) {
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
                throw new Error(`official draw command references vertex ${vertexIndex}/${vertexCount}`);
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
//# sourceMappingURL=runtime.js.map