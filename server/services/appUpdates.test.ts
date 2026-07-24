import { describe, expect, it, vi } from "vitest";
import { buildAppUpdateInfo, fetchLatestAppUpdate } from "./appUpdates.js";

describe("app update checks", () => {
  it("treats a leading v as part of tag formatting, not the version", () => {
    expect(buildAppUpdateInfo("1.0.2", {
      tag_name: "v1.0.2",
      name: "Vellium 1.0.2",
      published_at: "2026-07-20T12:00:00Z"
    })).toEqual({
      currentVersion: "1.0.2",
      latestVersion: "1.0.2",
      updateAvailable: false,
      releaseName: "Vellium 1.0.2",
      releaseUrl: "https://github.com/tg-prplx/vellium/releases/tag/v1.0.2",
      publishedAt: "2026-07-20T12:00:00.000Z"
    });
  });

  it("reports any latest-release version mismatch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      tag_name: "v1.1.0",
      name: "Vellium 1.1",
      published_at: null
    }), { status: 200 }));

    const result = await fetchLatestAppUpdate({
      fetchImpl,
      currentVersion: "1.0.2",
      repository: "tg-prplx/vellium"
    });

    expect(result).toMatchObject({
      currentVersion: "1.0.2",
      latestVersion: "1.1.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/tg-prplx/vellium/releases/tag/v1.1.0"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/tg-prplx/vellium/releases/latest",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "User-Agent": "Vellium/1.0.2"
        })
      })
    );
  });

  it("rejects malformed release responses", () => {
    expect(() => buildAppUpdateInfo("1.0.2", { tag_name: "" })).toThrow(
      "missing a valid version"
    );
  });
});
