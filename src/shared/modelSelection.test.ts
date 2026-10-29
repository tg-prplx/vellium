import { describe, expect, it } from "vitest";
import { pickLoadedModelId } from "./modelSelection";

describe("pickLoadedModelId", () => {
  const models = [{ id: "first" }, { id: "second" }];

  it("keeps the first candidate present in the loaded list", () => {
    expect(pickLoadedModelId(models, "second")).toBe("second");
    expect(pickLoadedModelId(models, "missing", "second")).toBe("second");
  });

  it("never falls back to an arbitrary first model", () => {
    expect(pickLoadedModelId(models, "missing")).toBe("");
    expect(pickLoadedModelId(models, "", null, undefined)).toBe("");
    expect(pickLoadedModelId([], "first")).toBe("");
  });
});
