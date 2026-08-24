import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarPortable, resolveMaterializedTarLinks } from "./archiveExtraction";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("portable tar extraction", () => {
  it("resolves safe chained aliases to their regular archive target", () => {
    expect(resolveMaterializedTarLinks([
      { path: "runtime/libvoice.so", linkpath: "libvoice.so.1" },
      { path: "runtime/libvoice.so.1", linkpath: "libvoice.so.1.9.1" }
    ])).toEqual([
      { alias: "runtime/libvoice.so", target: "runtime/libvoice.so.1.9.1", mode: undefined },
      { alias: "runtime/libvoice.so.1", target: "runtime/libvoice.so.1.9.1", mode: undefined }
    ]);
  });

  it("resolves tar hard links from the archive root", () => {
    expect(resolveMaterializedTarLinks([
      { path: "runtime/libvoice-copy.so", linkpath: "runtime/libvoice.so.1", kind: "hard" }
    ])).toEqual([
      { alias: "runtime/libvoice-copy.so", target: "runtime/libvoice.so.1", mode: undefined }
    ]);
  });

  it("rejects traversal and cyclic link chains", () => {
    expect(() => resolveMaterializedTarLinks([{ path: "runtime/bad", linkpath: "../../outside" }]))
      .toThrow(/Unsafe archive path/);
    expect(() => resolveMaterializedTarLinks([
      { path: "runtime/a", linkpath: "b" },
      { path: "runtime/b", linkpath: "a" }
    ])).toThrow(/Cyclic archive link/);
  });

  it.runIf(process.platform !== "win32")("copies symlink chains as regular files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vellium-tar-portable-"));
    temporaryPaths.push(root);
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    const archive = path.join(root, "runtime.tar.gz");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "libvoice.so.1.9.1"), "portable-runtime");
    await symlink("libvoice.so.1.9.1", path.join(source, "libvoice.so.1"));
    await symlink("libvoice.so.1", path.join(source, "libvoice.so"));
    await createTar({ gzip: true, cwd: source, file: archive }, ["libvoice.so.1.9.1", "libvoice.so.1", "libvoice.so"]);
    await extractTarPortable(archive, destination);
    await expect(readFile(path.join(destination, "libvoice.so"), "utf8")).resolves.toBe("portable-runtime");
    await expect(readFile(path.join(destination, "libvoice.so.1"), "utf8")).resolves.toBe("portable-runtime");
  });
});
