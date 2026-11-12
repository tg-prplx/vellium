import type {NovelImagePov} from "../../../shared/types/novels";
import {NovelStyleSwitch} from "./NovelStyleSwitch";
import { useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n";
import { isNovelWorkflow } from "../setup";
import { NovelNumberField, type SetupFieldsProps } from "./SetupFields";
export function NovelVisualsStep({ config, patch }: SetupFieldsProps) {
  const { t } = useI18n(); const props = { config, patch };
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState(""); const [error, setError] = useState("");
  async function importWorkflow(file?: File) {
    if (!file) return;
    try {
      if (file.size > 300000) throw new Error(t("novel.workflowTooLarge"));
      const workflow: unknown = JSON.parse(await file.text());
      if (!isNovelWorkflow(workflow)) throw new Error(t("novel.setup.workflowInvalid"));
      patch({ workflow }); setFileName(file.name); setError("");
    } catch (e) { setError(e instanceof SyntaxError ? t("novel.setup.workflowInvalid") : e instanceof Error ? e.message : String(e)); }
  }
  return <>
    <div className="novel-step-intro"><h2>{t("novel.setup.visualsHeading")}</h2><p>{t("novel.setup.visualsHint")}</p></div>
    <div className="novel-choice-modes" role="group" aria-label={t("novel.visuals")}>
      <button type="button" aria-pressed={!config.imagesEnabled} onClick={() => patch({ imagesEnabled: false })}><b>{t("novel.setup.textOnly")}</b><span>{t("novel.setup.textOnlyHint")}</span></button>
      <button type="button" aria-pressed={config.imagesEnabled} onClick={() => patch({ imagesEnabled: true })}><b>{t("novel.setup.withImages")}</b><span>{t("novel.setup.withImagesHint")}</span></button>
    </div>
    {!config.imagesEnabled ? <div className="novel-text-only-note"><span aria-hidden="true">Aa</span><div><h3>{t("novel.setup.textReady")}</h3><p>{t("novel.setup.canAddImagesLater")}</p></div></div> : <div className="novel-visual-settings">
      <label className="novel-field"><span>{t("novel.comfyUrl")}</span><input aria-label={t("novel.comfyUrl")} value={config.comfyUrl} placeholder="http://127.0.0.1:8188" onChange={(e) => patch({ comfyUrl: e.target.value })} /><p>{t("novel.setup.comfyHint")}</p></label>
      <div className="novel-field novel-workflow-upload"><span>{t("novel.workflow")}</span>
        <input ref={fileInput} className="novel-workflow-file-input" tabIndex={-1} aria-label={t("novel.workflow")} type="file" accept=".json,application/json" onChange={(e) => { void importWorkflow(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="novel-workflow-file-action" type="button" onClick={() => fileInput.current?.click()}>{t(config.workflow ? "novel.setup.replaceWorkflow" : "novel.setup.chooseWorkflow")}</button>
        {config.workflow && <p className="novel-workflow-success" role="status">✓ {fileName || t("novel.setup.workflowLoaded")} · {Object.keys(config.workflow).length} {t("novel.setup.workflowNodes")}</p>}
        <p>{t("novel.setup.workflowHelp")}</p>
      </div>
      {error && <p role="alert" className="novel-error">{error}</p>}
      <label className="novel-field"><span>{t("novel.imagePov")}</span><select aria-label={t("novel.imagePov")} value={config.imagePov||"dynamic"} onChange={e=>patch({imagePov:e.target.value as NovelImagePov})}>{(["first","third","over-shoulder","dynamic"] as const).map(mode=><option key={mode} value={mode}>{t(`novel.imagePov.${mode}`)}</option>)}</select><p>{t("novel.imagePovHint")}</p></label>
      {(config.imagePov==="first"||config.imagePov==="over-shoulder") && <label className="novel-field"><span>{t("novel.imageViewpoint")}</span><input aria-label={t("novel.imageViewpoint")} value={config.imagePovCharacter||""} onChange={e=>patch({imagePovCharacter:e.target.value})} placeholder={t("novel.viewpointHint")}/></label>}
      <NovelStyleSwitch {...props} />
      <NovelNumberField {...props} name="imagesPerScene" label="novel.frames" min={1} max={4} /><p className="novel-hint">{t("novel.framePlanHint")}</p>
      <details className="novel-advanced"><summary>{t("novel.setup.advancedImages")}</summary>
        <div className="novel-form-grid"><NovelNumberField {...props} name="width" label="novel.width" min={256} max={2048} /><NovelNumberField {...props} name="height" label="novel.height" min={256} max={2048} /></div>
        <p className="novel-hint">{t("novel.workflowHint")}</p>
        <div className="novel-form-grid"><label className="novel-field"><span>{t("novel.positiveNode")}</span><input value={config.positiveNode} onChange={(e) => patch({ positiveNode: e.target.value })} /></label><label className="novel-field"><span>{t("novel.negativeNode")}</span><input value={config.negativeNode} onChange={(e) => patch({ negativeNode: e.target.value })} /></label></div>
        <label className="novel-hint"><input type="checkbox" checked={config.overrideWorkflowNegative === true} onChange={e=>patch({overrideWorkflowNegative:e.target.checked})} /> {t("novel.overrideNegative")}</label>
        {config.overrideWorkflowNegative && <label className="novel-field"><span>{t("novel.negativePrompt")}</span><textarea value={config.negativePrompt} onChange={(e) => patch({ negativePrompt: e.target.value })} /></label>}
      </details>
      <button className="novel-link" type="button" onClick={() => patch({ imagesEnabled: false })}>{t("novel.setup.skipImages")}</button>
    </div>}
  </>;
}
