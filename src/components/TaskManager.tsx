import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearFinishedBackgroundTasks,
  removeBackgroundTask,
  type BackgroundTask,
  type BackgroundTaskScope,
  useBackgroundTasks
} from "../shared/backgroundTasks";
import { useI18n } from "../shared/i18n";

const TASK_SCOPE_TABS: Record<BackgroundTaskScope, string> = {
  chat: "chat",
  writing: "writing",
  characters: "characters",
  lorebooks: "lorebooks",
  knowledge: "knowledge"
};

function formatTaskDuration(startedAt: number, now: number, finishedAt?: number) {
  const totalSeconds = Math.max(0, Math.floor(((finishedAt ?? now) - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

type TaskTranslator = ReturnType<typeof useI18n>["t"];

function taskScopeLabel(t: TaskTranslator, scope: BackgroundTaskScope) {
  switch (scope) {
    case "chat":
      return t("taskManager.scope.chat");
    case "writing":
      return t("taskManager.scope.writing");
    case "characters":
      return t("taskManager.scope.characters");
    case "lorebooks":
      return t("taskManager.scope.lorebooks");
    case "knowledge":
      return t("taskManager.scope.knowledge");
    default:
      return scope;
  }
}

function taskStatusLabel(t: TaskTranslator, task: BackgroundTask) {
  if (task.status === "done") return t("taskManager.done");
  if (task.status === "error") return t("taskManager.error");
  return t("taskManager.running");
}

function TaskProgress({ task }: { task: BackgroundTask }) {
  const width = typeof task.progress === "number"
    ? `${Math.max(2, Math.min(100, task.progress))}%`
    : task.status === "done"
      ? "100%"
      : "45%";

  const tone = task.status === "error"
    ? "bg-danger"
    : task.status === "done"
      ? "bg-success"
      : "bg-accent";

  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
      <div
        className={`h-full rounded-full ${tone} ${typeof task.progress === "number" || task.status !== "running" ? "" : "animate-pulse"}`}
        style={{ width }}
      />
    </div>
  );
}

function TaskCard({
  task,
  now,
  onOpenScope,
  onClose
}: {
  task: BackgroundTask;
  now: number;
  onOpenScope: (scope: BackgroundTaskScope) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const statusClass = task.status === "done"
    ? "border-success-border bg-success-subtle text-success"
    : task.status === "error"
      ? "border-danger-border bg-danger-subtle text-danger"
      : "border-accent-border bg-accent-subtle text-accent";

  const summary = task.result?.trim()
    || task.progressLabel?.trim()
    || formatTaskDuration(task.startedAt, now, task.finishedAt);

  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-primary p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">{task.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary">
              {taskScopeLabel(t, task.scope)}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
              {taskStatusLabel(t, task)}
            </span>
            {typeof task.progress === "number" && (
              <span className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary">
                {Math.round(task.progress)}%
              </span>
            )}
          </div>
        </div>
        <span className="flex-shrink-0 text-[10px] text-text-tertiary">
          {formatTaskDuration(task.startedAt, now, task.finishedAt)}
        </span>
      </div>

      <p className="mt-2 text-xs text-text-secondary">{summary}</p>
      <TaskProgress task={task} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            onOpenScope(task.scope);
            onClose();
          }}
          className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        >
          {t("taskManager.open")}
        </button>

        {task.status === "running" && task.cancellable && task.onCancel ? (
          <button
            onClick={() => {
              void task.onCancel?.();
            }}
            className="rounded-lg border border-danger-border px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-danger-subtle"
          >
            {task.cancelLabel || t("taskManager.stop")}
          </button>
        ) : (
          <button
            onClick={() => removeBackgroundTask(task.id)}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            {t("taskManager.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskManager({
  isElectron,
  onOpenTab
}: {
  isElectron: boolean;
  onOpenTab: (tab: string) => void;
}) {
  const { t } = useI18n();
  const tasks = useBackgroundTasks();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const runningTasks = useMemo(
    () => tasks.filter((task) => task.status === "running"),
    [tasks]
  );
  const recentTasks = useMemo(
    () => tasks.filter((task) => task.status !== "running").slice(0, 6),
    [tasks]
  );

  useEffect(() => {
    if (tasks.length === 0) {
      setIsOpen(false);
      return;
    }
    if (runningTasks.length > 0) {
      setIsOpen(true);
    }
  }, [tasks.length, runningTasks.length]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && runningTasks.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, runningTasks.length]);

  if (tasks.length === 0) return null;

  const topClass = isElectron ? "top-14" : "top-[4.75rem]";
  const count = runningTasks.length > 0 ? runningTasks.length : tasks.length;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
          runningTasks.length > 0
            ? "border-accent-border bg-accent-subtle text-accent"
            : "border-border-subtle bg-bg-secondary text-text-secondary hover:bg-bg-hover"
        }`}
        title={t("taskManager.title")}
      >
        <svg
          className={`h-3.5 w-3.5 ${runningTasks.length > 0 ? "animate-spin text-accent" : "text-text-tertiary"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 3a9 9 0 109 9" />
        </svg>
        <span className="max-w-[140px] truncate text-left font-medium text-text-primary">{t("taskManager.title")}</span>
        <span className="rounded-full bg-bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
          {count}
        </span>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className={`fixed ${topClass} right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl border border-border bg-bg-secondary/95 p-3 shadow-2xl backdrop-blur`}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">{t("taskManager.title")}</div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {runningTasks.length > 0
                  ? `${runningTasks.length} ${t("taskManager.active")}`
                  : `${recentTasks.length} ${t("taskManager.recent")}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {recentTasks.length > 0 && (
                <button
                  onClick={() => clearFinishedBackgroundTasks()}
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  {t("taskManager.clearFinished")}
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              >
                {t("chat.closePreview")}
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-8rem)] space-y-3 overflow-y-auto pr-1">
            {runningTasks.length > 0 ? (
              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {t("taskManager.active")}
                </div>
                {runningTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    now={now}
                    onOpenScope={(scope) => onOpenTab(TASK_SCOPE_TABS[scope])}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </section>
            ) : null}

            {recentTasks.length > 0 ? (
              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {t("taskManager.recent")}
                </div>
                {recentTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    now={now}
                    onOpenScope={(scope) => onOpenTab(TASK_SCOPE_TABS[scope])}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </section>
            ) : null}

            {runningTasks.length === 0 && recentTasks.length === 0 ? (
              <div className="rounded-2xl border border-border-subtle bg-bg-primary px-3 py-6 text-center text-xs text-text-tertiary">
                {t("taskManager.empty")}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
