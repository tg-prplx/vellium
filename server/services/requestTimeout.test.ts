import { describe, expect, it, vi } from "vitest";
import { createRequestTimeout } from "./requestTimeout.js";

describe("createRequestTimeout", () => {
  it("does not create a timer when the timeout is disabled", () => {
    const timeout = createRequestTimeout(0, "Request");
    expect(timeout.signal).toBeUndefined();
    timeout.dispose();
  });

  it("aborts with a useful error and can be disposed", () => {
    vi.useFakeTimers();
    try {
      const timeout = createRequestTimeout(5, "Endpoint discovery");
      expect(timeout.signal?.aborted).toBe(false);
      vi.advanceTimersByTime(5_000);
      expect(timeout.signal?.aborted).toBe(true);
      expect(timeout.signal?.reason).toEqual(new Error("Endpoint discovery timed out after 5s"));
      timeout.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
