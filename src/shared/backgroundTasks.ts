import { useSyncExternalStore } from "react";

export type BackgroundTaskStatus = "running" | "done" | "error";
export type BackgroundTaskScope = "chat" | "writing" | "characters" | "lorebooks" | "knowledge";
export type BackgroundTaskType = "generate" | "expand" | "rewrite" | "summarize" | "consistency" | "character" | "translate" | "ingest";

export interface BackgroundTask {
  id: string;
  scope: BackgroundTaskScope;
  type: BackgroundTaskType;
  label: string;
  startedAt: number;
  finishedAt?: number;
  status: BackgroundTaskStatus;
  result?: string;
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
  backgroundTasks = [task, ...backgroundTasks].slice(0, MAX_BACKGROUND_TASKS);
  emitBackgroundTasks();
}

export function updateBackgroundTask(id: string, update: Partial<BackgroundTask>) {
  let changed = false;
  backgroundTasks = backgroundTasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;
    const nextStatus = update.status ?? task.status;
    return {
      ...task,
      ...update,
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
    status: "running"
  };
  addBackgroundTask(task);
  return task.id;
}

export function finishBackgroundTask(id: string, result?: string) {
  updateBackgroundTask(id, { status: "done", result, finishedAt: Date.now() });
}

export function failBackgroundTask(id: string, result?: string) {
  updateBackgroundTask(id, { status: "error", result, finishedAt: Date.now() });
}

export function useBackgroundTasks() {
  return useSyncExternalStore(subscribeBackgroundTasks, getBackgroundTasks, getBackgroundTasks);
}
