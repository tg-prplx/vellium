import { afterEach, describe, expect, it, vi } from "vitest";
import { describeProviderFetchFailure, fetchProviderResponse } from "./providerHttp.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchProviderResponse", () => {
  it("uses fresh connections and waits for a temporarily unavailable model", async () => {
    const mockedFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Loading model", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchProviderResponse("http://10.117.85.1:1234/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }, {
      retryDelaysMs: [0, 0]
    });

    expect(response.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const firstInit = mockedFetch.mock.calls[0]?.[1];
    const headers = new Headers(firstInit?.headers);
    expect(headers.get("Connection")).toBe("close");
    expect(headers.get("Cache-Control")).toBe("no-cache");
    expect(firstInit?.cache).toBe("no-store");
  });

  it("retries safe connection failures", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ENETUNREACH"), { code: "ENETUNREACH" })
    });
    const mockedFetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchProviderResponse("https://provider.example/v1/chat/completions", {}, {
      retryDelaysMs: [0, 0]
    });

    expect(response.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a temporary macOS local-network EHOSTDOWN failure", async () => {
    const hostDown = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect EHOSTDOWN 10.117.85.1:1234"), {
        code: "EHOSTDOWN"
      })
    });
    const mockedFetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(hostDown)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchProviderResponse("http://10.117.85.1:1234/v1/chat/completions", {}, {
      retryDelaysMs: [0, 0]
    });

    expect(response.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not repeat ambiguous socket failures against public billable providers", async () => {
    const socketError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
    });
    const mockedFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(socketError);

    await expect(fetchProviderResponse("https://provider.example/v1/chat/completions", {}, {
      retryDelaysMs: [0, 0]
    })).rejects.toThrow(/Provider request failed.*UND_ERR_SOCKET/);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("reports the underlying network cause instead of a bare fetch failed", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect EHOSTUNREACH 10.0.0.2:1234"), {
        code: "EHOSTUNREACH",
        syscall: "connect",
        address: "10.0.0.2",
        port: 1234
      })
    });
    expect(describeProviderFetchFailure(error)).toContain("EHOSTUNREACH");
    expect(describeProviderFetchFailure(error)).toContain("10.0.0.2:1234");
  });
});
