import { describe, expect, it } from "vitest";
import { LOCAL_TERATTS_MODEL_REVISION } from "./localModelConfig";
import { TERA_TTS_MODEL_BYTES, TERA_TTS_MODEL_FILES, teraTtsModelUrl } from "./teraTtsModel";

describe("TeraTTSv2 downloadable snapshot", () => {
  it("contains the exact distilled model payload without the unused teacher graph", () => {
    expect(TERA_TTS_MODEL_BYTES).toBe(915_321_336);
    expect(TERA_TTS_MODEL_FILES.some((file) => file.path.includes("sampler_distilled"))).toBe(true);
    expect(TERA_TTS_MODEL_FILES.some((file) => file.path.includes("sampler_teacher"))).toBe(false);
    expect(new Set(TERA_TTS_MODEL_FILES.map((file) => file.path)).size).toBe(TERA_TTS_MODEL_FILES.length);
  });

  it("resolves every file against the immutable reviewed Hub revision", () => {
    for (const file of TERA_TTS_MODEL_FILES) {
      const url = teraTtsModelUrl(file.path);
      expect(url).toContain(`/resolve/${LOCAL_TERATTS_MODEL_REVISION}/`);
      expect(url).not.toContain("/resolve/main/");
    }
  });
});
