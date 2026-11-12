import { useState } from "react";
import { useI18n } from "../../../shared/i18n";
import type { CharacterDetail } from "../../../shared/types/contracts";
import { NovelTextField, type SetupFieldsProps } from "./SetupFields";
export function NovelStoryStep({ config, patch, title, setTitle, characters, editing }: SetupFieldsProps & {
  title: string; setTitle: (value: string) => void; characters: CharacterDetail[]; editing: boolean;
}) {
  const { t } = useI18n(); const [chooseCast, setChooseCast] = useState(config.characterIds.length > 0);
  const [search, setSearch] = useState("");
  const props = { config, patch };
  const filtered = characters.filter((c) => c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <>
    <div className="novel-step-intro"><h2>{t("novel.setup.storyHeading")}</h2><p>{t("novel.setup.storyHint")}</p></div>
    <NovelTextField {...props} name="premise" label="novel.premise" rows={4} placeholder="novel.setup.premisePlaceholder" />
    {!config.premise.trim() && <div className="novel-idea-seeds"><span>{t("novel.setup.tryIdea")}</span>{(["mystery", "journey", "everyday"] as const).map((key) => <button key={key} type="button" onClick={() => patch({ premise: t(`novel.setup.seed.${key}`) })}>{t(`novel.setup.genre.${key}`)}</button>)}</div>}
    <label className="novel-field"><span>{t("novel.title")} <small>{t("novel.setup.optional")}</small></span><input aria-label={t("novel.title")} maxLength={160} value={title} placeholder={t("novel.setup.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} /></label>
    <section className="novel-cast-section"><h3>{t("novel.cast")}</h3>
      {editing ? <p className="novel-hint">{t("novel.castLocked")}</p> : <div className="novel-choice-modes" role="group" aria-label={t("novel.cast")}>
        <button type="button" aria-pressed={!chooseCast} onClick={() => { setChooseCast(false); patch({ characterIds: [] }); }}><b>{t("novel.setup.castAuto")}</b><span>{t("novel.setup.castAutoHint")}</span></button>
        <button type="button" aria-pressed={chooseCast} onClick={() => setChooseCast(true)}><b>{t("novel.setup.castLibrary")}</b><span>{t("novel.setup.castLibraryHint")}</span></button>
      </div>}
      {(chooseCast || editing) && <>
        {characters.length > 5 && <input className="novel-search" aria-label={t("novel.setup.searchCast")} placeholder={t("novel.setup.searchCast")} value={search} onChange={(e) => setSearch(e.target.value)} />}
        <div className="novel-cast-picker">{filtered.map((c) => <label key={c.id}><input type="checkbox" checked={config.characterIds.includes(c.id)} disabled={editing || (!config.characterIds.includes(c.id) && config.characterIds.length >= 12)} onChange={(e) => patch({ characterIds: e.target.checked ? [...config.characterIds, c.id] : config.characterIds.filter((id) => id !== c.id) })} />{c.name}</label>)}
          {!characters.length && <p>{t("novel.noCharacters")}</p>}{characters.length > 0 && !filtered.length && <p>{t("novel.setup.noCastMatches")}</p>}
        </div>
        <p className="novel-hint">{config.characterIds.length ? `${config.characterIds.length} / 12 · ${t("novel.setup.castSnapshot")}` : t("novel.setup.castEmpty")}</p>
      </>}
    </section>
    <details className="novel-advanced" open={editing || undefined}><summary>{t("novel.setup.storyDetails")}</summary>
      <NovelTextField {...props} name="protagonist" label="novel.protagonist" placeholder="novel.setup.protagonistPlaceholder" />
      <NovelTextField {...props} name="tone" label="novel.tone" placeholder="novel.setup.tonePlaceholder" />
      <NovelTextField {...props} name="direction" label="novel.direction" />
    </details>
  </>;
}
