const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const THINK_TAGS = [THINK_OPEN, THINK_CLOSE];

export interface ThinkSplitResult {
  content: string;
  reasoning: string;
}

export interface ThinkStreamState {
  pending: string;
  inThink: boolean;
}

function trailingTagPrefix(input: string): string {
  for (let size = Math.min(input.length, THINK_CLOSE.length); size > 0; size -= 1) {
    const suffix = input.slice(-size);
    if (THINK_TAGS.some((tag) => tag.startsWith(suffix))) {
      return suffix;
    }
  }
  return "";
}

function appendChunk(target: ThinkSplitResult, inThink: boolean, chunk: string) {
  if (!chunk) return;
  if (inThink) {
    target.reasoning += chunk;
  } else {
    target.content += chunk;
  }
}

function processText(state: ThinkStreamState, text: string): ThinkSplitResult {
  const result: ThinkSplitResult = { content: "", reasoning: "" };
  let index = 0;

  while (index < text.length) {
    const nextTag = state.inThink
      ? text.indexOf(THINK_CLOSE, index)
      : text.indexOf(THINK_OPEN, index);

    if (nextTag === -1) {
      break;
    }

    appendChunk(result, state.inThink, text.slice(index, nextTag));
    index = nextTag + (state.inThink ? THINK_CLOSE.length : THINK_OPEN.length);
    state.inThink = !state.inThink;
  }

  const remainder = text.slice(index);
  const carry = trailingTagPrefix(remainder);
  const safe = carry ? remainder.slice(0, -carry.length) : remainder;
  appendChunk(result, state.inThink, safe);
  state.pending = carry;

  return result;
}

export function createThinkStreamState(): ThinkStreamState {
  return {
    pending: "",
    inThink: false
  };
}

export function consumeThinkChunk(state: ThinkStreamState, chunk: string): ThinkSplitResult {
  const source = `${state.pending}${String(chunk || "")}`;
  state.pending = "";
  return processText(state, source);
}

export function flushThinkState(state: ThinkStreamState): ThinkSplitResult {
  const result: ThinkSplitResult = { content: "", reasoning: "" };
  if (state.pending) {
    appendChunk(result, state.inThink, state.pending);
    state.pending = "";
  }
  return result;
}

export function splitThinkContent(text: string): ThinkSplitResult {
  const state = createThinkStreamState();
  const first = consumeThinkChunk(state, text);
  const tail = flushThinkState(state);
  return {
    content: `${first.content}${tail.content}`,
    reasoning: `${first.reasoning}${tail.reasoning}`
  };
}
