const MAX_WASM_BYTES = 8 * 1024 * 1024;
const MAX_PARAMETERS = 4_096;
const MAX_DRAW_COMMANDS = 65_536;
const MAX_DRAW_BUFFER_BYTES = 64 * 1024 * 1024;
const DRAW_COMMAND_BYTES = 128;
const VERTEX_BYTES = 16;

type Pointer = number;

interface OfficialExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  in_init(): void;
  nu_malloc(bytes: number): Pointer;
  nu_realloc(pointer: Pointer, bytes: number): Pointer;
  nu_free(pointer: Pointer): void;
  in_puppet_load_from_memory(
    data: Pointer,
    length: number,
    sink: Pointer,
  ): Pointer;
  in_puppet_free(puppet: Pointer): void;
  in_puppet_update(puppet: Pointer, deltaSeconds: number): void;
  in_puppet_draw(puppet: Pointer, deltaSeconds: number): void;
  in_puppet_get_parameters(puppet: Pointer, count: Pointer): Pointer;
  in_puppet_get_drawlist(puppet: Pointer): Pointer;
  in_puppet_get_texture_cache(puppet: Pointer): Pointer;
  in_puppet_get_physics_enabled(puppet: Pointer): number;
  in_puppet_set_physics_enabled(puppet: Pointer, enabled: number): void;
  in_puppet_get_driver_count(puppet: Pointer): number;
  in_puppet_get_resolved_driver_count(puppet: Pointer): number;
  in_puppet_get_spring_driver_count(puppet: Pointer): number;
  in_puppet_get_xy_driver_count(puppet: Pointer): number;
  in_puppet_get_nonzero_physics_scale_count(puppet: Pointer): number;
  in_parameter_get_name(parameter: Pointer): Pointer;
  in_parameter_get_dimensions(parameter: Pointer): number;
  in_parameter_get_lower_bounds(parameter: Pointer): Pointer;
  in_parameter_get_upper_bounds(parameter: Pointer): Pointer;
  in_parameter_get_binding_count(parameter: Pointer): number;
  in_parameter_get_bound_binding_count(parameter: Pointer): number;
  in_parameter_get_invalid_binding_application_count(
    parameter: Pointer,
  ): number;
  in_parameter_get_value(parameter: Pointer): Pointer;
  in_parameter_set_value(parameter: Pointer, values: Pointer): void;
  in_texture_cache_get_size(cache: Pointer): number;
  in_texture_cache_get_texture(cache: Pointer, slot: number): Pointer;
  in_texture_get_width(texture: Pointer): number;
  in_texture_get_height(texture: Pointer): number;
  in_texture_get_channels(texture: Pointer): number;
  in_texture_get_pixels(texture: Pointer): Pointer;
  in_drawlist_get_commands(drawList: Pointer, count: Pointer): Pointer;
  in_drawlist_get_vertex_data(drawList: Pointer, bytes: Pointer): Pointer;
  in_drawlist_get_index_data(drawList: Pointer, bytes: Pointer): Pointer;
}

export interface OfficialParameter {
  pointer: Pointer;
  dimensions: 1 | 2;
  lowerBounds: readonly number[];
  upperBounds: readonly number[];
  bindingCount: number;
  boundBindingCount: number;
}

export interface OfficialPuppet {
  pointer: Pointer;
  parameters: Map<string, OfficialParameter>;
  physics: {
    enabled: boolean;
    driverCount: number;
    resolvedDriverCount: number;
    springDriverCount: number;
    xyDriverCount: number;
    nonzeroScaleCount: number;
  };
}

export interface OfficialTexture {
  pointer: Pointer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  pixels: Uint8Array;
}

export interface OfficialDrawCommand {
  sources: readonly Pointer[];
  state: number;
  blendMode: number;
  maskMode: number;
  vertexOffset: number;
  indexOffset: number;
  elementCount: number;
  typeId: number;
  variables: Float32Array;
}

export interface OfficialDrawList {
  commands: readonly OfficialDrawCommand[];
  vertices: Float32Array;
  indices: Uint32Array;
}

interface DrawSnapshot {
  vertices: Float32Array;
  indices: Uint32Array;
  commands: Array<{
    sources: readonly Pointer[];
    state: number;
    blendMode: number;
    maskMode: number;
    vertexOffset: number;
    indexOffset: number;
    elementCount: number;
    typeId: number;
    variables: Float32Array;
  }>;
}

export class OfficialInochi2dSdk {
  readonly #exports: OfficialExports;
  #scratchPointer = 0;
  #scratchBytes = 0;
  #destroyed = false;

  private constructor(exports: OfficialExports) {
    this.#exports = exports;
    exports.in_init();
  }

  static async create(
    wasmUrl: URL,
    signal?: AbortSignal,
  ): Promise<OfficialInochi2dSdk> {
    const bytes = await fetchBounded(wasmUrl, MAX_WASM_BYTES, signal);
    const result = await WebAssembly.instantiate(bytes, createWasiImports());
    return new OfficialInochi2dSdk(
      assertOfficialExports(result.instance.exports),
    );
  }

  loadPuppet(bytes: Uint8Array): OfficialPuppet {
    this.#assertActive();
    if (bytes.byteLength === 0 || bytes.byteLength > 0xffff_ffff) {
      throw new Error(
        "model byte length is invalid for the official Inochi2D SDK",
      );
    }

    const modelPointer = this.#allocate(bytes.byteLength);
    let puppetPointer = 0;
    try {
      this.#bytes(modelPointer, bytes.byteLength).set(bytes);
      puppetPointer = this.#exports.in_puppet_load_from_memory(
        modelPointer,
        bytes.byteLength,
        0,
      );
    } finally {
      this.#exports.nu_free(modelPointer);
    }

    if (puppetPointer === 0) {
      throw new Error("the official Inochi2D SDK rejected the model");
    }

    try {
      return {
        pointer: puppetPointer,
        parameters: this.#readParameters(puppetPointer),
        physics: {
          enabled:
            this.#exports.in_puppet_get_physics_enabled(puppetPointer) !== 0,
          driverCount:
            this.#exports.in_puppet_get_driver_count(puppetPointer),
          resolvedDriverCount:
            this.#exports.in_puppet_get_resolved_driver_count(puppetPointer),
          springDriverCount:
            this.#exports.in_puppet_get_spring_driver_count(puppetPointer),
          xyDriverCount:
            this.#exports.in_puppet_get_xy_driver_count(puppetPointer),
          nonzeroScaleCount:
            this.#exports.in_puppet_get_nonzero_physics_scale_count(
              puppetPointer,
            ),
        },
      };
    } catch (error) {
      this.#exports.in_puppet_free(puppetPointer);
      throw error;
    }
  }

  freePuppet(puppet: OfficialPuppet | undefined): void {
    if (!puppet || this.#destroyed) {
      return;
    }
    this.#exports.in_puppet_free(puppet.pointer);
  }

  setParameter(
    parameter: OfficialParameter,
    value: number | readonly [number, number],
  ): void {
    this.#assertActive();
    const pointer = this.#scratch(
      parameter.dimensions * Float32Array.BYTES_PER_ELEMENT,
    );
    const view = new DataView(this.#exports.memory.buffer);
    if (typeof value === "number") {
      if (parameter.dimensions === 1) {
        view.setFloat32(
          pointer,
          clampParameterValue(parameter, 0, value),
          true,
        );
      } else {
        const current = this.#readParameterValue(parameter);
        view.setFloat32(
          pointer,
          clampParameterValue(parameter, 0, value),
          true,
        );
        view.setFloat32(
          pointer + 4,
          clampParameterValue(parameter, 1, current[1] ?? 0),
          true,
        );
      }
    } else {
      view.setFloat32(
        pointer,
        clampParameterValue(parameter, 0, value[0]),
        true,
      );
      if (parameter.dimensions === 2) {
        view.setFloat32(
          pointer + 4,
          clampParameterValue(parameter, 1, value[1]),
          true,
        );
      }
    }
    this.#exports.in_parameter_set_value(parameter.pointer, pointer);
  }

  /** Reads the current model-owned parameter value for compatibility tests. */
  readParameterValue(parameter: OfficialParameter): readonly number[] {
    this.#assertActive();
    return this.#readParameterValue(parameter);
  }

  setPhysicsEnabled(puppet: OfficialPuppet, enabled: boolean): void {
    this.#assertActive();
    this.#exports.in_puppet_set_physics_enabled(
      puppet.pointer,
      enabled ? 1 : 0,
    );
    puppet.physics.enabled = enabled;
  }

  /**
   * Probes one parameter axis against the official draw list and restores the
   * original value. Declared bindings alone are insufficient: some exported
   * models contain bindings that produce no runtime-visible output.
   */
  parameterHasDrawEffect(
    puppet: OfficialPuppet,
    parameter: OfficialParameter,
    axis: "x" | "y" | undefined,
  ): boolean {
    this.#assertActive();
    const selectedAxis = axis === "y" && parameter.dimensions === 2 ? 1 : 0;
    const original = this.#readParameterValue(parameter);
    const start = [...original];
    const end = [...original];
    start[selectedAxis] = parameter.lowerBounds[selectedAxis]!;
    end[selectedAxis] = parameter.upperBounds[selectedAxis]!;

    try {
      this.setParameter(
        parameter,
        parameter.dimensions === 1 ? start[0]! : [start[0]!, start[1]!],
      );
      const before = snapshotDrawList(this.updateAndDraw(puppet, 0));
      this.setParameter(
        parameter,
        parameter.dimensions === 1 ? end[0]! : [end[0]!, end[1]!],
      );
      return drawListsDiffer(before, this.updateAndDraw(puppet, 0));
    } finally {
      this.setParameter(
        parameter,
        parameter.dimensions === 1
          ? original[0]!
          : [original[0]!, original[1]!],
      );
      this.updateAndDraw(puppet, 0);
    }
  }

  updateAndDraw(
    puppet: OfficialPuppet,
    deltaSeconds: number,
  ): OfficialDrawList {
    this.#assertActive();
    const delta = Number.isFinite(deltaSeconds)
      ? Math.min(0.1, Math.max(0, deltaSeconds))
      : 0;
    this.#exports.in_puppet_update(puppet.pointer, delta);
    for (const [name, parameter] of puppet.parameters) {
      const invalid =
        this.#exports.in_parameter_get_invalid_binding_application_count(
          parameter.pointer,
        );
      if (invalid > 0) {
        throw new Error(
          `parameter ${name} produced ${invalid} invalid runtime binding value(s)`,
        );
      }
    }
    this.#exports.in_puppet_draw(puppet.pointer, delta);
    return this.#readDrawList(puppet.pointer);
  }

  readTextures(puppet: OfficialPuppet): OfficialTexture[] {
    this.#assertActive();
    const cache = this.#exports.in_puppet_get_texture_cache(puppet.pointer);
    if (cache === 0) {
      throw new Error("the official Inochi2D SDK returned no texture cache");
    }
    const count = this.#exports.in_texture_cache_get_size(cache);
    if (!Number.isInteger(count) || count < 0 || count > 4_096) {
      throw new Error(
        `invalid texture count returned by the official SDK: ${count}`,
      );
    }

    const textures: OfficialTexture[] = [];
    for (let slot = 0; slot < count; slot += 1) {
      const pointer = this.#exports.in_texture_cache_get_texture(cache, slot);
      if (pointer === 0) {
        throw new Error(`texture slot ${slot} is empty`);
      }
      const width = this.#exports.in_texture_get_width(pointer);
      const height = this.#exports.in_texture_get_height(pointer);
      const channels = this.#exports.in_texture_get_channels(pointer);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 4_096 ||
        height > 4_096
      ) {
        throw new Error(
          `texture ${slot} has invalid dimensions ${width}x${height}`,
        );
      }
      if (
        channels !== 1 &&
        channels !== 2 &&
        channels !== 3 &&
        channels !== 4
      ) {
        throw new Error(
          `texture ${slot} has unsupported channel count ${channels}`,
        );
      }
      const byteLength = checkedProduct(width, height, channels);
      if (byteLength > MAX_DRAW_BUFFER_BYTES) {
        throw new Error(
          `texture ${slot} exceeds the decoded texture byte limit`,
        );
      }

      // Creator/Mannequin container textures already carry premultiplied RGB.
      // Mutating the SDK cache here would multiply alpha a second time and
      // produce dark fringes; it would also compound after a repeated read.
      const pixelsPointer = this.#exports.in_texture_get_pixels(pointer);
      textures.push({
        pointer,
        width,
        height,
        channels,
        pixels: this.#bytes(pixelsPointer, byteLength),
      });
    }
    return textures;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#scratchPointer !== 0) {
      this.#exports.nu_free(this.#scratchPointer);
      this.#scratchPointer = 0;
      this.#scratchBytes = 0;
    }
    this.#destroyed = true;
  }

  #readParameters(puppet: Pointer): Map<string, OfficialParameter> {
    const countPointer = this.#scratch(4);
    const listPointer = this.#exports.in_puppet_get_parameters(
      puppet,
      countPointer,
    );
    const count = new DataView(this.#exports.memory.buffer).getUint32(
      countPointer,
      true,
    );
    if (count > MAX_PARAMETERS) {
      throw new Error(`model exposes too many parameters: ${count}`);
    }
    const pointers = this.#bytes(listPointer, checkedProduct(count, 4));
    const view = new DataView(
      pointers.buffer,
      pointers.byteOffset,
      pointers.byteLength,
    );
    const parameters = new Map<string, OfficialParameter>();
    for (let index = 0; index < count; index += 1) {
      const pointer = view.getUint32(index * 4, true);
      const name = this.#string(this.#exports.in_parameter_get_name(pointer));
      const dimensions = this.#exports.in_parameter_get_dimensions(pointer);
      const bindingCount =
        this.#exports.in_parameter_get_binding_count(pointer);
      const boundBindingCount =
        this.#exports.in_parameter_get_bound_binding_count(pointer);
      if (name.length === 0) {
        throw new Error(`parameter ${index} has no name`);
      }
      if (dimensions !== 1 && dimensions !== 2) {
        throw new Error(
          `parameter ${name} has unsupported dimensionality ${dimensions}`,
        );
      }
      const lowerBounds = this.#readFloatVector(
        this.#exports.in_parameter_get_lower_bounds(pointer),
        dimensions,
      );
      const upperBounds = this.#readFloatVector(
        this.#exports.in_parameter_get_upper_bounds(pointer),
        dimensions,
      );
      for (let axis = 0; axis < dimensions; axis += 1) {
        if (
          !Number.isFinite(lowerBounds[axis]) ||
          !Number.isFinite(upperBounds[axis]) ||
          lowerBounds[axis]! >= upperBounds[axis]!
        ) {
          throw new Error(
            `parameter ${name} has invalid bounds on axis ${axis}`,
          );
        }
      }
      if (
        !Number.isInteger(bindingCount) ||
        bindingCount < 0 ||
        bindingCount > MAX_DRAW_COMMANDS
      ) {
        throw new Error(
          `parameter ${name} has an invalid binding count ${bindingCount}`,
        );
      }
      if (
        !Number.isInteger(boundBindingCount) ||
        boundBindingCount < 0 ||
        boundBindingCount > bindingCount
      ) {
        throw new Error(
          `parameter ${name} has an invalid resolved binding count ${boundBindingCount}`,
        );
      }
      if (parameters.has(name)) {
        throw new Error(`model contains duplicate parameter ${name}`);
      }
      parameters.set(name, {
        pointer,
        dimensions,
        lowerBounds,
        upperBounds,
        bindingCount,
        boundBindingCount,
      });
    }
    return parameters;
  }

  #readParameterValue(parameter: OfficialParameter): readonly number[] {
    const pointer = this.#exports.in_parameter_get_value(parameter.pointer);
    return this.#readFloatVector(pointer, parameter.dimensions);
  }

  #readFloatVector(pointer: Pointer, length: number): readonly number[] {
    const bytes = this.#bytes(pointer, length * Float32Array.BYTES_PER_ELEMENT);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length }, (_, index) =>
      view.getFloat32(index * 4, true),
    );
  }

  #readDrawList(puppet: Pointer): OfficialDrawList {
    const drawList = this.#exports.in_puppet_get_drawlist(puppet);
    if (drawList === 0) {
      throw new Error("the official SDK returned no draw list");
    }
    const outPointer = this.#scratch(4);
    const commandPointer = this.#exports.in_drawlist_get_commands(
      drawList,
      outPointer,
    );
    const commandCount = new DataView(this.#exports.memory.buffer).getUint32(
      outPointer,
      true,
    );
    if (commandCount > MAX_DRAW_COMMANDS) {
      throw new Error(`draw command count exceeds the limit: ${commandCount}`);
    }
    const commandBytes = this.#bytes(
      commandPointer,
      checkedProduct(commandCount, DRAW_COMMAND_BYTES),
    );
    const commandView = new DataView(
      commandBytes.buffer,
      commandBytes.byteOffset,
      commandBytes.byteLength,
    );
    const commands: OfficialDrawCommand[] = [];
    for (let index = 0; index < commandCount; index += 1) {
      const base = index * DRAW_COMMAND_BYTES;
      const state = commandView.getUint32(base + 32, true);
      const blendMode = commandView.getUint32(base + 36, true);
      const maskMode = commandView.getUint32(base + 40, true);
      const typeId = commandView.getUint32(base + 60, true);
      const sources = Array.from({ length: 8 }, (_, sourceIndex) =>
        commandView.getUint32(base + sourceIndex * 4, true),
      );
      const variables = new Float32Array(16);
      for (let variable = 0; variable < variables.length; variable += 1) {
        variables[variable] = commandView.getFloat32(
          base + 64 + variable * 4,
          true,
        );
        if (!Number.isFinite(variables[variable])) {
          throw new Error(
            `draw command ${index} contains a non-finite variable at ${variable} ` +
              `(state=${state}, blendMode=${blendMode}, maskMode=${maskMode}, typeId=${typeId})`,
          );
        }
      }
      commands.push({
        sources,
        state,
        blendMode,
        maskMode,
        vertexOffset: commandView.getUint32(base + 48, true),
        indexOffset: commandView.getUint32(base + 52, true),
        elementCount: commandView.getUint32(base + 56, true),
        typeId,
        variables,
      });
    }

    const vertexPointer = this.#exports.in_drawlist_get_vertex_data(
      drawList,
      outPointer,
    );
    const vertexBytes = new DataView(this.#exports.memory.buffer).getUint32(
      outPointer,
      true,
    );
    if (
      vertexBytes > MAX_DRAW_BUFFER_BYTES ||
      vertexBytes % VERTEX_BYTES !== 0
    ) {
      throw new Error(`invalid draw-list vertex byte length: ${vertexBytes}`);
    }
    const vertices = this.#float32(vertexPointer, vertexBytes);
    for (let index = 0; index < vertices.length; index += 1) {
      if (!Number.isFinite(vertices[index])) {
        throw new Error(`draw-list vertex ${index} is not finite`);
      }
    }

    const indexPointer = this.#exports.in_drawlist_get_index_data(
      drawList,
      outPointer,
    );
    const indexBytes = new DataView(this.#exports.memory.buffer).getUint32(
      outPointer,
      true,
    );
    if (
      indexBytes > MAX_DRAW_BUFFER_BYTES ||
      indexBytes % Uint32Array.BYTES_PER_ELEMENT !== 0
    ) {
      throw new Error(`invalid draw-list index byte length: ${indexBytes}`);
    }
    const indices = this.#uint32(indexPointer, indexBytes);
    validateDrawRanges(commands, vertices.length / 4, indices.length);
    return { commands, vertices, indices };
  }

  #scratch(bytes: number): Pointer {
    this.#assertActive();
    if (bytes <= this.#scratchBytes) {
      return this.#scratchPointer;
    }
    const pointer =
      this.#scratchPointer === 0
        ? this.#exports.nu_malloc(bytes)
        : this.#exports.nu_realloc(this.#scratchPointer, bytes);
    if (pointer === 0) {
      throw new Error(`official SDK failed to allocate ${bytes} scratch bytes`);
    }
    this.#scratchPointer = pointer;
    this.#scratchBytes = bytes;
    return pointer;
  }

  #allocate(bytes: number): Pointer {
    const pointer = this.#exports.nu_malloc(bytes);
    if (pointer === 0) {
      throw new Error(`official SDK failed to allocate ${bytes} bytes`);
    }
    return pointer;
  }

  #bytes(pointer: Pointer, byteLength: number): Uint8Array {
    assertMemoryRange(this.#exports.memory, pointer, byteLength);
    return new Uint8Array(this.#exports.memory.buffer, pointer, byteLength);
  }

  #float32(pointer: Pointer, byteLength: number): Float32Array {
    assertMemoryRange(this.#exports.memory, pointer, byteLength);
    return new Float32Array(
      this.#exports.memory.buffer,
      pointer,
      byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }

  #uint32(pointer: Pointer, byteLength: number): Uint32Array {
    assertMemoryRange(this.#exports.memory, pointer, byteLength);
    return new Uint32Array(
      this.#exports.memory.buffer,
      pointer,
      byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
  }

  #string(pointer: Pointer): string {
    if (pointer === 0) {
      return "";
    }
    const memory = new Uint8Array(this.#exports.memory.buffer);
    if (
      !Number.isInteger(pointer) ||
      pointer < 0 ||
      pointer >= memory.byteLength
    ) {
      throw new Error("official SDK returned an invalid string pointer");
    }
    const maximum = Math.min(memory.byteLength, pointer + 16_384);
    let end = pointer;
    while (end < maximum && memory[end] !== 0) {
      end += 1;
    }
    if (end === maximum) {
      throw new Error("official SDK returned an unterminated string");
    }
    return new TextDecoder().decode(memory.subarray(pointer, end));
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("official Inochi2D SDK instance is destroyed");
    }
  }
}

function snapshotDrawList(drawList: OfficialDrawList): DrawSnapshot {
  return {
    vertices: new Float32Array(drawList.vertices),
    indices: new Uint32Array(drawList.indices),
    commands: drawList.commands.map((command) => ({
      sources: [...command.sources],
      state: command.state,
      blendMode: command.blendMode,
      maskMode: command.maskMode,
      vertexOffset: command.vertexOffset,
      indexOffset: command.indexOffset,
      elementCount: command.elementCount,
      typeId: command.typeId,
      variables: new Float32Array(command.variables),
    })),
  };
}

function drawListsDiffer(
  before: DrawSnapshot,
  after: OfficialDrawList,
): boolean {
  if (
    before.vertices.length !== after.vertices.length ||
    before.indices.length !== after.indices.length ||
    before.commands.length !== after.commands.length
  ) {
    return true;
  }
  for (let index = 0; index < before.vertices.length; index += 1) {
    if (Math.abs(before.vertices[index]! - after.vertices[index]!) > 1e-4) {
      return true;
    }
  }
  for (let index = 0; index < before.indices.length; index += 1) {
    if (before.indices[index] !== after.indices[index]) {
      return true;
    }
  }
  for (let index = 0; index < before.commands.length; index += 1) {
    const left = before.commands[index]!;
    const right = after.commands[index]!;
    if (
      left.state !== right.state ||
      left.blendMode !== right.blendMode ||
      left.maskMode !== right.maskMode ||
      left.vertexOffset !== right.vertexOffset ||
      left.indexOffset !== right.indexOffset ||
      left.elementCount !== right.elementCount ||
      left.typeId !== right.typeId ||
      left.sources.length !== right.sources.length ||
      left.variables.length !== right.variables.length
    ) {
      return true;
    }
    if (
      left.sources.some(
        (source, sourceIndex) => source !== right.sources[sourceIndex],
      )
    ) {
      return true;
    }
    for (let variable = 0; variable < left.variables.length; variable += 1) {
      if (
        Math.abs(left.variables[variable]! - right.variables[variable]!) > 1e-6
      ) {
        return true;
      }
    }
  }
  return false;
}

function assertOfficialExports(exports: WebAssembly.Exports): OfficialExports {
  const required = [
    "memory",
    "in_init",
    "nu_malloc",
    "nu_realloc",
    "nu_free",
    "in_puppet_load_from_memory",
    "in_puppet_free",
    "in_puppet_update",
    "in_puppet_draw",
    "in_puppet_get_parameters",
    "in_puppet_get_drawlist",
    "in_puppet_get_texture_cache",
    "in_puppet_get_physics_enabled",
    "in_puppet_set_physics_enabled",
    "in_puppet_get_driver_count",
    "in_puppet_get_resolved_driver_count",
    "in_puppet_get_spring_driver_count",
    "in_puppet_get_xy_driver_count",
    "in_puppet_get_nonzero_physics_scale_count",
    "in_parameter_get_name",
    "in_parameter_get_dimensions",
    "in_parameter_get_lower_bounds",
    "in_parameter_get_upper_bounds",
    "in_parameter_get_binding_count",
    "in_parameter_get_bound_binding_count",
    "in_parameter_get_invalid_binding_application_count",
    "in_parameter_get_value",
    "in_parameter_set_value",
    "in_texture_cache_get_size",
    "in_texture_cache_get_texture",
    "in_texture_get_width",
    "in_texture_get_height",
    "in_texture_get_channels",
    "in_texture_get_pixels",
    "in_drawlist_get_commands",
    "in_drawlist_get_vertex_data",
    "in_drawlist_get_index_data",
  ] as const;
  for (const name of required) {
    if (!(name in exports)) {
      throw new Error(`official Inochi2D WASM is missing export ${name}`);
    }
  }
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("official Inochi2D WASM exports an invalid memory object");
  }
  return exports as OfficialExports;
}

function createWasiImports(): WebAssembly.Imports {
  const success = () => 0;
  return {
    env: {
      STACKTOP: 0,
      STACK_MAX: 65_536,
      abortStackOverflow: () => {
        throw new Error("official Inochi2D WASM stack overflow");
      },
      memory: new WebAssembly.Memory({ initial: 256 }),
      table: new WebAssembly.Table({ initial: 0, element: "anyfunc" }),
      memoryBase: 0,
      tableBase: 2_147_483_648,
    },
    wasi_snapshot_preview1: {
      args_get: success,
      args_sizes_get: success,
      environ_get: success,
      environ_sizes_get: success,
      path_open: success,
      fd_close: success,
      fd_seek: success,
      fd_read: success,
      fd_write: success,
      fd_fdstat_get: success,
      fd_fdstat_set_flags: success,
      fd_prestat_get: success,
      fd_prestat_dir_name: success,
      random_get: success,
      clock_time_get: success,
      proc_exit: (code: number) => {
        throw new Error(`official Inochi2D WASM exited with code ${code}`);
      },
    },
  };
}

function clampParameterValue(
  parameter: OfficialParameter,
  axis: number,
  value: number,
): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("parameter values must be finite numbers");
  }
  return Math.min(
    parameter.upperBounds[axis]!,
    Math.max(parameter.lowerBounds[axis]!, value),
  );
}

async function fetchBounded(
  url: URL,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const request: RequestInit = { credentials: "same-origin" };
  if (signal) {
    request.signal = signal;
  }
  const response = await fetch(url, request);
  if (!response.ok) {
    throw new Error(`official SDK request failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`official SDK asset exceeds ${maximumBytes} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`official SDK asset exceeds ${maximumBytes} bytes`);
  }
  return bytes.buffer;
}

function assertMemoryRange(
  memory: WebAssembly.Memory,
  pointer: number,
  byteLength: number,
): void {
  if (
    !Number.isInteger(pointer) ||
    !Number.isInteger(byteLength) ||
    pointer < 0 ||
    byteLength < 0 ||
    (pointer === 0 && byteLength > 0) ||
    pointer + byteLength > memory.buffer.byteLength
  ) {
    throw new Error(
      `official SDK returned an invalid memory range ${pointer}+${byteLength}`,
    );
  }
}

function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("official SDK returned an invalid size");
    }
    result *= value;
    if (!Number.isSafeInteger(result)) {
      throw new Error("official SDK size calculation overflowed");
    }
  }
  return result;
}

function validateDrawRanges(
  commands: readonly OfficialDrawCommand[],
  vertexCount: number,
  indexCount: number,
): void {
  for (const [position, command] of commands.entries()) {
    // Only normal and mask-definition commands reference mesh buffers. The SDK
    // intentionally leaves allocation fields unspecified on stack/composite
    // control commands, so treating those fields as offsets rejects valid models.
    if (
      (command.state !== 0 && command.state !== 1) ||
      command.elementCount === 0
    ) {
      continue;
    }
    if (
      command.vertexOffset > vertexCount ||
      command.indexOffset > indexCount ||
      command.elementCount > indexCount - command.indexOffset
    ) {
      throw new Error(
        `draw command ${position} references data outside the draw buffers ` +
          `(state=${command.state}, vertices=${command.vertexOffset}/${vertexCount}, ` +
          `indices=${command.indexOffset}+${command.elementCount}/${indexCount})`,
      );
    }
  }
}
