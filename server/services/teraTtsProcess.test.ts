import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mocks.spawn }));

import { TeraTtsProcess } from "./teraTtsProcess";

function fakeRuntime() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { writable: boolean; write: ReturnType<typeof vi.fn> };
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
    return true;
  });
  child.stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: vi.fn((line: string, _encoding: string, callback: (error?: Error) => void) => {
      const request = JSON.parse(line) as { id: string; stream: boolean };
      queueMicrotask(() => {
        const event = request.stream
          ? { id: request.id, type: "audio", format: "pcm", sampleRate: 44_100, audioBase64: "AQI=" }
          : { id: request.id, type: "audio", contentType: "audio/wav", audioBase64: "V0FW" };
        child.stdout.emit("data", `${JSON.stringify(event)}\n${JSON.stringify({ id: request.id, type: "done" })}\n`);
      });
      callback();
      return true;
    })
  });
  queueMicrotask(() => child.stdout.emit("data", '{"type":"ready","sampleRate":44100}\n'));
  return child;
}

describe("TeraTTSv2 persistent runtime protocol", () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.spawn.mockImplementation(() => fakeRuntime());
  });

  it("reuses one loaded child process for consecutive WAV requests", async () => {
    const runtime = new TeraTtsProcess("/runtime/teratts-runtime", "/models/teratts");
    await expect(runtime.synthesize("Hello", "eng_f3")).resolves.toEqual(Buffer.from("WAV"));
    await expect(runtime.synthesize("Привет", "ru_f1")).resolves.toEqual(Buffer.from("WAV"));
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it("forwards native 44.1 kHz PCM chunks without turning them into WAV files", async () => {
    const runtime = new TeraTtsProcess("/runtime/teratts-runtime", "/models/teratts");
    const chunks: unknown[] = [];
    await runtime.stream("Поток", "ru_m5", undefined, (chunk) => chunks.push(chunk));
    expect(chunks).toEqual([{ audioBase64: "AQI=", format: "pcm", sampleRate: 44_100 }]);
    runtime.stop();
  });
});
