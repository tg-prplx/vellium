import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { ManagedBackendManager } from "./managedBackends";

function managedProcess() {
  const child = Object.assign(new EventEmitter(), {
    killed: false, exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn((_signal: string) => { child.killed = true; return true; })
  });
  const manager = new ManagedBackendManager();
  // Simulate only the manager-owned process. No OS process or user app is touched.
  (manager as unknown as { states: Map<string, unknown> }).states.set("local", {
    config: { id: "local" }, child, pollTimer: null, startDeadline: null,
    runtime: { backendId: "local", status: "running", models: [] }, logs: []
  });
  return { child, manager };
}

afterEach(() => vi.useRealTimers());

it("waits for process closure before replacing its files", async () => {
  vi.useFakeTimers();
  const { child, manager } = managedProcess();
  let complete = false;
  const stopped = manager.stopAndWait("local").then(() => { complete = true; });
  await vi.advanceTimersByTimeAsync(100);
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(complete).toBe(false);
  child.emit("close", 0);
  await stopped;
  expect(complete).toBe(true);
});

it("forces a stuck process even after ChildProcess.killed becomes true", async () => {
  vi.useFakeTimers();
  const { child, manager } = managedProcess();
  const stopped = manager.stopAndWait("local");
  await vi.advanceTimersByTimeAsync(3_000);
  expect(child.killed).toBe(true);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  child.emit("close", null, "SIGKILL");
  await stopped;
});

it("refuses promotion if the owned process still has not stopped", async () => {
  vi.useFakeTimers();
  const { manager } = managedProcess();
  const stopped = expect(manager.stopAndWait("local")).rejects.toThrow("installation was preserved");
  await vi.advanceTimersByTimeAsync(5_000);
  await stopped;
});

it("waits for a real disposable Node process to exit", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "pipe" });
  const manager = new ManagedBackendManager();
  (manager as unknown as { states: Map<string, unknown> }).states.set("fixture", {
    config: { id: "fixture" }, child, pollTimer: null, startDeadline: null,
    runtime: { backendId: "fixture", status: "running", models: [] }, logs: []
  });
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    await manager.stopAndWait("fixture");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
