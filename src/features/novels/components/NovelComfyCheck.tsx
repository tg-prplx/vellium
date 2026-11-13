import { useState } from "react";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { NovelConfig } from "../../../shared/types/novels";

/** Ask the server to contact ComfyUI and dry-run the workflow. No job is queued. */
export function NovelComfyCheck({ config }: { config: NovelConfig }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; message?: string }>({ busy: false });
  async function check() {
    if (state.busy) return;
    setState({ busy: true });
    try {
      const result = await api.novelComfyCheck({ comfyUrl: config.comfyUrl, workflow: config.workflow, positiveNode: config.positiveNode, negativeNode: config.negativeNode });
      const ok = result.reachable && result.workflowOk;
      setState({ busy: false, ok, message: ok ? t("novel.comfyOk").replace("{node}", result.positiveNode || "?")
        : t(result.reachable ? "novel.comfyWorkflowBad" : "novel.comfyUnreachable").replace("{error}", result.error || "") });
    } catch (e) { setState({ busy: false, ok: false, message: t("novel.comfyUnreachable").replace("{error}", e instanceof Error ? e.message : String(e)) }); }
  }
  return <div className="novel-comfy-check">
    <button type="button" className="novel-workflow-file-action" disabled={state.busy || !config.comfyUrl.trim()} onClick={() => void check()}>{t(state.busy ? "novel.comfyChecking" : "novel.comfyCheck")}</button>
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "novel-workflow-success" : "novel-error"}>{state.ok ? "✓ " : ""}{state.message}</p>}
  </div>;
}
