import { useEffect, useState } from "react";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { RagCollection } from "../../../shared/types/contracts";
import type { SetupFieldsProps } from "./SetupFields";

/** Knowledge collections searched each turn (Lite mode). Selecting any turns
 * retrieval on; clearing all turns it off. */
export function NovelKnowledgePicker({ config, patch }: SetupFieldsProps) {
  const { t } = useI18n();
  const [collections, setCollections] = useState<RagCollection[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.ragCollectionList().then((list) => { if (!cancelled) setCollections(list); }).catch(() => { if (!cancelled) setCollections([]); });
    return () => { cancelled = true; };
  }, []);
  const ids = config.ragCollectionIds || [];
  const lite = config.generationMode === "lite";
  const toggle = (id: string, on: boolean) => { const next = on ? [...ids, id] : ids.filter((value) => value !== id); patch({ ragCollectionIds: next, ragEnabled: next.length > 0 }); };
  return <details className="novel-advanced" open={ids.length > 0 || undefined}><summary>{t("novel.knowledge")}{ids.length > 0 && ` · ${ids.length}/5`}</summary>
    <p className="novel-hint">{t(lite ? "novel.knowledgeHint" : "novel.knowledgeLiteOnly")}</p>
    <div className="novel-cast-picker">
      {(collections || []).map((c) => <label key={c.id}><input type="checkbox" disabled={!lite || (!ids.includes(c.id) && ids.length >= 5)} checked={ids.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />{c.name}</label>)}
      {collections && !collections.length && <p>{t("novel.knowledgeNone")}</p>}
      {!collections && <p>{t("chat.loading")}</p>}
    </div>
  </details>;
}
