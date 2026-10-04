import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("encryptStoredSecrets", () => {
  let root = "";
  let migration: typeof import("./secretMigration.js");
  let vault: typeof import("../services/secretVault.js");

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "vellium-secret-migration-"));
    process.env.SLV_DATA_DIR = root;
    delete process.env.SLV_SECRET_KEY;
    vi.resetModules();
    migration = await import("./secretMigration.js");
    vault = await import("../services/secretVault.js");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("encrypts legacy plaintext keys once and leaves other settings untouched", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, api_key_cipher TEXT NOT NULL); CREATE TABLE settings (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);");
    db.prepare("INSERT INTO providers VALUES (?, ?), (?, ?), (?, ?)").run("a", "sk-provider", "b", "", "c", vault.encryptSecret("sk-already"));
    db.prepare("INSERT INTO settings VALUES (1, ?)").run(JSON.stringify({ ttsApiKey: "sk-tts", sttApiKey: "", theme: "dark" }));

    migration.encryptStoredSecrets(db);
    const rows = Object.fromEntries((db.prepare("SELECT id, api_key_cipher FROM providers").all() as Array<{ id: string; api_key_cipher: string }>).map((row) => [row.id, row.api_key_cipher]));
    expect(rows.a).toMatch(/^vlt1:/);
    expect(vault.decryptSecret(rows.a)).toBe("sk-provider");
    expect(rows.b).toBe("");
    expect(vault.decryptSecret(rows.c)).toBe("sk-already");
    const settings = JSON.parse((db.prepare("SELECT payload FROM settings").get() as { payload: string }).payload);
    expect(vault.decryptSecret(settings.ttsApiKey)).toBe("sk-tts");
    expect(settings.sttApiKey).toBe("");
    expect(settings.theme).toBe("dark");

    const snapshot = JSON.stringify(db.prepare("SELECT * FROM providers").all()) + JSON.stringify(db.prepare("SELECT * FROM settings").all());
    migration.encryptStoredSecrets(db);
    expect(JSON.stringify(db.prepare("SELECT * FROM providers").all()) + JSON.stringify(db.prepare("SELECT * FROM settings").all())).toBe(snapshot);
  });
});
