import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFinishedBackgroundTasks,
  finishBackgroundTask,
  getBackgroundTasks,
  removeBackgroundTask,
  startBackgroundTask,
  updateBackgroundTask
} from "./backgroundTasks";

function resetBackgroundTasks() {
  for (const task of getBackgroundTasks()) {
    removeBackgroundTask(task.id);
  }
}

describe("backgroundTasks", () => {
  beforeEach(() => {
    resetBackgroundTasks();
  });

  it("tracks progress and clears cancel controls once a task finishes", () => {
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "generate",
      label: "Streaming reply",
      progress: 5,
      progressLabel: "Queued",
      cancellable: true,
      cancelLabel: "Stop",
      onCancel: () => {}
    });

    updateBackgroundTask(taskId, { progress: 42, progressLabel: "Receiving response" });
    finishBackgroundTask(taskId, "Done");

    const task = getBackgroundTasks()[0];
    expect(task?.status).toBe("done");
    expect(task?.progress).toBe(100);
    expect(task?.cancellable).toBe(false);
    expect(task?.onCancel).toBeNull();
  });

  it("clears only finished tasks and keeps running ones available", () => {
    const runningId = startBackgroundTask({
      scope: "writing",
      type: "summarize",
      label: "Summarizing chapter"
    });
    const doneId = startBackgroundTask({
      scope: "knowledge",
      type: "ingest",
      label: "Indexing notes"
    });

    finishBackgroundTask(doneId, "Indexed");
    clearFinishedBackgroundTasks();

    expect(getBackgroundTasks().map((task) => task.id)).toEqual([runningId]);
  });
});
