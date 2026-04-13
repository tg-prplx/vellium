import { describe, expect, it } from "vitest";
import { syncTaskManagerOpenState } from "./TaskManager";

describe("syncTaskManagerOpenState", () => {
  it("keeps the panel collapsed when tasks appear", () => {
    expect(syncTaskManagerOpenState(false, 1)).toBe(false);
  });

  it("keeps the panel open until tasks disappear", () => {
    expect(syncTaskManagerOpenState(true, 2)).toBe(true);
    expect(syncTaskManagerOpenState(true, 0)).toBe(false);
  });
});
