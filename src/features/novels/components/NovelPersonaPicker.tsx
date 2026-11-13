import { useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { UserPersona } from "../../../shared/types/contracts";
import type { SetupFieldsProps } from "./SetupFields";

/** The protagonist can be a user persona. A new story starts with the default
 * persona; "" keeps the free-text protagonist field. */
export function NovelPersonaPicker({ config, patch, editing }: SetupFieldsProps & { editing: boolean }) {
  const { t } = useI18n();
  const [personas, setPersonas] = useState<UserPersona[] | null>(null);
  const [error, setError] = useState("");
  const initial = useRef(config.personaId);
  useEffect(() => {
    let cancelled = false;
    api.personaList().then((list) => { if (!cancelled) setPersonas(list); }).catch((e) => { if (!cancelled) { setPersonas([]); setError(String(e)); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (editing || config.personaId !== undefined || !personas) return;
    const preferred = personas.find((p) => p.isDefault);
    patch({ personaId: preferred?.id || "" });
  }, [personas, editing, config.personaId, patch]);
  const value = config.personaId || "";
  const missing = Boolean(value) && personas !== null && !personas.some((p) => p.id === value);
  return <label className="novel-field"><span>{t("novel.persona")}</span>
    <select aria-label={t("novel.persona")} disabled={!personas} value={value} onChange={(e) => patch({ personaId: e.target.value })}>
      <option value="">{t("novel.personaManual")}</option>
      {missing && <option value={value}>{t("novel.personaSaved")}</option>}
      {(personas || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    <p>{error ? error : personas && !personas.length ? t("novel.personaNone") : t("novel.personaHint")}</p>
    {editing && value !== (initial.current || "") && <p role="status">{t("novel.personaChangeHint")}</p>}
  </label>;
}
