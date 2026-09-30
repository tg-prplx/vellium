import { describe, expect, it } from "vitest";
import { simplePanelDismissal } from "./useSimplePanelController";

describe("Simple Mode panel dismissal", () => {
  it("keeps the inspector and history open when Escape belongs to a nested modal", () => {
    expect(simplePanelDismissal({ modalOpen: true, inspectorOpen: true, sidebarOpen: true, compact: true })).toBeNull();
  });
  it("dismisses the inspector before the history panel", () => {
    expect(simplePanelDismissal({ modalOpen: false, inspectorOpen: true, sidebarOpen: true, compact: true })).toBe("inspector");
  });
  it("only dismisses the history panel when it is a compact overlay", () => {
    expect(simplePanelDismissal({ modalOpen: false, inspectorOpen: false, sidebarOpen: true, compact: false })).toBeNull();
    expect(simplePanelDismissal({ modalOpen: false, inspectorOpen: false, sidebarOpen: true, compact: true })).toBe("sidebar");
  });
});
