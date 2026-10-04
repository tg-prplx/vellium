import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("secretVault", () => {
  let root = "";
  let vault: typeof import("./secretVault.js");

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "vellium-vault-"));
    process.env.SLV_DATA_DIR = root;
    delete process.env.SLV_SECRET_KEY;
    vi.resetModules();
    vault = await import("./secretVault.js");
  });

  beforeEach(() => {
    delete process.env.SLV_SECRET_KEY;
    vault.resetSecretVaultCache();
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("round-trips secrets with a private key file created on first use", () => {
    const encrypted = vault.encryptSecret("sk-live-secret");
    expect(encrypted).toMatch(/^vlt1:/);
    expect(encrypted).not.toContain("sk-live-secret");
    expect(vault.encryptSecret("sk-live-secret")).not.toBe(encrypted);
    expect(vault.decryptSecret(encrypted)).toBe("sk-live-secret");
    const keyPath = join(root, "keys", "master.key");
    expect(existsSync(keyPath)).toBe(true);
    if (process.platform !== "win32") expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(vault.encryptSecret(encrypted)).toBe(encrypted);
  });

  it("passes legacy plaintext and empty values through", () => {
    expect(vault.decryptSecret("sk-plain")).toBe("sk-plain");
    expect(vault.encryptSecret("")).toBe("");
    expect(vault.decryptSecret(undefined)).toBe("");
  });

  it("never overwrites an existing key file and returns empty for tampered or foreign ciphertext", () => {
    const keyPath = join(root, "keys", "master.key");
    const before = readFileSync(keyPath, "utf8");
    const encrypted = vault.encryptSecret("sk-live-secret");
    vault.resetSecretVaultCache();
    expect(readFileSync(keyPath, "utf8")).toBe(before);
    expect(vault.decryptSecret(encrypted)).toBe("sk-live-secret");

    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(vault.decryptSecret(tampered)).toBe("");

    process.env.SLV_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    vault.resetSecretVaultCache();
    expect(vault.decryptSecret(encrypted)).toBe("");
    const envEncrypted = vault.encryptSecret("from-env");
    expect(vault.decryptSecret(envEncrypted)).toBe("from-env");
  });

  it("rejects malformed configured keys instead of silently generating new ones", () => {
    process.env.SLV_SECRET_KEY = "too-short";
    vault.resetSecretVaultCache();
    expect(() => vault.encryptSecret("x")).toThrow(/SLV_SECRET_KEY/);
    delete process.env.SLV_SECRET_KEY;
    writeFileSync(join(root, "keys", "master.key"), "broken");
    vault.resetSecretVaultCache();
    expect(() => vault.encryptSecret("x")).toThrow(/master\.key/);
  });
});
