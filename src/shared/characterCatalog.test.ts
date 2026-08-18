import { afterEach, describe, expect, it, vi } from "vitest";

import {
  notifyAfterCharacterCatalogMutation,
  notifyCharacterCatalogChanged,
  subscribeCharacterCatalogChanged
} from "./characterCatalog";

const originalWindow = globalThis.window;

function installEventWindow() {
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true
  });
});

describe("character catalog changes", () => {
  it("notifies mounted consumers immediately after a successful mutation", async () => {
    installEventWindow();
    const listener = vi.fn();
    const unsubscribe = subscribeCharacterCatalogChanged(listener);

    await expect(notifyAfterCharacterCatalogMutation(Promise.resolve("created"))).resolves.toBe("created");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyCharacterCatalogChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate consumers when a mutation fails", async () => {
    installEventWindow();
    const listener = vi.fn();
    subscribeCharacterCatalogChanged(listener);

    await expect(notifyAfterCharacterCatalogMutation(Promise.reject(new Error("failed"))))
      .rejects
      .toThrow("failed");
    expect(listener).not.toHaveBeenCalled();
  });
});
