import { useEffect, useId, useRef, useState } from "react";
import { ModalShell } from "../../../components/ModalShell";
import { api } from "../../../shared/api";
import { useI18n, type TranslationKey } from "../../../shared/i18n";
import { useDataCatalogRefresh } from "../../../shared/useDataCatalogRefresh";
import { DEFAULT_NOVEL_CONFIG, type NovelConfig } from "../../../shared/types/novels";
import type { CharacterDetail, ProviderProfile, ProviderModel } from "../../../shared/types/contracts";
import { firstNovelProblem, NOVEL_SETUP_STEPS, novelStepProblem, type NovelDraft, type NovelSetupStep } from "../setup";
import { NovelStoryStep } from "./NovelStoryStep";
import { NovelNarratorStep } from "./NovelNarratorStep";
import { NovelVisualsStep } from "./NovelVisualsStep";
import { NovelSetupReview } from "./NovelSetupReview";

export function NovelSetup({ initial, title: initialTitle, busy, onClose, onSave, onDelete, draft, onDraftChange, submitError }: {
  initial?: NovelConfig; title?: string; busy: boolean; onDelete?: () => void; onClose: () => void;
  onSave: (title: string, config: NovelConfig) => Promise<unknown>;
  draft?: NovelDraft | null; onDraftChange?: (draft: NovelDraft) => void; submitError?: string;
}) {
  const { t, locale } = useI18n(); const editing = Boolean(initial); const formId = useId();
  const [config, setConfig] = useState<NovelConfig>(initial || draft?.config || { ...DEFAULT_NOVEL_CONFIG, language: ({ en: "English", ru: "Russian", zh: "Chinese", ja: "Japanese" })[locale] });
  const [title, setTitle] = useState(initialTitle || draft?.title || "");
  const [step, setStep] = useState<NovelSetupStep>(editing ? "story" : draft?.step || "story");
  const [characters, setCharacters] = useState<CharacterDetail[]>([]); const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]); const [modelLoading, setModelLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true); const [dataError, setDataError] = useState(""); const [modelError, setModelError] = useState("");
  const [validation, setValidation] = useState<TranslationKey | null>(null);
  const submitting = useRef(false); const formRef = useRef<HTMLFormElement>(null); const onDraftRef = useRef(onDraftChange);
  onDraftRef.current = onDraftChange;
  const patch = (value: Partial<NovelConfig>) => { setConfig((c) => ({ ...c, ...value })); setValidation(null); };
  useEffect(() => { if (!editing) onDraftRef.current?.({ title, config, step }); }, [title, config, step, editing]);
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([api.characterList(), api.providerList(), api.settingsGet()]).then(([cast, connections, settings]) => {
      if (cancelled) return;
      if (cast.status === "fulfilled") setCharacters(cast.value); else setDataError(String(cast.reason));
      if (connections.status === "fulfilled") setProviders(connections.value); else setDataError(String(connections.reason));
      if (!editing && settings.status === "fulfilled") setConfig((c) => c.providerId || c.modelId ? c : { ...c, providerId: settings.value.activeProviderId || "", modelId: settings.value.activeModel || "" });
      setDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [editing]);
  useDataCatalogRefresh(["characters", "providers"], (kind) => {
    if (kind === "characters") void api.characterList().then(setCharacters).catch((e) => setDataError(String(e)));
    else void api.providerList().then(setProviders).catch((e) => setDataError(String(e)));
  });
  useEffect(() => {
    let cancelled = false; setModels([]); setModelError(""); setModelLoading(Boolean(config.providerId));
    if (!config.providerId) return;
    void api.providerFetchModels(config.providerId).then((list) => { if (!cancelled) setModels(list); }).catch((e) => { if (!cancelled) setModelError(String(e)); }).finally(() => { if (!cancelled) setModelLoading(false); });
    return () => { cancelled = true; };
  }, [config.providerId]);
  const steps = editing ? NOVEL_SETUP_STEPS.slice(0, 3) : NOVEL_SETUP_STEPS;
  const index = steps.indexOf(step); const last = step === "review";
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const form = formRef.current;
    form?.closest(".vellium-modal-body")?.scrollTo(0, 0);
    const heading = form?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [step]);
  function navigate(next: NovelSetupStep) {
    if (busy) return;
    if (!editing && steps.indexOf(next) > index) {
      for (const candidate of steps.slice(0, steps.indexOf(next))) {
        const problem = novelStepProblem(candidate, config);
        if (problem) { setStep(candidate); setValidation(problem); return; }
      }
    }
    setValidation(null); setStep(next); formRef.current?.closest(".vellium-modal-body")?.scrollTo(0, 0);
  }
  async function submit() {
    if (busy || submitting.current) return;
    if (!editing && !last) {
      const problem = novelStepProblem(step, config);
      if (problem) { setValidation(problem); formRef.current?.querySelector<HTMLElement>("textarea, input, select")?.focus(); return; }
      navigate(steps[index + 1]); return;
    }
    const problem = firstNovelProblem(config);
    if (problem) { setStep(problem.step); setValidation(problem.problem); return; }
    submitting.current = true;
    try { await onSave(title, config); } finally { submitting.current = false; }
  }
  function openProviderSettings() {
    onClose();
    window.dispatchEvent(new CustomEvent("open-settings-view", { detail: { category: "connection", sectionId: "settings-manual-provider" } }));
  }
  const fields = { config, patch };
  return <ModalShell title={t(editing ? "novel.settings" : "novel.create")} closeLabel={t("chat.cancel")} onClose={onClose} closeDisabled={busy} size="lg"
    surfaceClassName="novel-setup-modal"
    footer={<div className="novel-wizard-footer">
      <div className="novel-wizard-footer-note" role="status">{busy ? t("novel.setup.starting") : t(editing ? "novel.setup.settingsFuture" : "novel.setup.draftHint")}</div>
      <div className="novel-wizard-footer-actions">{onDelete && <button type="button" className="novel-delete-action" onClick={onDelete} disabled={busy}>{t("novel.delete")}</button>}
        <button type="button" disabled={busy} onClick={!editing && index > 0 ? () => navigate(steps[index - 1]) : onClose}>{t(!editing && index > 0 ? "novel.previous" : "chat.cancel")}</button>
        <button type="submit" form={formId} className="novel-primary" disabled={busy}>{t(busy ? "chat.loading" : editing ? "novel.save" : last ? "novel.setup.startReading" : "novel.setup.nextStep")}{!busy && !editing && !last ? " →" : ""}</button>
      </div>
    </div>}>
    <div className="novel-setup">
      {editing ? <div className="novel-tabs" role="tablist">{steps.map((key) => <button key={key} role="tab" aria-selected={step === key} disabled={busy} onClick={() => navigate(key)}>{t(`novel.${key}` as TranslationKey)}</button>)}</div>
      : <ol className="novel-wizard-steps" aria-label={t("novel.setup.steps")}>{steps.map((key, i) => <li key={key}><button type="button" disabled={busy} aria-current={step === key ? "step" : undefined} onClick={() => navigate(key)}><span>{i < index ? "✓" : i + 1}</span><b>{t(`novel.setup.step.${key}`)}</b></button></li>)}</ol>}
      {(submitError || validation || dataError) && <div role="alert" className="novel-validation">{submitError || (validation ? t(validation) : t("novel.setup.dataError"))}{dataError && <details><summary>{t("novel.setup.errorDetails")}</summary>{dataError}</details>}</div>}
      <form id={formId} ref={formRef} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <fieldset disabled={busy}>
          {step === "story" && <NovelStoryStep {...fields} title={title} setTitle={(value) => { setTitle(value); setValidation(null); }} characters={characters} editing={editing} />}
          {step === "generation" && <NovelNarratorStep {...fields} providers={providers} models={models} modelLoading={modelLoading} modelError={modelError} dataLoading={dataLoading} onProviderSettings={openProviderSettings} />}
          {step === "visuals" && <NovelVisualsStep {...fields} />}
          {step === "review" && <NovelSetupReview title={title} config={config} characters={characters} providers={providers} onEdit={navigate} />}
        </fieldset>
      </form>
    </div>
  </ModalShell>;
}
