import { useI18n } from "../../../shared/i18n";
import type { NovelConfig } from "../../../shared/types/novels";
import type { ProviderProfile, ProviderModel } from "../../../shared/types/contracts";
import { NovelNumberField, type SetupFieldsProps } from "./SetupFields";
export function NovelNarratorStep({ config, patch, providers, models, modelLoading, modelError, dataLoading, onProviderSettings }: SetupFieldsProps & {
  providers: ProviderProfile[]; models: ProviderModel[]; modelLoading: boolean; modelError: string; dataLoading: boolean; onProviderSettings: () => void;
}) {
  const { t } = useI18n(); const props = { config, patch };
  return <>
    <div className="novel-step-intro"><h2>{t("novel.setup.narratorHeading")}</h2><p>{t("novel.setup.narratorHint")}</p></div>
    {!dataLoading && !providers.length ? <div className="novel-connection-help"><h3>{t("novel.setup.noProviders")}</h3><p>{t("novel.setup.noProvidersHint")}</p><button type="button" className="novel-primary" onClick={onProviderSettings}>{t("novel.setup.connectProvider")}</button></div> : <>
      <div className="novel-form-grid">
        <label className="novel-field"><span>{t("settings.provider")}</span><select aria-label={t("settings.provider")} disabled={dataLoading} value={config.providerId} onChange={(e) => patch({ providerId: e.target.value, modelId: "" })}><option value="">{t(dataLoading ? "chat.loading" : "settings.selectProvider")}</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="novel-field"><span>{t("chat.model")}</span><input aria-label={t("chat.model")} list="novel-models" disabled={!config.providerId} value={config.modelId} placeholder={t(modelLoading ? "chat.loading" : "settings.selectModel")} onChange={(e) => patch({ modelId: e.target.value })} /><datalist id="novel-models">{models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</datalist></label>
      </div>
      {modelError ? <div className="novel-hint" role="status">{t("novel.setup.modelListError")}<details><summary>{t("novel.setup.errorDetails")}</summary>{modelError}</details></div> : <p className="novel-hint">{t("novel.setup.modelHint")}</p>}
    </>}
    <div className="novel-form-grid novel-narration-options">
      <label className="novel-field"><span>{t("novel.pov")}</span><select aria-label={t("novel.pov")} value={config.pov} onChange={(e) => patch({ pov: e.target.value as NovelConfig["pov"] })}>{(["first", "second", "third", "dynamic"] as const).map((v) => <option key={v} value={v}>{t(`novel.pov.${v}`)}</option>)}</select><p>{t(`novel.setup.povHint.${config.pov}`)}</p></label>
      <label className="novel-field"><span>{t("novel.questions")}</span><select aria-label={t("novel.questions")} value={config.questionFrequency} onChange={(e) => patch({ questionFrequency: e.target.value as NovelConfig["questionFrequency"] })}>{(["off", "rare", "balanced", "frequent"] as const).map((v) => <option key={v} value={v}>{t(`novel.frequency.${v}`)}</option>)}</select><p>{t("novel.setup.questionHint")}</p></label>
      <label className="novel-field"><span>{t("novel.language")}</span><input aria-label={t("novel.language")} value={config.language} onChange={(e) => patch({ language: e.target.value })} /></label>
      <NovelNumberField {...props} name="scenesPerTurn" label="novel.batch" min={1} max={5} />
    </div>
    <details className="novel-advanced"><summary>{t("novel.setup.advancedGeneration")}</summary>
      <label className="novel-field"><span>{t("novel.viewpoint")}</span><input value={config.povCharacter} onChange={(e) => patch({ povCharacter: e.target.value })} placeholder={t("novel.viewpointHint")} /></label>
      <div className="novel-form-grid"><NovelNumberField {...props} name="maxTokens" label="novel.maxTokens" min={1000} max={16000} /><NovelNumberField {...props} name="contextChars" label="novel.context" min={8000} max={120000} /></div>
      <p className="novel-hint">{t("novel.cacheHint")}</p>
    </details>
  </>;
}
