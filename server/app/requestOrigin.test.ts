import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin } from "./requestOrigin.js";

const localRequest = {
  protocol: "http",
  headers: { host: "127.0.0.1:3002" }
};

describe("isAllowedRequestOrigin", () => {
  it("allows the exact application origin and non-browser clients", () => {
    const policy = { publicMode: false, serveStatic: true };
    expect(isAllowedRequestOrigin(localRequest, "http://127.0.0.1:3002", policy)).toBe(true);
    expect(isAllowedRequestOrigin(localRequest, undefined, policy)).toBe(true);
  });

  it("blocks unrelated localhost ports in packaged mode", () => {
    const policy = { publicMode: false, serveStatic: true };
    expect(isAllowedRequestOrigin(localRequest, "http://localhost:8080", policy)).toBe(false);
    expect(isAllowedRequestOrigin(localRequest, "http://127.0.0.1:1420", policy)).toBe(false);
  });

  it("allows only the Vite origin in local development", () => {
    const policy = { publicMode: false, serveStatic: false };
    expect(isAllowedRequestOrigin(localRequest, "http://localhost:1420", policy)).toBe(true);
    expect(isAllowedRequestOrigin(localRequest, "http://127.0.0.1:1420", policy)).toBe(true);
    expect(isAllowedRequestOrigin(localRequest, "http://localhost:5173", policy)).toBe(false);
  });

  it("ignores spoofed forwarded headers outside public proxy mode", () => {
    const request = {
      ...localRequest,
      headers: {
        ...localRequest.headers,
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https"
      }
    };
    expect(isAllowedRequestOrigin(request, "https://attacker.example", { publicMode: false, serveStatic: true })).toBe(false);
    expect(isAllowedRequestOrigin(request, "https://attacker.example", { publicMode: true, serveStatic: true })).toBe(true);
  });
});
