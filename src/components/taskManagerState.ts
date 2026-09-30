export function syncTaskManagerOpenState(isOpen: boolean, taskCount: number) {
  return taskCount === 0 ? false : isOpen;
}

/** The header badge counts work that needs attention, not every finished chat turn. */
export function taskManagerBadge(tasks: ReadonlyArray<{ status: string }>): { count: number; tone: "running" | "error" } | null {
  const running = tasks.filter((task) => task.status === "running").length;
  if (running > 0) return { count: running, tone: "running" };
  const failed = tasks.filter((task) => task.status === "error").length;
  return failed > 0 ? { count: failed, tone: "error" } : null;
}
