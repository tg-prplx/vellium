import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { promoteLocalModelInstall } from "./localModelRuntime";

let folder: string | undefined;
afterEach(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

async function oldInstallation() {
  folder = await mkdtemp(path.join(os.tmpdir(), "vellium-install-rollback-"));
  const root = path.join(folder, "llm");
  await mkdir(root);
  await writeFile(path.join(root, "old.gguf"), "keep old weights");
  return root;
}

it("restores the old installation if promotion fails after moving it aside", async () => {
  const root = await oldInstallation();
  await expect(promoteLocalModelInstall(`${root}.missing`, root, new AbortController().signal)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(path.join(root, "old.gguf"), "utf8")).resolves.toBe("keep old weights");
});

it("does not modify the previous installation when cancellation has already arrived", async () => {
  const root = await oldInstallation();
  const controller = new AbortController();
  controller.abort();
  await expect(promoteLocalModelInstall(`${root}.installing`, root, controller.signal)).rejects.toThrow();
  await expect(readFile(path.join(root, "old.gguf"), "utf8")).resolves.toBe("keep old weights");
});

it("promotes new files and removes the backup only after success", async () => {
  const root = await oldInstallation();
  await mkdir(`${root}.installing`);
  await writeFile(path.join(`${root}.installing`, "new.gguf"), "new weights");
  await promoteLocalModelInstall(`${root}.installing`, root, new AbortController().signal);
  await expect(readFile(path.join(root, "new.gguf"), "utf8")).resolves.toBe("new weights");
  await expect(readFile(path.join(`${root}.previous`, "old.gguf"))).rejects.toMatchObject({ code: "ENOENT" });
});
