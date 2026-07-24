import { describe, expect, it } from "vitest";
import {
  findLocalLlmVariant,
  localLlmModelUrl,
  localLlmVariantFits,
  recommendedLocalLlmVariant,
  LOCAL_LLM_VARIANTS
} from "./localLlmVariants";

const GIB = 1024 ** 3;

describe("local Gemma 4 ladder", () => {
  it("is ordered from lightest to heaviest with rising memory requirements", () => {
    const ids = LOCAL_LLM_VARIANTS.map((variant) => variant.id);
    expect(ids).toEqual(["e2b", "e4b", "12b", "26b"]);
    for (let index = 1; index < LOCAL_LLM_VARIANTS.length; index += 1) {
      expect(LOCAL_LLM_VARIANTS[index].bytes).toBeGreaterThan(LOCAL_LLM_VARIANTS[index - 1].bytes);
      expect(LOCAL_LLM_VARIANTS[index].recommendedMemoryBytes)
        .toBeGreaterThan(LOCAL_LLM_VARIANTS[index - 1].recommendedMemoryBytes);
    }
  });

  it("pins every download to an immutable revision and checksum", () => {
    for (const variant of LOCAL_LLM_VARIANTS) {
      expect(variant.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(variant.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(localLlmModelUrl(variant)).toBe(
        `https://huggingface.co/${variant.repo}/resolve/${variant.revision}/${variant.file}?download=true`
      );
    }
  });
});

describe("hardware-based default selection", () => {
  it("scales the default from the smallest to the largest build with available memory", () => {
    const pick = (memoryGib: number) => recommendedLocalLlmVariant({ memoryBytes: memoryGib * GIB, accelerator: "metal" }).id;
    expect(pick(8)).toBe("e2b");
    expect(pick(16)).toBe("e4b");
    expect(pick(24)).toBe("12b");
    expect(pick(32)).toBe("26b");
    expect(pick(128)).toBe("26b");
  });

  it("never returns nothing on machines below the lightest tier", () => {
    expect(recommendedLocalLlmVariant({ memoryBytes: 4 * GIB, accelerator: "cpu" }).id).toBe("e2b");
    expect(recommendedLocalLlmVariant({ memoryBytes: 0, accelerator: "cpu" }).id).toBe("e2b");
  });

  it("rounds a slightly under-reported memory size up to its nominal tier", () => {
    expect(recommendedLocalLlmVariant({ memoryBytes: 15.6 * GIB, accelerator: "vulkan" }).id).toBe("e4b");
  });

  it("keeps dense builds out of the default on machines without an accelerator", () => {
    expect(recommendedLocalLlmVariant({ memoryBytes: 24 * GIB, accelerator: "cpu" }).id).toBe("e4b");
    expect(recommendedLocalLlmVariant({ memoryBytes: 64 * GIB, accelerator: "cpu" }).id).toBe("26b");
  });

  it("reports which builds a machine can still run manually", () => {
    const hardware = { memoryBytes: 16 * GIB, accelerator: "metal" as const };
    expect(localLlmVariantFits(findLocalLlmVariant("12b")!, hardware)).toBe(true);
    expect(localLlmVariantFits(findLocalLlmVariant("26b")!, hardware)).toBe(false);
  });

  it("ignores an unknown variant id", () => {
    expect(findLocalLlmVariant("gemma-9000" as never)).toBeNull();
    expect(findLocalLlmVariant(null)).toBeNull();
  });
});
