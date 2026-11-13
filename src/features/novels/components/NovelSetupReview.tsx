import { useI18n } from "../../../shared/i18n";
import type { CharacterDetail, ProviderProfile } from "../../../shared/types/contracts";
import type { NovelConfig } from "../../../shared/types/novels";
import type { NovelSetupStep } from "../setup";
export function NovelSetupReview({ title, config, characters, providers, onEdit }: {
  title: string; config: NovelConfig; characters: CharacterDetail[]; providers: ProviderProfile[]; onEdit: (step: NovelSetupStep) => void;
}) {
  const { t } = useI18n();
  return <>
    <div className="novel-step-intro"><span className="novel-eyebrow">{t("novel.setup.readyEyebrow")}</span><h2>{title.trim() || config.premise.trim().slice(0, 60) || characters.find(card=>card.id===config.settingCardIds?.[0])?.name || t("novel.setup.untitled")}</h2><p>{t("novel.setup.reviewHint")}</p></div>
    <dl className="novel-setup-summary">
      <div><dt>{t("novel.premise")}</dt><dd className="novel-review-premise">{config.premise||t("novel.worldPremiseOnly")}</dd><button type="button" onClick={() => onEdit("story")}>{t("chat.edit")}</button></div>
      {Boolean(config.settingCardIds?.length)&&<div><dt>{t("novel.worldCards")}</dt><dd>{config.settingCardIds!.map(id=>characters.find(card=>card.id===id)?.name||t("novel.worldCardSaved")).join(", ")}</dd><button type="button" onClick={()=>onEdit("story")}>{t("chat.edit")}</button></div>}
      <div><dt>{t("novel.cast")}</dt><dd>{config.characterIds.length ? config.characterIds.map((id) => characters.find((c) => c.id === id)?.name || id).join(", ") : t("novel.setup.castAuto")}</dd><button type="button" onClick={() => onEdit("story")}>{t("chat.edit")}</button></div>
      <div><dt>{t("novel.generation")}</dt><dd>{providers.find((p) => p.id === config.providerId)?.name || config.providerId}<small>{config.modelId}</small></dd><button type="button" onClick={() => onEdit("generation")}>{t("chat.edit")}</button></div>
      <div><dt>{t("novel.pov")}</dt><dd>{t(`novel.pov.${config.pov}`)}<small>{config.language} · {t(`novel.frequency.${config.questionFrequency}`)}</small></dd><button type="button" onClick={() => onEdit("generation")}>{t("chat.edit")}</button></div>
      <div><dt>{t("novel.visuals")}</dt><dd>{t(config.imagesEnabled ? "novel.setup.withImages" : "novel.setup.textOnly")}{config.imagesEnabled && <small>{t(`novel.imagePov.${config.imagePov||"dynamic"}`)} · {t("novel.setup.framesUpTo").replace("{count}", String(config.imagesPerScene))} · {config.width} × {config.height}</small>}</dd><button type="button" onClick={() => onEdit("visuals")}>{t("chat.edit")}</button></div>
    </dl>
    <p className="novel-start-explanation">{t("novel.setup.startHint")}</p>
  </>;
}
