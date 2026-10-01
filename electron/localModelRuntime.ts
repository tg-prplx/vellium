import { execFile } from "child_process";
import { rename, rm } from "fs/promises";
import path from "path";

function runtimeOutput(executable: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(executable, args, { cwd: path.dirname(executable), signal, timeout: 30_000,
      maxBuffer: 1024 ** 2, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Runtime check failed: ${error.message}: ${stderr.slice(-2_000)}`));
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}

export async function validateLocalRuntime(executable: string, component: "llm" | "stt", signal: AbortSignal) {
  // Check native DLLs/dylibs and CPU compatibility before touching the old install.
  await runtimeOutput(executable, [component === "llm" ? "--version" : "--help"], signal);
  if (component !== "llm") return false;
  const devices = await runtimeOutput(executable, ["--list-devices"], signal);
  return /^\s*(?:MTL|Metal|Vulkan|CUDA|ROCm|HIP|SYCL)\w*\s*:/im.test(devices);
}

/** Renaming on the same volume preserves the old install if promotion fails. */
export async function promoteLocalModelInstall(staging: string, root: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const backup = `${root}.previous`;
  // A leftover backup is recoverable data; never silently remove it.
  let movedOld = false;
  try {
    await rename(root, backup);
    movedOld = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    signal.throwIfAborted();
    await rename(staging, root);
  } catch (error) {
    if (movedOld) await rename(backup, root);
    throw error;
  }
  // A cleanup failure must not report the successfully promoted install as broken.
  if (movedOld) await rm(backup, { recursive: true, force: true }).catch(() => {});
}
