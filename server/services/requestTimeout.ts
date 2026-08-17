export interface RequestTimeout {
  signal: AbortSignal | undefined;
  dispose: () => void;
}

export function createRequestTimeout(seconds: number, label: string): RequestTimeout {
  const timeoutMs = Math.max(0, Math.floor(Number(seconds) * 1000));
  if (timeoutMs === 0) return { signal: undefined, dispose: () => undefined };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s`));
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer)
  };
}
