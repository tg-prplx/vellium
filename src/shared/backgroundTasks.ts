import { useSyncExternalStore } from "react";

export type BackgroundTaskStatus = "running" | "done" | "error" | "cancelled";
export type BackgroundTaskScope = "chat" | "writing" | "characters" | "lorebooks" | "knowledge" | "agents";
export type BackgroundTaskType = "generate" | "expand" | "rewrite" | "summarize" | "consistency" | "character" | "translate" | "export" | "ingest" | "agent";
export type BackgroundTaskCancelAction = (() => Promise<void> | void) | null;

export interface BackgroundTask {
  id: string;
  scope: BackgroundTaskScope;
  type: BackgroundTaskType;
  label: string;
  startedAt: number;
  finishedAt?: number;
  status: BackgroundTaskStatus;
  result?: string;
  progress?: number | null;
  progressLabel?: string;
  cancellable?: boolean;
  cancelLabel?: string;
  onCancel?: BackgroundTaskCancelAction;
  cancelRequested?: boolean;
}

const MAX_BACKGROUND_TASKS = 60;

let backgroundTasks: BackgroundTask[] = [];
let taskCounter = 0;
const listeners = new Set<() => void>();

function emitBackgroundTasks() {
  for (const listener of listeners) listener();
}

function nextTaskId() {
  taskCounter += 1;
  return `task-${Date.now()}-${taskCounter}`;
}

function normalizeProgress(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function subscribeBackgroundTasks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBackgroundTasks(): BackgroundTask[] {
  return backgroundTasks;
}

export function addBackgroundTask(task: BackgroundTask) {
  const nextTasks = [{
    ...task,
    progress: normalizeProgress(task.progress),
    onCancel: task.onCancel ?? null,
    cancelRequested: task.cancelRequested ?? false
  }, ...backgroundTasks.filter((item) => item.id !== task.id)];
  const runningTasks = nextTasks.filter((item) => item.status === "running");
  const finishedTasks = nextTasks.filter((item) => item.status !== "running");
  backgroundTasks = [...runningTasks, ...finishedTasks.slice(0, Math.max(0, MAX_BACKGROUND_TASKS - runningTasks.length))];
  emitBackgroundTasks();
}

export function updateBackgroundTask(id: string, update: Partial<BackgroundTask>) {
  let changed = false;
  backgroundTasks = backgroundTasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;
    const nextStatus = update.status ?? task.status;
    const nextProgress = update.progress === undefined ? task.progress : normalizeProgress(update.progress);
    const nextCancelable = nextStatus === "running"
      ? (update.cancellable ?? task.cancellable ?? false)
      : false;
    const nextCancelLabel = nextStatus === "running"
      ? (update.cancelLabel ?? task.cancelLabel)
      : undefined;
    const nextCancelAction = nextStatus === "running"
      ? (update.onCancel ?? task.onCancel ?? null)
      : null;
    return {
      ...task,
      ...update,
      progress: nextProgress,
      cancellable: nextCancelable,
      cancelLabel: nextCancelLabel,
      onCancel: nextCancelAction,
      cancelRequested: nextStatus === "running"
        ? (update.cancelRequested ?? task.cancelRequested ?? false)
        : false,
      finishedAt: nextStatus === "running" ? task.finishedAt : (update.finishedAt ?? task.finishedAt ?? Date.now())
    };
  });
  if (changed) emitBackgroundTasks();
}

export function startBackgroundTask(input: Omit<BackgroundTask, "id" | "startedAt" | "status"> & { id?: string; startedAt?: number }) {
  const task: BackgroundTask = {
    id: input.id ?? nextTaskId(),
    scope: input.scope,
    type: input.type,
    label: input.label,
    startedAt: input.startedAt ?? Date.now(),
    status: "running",
    progress: normalizeProgress(input.progress),
    progressLabel: input.progressLabel,
    cancellable: input.cancellable ?? false,
    cancelLabel: input.cancelLabel,
    onCancel: input.onCancel ?? null
  };
  addBackgroundTask(task);
  return task.id;
}

export function finishBackgroundTask(id: string, result?: string) {
  updateBackgroundTask(id, {
    status: "done",
    result,
    progress: 100,
    progressLabel: undefined,
    finishedAt: Date.now()
  });
}

export function failBackgroundTask(id: string, result?: string) {
  if (backgroundTasks.some((task) => task.id === id && task.status === "cancelled")) return;
  updateBackgroundTask(id, { status: "error", result, finishedAt: Date.now() });
}

export async function cancelBackgroundTask(id: string, result?: string) {
  const task = backgroundTasks.find((item) => item.id === id);
  if (!task || task.status !== "running" || task.cancelRequested || !task.onCancel) return false;

  const cancelAction = task.onCancel;
  updateBackgroundTask(id, { cancelRequested: true });
  try {
    await cancelAction();
    updateBackgroundTask(id, {
      status: "cancelled",
      result,
      finishedAt: Date.now()
    });
    return true;
  } catch (error) {
    failBackgroundTask(id, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function removeBackgroundTask(id: string) {
  const nextTasks = backgroundTasks.filter((task) => task.id !== id);
  if (nextTasks.length === backgroundTasks.length) return;
  backgroundTasks = nextTasks;
  emitBackgroundTasks();
}

export function clearFinishedBackgroundTasks() {
  const nextTasks = backgroundTasks.filter((task) => task.status === "running");
  if (nextTasks.length === backgroundTasks.length) return;
  backgroundTasks = nextTasks;
  emitBackgroundTasks();
}

export function useBackgroundTasks() {
  return useSyncExternalStore(subscribeBackgroundTasks, getBackgroundTasks, getBackgroundTasks);
}
