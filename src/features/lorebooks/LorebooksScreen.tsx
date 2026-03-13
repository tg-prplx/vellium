import { useEffect, useMemo, useRef, useState } from "react";
import { ThreePanelLayout, PanelTitle, EmptyState } from "../../components/Panels";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type { LoreBook, LoreBookEntry } from "../../shared/types/contracts";

const POSITION_OPTIONS = [
  "after_char",
  "before_char",
  "after_scene",
  "before_scene",
  "after_system",
  "before_system",
  "after_jailbreak",
  "before_jailbreak"
] as const;

function splitKeys(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinKeys(keys: string[]): string {
  return keys.join(", ");
}

function newEntry(index: number): LoreBookEntry {
  return {
    id: `entry-${Date.now()}-${index}`,
    name: "",
    keys: [],
    content: "",
    enabled: true,
    constant: false,
    position: "after_char",
    insertionOrder: (index + 1) * 100
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read export blob"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.readAsDataURL(blob);
  });
}

async function triggerBlobDownload(blob: Blob, filename: string) {
  if (window.electronAPI?.saveFile) {
    const base64Data = await blobToBase64(blob);
    const saved = await window.electronAPI.saveFile(filename, base64Data);
    if (!saved.canceled && saved.ok) return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildFilenameBase(raw: string, fallback: string): string {
  return String(raw || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "") || fallback;
}

export function LorebooksScreen() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [lorebooks, setLorebooks] = useState<LoreBook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoreBook | null>(null);
  const [saving, setSaving] = useState(false);
  const [translatingCopy, setTranslatingCopy] = useState(false);
  const [status, setStatus] = useState("");
  const [entryKeysInput, setEntryKeysInput] = useState<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const list = await api.lorebookList();
        setLorebooks(list);
        if (list[0]) {
          setSelectedId(list[0].id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    const current = lorebooks.find((item) => item.id === selectedId) || null;
    if (!current) {
      setDraft(null);
      setEntryKeysInput({});
      return;
    }
    const nextDraft = {
      ...current,
      entries: (current.entries || []).map((entry) => ({ ...entry, keys: [...entry.keys] }))
    };
    setDraft(nextDraft);
    setEntryKeysInput(
      Object.fromEntries(
        nextDraft.entries.map((entry) => [entry.id, joinKeys(entry.keys)])
      )
    );
  }, [selectedId, lorebooks]);

  const selected = useMemo(
    () => lorebooks.find((item) => item.id === selectedId) || null,
    [lorebooks, selectedId]
  );

  async function refreshLorebooks(nextSelectedId?: string | null) {
    const list = await api.lorebookList();
    setLorebooks(list);
    if (nextSelectedId) {
      setSelectedId(nextSelectedId);
      return;
    }
    if (!selectedId && list[0]) {
      setSelectedId(list[0].id);
    }
    if (selectedId && !list.find((item) => item.id === selectedId)) {
      setSelectedId(list[0]?.id || null);
    }
  }

  async function createLorebook() {
    const created = await api.lorebookCreate({
      name: t("lore.newBookName"),
      description: "",
      entries: [newEntry(0)]
    });
    await refreshLorebooks(created.id);
    setStatus(t("lore.statusCreated"));
  }

  async function importWorldInfoFile(file: File) {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const imported = await api.lorebookImportWorldInfo(parsed);
      await refreshLorebooks(imported.id);
      setStatus(t("lore.statusImported"));
    } catch (error) {
      setStatus(`${t("lore.statusImportFailed")} ${error instanceof Error ? error.message : ""}`.trim());
    }
  }

  async function saveLorebook() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload: Partial<LoreBook> = {
        name: draft.name,
        description: draft.description,
        entries: (draft.entries || []).map((entry) => ({
          ...entry,
          position: entry.position || "after_char",
          insertionOrder: Number.isFinite(entry.insertionOrder) ? Math.floor(entry.insertionOrder) : 100
        }))
      };
      const updated = await api.lorebookUpdate(draft.id, payload);
      setLorebooks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDraft(updated);
      setStatus(t("lore.statusSaved"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteLorebook(id: string) {
    await api.lorebookDelete(id);
    await refreshLorebooks(null);
    setStatus(t("lore.statusDeleted"));
  }

  async function translateLorebookCopy() {
    if (!selected || translatingCopy) return;
    setTranslatingCopy(true);
    try {
      const copied = await api.lorebookTranslateCopy(selected.id);
      await refreshLorebooks(copied.id);
      setStatus(`${t("lore.statusTranslated")}: ${copied.name}`);
    } catch (error) {
      setStatus(`${t("lore.statusTranslateFailed")} ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      setTranslatingCopy(false);
    }
  }

  async function exportLorebookWorldInfo() {
    if (!selected) return;
    try {
      const blob = await api.lorebookExportWorldInfo(selected.id);
      await triggerBlobDownload(blob, `${buildFilenameBase(selected.name, "lorebook")}_world_info.json`);
      setStatus(t("lore.statusExported"));
    } catch (error) {
      setStatus(`${t("lore.statusExportFailed")} ${error instanceof Error ? error.message : ""}`.trim());
    }
  }

  function updateEntry(entryId: string, patch: Partial<LoreBookEntry>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entries: prev.entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry))
      };
    });
  }

  function addEntry() {
    setDraft((prev) => {
      if (!prev) return prev;
      const entry = newEntry(prev.entries.length);
      setEntryKeysInput((current) => ({ ...current, [entry.id]: "" }));
      return {
        ...prev,
        entries: [...prev.entries, entry]
      };
    });
  }

  function removeEntry(entryId: string) {
    setEntryKeysInput((prev) => {
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entries: prev.entries.filter((entry) => entry.id !== entryId)
      };
    });
  }

  return (
    <ThreePanelLayout
      left={
        <>
          <PanelTitle
            action={
              <div className="flex items-center gap-1.5">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    void importWorldInfoFile(file);
                  }}
                />
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-bg-hover"
                  title={t("lore.importWorldInfo")}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </button>
                <button
                  onClick={() => { void createLorebook(); }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-text-inverse shadow-sm hover:bg-accent-hover"
                >
                  + {t("chat.new")}
                </button>
              </div>
            }
          >
            {t("tab.lorebooks")}
          </PanelTitle>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-text-tertiary">
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              {t("lore.loading")}
            </div>
          ) : lorebooks.length === 0 ? (
            <EmptyState title={t("lore.emptyTitle")} description={t("lore.emptyDesc")} />
          ) : (
            <div className="space-y-1">
              {lorebooks.map((book) => (
                <button
                  key={book.id}
                  onClick={() => setSelectedId(book.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all ${
                    selectedId === book.id
                      ? "border-accent-border bg-accent-subtle shadow-sm"
                      : "border-transparent hover:border-border-subtle hover:bg-bg-hover"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                      selectedId === book.id
                        ? "bg-accent text-text-inverse"
                        : "bg-bg-tertiary text-text-tertiary"
                    }`}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">{book.name}</div>
                      <div className="mt-0.5 text-[10px] text-text-tertiary">{book.entries.length} {t("lore.entriesCount")}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      }
      center={
        draft ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto">
            {/* Book info card */}
            <div className="rounded-xl border border-border-subtle bg-bg-primary p-4">
              <div className="mb-3 flex items-center gap-2">
                <svg className="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span className="text-xs font-semibold text-text-primary">{t("lore.name")}</span>
              </div>
              <input
                value={draft.name}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                className="w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent-subtle"
              />
              <label className="mb-1 mt-3 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{t("lore.description")}</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                className="h-20 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5 text-xs leading-relaxed text-text-primary placeholder:italic focus:border-accent focus:ring-1 focus:ring-accent-subtle"
              />
            </div>

            {/* Entries */}
            <div className="rounded-xl border border-border-subtle bg-bg-primary">
              <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("lore.entries")}</span>
                  <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-bold text-text-tertiary">{draft.entries.length}</span>
                </div>
                <button
                  onClick={addEntry}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent-border hover:bg-accent-subtle hover:text-accent"
                >
                  + {t("lore.entry")}
                </button>
              </div>

              <div className="divide-y divide-border-subtle">
                {draft.entries.map((entry, index) => (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                          entry.enabled ? "bg-accent-subtle text-accent" : "bg-bg-tertiary text-text-tertiary"
                        }`}>{index + 1}</span>
                        <span className="text-xs font-medium text-text-primary">{entry.name || `${t("lore.entry")} ${index + 1}`}</span>
                        {entry.constant && (
                          <span className="rounded-md bg-warning-subtle px-1.5 py-0.5 text-[9px] font-semibold text-warning">CONST</span>
                        )}
                        {!entry.enabled && (
                          <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold text-text-tertiary">OFF</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="rounded-lg px-2 py-1 text-[11px] text-danger/60 transition-colors hover:bg-danger-subtle hover:text-danger"
                      >
                        {t("chat.delete")}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{t("lore.keys")}</label>
                        <input
                          value={entryKeysInput[entry.id] ?? joinKeys(entry.keys)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEntryKeysInput((prev) => ({ ...prev, [entry.id]: raw }));
                            updateEntry(entry.id, { keys: splitKeys(raw) });
                          }}
                          placeholder="key1, key2, ..."
                          className="w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary/50 focus:border-accent focus:ring-1 focus:ring-accent-subtle"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{t("lore.position")}</label>
                        <select
                          value={entry.position || "after_char"}
                          onChange={(e) => updateEntry(entry.id, { position: e.target.value })}
                          className="w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent-subtle"
                        >
                          {POSITION_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{t("lore.insertionOrder")}</label>
                        <input
                          type="number"
                          value={entry.insertionOrder}
                          onChange={(e) => updateEntry(entry.id, { insertionOrder: Number(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent-subtle"
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                          <span className="text-[10px] font-medium text-text-secondary">{t("lore.enabled")}</span>
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })}
                          />
                        </label>
                        <label className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                          <span className="text-[10px] font-medium text-text-secondary">{t("lore.constant")}</span>
                          <input
                            type="checkbox"
                            checked={entry.constant}
                            onChange={(e) => updateEntry(entry.id, { constant: e.target.checked })}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-2">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{t("lore.content")}</label>
                      <textarea
                        value={entry.content}
                        onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                        className="h-28 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5 text-xs leading-relaxed text-text-primary focus:border-accent focus:ring-1 focus:ring-accent-subtle"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action bar */}
            <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-bg-primary/95 px-4 py-3 backdrop-blur-sm">
              <button
                onClick={() => { void saveLorebook(); }}
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-text-inverse shadow-sm hover:bg-accent-hover disabled:opacity-60"
              >
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    {t("lore.saving")}
                  </span>
                ) : t("lore.save")}
              </button>
              {selected && (
                <button
                  onClick={() => { void translateLorebookCopy(); }}
                  disabled={translatingCopy}
                  className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary hover:border-border hover:bg-bg-hover disabled:opacity-60"
                >
                  {translatingCopy ? t("lore.translating") : t("lore.translateKeysCopy")}
                </button>
              )}
              {selected && (
                <button
                  onClick={() => { void exportLorebookWorldInfo(); }}
                  className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary hover:border-border hover:bg-bg-hover"
                >
                  {t("lore.exportWorldInfo")}
                </button>
              )}
              <div className="flex-1" />
              {selected && (
                <button
                  onClick={() => { void deleteLorebook(selected.id); }}
                  className="rounded-lg border border-danger-border/50 px-3 py-2 text-xs font-medium text-danger/70 transition-colors hover:border-danger-border hover:bg-danger-subtle hover:text-danger"
                >
                  {t("lore.deleteBook")}
                </button>
              )}
              {status && <span className="text-[11px] text-text-tertiary">{status}</span>}
            </div>
          </div>
        ) : (
          <EmptyState title={t("lore.selectTitle")} description={t("lore.selectDesc")} />
        )
      }
      right={
        <div className="space-y-3 text-xs text-text-secondary">
          <PanelTitle>{t("lore.howItWorks")}</PanelTitle>
          <div className="rounded-xl border border-border-subtle bg-bg-primary p-3.5 leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-text-primary">
              <svg className="h-3.5 w-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t("lore.supportedFields")}
            </div>
            <div className="text-text-tertiary">{t("lore.supportedFieldsDesc")}</div>
          </div>
          <div className="rounded-xl border border-border-subtle bg-bg-primary p-3.5 leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-text-primary">
              <svg className="h-3.5 w-3.5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {t("lore.triggerLogic")}
            </div>
            <div className="text-text-tertiary">{t("lore.triggerLogicDesc")}</div>
          </div>
          <div className="rounded-xl border border-border-subtle bg-bg-primary p-3.5 leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-text-primary">
              <svg className="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {t("lore.importSource")}
            </div>
            <div className="text-text-tertiary">{t("lore.importSourceDesc")} <code className="rounded bg-bg-tertiary px-1 py-0.5 text-[10px] font-medium text-text-secondary">character_book</code>.</div>
          </div>
        </div>
      }
    />
  );
}
