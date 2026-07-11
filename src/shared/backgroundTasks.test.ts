import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelBackgroundTask,
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
    expect(task?.progressLabel).toBeUndefined();
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

  it("cancels a running task once and exposes the terminal state", async () => {
    let cancellationCalls = 0;
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "translate",
      label: "Translate message",
      cancellable: true,
      onCancel: () => {
        cancellationCalls += 1;
      }
    });

    await Promise.all([
      cancelBackgroundTask(taskId, "Cancelled"),
      cancelBackgroundTask(taskId, "Cancelled")
    ]);

    expect(cancellationCalls).toBe(1);
    expect(getBackgroundTasks()[0]).toMatchObject({
      id: taskId,
      status: "cancelled",
      cancellable: false,
      cancelRequested: false,
      result: "Cancelled"
    });
  });

  it("does not evict active work when the recent-task limit is reached", () => {
    const runningId = startBackgroundTask({
      scope: "agents",
      type: "agent",
      label: "Long-running agent"
    });

    for (let index = 0; index < 70; index += 1) {
      const id = startBackgroundTask({
        scope: "writing",
        type: "summarize",
        label: `Summary ${index}`
      });
      finishBackgroundTask(id);
    }

    expect(getBackgroundTasks().some((task) => task.id === runningId && task.status === "running")).toBe(true);
    expect(getBackgroundTasks()).toHaveLength(60);
  });
});
