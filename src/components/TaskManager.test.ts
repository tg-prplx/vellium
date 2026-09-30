import { describe, expect, it } from "vitest";
import { syncTaskManagerOpenState, taskManagerBadge } from "./taskManagerState";

describe("syncTaskManagerOpenState", () => {
  it("keeps the panel collapsed when tasks appear", () => {
    expect(syncTaskManagerOpenState(false, 1)).toBe(false);
  });

  it("keeps the panel open until tasks disappear", () => {
    expect(syncTaskManagerOpenState(true, 2)).toBe(true);
    expect(syncTaskManagerOpenState(true, 0)).toBe(false);
  });
});

describe("taskManagerBadge", () => {
  it("counts running work first", () => {
    expect(taskManagerBadge([{ status: "running" }, { status: "error" }, { status: "done" }])).toEqual({ count: 1, tone: "running" });
  });

  it("surfaces failures once nothing is running", () => {
    expect(taskManagerBadge([{ status: "error" }, { status: "done" }, { status: "error" }])).toEqual({ count: 2, tone: "error" });
  });

  it("hides the badge when every task finished normally", () => {
    expect(taskManagerBadge([{ status: "done" }, { status: "cancelled" }, { status: "done" }])).toBeNull();
  });
});
