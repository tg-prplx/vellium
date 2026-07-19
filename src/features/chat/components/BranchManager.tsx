import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../../shared/i18n";
import type { BranchNode } from "../../../shared/types/contracts";

interface BranchManagerProps {
  branches: BranchNode[];
  activeBranchId: string | null;
  disabled?: boolean;
  simple?: boolean;
  onSelect: (branchId: string) => void;
  onRename: (branchId: string, name: string) => Promise<void>;
  onDelete: (branchId: string) => Promise<void>;
}

export function BranchManager({ branches, activeBranchId, disabled, simple, onSelect, onRename, onDelete }: BranchManagerProps) {
  const { t } = useI18n();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) detailsRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function beginRename(branch: BranchNode) {
    setEditingId(branch.id);
    setDraftName(branch.name);
  }

  async function submitRename(event: FormEvent, branchId: string) {
    event.preventDefault();
    const name = draftName.replace(/\s+/g, " ").trim();
    if (!name) return;
    setBusyId(branchId);
    try {
      await onRename(branchId, name);
      setEditingId(null);
    } catch {
      // The screen-level error banner explains the API failure.
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(branch: BranchNode) {
    if (branches.length <= 1 || !window.confirm(t("chat.confirmDeleteBranch").replace("{name}", branch.name))) return;
    setBusyId(branch.id);
    try {
      await onDelete(branch.id);
      setEditingId(null);
    } catch {
      // The screen-level error banner explains the API failure.
    } finally {
      setBusyId(null);
    }
  }

  if (!activeBranch) return null;

  return (
    <details ref={detailsRef} className="relative">
      <summary
        aria-label={t("chat.manageBranches")}
        aria-disabled={disabled || undefined}
        title={t("chat.manageBranches")}
        onClick={(event) => { if (disabled) event.preventDefault(); }}
        className={`flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary transition hover:border-accent/50 hover:text-text-primary [&::-webkit-details-marker]:hidden ${simple ? "bg-bg-primary" : "bg-bg-secondary"} ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M6 3v6a4 4 0 004 4h8M6 9l4-4M6 9L2 5m16 4v10m0 0l-4-4m4 4l4-4" /></svg>
        <span className="max-w-32 truncate">{activeBranch.name}</span>
        <span className="rounded bg-bg-tertiary px-1 text-[9px] text-text-tertiary">{branches.length}</span>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </summary>

      <div className="absolute left-0 top-[calc(100%+0.4rem)] z-50 w-72 overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <div className="border-b border-border-subtle px-3 py-2">
          <div className="text-xs font-semibold text-text-primary">{t("chat.manageBranches")}</div>
          <div className="mt-0.5 text-[10px] text-text-tertiary">{t("chat.manageBranchesDesc")}</div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {branches.map((branch) => {
            const active = branch.id === activeBranchId;
            const busy = busyId === branch.id;
            return (
              <div key={branch.id} className={`group flex min-w-0 items-center gap-1 rounded-lg p-1 ${active ? "bg-accent/10" : "hover:bg-bg-tertiary"}`}>
                {editingId === branch.id ? (
                  <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { void submitRename(event, branch.id); }}>
                    <input autoFocus maxLength={80} value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 rounded-md border border-accent bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none" aria-label={t("chat.branchName")} />
                    <button type="submit" disabled={busy || !draftName.trim()} className="rounded p-1 text-success hover:bg-bg-primary disabled:opacity-40" title={t("chat.save")} aria-label={t("chat.save")}><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded p-1 text-text-tertiary hover:bg-bg-primary" title={t("chat.cancel")} aria-label={t("chat.cancel")}><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </form>
                ) : (
                  <>
                    <button type="button" onClick={() => { onSelect(branch.id); detailsRef.current?.removeAttribute("open"); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-accent" : "border border-text-tertiary"}`} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs text-text-primary">{branch.name}</span><span className="block text-[9px] text-text-tertiary">{branch.parentMessageId ? t("chat.branchFork") : t("chat.branchRoot")}</span></span>
                    </button>
                    <button type="button" disabled={busy} onClick={() => beginRename(branch)} className="rounded p-1.5 text-text-tertiary opacity-70 hover:bg-bg-primary hover:text-text-primary group-hover:opacity-100" title={t("chat.renameBranch")} aria-label={t("chat.renameBranch")}><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM13.5 8.5l3 3" /></svg></button>
                    <button type="button" disabled={busy || branches.length <= 1} onClick={() => { void confirmDelete(branch); }} className="rounded p-1.5 text-text-tertiary opacity-70 hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-25 group-hover:opacity-100" title={branches.length <= 1 ? t("chat.lastBranchHint") : t("chat.deleteBranch")} aria-label={t("chat.deleteBranch")}><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v5m4-5v5" /></svg></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
