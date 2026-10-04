import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const SERVER_ROOT = join(__dirname, "..");
// Encryption migration and backup re-keying handle ciphertext directly, never sending it to providers.
const ALLOWED = new Set(["services/providerStore.ts", "db/secretMigration.ts", "services/dataBackup/dataProfiles.ts"]);
const RAW_KEY_READ = /SELECT\s+(\*|[^"'`]*api_key_cipher)[^"'`]*FROM\s+providers/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("provider key access", () => {
  it("reads provider API keys only through the decrypting provider store", () => {
    const offenders = sourceFiles(SERVER_ROOT)
      .map((path) => relative(SERVER_ROOT, path).split("\\").join("/"))
      .filter((path) => !ALLOWED.has(path) && RAW_KEY_READ.test(readFileSync(join(SERVER_ROOT, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
