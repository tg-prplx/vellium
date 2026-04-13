function isStandaloneSseDataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return false;
  const payload = trimmed.slice(5).trimStart();
  if (!payload) return false;
  if (payload === "[DONE]") return true;
  try {
    JSON.parse(payload);
    return true;
  } catch {
    return false;
  }
}

export function consumeSseEventBlocks(buffer: string, flush = false): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const pending = flush ? [] : [lines.pop() ?? ""];
  const completeLines = flush ? lines : lines;
  const events: string[] = [];
  let currentEvent: string[] = [];

  const emitCurrentEvent = () => {
    if (currentEvent.length === 0) return;
    events.push(currentEvent.join("\n"));
    currentEvent = [];
  };

  for (const line of completeLines) {
    if (line.length === 0) {
      emitCurrentEvent();
      continue;
    }

    if (currentEvent.length === 0 && isStandaloneSseDataLine(line)) {
      events.push(line);
      continue;
    }

    currentEvent.push(line);
  }

  if (flush) {
    emitCurrentEvent();
    return { events, rest: "" };
  }

  return {
    events,
    rest: [...currentEvent, ...pending].join("\n")
  };
}

export function extractSseEventData(eventBlock: string): string {
  return eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

export function extractSseEventType(eventBlock: string): string {
  const eventLine = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("event:"));
  return eventLine ? eventLine.slice(6).trim().toLowerCase() : "message";
}

export function extractOpenAiStreamErrorMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const root = parsed as {
    error?: unknown;
    message?: unknown;
  };

  if (typeof root.error === "string" && root.error.trim()) {
    return root.error.trim();
  }

  if (root.error && typeof root.error === "object") {
    const row = root.error as Record<string, unknown>;
    const direct = [row.message, row.detail, row.error, row.description]
      .map((item) => typeof item === "string" ? item.trim() : "")
      .find(Boolean);
    if (direct) return direct;
  }

  if (typeof root.message === "string" && root.message.trim()) {
    return root.message.trim();
  }

  return "";
}

function flattenOpenAiStreamTextPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenOpenAiStreamTextPart(item))
      .filter(Boolean)
      .join("");
  }
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const direct = [row.text, row.content, row.value, row.delta, row.output_text, row.output_text_delta]
    .map((item) => typeof item === "string" ? item : "")
    .find(Boolean);
  if (direct) return direct;
  return [row.message, row.part, row.item]
    .map((item) => flattenOpenAiStreamTextPart(item))
    .find(Boolean) || "";
}

export function extractOpenAiStreamTextDelta(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const root = parsed as {
    choices?: Array<{
      delta?: Record<string, unknown>;
      message?: Record<string, unknown>;
      text?: unknown;
    }>;
    delta?: Record<string, unknown>;
    output_text?: unknown;
  };

  const choice = root.choices?.[0];
  const delta = choice?.delta;
  const candidates = [
    delta?.content,
    delta?.text,
    delta?.output_text,
    delta?.output_text_delta,
    delta?.message,
    choice?.message?.content,
    choice?.message,
    choice?.text,
    root.delta,
    root.output_text
  ];

  for (const candidate of candidates) {
    const text = flattenOpenAiStreamTextPart(candidate);
    if (text.length > 0) return text;
  }

  return "";
}
