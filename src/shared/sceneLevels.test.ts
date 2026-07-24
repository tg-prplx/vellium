import { describe, expect, it } from "vitest";
import { describeSceneLevel, getSceneLevelIndex } from "./sceneLevels";

describe("scene levels", () => {
  it("maps percentages into five stable bands", () => {
    expect([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(getSceneLevelIndex))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("uses axis-specific language for model context", () => {
    expect(describeSceneLevel("initiative", 15)).toBe("passive");
    expect(describeSceneLevel("initiative", 70)).toBe("proactive");
    expect(describeSceneLevel("descriptiveness", 95)).toBe("richly detailed");
    expect(describeSceneLevel("unpredictability", 50)).toBe("varied");
    expect(describeSceneLevel("emotionalDepth", 75)).toBe("deep");
    expect(describeSceneLevel("intensity", 45)).toBe("moderate");
  });
});
