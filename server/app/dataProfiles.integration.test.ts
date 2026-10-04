import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe.sequential("data profiles and backups", () => {
  let root = "";
  let base = "";
  let server: Server;
  let vault: typeof import("../services/secretVault.js");
  const json = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(base + path, {
      method: init.method || "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "vellium-profiles-"));
    process.env.SLV_DATA_DIR = root;
    process.env.ELECTRON_SERVE_STATIC = "0";
    vi.resetModules();
    const { createApp } = await import("./createApp.js");
    vault = await import("../services/secretVault.js");
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it("manages profiles and only switches the database after a restart", async () => {
    const initial = await json("/api/data/profiles");
    expect(initial.body).toMatchObject({ running: "default", selected: "default", restartMode: "manual" });
    const created = await json("/api/data/profiles", { method: "POST", body: { name: "  Work  " } });
    expect(created.body.name).toBe("Work");
    expect(existsSync(join(root, "profiles", created.body.id))).toBe(true);
    expect((await json(`/api/data/profiles/${created.body.id}`, { method: "PATCH", body: { name: "Работа" } })).body.name).toBe("Работа");
    expect((await json("/api/data/profiles", { method: "POST", body: { name: "   " } })).status).toBe(400);

    const selected = await json(`/api/data/profiles/${created.body.id}/select`, { method: "POST" });
    expect(selected.body).toEqual({ selected: created.body.id, restartRequired: true, restartMode: "manual" });
    expect(JSON.parse(readFileSync(join(root, "profiles.json"), "utf8")).active).toBe(created.body.id);
    expect((await json(`/api/data/profiles/${created.body.id}`, { method: "DELETE" })).status).toBe(400);
    await json("/api/data/profiles/default/select", { method: "POST" });
    expect((await json("/api/data/profiles/default", { method: "DELETE" })).status).toBe(400);
    expect((await json(`/api/data/profiles/${created.body.id}`, { method: "DELETE" })).body).toEqual({ ok: true });
    expect(readdirSync(join(root, ".trash")).some((name) => name.startsWith(created.body.id))).toBe(true);
    expect((await json("/api/data/profiles/missing-id/select", { method: "POST" })).status).toBe(404);
  });

  it("backs up, downloads and restores a profile into a new one, with and without a password", async () => {
    const chat = await json("/api/chats", { method: "POST", body: { title: "Backed up chat" } });
    await json("/api/providers", { method: "POST", body: { id: "backup-provider", name: "Backup", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-backup-secret", providerType: "openai" } });
    const upload = await json("/api/upload", { method: "POST", body: { base64Data: Buffer.from("attachment body").toString("base64"), filename: "note.txt" } });

    const plain = await json("/api/data/backups", { method: "POST", body: {} });
    expect(plain.body).toMatchObject({ encrypted: false, includesMasterKey: false, profileName: "Default" });
    expect((await json("/api/data/backups", { method: "POST", body: { password: "short" } })).status).toBe(400);
    const secret = await json("/api/data/backups", { method: "POST", body: { password: "long enough password" } });
    expect(secret.body).toMatchObject({ encrypted: true, includesMasterKey: true });
    const listed = (await json("/api/data/backups")).body.map((item: { file: string }) => item.file);
    expect(listed).toEqual(expect.arrayContaining([plain.body.file, secret.body.file]));

    const download = await fetch(`${base}/api/data/backups/${secret.body.file}/download`);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const downloaded = Buffer.from(await download.arrayBuffer());
    expect(downloaded.equals(readFileSync(join(root, "backups", secret.body.file)))).toBe(true);
    expect(downloaded.includes(Buffer.from("sk-backup-secret"))).toBe(false);

    expect((await json(`/api/data/backups/${secret.body.file}/restore`, { method: "POST", body: {} })).body.code).toBe("backup_password");
    expect((await json(`/api/data/backups/${secret.body.file}/restore`, { method: "POST", body: { password: "wrong password!" } })).status).toBe(401);
    const restored = await json(`/api/data/backups/${secret.body.file}/restore`, { method: "POST", body: { password: "long enough password", name: "Restored" } });
    expect(restored.body.name).toBe("Restored");
    const restoredDir = join(root, "profiles", restored.body.id);
    const restoredDb = new Database(join(restoredDir, "vellum.db"), { readonly: true });
    try {
      expect(restoredDb.prepare("SELECT title FROM chats WHERE id = ?").get(chat.body.id)).toEqual({ title: "Backed up chat" });
      const key = restoredDb.prepare("SELECT api_key_cipher FROM providers WHERE id = 'backup-provider'").get() as { api_key_cipher: string };
      expect(vault.decryptSecret(key.api_key_cipher)).toBe("sk-backup-secret");
    } finally { restoredDb.close(); }
    expect(readFileSync(join(restoredDir, "uploads", String(upload.body.url).split("/").pop() ?? ""), "utf8")).toBe("attachment body");
    expect(existsSync(join(restoredDir, "keys"))).toBe(false);
    expect(readdirSync(join(root, "profiles")).some((name) => name.startsWith(".staging"))).toBe(false);

    const plainRestore = await json(`/api/data/backups/${plain.body.file}/restore`, { method: "POST", body: {} });
    expect(plainRestore.status).toBe(200);
    expect((await json("/api/data/profiles")).body.profiles.map((profile: { id: string }) => profile.id)).toEqual(expect.arrayContaining([restored.body.id, plainRestore.body.id]));
  }, 30_000);

  it("accepts streamed uploads of backup files only", async () => {
    const [first] = (await json("/api/data/backups")).body;
    const bytes = readFileSync(join(root, "backups", first.file));
    const uploaded = await fetch(`${base}/api/data/backups/upload`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
    const summary = await uploaded.json();
    expect(summary.file).toMatch(/^uploaded-.*\.vbak$/);
    expect(summary.encrypted).toBe(first.encrypted);

    const before = readdirSync(join(root, "backups")).length;
    const junk = await fetch(`${base}/api/data/backups/upload`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from("not a backup") });
    expect(junk.status).toBe(400);
    expect(readdirSync(join(root, "backups")).length).toBe(before);
    const wrongType = await fetch(`${base}/api/data/backups/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(wrongType.status).toBe(415);

    expect((await json("/api/data/backups/..%2Fprofiles.json/download")).status).toBe(400);
    expect((await json(`/api/data/backups/${summary.file}`, { method: "DELETE" })).body).toEqual({ ok: true });
    expect(existsSync(join(root, "backups", summary.file))).toBe(false);
  });
});
