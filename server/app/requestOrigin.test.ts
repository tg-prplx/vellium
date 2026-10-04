import { describe, expect, it } from "vitest";
import { isAllowedRequestHost, isAllowedRequestOrigin } from "./requestOrigin.js";

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

describe("isAllowedRequestHost", () => {
  it("accepts loopback hosts and non-browser requests without Host", () => {
    expect(isAllowedRequestHost("127.0.0.1:3001", packagedPolicy)).toBe(true);
    expect(isAllowedRequestHost("localhost:3001", packagedPolicy)).toBe(true);
    expect(isAllowedRequestHost("[::1]:3001", packagedPolicy)).toBe(true);
    expect(isAllowedRequestHost(undefined, packagedPolicy)).toBe(true);
  });

  it("rejects DNS-rebinding hosts in local mode", () => {
    expect(isAllowedRequestHost("attacker.example:3001", packagedPolicy)).toBe(false);
    expect(isAllowedRequestHost("127.0.0.1.attacker.example", packagedPolicy)).toBe(false);
    expect(isAllowedRequestHost("", packagedPolicy)).toBe(false);
  });

  it("accepts explicitly configured hosts and allowlisted origins", () => {
    expect(isAllowedRequestHost("vellium.lan:3001", { ...packagedPolicy, serverHost: "vellium.lan" })).toBe(true);
    expect(isAllowedRequestHost("vellium.example", { ...packagedPolicy, allowedOrigins: ["https://vellium.example"] })).toBe(true);
    expect(isAllowedRequestHost("0.0.0.0:3001", { ...packagedPolicy, serverHost: "0.0.0.0" })).toBe(false);
  });

  it("leaves host trust to mandatory Basic Auth in public mode", () => {
    expect(isAllowedRequestHost("vellium.example", { ...packagedPolicy, publicMode: true, serverHost: "0.0.0.0" })).toBe(true);
  });
});
