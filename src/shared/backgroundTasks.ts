import { useSyncExternalStore } from "react";

export type BackgroundTaskStatus = "running" | "done" | "error";
export type BackgroundTaskScope = "chat" | "writing" | "characters" | "lorebooks" | "knowledge";
export type BackgroundTaskType = "generate" | "expand" | "rewrite" | "summarize" | "consistency" | "character" | "translate" | "ingest";
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
  backgroundTasks = [{
    ...task,
    progress: normalizeProgress(task.progress),
    onCancel: task.onCancel ?? null
  }, ...backgroundTasks].slice(0, MAX_BACKGROUND_TASKS);
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
  updateBackgroundTask(id, { status: "done", result, progress: 100, finishedAt: Date.now() });
}

export function failBackgroundTask(id: string, result?: string) {
  updateBackgroundTask(id, { status: "error", result, finishedAt: Date.now() });
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
