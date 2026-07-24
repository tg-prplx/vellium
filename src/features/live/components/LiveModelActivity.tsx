import { useState } from "react";
import { useI18n } from "../../../shared/i18n";

export interface LiveModelActivityCall {
  callId: string;
  name: string;
  args: string;
  status: "running" | "done";
  result: string;
}

export function LiveModelActivity({
  toolCalls,
  reasoningCalls,
  reasoningText
}: {
  toolCalls: LiveModelActivityCall[];
  reasoningCalls: LiveModelActivityCall[];
  reasoningText: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (toolCalls.length === 0 && reasoningCalls.length === 0 && !reasoningText) return null;
  const running = toolCalls.some((call) => call.status === "running")
    || reasoningCalls.some((call) => call.status === "running");

  return (
    <div className="mx-4 mt-3 rounded-xl border border-border-subtle bg-bg-primary/70">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-text-secondary" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <span>{t("live.modelActivity")}</span>
        <span>{running ? t("chat.running") : t("chat.done")}</span>
      </button>
      {expanded ? (
        <div className="max-h-48 space-y-2 overflow-auto border-t border-border-subtle p-3">
          {reasoningText ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">{t("chat.reasoning")}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-text-tertiary">{reasoningText}</pre>
            </details>
          ) : null}
          {reasoningCalls.map((call) => (
            <details key={call.callId}>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">{t("chat.reasoning")} · {call.status === "running" ? t("chat.running") : t("chat.done")}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-text-tertiary">{call.result || call.args}</pre>
            </details>
          ))}
          {toolCalls.map((call) => (
            <details key={call.callId}>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">{call.name} · {call.status === "running" ? t("chat.running") : t("chat.done")}</summary>
              <div className="mt-2 grid gap-2">
                <pre className="whitespace-pre-wrap rounded bg-bg-secondary p-2 text-[11px] text-text-tertiary">{call.args}</pre>
                {call.result ? <pre className="whitespace-pre-wrap rounded bg-bg-secondary p-2 text-[11px] text-text-secondary">{call.result}</pre> : null}
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
