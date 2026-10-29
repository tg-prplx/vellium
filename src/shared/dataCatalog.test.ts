import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyAfterDataCatalogMutation, notifyDataCatalogChanged, reuseUnchangedItems, subscribeDataCatalogChanged } from "./dataCatalog";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
});

describe("data catalog changes", () => {
  it("only notifies listeners of the changed kind", async () => {
    Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
    const personas = vi.fn();
    const providers = vi.fn();
    const stopPersonas = subscribeDataCatalogChanged("personas", personas);
    const stopProviders = subscribeDataCatalogChanged("providers", providers);

    await notifyAfterDataCatalogMutation("personas", Promise.resolve("saved"));
    expect(personas).toHaveBeenCalledTimes(1);
    expect(providers).not.toHaveBeenCalled();

    stopPersonas();
    notifyDataCatalogChanged("personas");
    expect(personas).toHaveBeenCalledTimes(1);
    stopProviders();
  });

  it("does not notify when the mutation fails", async () => {
    Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
    const listener = vi.fn();
    const stop = subscribeDataCatalogChanged("lorebooks", listener);
    await expect(notifyAfterDataCatalogMutation("lorebooks", Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

describe("reuseUnchangedItems", () => {
  it("keeps unchanged objects so open editors are not reset", () => {
    const a = { id: "a", name: "Alice" };
    const b = { id: "b", name: "Bob" };
    const merged = reuseUnchangedItems([a, b], [{ id: "a", name: "Alice" }, { id: "b", name: "Bobby" }, { id: "c", name: "Cid" }]);
    expect(merged[0]).toBe(a);
    expect(merged[1]).not.toBe(b);
    expect(merged[1]).toEqual({ id: "b", name: "Bobby" });
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
