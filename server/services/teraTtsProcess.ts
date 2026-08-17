import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";

export interface TeraTtsAudioChunk {
  audioBase64: string;
  format: "pcm";
  sampleRate: number;
}

interface RuntimeEvent {
  id?: string;
  type?: string;
  message?: string;
  audioBase64?: string;
  contentType?: string;
  format?: string;
  sampleRate?: number;
}

interface ActiveRequest {
  id: string;
  audio: Buffer[];
  onChunk?: (chunk: TeraTtsAudioChunk) => void;
  resolve: (audio: Buffer) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

const MAX_STDERR_CHARS = 16_000;

export class TeraTtsProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderr = "";
  private active: ActiveRequest | null = null;
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private executable: string, private modelDir: string) {}

  matches(executable: string, modelDir: string) {
    return this.executable === executable && this.modelDir === modelDir;
  }

  synthesize(text: string, voice: string, signal?: AbortSignal) {
    return this.enqueue(text, voice, false, signal);
  }

  stream(text: string, voice: string, signal: AbortSignal | undefined, onChunk: (chunk: TeraTtsAudioChunk) => void) {
    return this.enqueue(text, voice, true, signal, onChunk).then(() => undefined);
  }

  stop(reason = new Error("TeraTTS runtime stopped")) {
    const active = this.active;
    this.active = null;
    active?.cleanup();
    active?.reject(reason);
    this.rejectReady?.(reason);
    this.resetReady();
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGKILL");
  }

  private enqueue(text: string, voice: string, stream: boolean, signal?: AbortSignal, onChunk?: (chunk: TeraTtsAudioChunk) => void) {
    const run = this.tail.catch(() => undefined).then(() => this.perform(text, voice, stream, signal, onChunk));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async perform(text: string, voice: string, stream: boolean, signal?: AbortSignal, onChunk?: (chunk: TeraTtsAudioChunk) => void) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("TTS request aborted");
    await this.ensureReady();
    if (!this.child?.stdin.writable) throw new Error("TeraTTS runtime is not writable");
    const id = randomUUID();
    return new Promise<Buffer>((resolve, reject) => {
      const abort = () => this.stop(signal?.reason instanceof Error ? signal.reason : new Error("TTS request aborted"));
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.active = { id, audio: [], onChunk, resolve, reject, cleanup };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(`${JSON.stringify({ id, text, voice, stream })}\n`, "utf8", (error) => {
        if (error && this.active?.id === id) this.failActive(error);
      });
    });
  }

  private ensureReady() {
    if (this.ready) return this.ready;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.resolveReady = resolveReady;
    this.rejectReady = rejectReady;
    const threadCount = Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)));
    const child = spawn(this.executable, [
      "--model-dir", this.modelDir,
      "--threads", String(threadCount),
      "--ruaccent-mode", "full",
      "serve"
    ], {
      cwd: path.dirname(this.executable),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.consumeStdout(chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS);
    });
    child.once("error", (error) => this.handleExit(error));
    child.once("exit", (code, signal) => {
      this.handleExit(new Error(`TeraTTS runtime exited with code ${code ?? "?"}${signal ? ` (${signal})` : ""}: ${this.stderr.trim().slice(-1000)}`));
    });
    return this.ready;
  }

  private consumeStdout(value: string) {
    this.stdoutBuffer += value;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let event: RuntimeEvent;
      try {
        event = JSON.parse(line) as RuntimeEvent;
      } catch {
        this.handleExit(new Error(`TeraTTS runtime returned invalid output: ${line.slice(0, 500)}`));
        return;
      }
      if (event.type === "ready") {
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        continue;
      }
      const active = this.active;
      if (!active || event.id !== active.id) continue;
      if (event.type === "audio" && event.audioBase64) {
        if (event.format === "pcm" && active.onChunk) {
          active.onChunk({
            audioBase64: event.audioBase64,
            format: "pcm",
            sampleRate: Number.isFinite(event.sampleRate) ? Number(event.sampleRate) : 44_100
          });
        } else {
          active.audio.push(Buffer.from(event.audioBase64, "base64"));
        }
      } else if (event.type === "done") {
        this.active = null;
        active.cleanup();
        active.resolve(Buffer.concat(active.audio));
      } else if (event.type === "error") {
        this.failActive(new Error(event.message || "TeraTTS synthesis failed"));
      }
    }
  }

  private failActive(error: Error) {
    const active = this.active;
    this.active = null;
    active?.cleanup();
    active?.reject(error);
  }

  private handleExit(error: Error) {
    if (!this.child && !this.ready) return;
    this.child = null;
    this.rejectReady?.(error);
    this.resetReady();
    this.failActive(error);
  }

  private resetReady() {
    this.ready = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.stdoutBuffer = "";
    this.stderr = "";
  }
}
