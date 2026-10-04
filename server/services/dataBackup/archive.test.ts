import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { open } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { BackupFormatError, BackupPasswordError, extractBackupArchive, normalizeArchivePath, readBackupHeader, writeBackupArchive } from "./archive.js";

const root = mkdtempSync(join(tmpdir(), "vellium-archive-"));
const metadata = { createdAt: "2026-10-04T00:00:00.000Z", appVersion: "test", profileName: "Тест", includesMasterKey: false };
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(name: string, content: string | Buffer) {
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
}

describe("backup archive", () => {
  const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
  const files = () => [
    { archivePath: "vellum.db", sourcePath: fixture("db.bin", "database bytes") },
    { archivePath: "avatars/a.png", sourcePath: fixture("a.png", big) },
    { archivePath: "uploads/empty.txt", sourcePath: fixture("empty.txt", "") }
  ];

  it("round-trips files without a password", async () => {
    const output = join(root, "plain.vbak");
    await writeBackupArchive({ outputPath: output, metadata, files: files() });
    expect((await readBackupHeader(output)).encrypted).toBe(false);
    const dest = join(root, "plain-out");
    const result = await extractBackupArchive({ inputPath: output, destinationDir: dest });
    expect(result.files).toBe(3);
    expect(readFileSync(join(dest, "vellum.db"), "utf8")).toBe("database bytes");
    expect(readFileSync(join(dest, "avatars/a.png")).equals(big)).toBe(true);
    expect(statSync(join(dest, "uploads/empty.txt")).size).toBe(0);
  });

  it("encrypts with a password, rejects a wrong one early and detects tampering", async () => {
    const output = join(root, "secret.vbak");
    await writeBackupArchive({ outputPath: output, metadata, files: files(), inline: [{ archivePath: "__vellium__/master.key", data: Buffer.alloc(32, 1) }], password: "correct horse" });
    const raw = readFileSync(output);
    expect(raw.includes(Buffer.from("database bytes"))).toBe(false);
    await expect(extractBackupArchive({ inputPath: output, destinationDir: join(root, "nopass") })).rejects.toBeInstanceOf(BackupPasswordError);
    await expect(extractBackupArchive({ inputPath: output, destinationDir: join(root, "wrong"), password: "wrong horse" })).rejects.toBeInstanceOf(BackupPasswordError);
    const ok = await extractBackupArchive({ inputPath: output, destinationDir: join(root, "secret-out"), password: "correct horse" });
    expect(ok.special.get("__vellium__/master.key")?.equals(Buffer.alloc(32, 1))).toBe(true);
    expect(existsSync(join(root, "secret-out", "__vellium__"))).toBe(false);

    const handle = await open(output, "r+");
    const position = raw.length - 200;
    await handle.write(Buffer.from([raw[position] ^ 0xff]), 0, 1, position);
    await handle.close();
    await expect(extractBackupArchive({ inputPath: output, destinationDir: join(root, "tampered"), password: "correct horse" })).rejects.toBeInstanceOf(BackupFormatError);
  });

  it("refuses entries that would escape the destination", async () => {
    const output = join(root, "evil.vbak");
    await writeBackupArchive({ outputPath: output, metadata, files: [{ archivePath: "../escaped.txt", sourcePath: fixture("evil.txt", "x") }] });
    await expect(extractBackupArchive({ inputPath: output, destinationDir: join(root, "evil-out") })).rejects.toBeInstanceOf(BackupFormatError);
    expect(existsSync(join(root, "escaped.txt"))).toBe(false);
    for (const bad of ["../x", "/abs", "a/../b", "a\\b", "C:/x", "a//b", "."]) expect(normalizeArchivePath(bad), bad).toBeNull();
    expect(normalizeArchivePath("avatars/a.png")).toBe("avatars/a.png");
  });

  it("rejects truncated archives and files that are not backups", async () => {
    const output = join(root, "trunc.vbak");
    await writeBackupArchive({ outputPath: output, metadata, files: files() });
    const raw = readFileSync(output);
    writeFileSync(output, raw.subarray(0, raw.length - 40));
    await expect(extractBackupArchive({ inputPath: output, destinationDir: join(root, "trunc-out") })).rejects.toBeInstanceOf(BackupFormatError);
    await expect(readBackupHeader(fixture("not.vbak", "hello"))).rejects.toBeInstanceOf(BackupFormatError);
  });
});
