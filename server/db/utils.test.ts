import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { hashSecret, needsSecretRehash, verifySecret } from "./utils.js";

describe("account secret hashing", () => {
  it("uses unique salted scrypt hashes and verifies them", () => {
    const first = hashSecret("correct horse battery staple");
    const second = hashSecret("correct horse battery staple");
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
    expect(verifySecret("correct horse battery staple", first)).toBe(true);
    expect(verifySecret("wrong", first)).toBe(false);
    expect(needsSecretRehash(first)).toBe(false);
  });

  it("accepts legacy SHA-256 hashes for migration", () => {
    const legacy = createHash("sha256").update("legacy password").digest("hex");
    expect(verifySecret("legacy password", legacy)).toBe(true);
    expect(verifySecret("wrong", legacy)).toBe(false);
    expect(needsSecretRehash(legacy)).toBe(true);
  });

  it("rejects empty and oversized secrets", () => {
    expect(() => hashSecret("")).toThrow();
    expect(() => hashSecret("x".repeat(1025))).toThrow();
    expect(verifySecret("", hashSecret("valid"))).toBe(false);
  });
});
