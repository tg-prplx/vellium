import type { BackgroundTask } from "./types";

const backgroundTasks: BackgroundTask[] = [];

export function getBackgroundTasks(): BackgroundTask[] {
  return backgroundTasks;
}

export function addBackgroundTask(task: BackgroundTask) {
  backgroundTasks.unshift(task);
  if (backgroundTasks.length > 20) backgroundTasks.pop();
}

export function updateBackgroundTask(id: string, update: Partial<BackgroundTask>) {
  const task = backgroundTasks.find((item) => item.id === id);
  if (task) Object.assign(task, update);
}
