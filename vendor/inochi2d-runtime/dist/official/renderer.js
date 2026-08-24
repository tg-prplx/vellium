const DRAW_STATE_NORMAL = 0;
const DRAW_STATE_DEFINE_MASK = 1;
const DRAW_STATE_PUSH_MASK = 2;
const DRAW_STATE_POP_MASK = 3;
const DRAW_STATE_COMPOSITE_BEGIN = 4;
const DRAW_STATE_COMPOSITE_END = 5;
const DRAW_STATE_COMPOSITE_BLIT = 6;
const MASK_MODE_MASK = 0;
const MASK_MODE_DODGE = 1;
const BLEND_NORMAL = 0x00;
const BLEND_MULTIPLY = 0x01;
const BLEND_SCREEN = 0x02;
const BLEND_LIGHTEN = 0x05;
const BLEND_COLOR_DODGE = 0x06;
const BLEND_LINEAR_DODGE = 0x07;
const BLEND_ADD_GLOW = 0x08;
const BLEND_COLOR_BURN = 0x09;
const BLEND_INVERSE = 0x0f;
const BLEND_DESTINATION_IN = 0x10;
const BLEND_SOURCE_IN = 0x11;
const BLEND_SOURCE_OUT = 0x12;
/**
 * Apply the fixed-function blend equations defined by the Inochi2D standard.
 *
 * RGB and alpha use different destination factors for LinearDodge and AddGlow;
 * using blendFunc() there subtly accumulates transparency into dark fringes.
 */
export function applyInochiBlendMode(gl, mode) {
    gl.enable(gl.BLEND);
    switch (mode) {
        case BLEND_NORMAL:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_MULTIPLY:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_SCREEN:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
            break;
        case BLEND_LIGHTEN:
            gl.blendEquation(gl.MAX);
            gl.blendFunc(gl.DST_COLOR, gl.ONE);
            break;
        case BLEND_COLOR_DODGE:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.DST_COLOR, gl.ONE);
            break;
        case BLEND_LINEAR_DODGE:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_ADD_GLOW:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_COLOR_BURN:
            throw new Error("ColorBurn requires the shader-based blend path");
        case BLEND_INVERSE:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_DESTINATION_IN:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
            break;
        case BLEND_SOURCE_IN:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            break;
        case BLEND_SOURCE_OUT:
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
            break;
        default:
            throw new Error(`unsupported official Inochi2D blend mode ${mode}`);
    }
}
export class OfficialWebGlRenderer {
    #canvas;
    #gl;
    #meshVertexArray;
    #meshVertexBuffer;
    #meshIndexBuffer;
    #quadVertexArray;
    #quadVertexBuffer;
    #partProgram;
    #colorBurnProgram;
    #maskProgram;
    #combineProgram;
    #textures = new Map();
    #colorTargets = [];
    #maskTargets = [];
    #compositeStack = [];
    #maskStack = [];
    #whiteTexture;
    #colorTargetCursor = 0;
    #maskTargetCursor = 0;
    #lastComposite;
    #logicalWidth = 1;
    #logicalHeight = 1;
    #cameraX = 0;
    #cameraY = 0;
    #cameraScale;
    #destroyed = false;
    constructor(canvas, initialScale) {
        const gl = canvas.getContext("webgl2", {
            alpha: true,
            antialias: true,
            depth: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            stencil: true,
        });
        if (!gl) {
            throw new Error("WebGL2 is unavailable");
        }
        this.#canvas = canvas;
        this.#gl = gl;
        this.#cameraScale = initialScale;
        this.#meshVertexArray = requireGlObject(gl.createVertexArray(), "mesh vertex array");
        this.#meshVertexBuffer = requireGlObject(gl.createBuffer(), "mesh vertex buffer");
        this.#meshIndexBuffer = requireGlObject(gl.createBuffer(), "mesh index buffer");
        this.#quadVertexArray = requireGlObject(gl.createVertexArray(), "quad vertex array");
        this.#quadVertexBuffer = requireGlObject(gl.createBuffer(), "quad vertex buffer");
        this.#partProgram = createPartProgram(gl);
        this.#colorBurnProgram = createColorBurnProgram(gl);
        this.#maskProgram = createMaskProgram(gl);
        this.#combineProgram = createCombineProgram(gl);
        this.#whiteTexture = createWhiteTexture(gl);
        this.#prepareVertexArrays();
    }
    uploadTextures(textures) {
        this.#assertActive();
        const next = new Map();
        try {
            for (const source of textures) {
                if (next.has(source.pointer)) {
                    throw new Error(`official SDK returned duplicate texture pointer ${source.pointer}`);
                }
                next.set(source.pointer, createModelTexture(this.#gl, source));
            }
        }
        catch (error) {
            for (const texture of next.values()) {
                this.#gl.deleteTexture(texture);
            }
            throw error;
        }
        for (const texture of this.#textures.values()) {
            this.#gl.deleteTexture(texture);
        }
        this.#textures.clear();
        for (const [pointer, texture] of next) {
            this.#textures.set(pointer, texture);
        }
    }
    setCameraTransform(x, y, scale) {
        this.#assertActive();
        if (![x, y, scale].every(Number.isFinite) || scale <= 0) {
            throw new Error("camera transform must contain finite values and a positive scale");
        }
        this.#cameraX = x;
        this.#cameraY = y;
        this.#cameraScale = scale;
    }
    resize(width, height, devicePixelRatio) {
        this.#assertActive();
        if (![width, height, devicePixelRatio].every(Number.isFinite) ||
            width <= 0 ||
            height <= 0 ||
            devicePixelRatio <= 0) {
            throw new Error("canvas dimensions and device pixel ratio must be finite and positive");
        }
        const logicalWidth = Math.max(1, width);
        const logicalHeight = Math.max(1, height);
        const ratio = Math.max(0.1, devicePixelRatio);
        const pixelWidth = Math.max(1, Math.round(logicalWidth * ratio));
        const pixelHeight = Math.max(1, Math.round(logicalHeight * ratio));
        this.#logicalWidth = logicalWidth;
        this.#logicalHeight = logicalHeight;
        if (this.#canvas.width !== pixelWidth || this.#canvas.height !== pixelHeight) {
            this.#canvas.width = pixelWidth;
            this.#canvas.height = pixelHeight;
            this.#deleteTargets(this.#colorTargets);
            this.#deleteTargets(this.#maskTargets);
        }
    }
    render(drawList) {
        this.#assertActive();
        const gl = this.#gl;
        this.#resetFrameState();
        gl.bindVertexArray(this.#meshVertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#meshVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, drawList.vertices, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#meshIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawList.indices, gl.DYNAMIC_DRAW);
        this.#bindOutputTarget();
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        for (const command of drawList.commands) {
            switch (command.state) {
                case DRAW_STATE_NORMAL:
                    this.#drawPart(command, false);
                    break;
                case DRAW_STATE_DEFINE_MASK:
                    this.#drawMask(command);
                    break;
                case DRAW_STATE_PUSH_MASK:
                    this.#pushMask();
                    break;
                case DRAW_STATE_POP_MASK:
                    this.#popMask();
                    break;
                case DRAW_STATE_COMPOSITE_BEGIN:
                    this.#beginComposite();
                    break;
                case DRAW_STATE_COMPOSITE_END:
                    this.#endComposite();
                    break;
                case DRAW_STATE_COMPOSITE_BLIT:
                    this.#blitComposite(command);
                    break;
                default:
                    throw new Error(`unsupported official draw state ${command.state}`);
            }
        }
        if (this.#compositeStack.length !== 0 || this.#maskStack.length !== 0) {
            throw new Error("official draw list ended with unbalanced render state");
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);
    }
    destroy() {
        if (this.#destroyed) {
            return;
        }
        const gl = this.#gl;
        for (const texture of this.#textures.values()) {
            gl.deleteTexture(texture);
        }
        this.#textures.clear();
        gl.deleteTexture(this.#whiteTexture);
        this.#deleteTargets(this.#colorTargets);
        this.#deleteTargets(this.#maskTargets);
        gl.deleteProgram(this.#partProgram.program);
        gl.deleteProgram(this.#colorBurnProgram.program);
        gl.deleteProgram(this.#maskProgram.program);
        gl.deleteProgram(this.#combineProgram.program);
        gl.deleteBuffer(this.#meshVertexBuffer);
        gl.deleteBuffer(this.#meshIndexBuffer);
        gl.deleteBuffer(this.#quadVertexBuffer);
        gl.deleteVertexArray(this.#meshVertexArray);
        gl.deleteVertexArray(this.#quadVertexArray);
        this.#destroyed = true;
    }
    #prepareVertexArrays() {
        const gl = this.#gl;
        gl.bindVertexArray(this.#meshVertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#meshVertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#meshIndexBuffer);
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.bindVertexArray(this.#quadVertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            1, 1, 1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindVertexArray(null);
    }
    #drawPart(command, screenSpace) {
        if (command.elementCount === 0) {
            return;
        }
        if (command.blendMode === BLEND_COLOR_BURN) {
            this.#drawColorBurn(command, screenSpace, false);
            return;
        }
        const gl = this.#gl;
        this.#bindOutputTarget();
        this.#setBlendMode(command.blendMode);
        const program = this.#partProgram;
        gl.useProgram(program.program);
        this.#setCommonUniforms(program, screenSpace);
        const source = this.#textures.get(command.sources[0] ?? 0) ?? this.#whiteTexture;
        bindTexture(gl, 0, source);
        gl.uniform1i(program.albedo, 0);
        const mask = this.#activeMask();
        // Resolving a nested mask renders into a temporary framebuffer with the
        // mask-combine program. Restore both the output target and part program
        // before sampling that mask for the actual part draw.
        this.#bindOutputTarget();
        gl.useProgram(program.program);
        if (mask) {
            bindTexture(gl, 1, mask.texture);
            gl.uniform1i(program.mask, 1);
            gl.uniform1i(program.hasMask, 1);
        }
        else {
            gl.uniform1i(program.hasMask, 0);
        }
        gl.uniform2f(program.targetSize, this.#canvas.width, this.#canvas.height);
        gl.uniform3f(program.tint, finiteOr(command.variables[0], 1), finiteOr(command.variables[1], 1), finiteOr(command.variables[2], 1));
        gl.uniform3f(program.screenTint, finiteOr(command.variables[3], 0), finiteOr(command.variables[4], 0), finiteOr(command.variables[5], 0));
        gl.uniform1f(program.opacity, clamp(finiteOr(command.variables[7], 1), 0, 1));
        this.#drawMesh(command);
    }
    #drawMask(command) {
        if (command.elementCount === 0) {
            return;
        }
        const gl = this.#gl;
        const frame = this.#maskStack.at(-1);
        if (!frame) {
            throw new Error("official draw list defined a mask without opening a mask scope");
        }
        if (frame.combined) {
            throw new Error("official draw list changed a mask after masked drawing began");
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, frame.raw.framebuffer);
        gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
        if (!frame.initialized) {
            const clearValue = command.maskMode === MASK_MODE_DODGE ? 1 : 0;
            gl.clearColor(clearValue, clearValue, clearValue, clearValue);
            gl.clear(gl.COLOR_BUFFER_BIT);
            frame.initialized = true;
        }
        gl.enable(gl.BLEND);
        if (command.maskMode === MASK_MODE_MASK) {
            gl.blendEquation(gl.MAX);
            gl.blendFunc(gl.ONE, gl.ONE);
        }
        else if (command.maskMode === MASK_MODE_DODGE) {
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ONE, gl.ONE);
        }
        else {
            throw new Error(`unsupported mask mode ${command.maskMode}`);
        }
        const program = this.#maskProgram;
        gl.useProgram(program.program);
        this.#setCommonUniforms(program, false);
        bindTexture(gl, 0, this.#textures.get(command.sources[0] ?? 0) ?? this.#whiteTexture);
        gl.uniform1i(program.albedo, 0);
        this.#drawMesh(command);
    }
    #pushMask() {
        this.#maskStack.push({
            raw: this.#acquireMaskTarget(),
            initialized: false,
        });
    }
    #popMask() {
        const frame = this.#maskStack.pop();
        if (!frame) {
            throw new Error("official draw list popped an empty mask stack");
        }
        if (!frame.initialized) {
            throw new Error("official draw list closed a mask without defining it");
        }
    }
    #beginComposite() {
        const target = this.#acquireColorTarget();
        this.#compositeStack.push(target);
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, target.framebuffer);
        this.#gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
        this.#gl.clearColor(0, 0, 0, 0);
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT);
    }
    #endComposite() {
        const target = this.#compositeStack.pop();
        if (!target) {
            throw new Error("official draw list ended an empty composite stack");
        }
        this.#lastComposite = target;
        this.#bindOutputTarget();
    }
    #blitComposite(command) {
        const source = this.#lastComposite;
        if (!source) {
            throw new Error("official draw list requested a composite blit without a source");
        }
        const gl = this.#gl;
        if (command.blendMode === BLEND_COLOR_BURN) {
            this.#drawColorBurn(command, true, true);
            this.#lastComposite = undefined;
            return;
        }
        this.#bindOutputTarget();
        this.#setBlendMode(command.blendMode);
        const program = this.#partProgram;
        gl.useProgram(program.program);
        this.#setCommonUniforms(program, true);
        bindTexture(gl, 0, source.texture);
        gl.uniform1i(program.albedo, 0);
        const mask = this.#activeMask();
        this.#bindOutputTarget();
        gl.useProgram(program.program);
        if (mask) {
            bindTexture(gl, 1, mask.texture);
            gl.uniform1i(program.mask, 1);
            gl.uniform1i(program.hasMask, 1);
        }
        else {
            gl.uniform1i(program.hasMask, 0);
        }
        gl.uniform2f(program.targetSize, this.#canvas.width, this.#canvas.height);
        gl.uniform3f(program.tint, finiteOr(command.variables[0], 1), finiteOr(command.variables[1], 1), finiteOr(command.variables[2], 1));
        gl.uniform3f(program.screenTint, finiteOr(command.variables[3], 0), finiteOr(command.variables[4], 0), finiteOr(command.variables[5], 0));
        gl.uniform1f(program.opacity, clamp(finiteOr(command.variables[7], 1), 0, 1));
        this.#drawQuad();
        this.#lastComposite = undefined;
    }
    #drawColorBurn(command, screenSpace, compositeBlit) {
        const gl = this.#gl;
        const backdrop = this.#captureOutput();
        this.#bindOutputTarget();
        gl.disable(gl.BLEND);
        const program = this.#colorBurnProgram;
        gl.useProgram(program.program);
        this.#setCommonUniforms(program, screenSpace);
        const source = compositeBlit
            ? this.#lastComposite?.texture
            : this.#textures.get(command.sources[0] ?? 0);
        bindTexture(gl, 0, source ?? this.#whiteTexture);
        gl.uniform1i(program.albedo, 0);
        const mask = this.#activeMask();
        this.#bindOutputTarget();
        gl.useProgram(program.program);
        if (mask) {
            bindTexture(gl, 1, mask.texture);
            gl.uniform1i(program.mask, 1);
            gl.uniform1i(program.hasMask, 1);
        }
        else {
            gl.uniform1i(program.hasMask, 0);
        }
        bindTexture(gl, 2, backdrop.texture);
        gl.uniform1i(program.backdrop, 2);
        gl.uniform2f(program.targetSize, this.#canvas.width, this.#canvas.height);
        gl.uniform3f(program.tint, finiteOr(command.variables[0], 1), finiteOr(command.variables[1], 1), finiteOr(command.variables[2], 1));
        gl.uniform3f(program.screenTint, finiteOr(command.variables[3], 0), finiteOr(command.variables[4], 0), finiteOr(command.variables[5], 0));
        gl.uniform1f(program.opacity, clamp(finiteOr(command.variables[7], 1), 0, 1));
        if (compositeBlit) {
            this.#drawQuad();
        }
        else {
            this.#drawMesh(command);
        }
    }
    #captureOutput() {
        const gl = this.#gl;
        const target = this.#acquireColorTarget();
        this.#bindOutputTarget();
        bindTexture(gl, 2, target.texture);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.#canvas.width, this.#canvas.height);
        return target;
    }
    #drawMesh(command) {
        const gl = this.#gl;
        gl.bindVertexArray(this.#meshVertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#meshVertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#meshIndexBuffer);
        const vertexByteOffset = command.vertexOffset * 16;
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, vertexByteOffset);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, vertexByteOffset + 8);
        gl.drawElements(gl.TRIANGLES, command.elementCount, gl.UNSIGNED_INT, command.indexOffset * Uint32Array.BYTES_PER_ELEMENT);
    }
    #drawQuad() {
        const gl = this.#gl;
        gl.bindVertexArray(this.#quadVertexArray);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    #activeMask() {
        const index = this.#maskStack.length - 1;
        if (index < 0) {
            return undefined;
        }
        const frame = this.#maskStack[index];
        if (!frame?.initialized) {
            throw new Error("official draw list used a mask before defining it");
        }
        if (index === 0) {
            return frame.raw;
        }
        if (frame.combined) {
            return frame.combined;
        }
        const parent = this.#activeMaskAt(index - 1);
        const combined = this.#acquireMaskTarget();
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, combined.framebuffer);
        this.#gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
        this.#gl.disable(this.#gl.BLEND);
        this.#gl.useProgram(this.#combineProgram.program);
        bindTexture(this.#gl, 0, parent.texture);
        bindTexture(this.#gl, 1, frame.raw.texture);
        this.#gl.uniform1i(this.#combineProgram.parentMask, 0);
        this.#gl.uniform1i(this.#combineProgram.childMask, 1);
        this.#drawQuad();
        frame.combined = combined;
        return combined;
    }
    #activeMaskAt(index) {
        const frame = this.#maskStack[index];
        if (!frame?.initialized) {
            throw new Error("official draw list used a parent mask before defining it");
        }
        if (index === 0) {
            return frame.raw;
        }
        if (frame.combined) {
            return frame.combined;
        }
        const parent = this.#activeMaskAt(index - 1);
        const combined = this.#acquireMaskTarget();
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, combined.framebuffer);
        this.#gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
        this.#gl.disable(this.#gl.BLEND);
        this.#gl.useProgram(this.#combineProgram.program);
        bindTexture(this.#gl, 0, parent.texture);
        bindTexture(this.#gl, 1, frame.raw.texture);
        this.#gl.uniform1i(this.#combineProgram.parentMask, 0);
        this.#gl.uniform1i(this.#combineProgram.childMask, 1);
        this.#drawQuad();
        frame.combined = combined;
        return combined;
    }
    #setCommonUniforms(program, screenSpace) {
        const gl = this.#gl;
        gl.uniform2f(program.viewport, this.#logicalWidth, this.#logicalHeight);
        gl.uniform3f(program.camera, this.#cameraX, this.#cameraY, this.#cameraScale);
        gl.uniform1i(program.screenSpace, screenSpace ? 1 : 0);
    }
    #setBlendMode(mode) {
        applyInochiBlendMode(this.#gl, mode);
    }
    #bindOutputTarget() {
        const target = this.#compositeStack.at(-1);
        this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, target?.framebuffer ?? null);
        this.#gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    }
    #acquireColorTarget() {
        const target = this.#colorTargets[this.#colorTargetCursor] ??
            this.#createTarget(this.#colorTargets);
        this.#colorTargetCursor += 1;
        return target;
    }
    #acquireMaskTarget() {
        const target = this.#maskTargets[this.#maskTargetCursor] ??
            this.#createTarget(this.#maskTargets);
        this.#maskTargetCursor += 1;
        return target;
    }
    #createTarget(pool) {
        const gl = this.#gl;
        const texture = requireGlObject(gl.createTexture(), "render target texture");
        bindTexture(gl, 0, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.#canvas.width, this.#canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const framebuffer = requireGlObject(gl.createFramebuffer(), "render target framebuffer");
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
            throw new Error("WebGL2 could not create an Inochi2D render target");
        }
        const target = { framebuffer, texture };
        pool.push(target);
        return target;
    }
    #deleteTargets(targets) {
        for (const target of targets.splice(0)) {
            this.#gl.deleteFramebuffer(target.framebuffer);
            this.#gl.deleteTexture(target.texture);
        }
    }
    #resetFrameState() {
        this.#colorTargetCursor = 0;
        this.#maskTargetCursor = 0;
        this.#lastComposite = undefined;
        this.#compositeStack.length = 0;
        this.#maskStack.length = 0;
    }
    #assertActive() {
        if (this.#destroyed) {
            throw new Error("official Inochi2D WebGL renderer is destroyed");
        }
    }
}
const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_viewport;
uniform vec3 u_camera;
uniform bool u_screen_space;
out vec2 v_uv;
void main() {
  vec2 clip = a_position;
  if (!u_screen_space) {
    vec2 world = (a_position + u_camera.xy) * u_camera.z;
    // Inochi2D model space uses screen-style Y-down coordinates, while WebGL
    // clip space points up. Flip only model geometry; render-target quads are
    // already expressed directly in clip space.
    clip = vec2(world.x * 2.0 / u_viewport.x, -world.y * 2.0 / u_viewport.y);
  }
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
}`;
const PART_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_albedo;
uniform sampler2D u_mask;
uniform bool u_has_mask;
uniform vec2 u_target_size;
uniform vec3 u_tint;
uniform vec3 u_screen_tint;
uniform float u_opacity;
out vec4 out_color;
void main() {
  vec4 tex_color = texture(u_albedo, v_uv);
  vec3 screen_color =
    vec3(1.0) - ((vec3(1.0) - tex_color.rgb) *
    (vec3(1.0) - (u_screen_tint * tex_color.a)));
  vec4 color = vec4(screen_color, tex_color.a) * vec4(u_tint, 1.0) * u_opacity;
  if (u_has_mask) {
    color *= texture(u_mask, gl_FragCoord.xy / u_target_size).r;
  }
  out_color = color;
}`;
const COLOR_BURN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_albedo;
uniform sampler2D u_mask;
uniform sampler2D u_backdrop;
uniform bool u_has_mask;
uniform vec2 u_target_size;
uniform vec3 u_tint;
uniform vec3 u_screen_tint;
uniform float u_opacity;
out vec4 out_color;
void main() {
  vec4 tex_color = texture(u_albedo, v_uv);
  vec3 screen_color =
    vec3(1.0) - ((vec3(1.0) - tex_color.rgb) *
    (vec3(1.0) - (u_screen_tint * tex_color.a)));
  vec4 source = vec4(screen_color, tex_color.a) * vec4(u_tint, 1.0) * u_opacity;
  if (u_has_mask) {
    source *= texture(u_mask, gl_FragCoord.xy / u_target_size).r;
  }

  vec4 backdrop = texture(u_backdrop, gl_FragCoord.xy / u_target_size);
  float source_alpha = clamp(source.a, 0.0, 1.0);
  float backdrop_alpha = clamp(backdrop.a, 0.0, 1.0);
  vec3 source_color =
    source_alpha > 0.000001 ? source.rgb / source_alpha : vec3(0.0);
  vec3 backdrop_color =
    backdrop_alpha > 0.000001 ? backdrop.rgb / backdrop_alpha : vec3(0.0);
  vec3 burn = vec3(0.0);
  bvec3 nonzero_source = greaterThan(source_color, vec3(0.000001));
  vec3 divided =
    vec3(1.0) - min(vec3(1.0), (vec3(1.0) - backdrop_color) /
      max(source_color, vec3(0.000001)));
  burn = mix(burn, divided, nonzero_source);

  float output_alpha =
    source_alpha + backdrop_alpha - source_alpha * backdrop_alpha;
  vec3 output_rgb =
    source.rgb * (1.0 - backdrop_alpha) +
    backdrop.rgb * (1.0 - source_alpha) +
    burn * source_alpha * backdrop_alpha;
  out_color = vec4(output_rgb, output_alpha);
}`;
const MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_albedo;
out vec4 out_color;
void main() {
  float alpha = texture(u_albedo, v_uv).a;
  out_color = vec4(alpha);
}`;
const QUAD_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}`;
const COMBINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_parent_mask;
uniform sampler2D u_child_mask;
out vec4 out_color;
void main() {
  float alpha = texture(u_parent_mask, v_uv).r * texture(u_child_mask, v_uv).r;
  out_color = vec4(alpha);
}`;
function createPartProgram(gl) {
    const program = linkProgram(gl, VERTEX_SHADER, PART_FRAGMENT_SHADER);
    return {
        ...commonHandles(gl, program),
        program,
        albedo: gl.getUniformLocation(program, "u_albedo"),
        mask: gl.getUniformLocation(program, "u_mask"),
        hasMask: gl.getUniformLocation(program, "u_has_mask"),
        targetSize: gl.getUniformLocation(program, "u_target_size"),
        tint: gl.getUniformLocation(program, "u_tint"),
        screenTint: gl.getUniformLocation(program, "u_screen_tint"),
        opacity: gl.getUniformLocation(program, "u_opacity"),
    };
}
function createColorBurnProgram(gl) {
    const program = linkProgram(gl, VERTEX_SHADER, COLOR_BURN_FRAGMENT_SHADER);
    return {
        ...commonHandles(gl, program),
        program,
        albedo: gl.getUniformLocation(program, "u_albedo"),
        mask: gl.getUniformLocation(program, "u_mask"),
        backdrop: gl.getUniformLocation(program, "u_backdrop"),
        hasMask: gl.getUniformLocation(program, "u_has_mask"),
        targetSize: gl.getUniformLocation(program, "u_target_size"),
        tint: gl.getUniformLocation(program, "u_tint"),
        screenTint: gl.getUniformLocation(program, "u_screen_tint"),
        opacity: gl.getUniformLocation(program, "u_opacity"),
    };
}
function createMaskProgram(gl) {
    const program = linkProgram(gl, VERTEX_SHADER, MASK_FRAGMENT_SHADER);
    return {
        ...commonHandles(gl, program),
        program,
        albedo: gl.getUniformLocation(program, "u_albedo"),
    };
}
function createCombineProgram(gl) {
    const program = linkProgram(gl, QUAD_VERTEX_SHADER, COMBINE_FRAGMENT_SHADER);
    return {
        program,
        parentMask: gl.getUniformLocation(program, "u_parent_mask"),
        childMask: gl.getUniformLocation(program, "u_child_mask"),
    };
}
function commonHandles(gl, program) {
    return {
        viewport: gl.getUniformLocation(program, "u_viewport"),
        camera: gl.getUniformLocation(program, "u_camera"),
        screenSpace: gl.getUniformLocation(program, "u_screen_space"),
    };
}
function linkProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = requireGlObject(gl.createProgram(), "shader program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || "unknown link error";
        gl.deleteProgram(program);
        throw new Error(`Inochi2D WebGL shader link failed: ${message}`);
    }
    return program;
}
function compileShader(gl, type, source) {
    const shader = requireGlObject(gl.createShader(type), "shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "unknown compilation error";
        gl.deleteShader(shader);
        throw new Error(`Inochi2D WebGL shader compilation failed: ${message}`);
    }
    return shader;
}
function createWhiteTexture(gl) {
    const texture = requireGlObject(gl.createTexture(), "white texture");
    bindTexture(gl, 0, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}
function createModelTexture(gl, source) {
    const texture = requireGlObject(gl.createTexture(), "model texture");
    bindTexture(gl, 0, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    const [internalFormat, format] = textureFormat(gl, source.channels);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, source.width, source.height, 0, format, gl.UNSIGNED_BYTE, source.pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}
function textureFormat(gl, channels) {
    switch (channels) {
        case 1:
            return [gl.R8, gl.RED];
        case 2:
            return [gl.RG8, gl.RG];
        case 3:
            return [gl.RGB8, gl.RGB];
        case 4:
            return [gl.RGBA8, gl.RGBA];
    }
}
function bindTexture(gl, unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
}
function requireGlObject(value, description) {
    if (!value) {
        throw new Error(`WebGL2 failed to create ${description}`);
    }
    return value;
}
function finiteOr(value, fallback) {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
//# sourceMappingURL=renderer.js.map