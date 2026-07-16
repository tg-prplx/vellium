import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin } from "./requestOrigin.js";

const packagedPolicy = {
  publicMode: false,
  serveStatic: true,
  serverHost: "127.0.0.1",
  serverPort: 3002
};

describe("isAllowedRequestOrigin", () => {
  it("allows the exact application origin and non-browser clients", () => {
    expect(isAllowedRequestOrigin("http://127.0.0.1:3002", packagedPolicy)).toBe(true);
    expect(isAllowedRequestOrigin(undefined, packagedPolicy)).toBe(true);
  });

  it("blocks unrelated localhost ports in packaged mode", () => {
    expect(isAllowedRequestOrigin("http://localhost:8080", packagedPolicy)).toBe(false);
    expect(isAllowedRequestOrigin("http://127.0.0.1:1420", packagedPolicy)).toBe(false);
  });

  it("allows only the Vite origin in local development", () => {
    const policy = { ...packagedPolicy, serveStatic: false };
    expect(isAllowedRequestOrigin("http://localhost:1420", policy)).toBe(true);
    expect(isAllowedRequestOrigin("http://127.0.0.1:1420", policy)).toBe(true);
    expect(isAllowedRequestOrigin("http://localhost:5173", policy)).toBe(false);
  });

  it("never derives trust from an attacker-controlled request host", () => {
    expect(isAllowedRequestOrigin("https://attacker.example", packagedPolicy)).toBe(false);
    expect(isAllowedRequestOrigin("https://attacker.example", { ...packagedPolicy, publicMode: true })).toBe(false);
  });

  it("allows a public reverse-proxy origin only when it is explicitly configured", () => {
    const policy = {
      ...packagedPolicy,
      publicMode: true,
      serverHost: "0.0.0.0",
      allowedOrigins: ["https://vellium.example"]
    };
    expect(isAllowedRequestOrigin("https://vellium.example", policy)).toBe(true);
    expect(isAllowedRequestOrigin("https://attacker.example", policy)).toBe(false);
  });
});
