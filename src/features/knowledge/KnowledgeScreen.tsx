import { useEffect, useMemo, useRef, useState } from "react";
import { ThreePanelLayout, PanelTitle, EmptyState } from "../../components/Panels";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type { RagCollection, RagDocument } from "../../shared/types/contracts";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask,
  useBackgroundTasks
} from "../../shared/backgroundTasks";

export function KnowledgeScreen() {
  const { t } = useI18n();
  const backgroundTasks = useBackgroundTasks();
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCollection, setSavingCollection] = useState(false);
  const [mutatingCollection, setMutatingCollection] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [status, setStatus] = useState("");

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftScope, setDraftScope] = useState<"global" | "chat" | "writer">("global");
  const [docTitle, setDocTitle] = useState("");
  const [docText, setDocText] = useState("");
  const documentsRequestIdRef = useRef(0);

  const selectedCollection = useMemo(
    () => collections.find((item) => item.id === selectedId) || null,
    [collections, selectedId]
  );
  const ingestBusy = ingesting || backgroundTasks.some((task) => (
    task.scope === "knowledge" && task.type === "ingest" && task.status === "running"
  ));

  function setErrorStatus(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    setStatus(text || "Operation failed");
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const list = await api.ragCollectionList();
        setCollections(list);
        if (list[0]) setSelectedId(list[0].id);
      } catch (error) {
        setErrorStatus(error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedCollection) {
      documentsRequestIdRef.current += 1;
      setDraftName("");
      setDraftDescription("");
      setDraftScope("global");
      setDocuments([]);
      return;
    }
    setDraftName(selectedCollection.name);
    setDraftDescription(selectedCollection.description || "");
    setDraftScope(selectedCollection.scope || "global");
    setDocuments([]);
    void refreshDocuments(selectedCollection.id).catch(setErrorStatus);
  }, [selectedCollection?.id]);

  async function refreshCollections(nextSelectedId?: string | null) {
    const list = await api.ragCollectionList();
    setCollections(list);
    setSelectedId((current) => {
      if (typeof nextSelectedId === "string" && list.some((item) => item.id === nextSelectedId)) {
        return nextSelectedId;
      }
      if (current && list.some((item) => item.id === current)) return current;
      return list[0]?.id || null;
    });
  }

  async function refreshDocuments(collectionId: string) {
    const requestId = ++documentsRequestIdRef.current;
    const list = await api.ragDocumentList(collectionId);
    if (requestId === documentsRequestIdRef.current) setDocuments(list);
  }

  async function createCollection() {
    if (mutatingCollection) return;
    setMutatingCollection(true);
    try {
      const created = await api.ragCollectionCreate({
        name: t("knowledge.newCollectionDefault"),
        description: "",
        scope: "global"
      });
      await refreshCollections(created.id);
      setStatus(t("knowledge.collectionCreated"));
    } catch (error) {
      setErrorStatus(error);
    } finally {
      setMutatingCollection(false);
    }
  }

  async function saveCollection() {
    if (!selectedCollection) return;
    setSavingCollection(true);
    try {
      await api.ragCollectionUpdate(selectedCollection.id, {
        name: draftName.trim() || selectedCollection.name,
        description: draftDescription,
        scope: draftScope
      });
      await refreshCollections(selectedCollection.id);
      setStatus(t("knowledge.collectionSaved"));
    } catch (error) {
      setErrorStatus(error);
    } finally {
      setSavingCollection(false);
    }
  }

  async function removeCollection() {
    if (!selectedCollection || mutatingCollection) return;
    if (!confirm(t("knowledge.confirmDeleteCollection"))) return;
    setMutatingCollection(true);
    try {
      await api.ragCollectionDelete(selectedCollection.id);
      await refreshCollections(null);
      setStatus(t("knowledge.collectionDeleted"));
    } catch (error) {
      setErrorStatus(error);
    } finally {
      setMutatingCollection(false);
    }
  }

  async function ingestDocument() {
    if (!selectedCollection || ingestBusy) return;
    const text = docText.trim();
    if (!text) return;
    setIngesting(true);
    const taskId = startBackgroundTask({
      scope: "knowledge",
      type: "ingest",
      label: t("knowledge.ingesting")
    });
    try {
      await api.ragIngestDocument(selectedCollection.id, {
        title: docTitle.trim() || t("knowledge.untitledDocument"),
        text,
        sourceType: "manual"
      });
      setDocText("");
      setDocTitle("");
      await refreshDocuments(selectedCollection.id);
      setStatus(t("knowledge.documentIngested"));
      finishBackgroundTask(taskId, t("knowledge.documentIngested"));
    } catch (error) {
      failBackgroundTask(taskId, error instanceof Error ? error.message : String(error));
      setErrorStatus(error);
    } finally {
      setIngesting(false);
    }
  }

  async function removeDocument(documentId: string) {
    try {
      await api.ragDocumentDelete(documentId);
      if (selectedCollection) await refreshDocuments(selectedCollection.id);
    } catch (error) {
      setErrorStatus(error);
    }
  }

  return (
    <ThreePanelLayout
      className="knowledge-workspace"
      leftClassName="knowledge-library-panel"
      centerClassName="knowledge-editor-panel"
      rightClassName="knowledge-help-panel"
      left={
        <>
          <PanelTitle
            action={(
              <button
                onClick={() => { void createCollection(); }}
                disabled={mutatingCollection}
                className="knowledge-primary-action rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover"
              >
                + {t("chat.new")}
              </button>
            )}
          >
            {t("knowledge.title")}
          </PanelTitle>
          {loading ? (
            <div className="text-xs text-text-tertiary">{t("knowledge.loading")}</div>
          ) : collections.length === 0 ? (
            <EmptyState title={t("knowledge.emptyTitle")} description={t("knowledge.emptyDesc")} />
          ) : (
            <div className="space-y-1">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  onClick={() => setSelectedId(collection.id)}
                  className={`knowledge-collection-item ${
                    selectedId === collection.id
                      ? "is-active"
                      : ""
                  }`}
                >
                  <div className="truncate text-sm font-medium text-text-primary">{collection.name}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{collection.scope}</div>
                </button>
              ))}
            </div>
          )}
        </>
      }
      center={
        selectedCollection ? (
          <div className="knowledge-editor-scroll">
            <div className="knowledge-editor-section knowledge-collection-section">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("knowledge.collectionName")}</label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
              />
              <label className="mb-1 mt-3 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("knowledge.collectionDescription")}</label>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="h-20 w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
              />
              <label className="mb-1 mt-3 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("knowledge.scope")}</label>
              <select
                value={draftScope}
                onChange={(e) => setDraftScope(e.target.value as "global" | "chat" | "writer")}
                className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
              >
                <option value="global">{t("knowledge.scopeGlobal")}</option>
                <option value="chat">{t("knowledge.scopeChat")}</option>
                <option value="writer">{t("knowledge.scopeWriter")}</option>
              </select>
              <div className="knowledge-section-actions mt-3 flex items-center gap-2">
                <button
                  onClick={() => { void saveCollection(); }}
                  disabled={savingCollection || mutatingCollection}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                >
                  {t("knowledge.saveCollection")}
                </button>
                <button
                  onClick={() => { void removeCollection(); }}
                  disabled={mutatingCollection || savingCollection}
                  className="rounded-lg border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle"
                >
                  {t("knowledge.deleteCollection")}
                </button>
              </div>
            </div>

            <div className="knowledge-editor-section knowledge-ingest-section">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("knowledge.ingestText")}</div>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={t("knowledge.documentTitlePlaceholder")}
                className="mb-2 w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
              />
              <textarea
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder={t("knowledge.documentTextPlaceholder")}
                className="h-40 w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
              />
              <div className="mt-2">
                <button
                  onClick={() => { void ingestDocument(); }}
                  disabled={ingestBusy || !docText.trim()}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                >
                  {ingestBusy ? t("knowledge.ingesting") : t("knowledge.ingest")}
                </button>
              </div>
            </div>

            <div className="knowledge-editor-section knowledge-documents-section">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("knowledge.documents")}</div>
              {documents.length === 0 ? (
                <div className="text-xs text-text-tertiary">{t("knowledge.noDocuments")}</div>
              ) : (
                <div className="space-y-2">
                  {documents.map((document) => (
                    <div key={document.id} className="knowledge-document-row flex items-center justify-between gap-3 rounded-md border border-border bg-bg-secondary px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-text-primary">{document.title}</div>
                        <div className="text-[10px] text-text-tertiary">{document.status}</div>
                      </div>
                      <button
                        onClick={() => { void removeDocument(document.id); }}
                        className="rounded-md px-2 py-1 text-[11px] text-danger/70 hover:bg-danger-subtle hover:text-danger"
                      >
                        {t("chat.delete")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title={t("knowledge.selectCollection")} description={t("knowledge.selectCollectionDesc")} />
        )
      }
      right={
        <div className="knowledge-help-content space-y-3 text-xs text-text-secondary">
          <PanelTitle>{t("knowledge.howItWorks")}</PanelTitle>
          <div className="knowledge-help-card rounded-lg border border-border-subtle bg-bg-primary p-3 leading-relaxed">
            <div className="font-medium text-text-primary">{t("knowledge.howItWorksLexical")}</div>
            <div className="mt-1">{t("knowledge.howItWorksLexicalDesc")}</div>
          </div>
          <div className="knowledge-help-card rounded-lg border border-border-subtle bg-bg-primary p-3 leading-relaxed">
            <div className="font-medium text-text-primary">{t("knowledge.howItWorksVector")}</div>
            <div className="mt-1">{t("knowledge.howItWorksVectorDesc")}</div>
          </div>
          {status && (
            <div className="rounded-lg border border-border-subtle bg-bg-primary p-3 text-[11px] text-text-tertiary">{status}</div>
          )}
        </div>
      }
    />
  );
}
