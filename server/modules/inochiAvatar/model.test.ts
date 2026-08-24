import { describe, expect, it } from "vitest";
import { parseInochiModel } from "./model";

function modelBuffer(payload: Record<string, unknown>) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  const textureCount = Buffer.alloc(4);
  return Buffer.concat([Buffer.from("TRNSRTS\0"), length, json, Buffer.from("TEX_SECT"), textureCount]);
}

describe("Inochi2D model validation", () => {
  it("reads metadata and bounded animation parameters from an INP file", () => {
    const parsed = parseInochiModel(modelBuffer({
      meta: { name: "Mira", artist: "Artist" },
      physics: {},
      nodes: {},
      param: [
        { name: "Mouth:: Smile", is_vec2: false, min: [-1, 0], max: [1, 0], defaults: [0, 0] },
        { name: "Head:: Yaw-Pitch", is_vec2: true, min: [-1, -1], max: [1, 1], defaults: [0, 0] }
      ]
    }), "mira.inp");
    expect(parsed.displayName).toBe("Mira");
    expect(parsed.parameters).toHaveLength(2);
    expect(parsed.emotionParameters.map((parameter) => parameter.name)).toEqual(["Mouth:: Smile"]);
  });

  it("rejects Cubism and malformed files with an actionable error", () => {
    expect(() => parseInochiModel(Buffer.from("not an inp"), "avatar.inp")).toThrow("Inochi2D model");
    expect(() => parseInochiModel(modelBuffer({ meta: {}, physics: {}, nodes: {}, param: [] }), "avatar.zip")).toThrow(".inp or .inx");
  });
});
