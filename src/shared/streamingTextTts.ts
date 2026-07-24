import type { TtsStreamEvent } from "./api/chatClient";
import { RealtimeTtsPlayer } from "./realtimeTts";

type TtsTransport = (
  input: string,
  onEvent: (event: TtsStreamEvent) => void,
  signal: AbortSignal
) => Promise<void>;

interface StreamingTextTtsOptions {
  maxBufferedChars?: number;
  normalizeText?: (text: string) => string;
  onPlaybackStart?: () => void;
  onError?: (error: Error) => void;
}

export function takeCompletedSpeechSegments(
  input: string,
  flush = false,
  maxBufferedChars = 280
): { segments: string[]; remainder: string } {
  let remainder = String(input || "");
  const segments: string[] = [];
  const boundary = /(?:[.!?]+["'»”’)\]}]*[ \t]+|[。！？]+|[\r\n]+)/u;

  while (remainder) {
    const match = boundary.exec(remainder);
    if (match?.index !== undefined) {
      const end = match.index + match[0].length;
      const segment = remainder.slice(0, end).trim();
      remainder = remainder.slice(end);
      if (segment) segments.push(segment);
      continue;
    }

    if (!flush && remainder.length > maxBufferedChars) {
      const preferredBreak = remainder.lastIndexOf(" ", maxBufferedChars);
      const end = preferredBreak >= Math.floor(maxBufferedChars * 0.55)
        ? preferredBreak + 1
        : maxBufferedChars;
      const segment = remainder.slice(0, end).trim();
      remainder = remainder.slice(end);
      if (segment) segments.push(segment);
      continue;
    }
    break;
  }

  if (flush) {
    const tail = remainder.trim();
    if (tail) segments.push(tail);
    remainder = "";
  }
  return { segments, remainder };
}

export class StreamingTextTtsSession {
  private readonly player: RealtimeTtsPlayer;
  private readonly pending: string[] = [];
  private readonly completion: Promise<void>;
  private buffer = "";
  private inputFinished = false;
  private stopped = false;
  private wakeConsumer: (() => void) | null = null;
  private audioIndex = 0;

  constructor(
    private readonly transport: TtsTransport,
    private readonly options: StreamingTextTtsOptions = {}
  ) {
    this.player = new RealtimeTtsPlayer({
      onPlaybackStart: options.onPlaybackStart,
      onError: options.onError
    });
    this.completion = this.player.play((onEvent, signal) => this.consume(onEvent, signal));
    void this.completion.catch(() => {});
  }

  push(delta: string) {
    if (this.stopped || this.inputFinished || !delta) return;
    this.buffer += delta;
    this.extract(false);
  }

  async finish() {
    if (!this.inputFinished) {
      this.extract(true);
      this.inputFinished = true;
      this.wake();
    }
    await this.completion;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.inputFinished = true;
    this.pending.length = 0;
    this.buffer = "";
    this.wake();
    this.player.stop();
  }

  private extract(flush: boolean) {
    const result = takeCompletedSpeechSegments(
      this.buffer,
      flush,
      this.options.maxBufferedChars
    );
    this.buffer = result.remainder;
    for (const rawSegment of result.segments) {
      const segment = (this.options.normalizeText?.(rawSegment) ?? rawSegment).trim();
      if (segment) this.pending.push(segment);
    }
    if (result.segments.length > 0) this.wake();
  }

  private async consume(
    onEvent: (event: TtsStreamEvent) => void,
    signal: AbortSignal
  ) {
    while (!signal.aborted) {
      const phrase = await this.nextPhrase(signal);
      if (phrase === null) break;
      await this.transport(phrase, (event) => {
        if (event.type === "done") return;
        if (event.type === "audio") {
          onEvent({ ...event, index: this.audioIndex });
          this.audioIndex += 1;
          return;
        }
        onEvent(event);
      }, signal);
    }
    if (!signal.aborted) onEvent({ type: "done", count: this.audioIndex });
  }

  private async nextPhrase(signal: AbortSignal): Promise<string | null> {
    while (!signal.aborted) {
      const next = this.pending.shift();
      if (next) return next;
      if (this.inputFinished) return null;
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          if (this.wakeConsumer === wake) this.wakeConsumer = null;
          resolve();
        };
        const wake = () => {
          signal.removeEventListener("abort", onAbort);
          if (this.wakeConsumer === wake) this.wakeConsumer = null;
          resolve();
        };
        this.wakeConsumer = wake;
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return null;
  }

  private wake() {
    const wake = this.wakeConsumer;
    this.wakeConsumer = null;
    wake?.();
  }
}
