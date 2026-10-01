import { useCallback, useEffect, useRef, useState } from "react";
import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../shared/i18n";
import { api } from "../../../shared/api";
import type { ChatContextConfig, ChatContextPreview, ContextSource } from "../../../shared/types/chatContext";
import type { FileAttachment, UserPersona } from "../../../shared/types/contracts";
import type { LiveAvatarControlCapabilities } from "../../../shared/types/inochiAvatar";

interface Props {
  chatId: string;
  branchId: string;
  draft: string;
  attachments: FileAttachment[];
  userPersona: Pick<UserPersona, "name" | "description" | "personality" | "scenario"> | null;
  liveAvatar?: LiveAvatarControlCapabilities | null;
  busy: boolean;
  onClose: () => void;
}

const sourceKeys = {
  instructions: "context.instructions", character: "context.character", persona: "context.persona", scene: "context.scene",
  lore: "context.lore", rag: "context.rag", summary: "context.summary", authorNote: "context.authorNote",
  history: "context.history", attachments: "context.attachments", reasoning: "context.reasoning", formatting: "context.formatting"
} as const satisfies Record<ContextSource, string>;

export function ContextManagerModal({ chatId, branchId, draft, attachments, userPersona, liveAvatar, busy, onClose }: Props) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ChatContextPreview | null>(null);
  const [config, setConfig] = useState<ChatContextConfig>({});
  const [tab, setTab] = useState<"budget" | "history" | "prompt">("budget");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async (syncConfig = false) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError("");
    try {
      const next = await api.chatPreviewContext(chatId, { branchId, draft, attachments, userPersona, liveAvatar }, request.signal);
      if (!request.signal.aborted && mounted.current) {
        setPreview(next);
        if (syncConfig) setConfig({ ...next.config, contextWindowSize: next.effective.contextWindowSize, maxOutputTokens: next.reservedOutputTokens, maxMessages: next.effective.maxMessages, includeReasoning: next.effective.includeReasoning, summary: next.effective.summary });
      }
    } catch (failure) {
      if (!request.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : t("context.failed"));
    } finally { if (!request.signal.aborted && mounted.current) setLoading(false); }
  }, [chatId, branchId, draft, attachments, userPersona, liveAvatar, t]);

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => { mounted.current = false; controller.current?.abort(); };
    // A deliberate refresh captures the current draft; typing never triggers provider work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, branchId]);

  async function save(reset = false) {
    if (saving || busy || loading || (invalid && !reset)) return;
    setSaving(true); setError("");
    try {
      await api.chatUpdateContext(chatId, branchId, config, reset);
      if (mounted.current) await refresh(true);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t("context.failed")); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function compress() {
    if (saving || busy || loading) return;
    setSaving(true); setError("");
    try {
      const result = await api.chatCompressContext(chatId, branchId);
      if (!result.summary) throw new Error(t("context.compressFailed"));
      if (mounted.current) await refresh(true);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t("context.failed")); }
    finally { if (mounted.current) setSaving(false); }
  }
  const invalid = !Number.isFinite(config.contextWindowSize) || Number(config.contextWindowSize) < 512 || Number(config.contextWindowSize) > 2097152 || !Number.isFinite(config.maxOutputTokens) || Number(config.maxOutputTokens) < 1 || Number(config.maxOutputTokens) > 131072 || !Number.isFinite(config.maxMessages) || Number(config.maxMessages) < 0 || Number(config.maxMessages) > 10000;
  const disabled = busy || saving || loading;
  const excluded = new Set(config.excludedMessageIds || []);
  const number = (value: number) => value.toLocaleString();
  const occupied = preview ? Math.min(100, (preview.inputTokens + preview.reservedOutputTokens) / preview.effective.contextWindowSize * 100) : 0;
  const toggleMessage = (id: string) => setConfig(current => ({ ...current, excludedMessageIds: excluded.has(id) ? [...excluded].filter(value => value !== id) : [...excluded, id] }));
  const pending = preview && JSON.stringify({ ...config, excludedMessageIds: config.excludedMessageIds || [] }) !== JSON.stringify({ ...preview.config, contextWindowSize: preview.effective.contextWindowSize, maxOutputTokens: preview.reservedOutputTokens, maxMessages: preview.effective.maxMessages, includeReasoning: preview.effective.includeReasoning, summary: preview.effective.summary, excludedMessageIds: preview.config.excludedMessageIds || [] });

  return <ModalShell title={t("context.title")} description={t("context.description")} size="xl" onClose={onClose} closeDisabled={saving} closeLabel={t("common.close")} bodyClassName="context-manager-body"
    headerActions={<button className="context-button" disabled={loading || saving} onClick={() => { void refresh(); }}>{t("context.refresh")}</button>}
    footer={<div className="context-footer"><span>{invalid && preview ? t("context.invalid") : pending ? t("context.unsaved") : t("context.branchOnly")}</span><button className="context-button" disabled={disabled || invalid || !pending} onClick={() => { void save(); }}>{saving ? t("context.saving") : t("context.apply")}</button></div>}>
    {error && <div role="alert" className="context-alert">{error}<button className="context-button" disabled={saving || loading} onClick={() => { void refresh(true); }}>{t("context.refresh")}</button></div>}
    {!preview ? <div role="status" className="context-loading">{loading ? t("context.loading") : t("context.failed")}</div> : <>
      <div className="context-budget" aria-busy={loading}>
        <div className="context-budget-heading"><div><span className="context-eyebrow">{t(preview.countSource === "tokenizer" ? "context.tokenizerInput" : "context.nextRequest")}</span><strong>{preview.countSource === "estimate" ? "≈" : ""}{number(preview.inputTokens)} <small>/ {number(preview.effective.contextWindowSize)} tok</small></strong></div><span className="context-model" title={preview.model || ""}>{preview.model || t("context.noModel")}</span></div>
        <div className={`context-meter${preview.overBudget ? " is-over" : ""}`} role="meter" aria-label={t("context.title")} aria-valuemin={0} aria-valuemax={preview.effective.contextWindowSize} aria-valuenow={Math.min(preview.effective.contextWindowSize, preview.inputTokens + preview.reservedOutputTokens)}>
          <span style={{ width: `${Math.min(100, preview.inputTokens / preview.effective.contextWindowSize * 100)}%` }} /><i style={{ width: `${Math.max(0, occupied - Math.min(100, preview.inputTokens / preview.effective.contextWindowSize * 100))}%` }} />
        </div>
        <div className="context-budget-caption"><span>{t("context.replyReserve")} <b>{number(preview.reservedOutputTokens)}</b></span><span>{t("context.free")} <b>≈{number(preview.availableTokens)}</b></span><span>{preview.history.filter(row => row.included).length} / {preview.history.length} {t("context.messages")}</span></div>
        <p className="context-hint">{t(preview.countSource === "tokenizer" ? "context.tokenizerHint" : "context.estimateHint")}</p>
        {preview.overBudget && <div role="alert" className="context-alert">{t("context.overBudget")}</div>}
        {(preview.hasImages || preview.hasTools) && <p className="context-hint">{preview.hasImages && t("context.imageHint")} {preview.hasTools && t("context.toolHint")}</p>}
      </div>
      <div className="context-layout">
        <section className="context-detail">
          <div className="context-tabs" role="tablist" aria-label={t("context.title")}>{(["budget", "history", "prompt"] as const).map(value => <button key={value} role="tab" id={`context-tab-${value}`} aria-controls="context-tab-content" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={event => { const tabs = ["budget", "history", "prompt"] as const; const index = tabs.indexOf(value); const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : undefined; if (next) { event.preventDefault(); setTab(next); document.getElementById(`context-tab-${next}`)?.focus(); } }} onClick={() => setTab(value)}>{t(value === "budget" ? "context.breakdown" : value === "history" ? "context.history" : "context.prompt")}</button>)}</div>
          <div role="tabpanel" id="context-tab-content" aria-labelledby={`context-tab-${tab}`} className="context-tab-content">
            {tab === "budget" && <>
              {preview.sections.filter(section => section.tokens > 0).sort((a, b) => b.tokens - a.tokens).map(section => <details className="context-source" key={section.source}>
                <summary><span>{t(sourceKeys[section.source])}<i className="context-source-bar" style={{ width: `${Math.min(100, section.tokens / Math.max(1, preview.inputTokens) * 100)}px` }} /></span><b>≈{number(section.tokens)} <small>tok</small></b></summary>
                {section.text ? <pre>{section.text}</pre> : <p className="context-hint">{t("context.formattingHint")}</p>}
              </details>)}
              {preview.lastGeneration && <div className="context-last"><h3>{t("context.lastRequest")}</h3><dl>
                <div><dt>{t("context.input")}</dt><dd>{preview.lastGeneration.inputTokens === undefined ? "—" : number(preview.lastGeneration.inputTokens)} tok</dd></div>
                <div><dt>{t("context.output")}</dt><dd>{preview.lastGeneration.tokenSource === "estimate" ? "≈" : ""}{number(preview.lastGeneration.outputTokens)} tok</dd></div>
                {preview.lastGeneration.reasoningTokens !== undefined && <div><dt>{t("context.reasoningIncluded")}</dt><dd>{number(preview.lastGeneration.reasoningTokens)} tok</dd></div>}
                {preview.lastGeneration.cachedTokens !== undefined && <div><dt>{t("context.cached")}</dt><dd>{number(preview.lastGeneration.cachedTokens)} tok</dd></div>}
                {preview.lastGeneration.firstTokenMs !== undefined && <div><dt>{t("context.firstToken")}</dt><dd>{(preview.lastGeneration.firstTokenMs / 1000).toFixed(2)} s</dd></div>}
                {preview.lastGeneration.tokensPerSecond !== undefined && <div><dt>{t("context.speed")}</dt><dd>{preview.lastGeneration.speedSource === "measured" ? "≈" : ""}{preview.lastGeneration.tokensPerSecond.toFixed(1)} t/s</dd></div>}
                <div><dt>{t("context.duration")}</dt><dd>{(preview.lastGeneration.totalMs / 1000).toFixed(2)} s</dd></div>
                {(preview.lastGeneration.requests || 0) > 1 && <div><dt>{t("context.requests")}</dt><dd>{preview.lastGeneration.requests}</dd></div>}
                {preview.lastGeneration.totalInputTokens !== undefined && <div><dt>{t("context.totalInput")}</dt><dd>{number(preview.lastGeneration.totalInputTokens)} tok</dd></div>}
                {preview.lastGeneration.totalOutputTokens !== undefined && <div><dt>{t("context.totalOutput")}</dt><dd>{number(preview.lastGeneration.totalOutputTokens)} tok</dd></div>}
              </dl><p className="context-hint">{t("context.speedHint")}</p></div>}
            </>}
            {tab === "history" && <><p className="context-hint">{t("context.historyHint")}</p>{preview.history.length === 0 ? <p className="context-hint">{t("context.emptyHistory")}</p> : preview.history.map(row => <label className={`context-history-row${row.included ? "" : " is-excluded"}`} key={row.id}>
              <input type="checkbox" checked={!excluded.has(row.id)} disabled={disabled || row.id === "__draft__"} onChange={() => toggleMessage(row.id)} />
              <span><strong>{row.id === "__draft__" ? t("context.draft") : row.characterName || (row.role === "assistant" ? t("chat.assistant") : t("chat.user"))}</strong><small>{row.included ? t("context.included") : t(row.reason === "manual" ? "context.manual" : row.reason === "limit" ? "context.limit" : "context.budgetExcluded")}</small><p>{row.content || t("context.attachments")}</p></span><b>≈{number(row.tokens)} tok</b>
            </label>)}</>}
            {tab === "prompt" && <><p className="context-hint">{t("context.promptHint")}</p>{preview.transport && <details className="context-prompt" open><summary>KoboldCpp · prompt / memory</summary><pre>{preview.transport.memory}

{preview.transport.prompt}</pre></details>}{preview.messages.map((message, index) => <details className="context-prompt" key={index} open={preview.messages.length < 4}><summary>{index + 1} · {message.role}</summary><pre>{typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2)}{message.reasoning_content ? `\n\n[reasoning_content]\n${message.reasoning_content}` : ""}</pre></details>)}</>}
          </div>
        </section>
        <aside className="context-controls"><h3>{t("context.manage")}</h3><p className="context-hint">{t("context.branchOnly")}</p>
          <label>{t("context.window")}<input type="number" min={512} max={2097152} value={config.contextWindowSize ?? ""} disabled={disabled} onChange={event => setConfig(current => ({ ...current, contextWindowSize: Number(event.target.value) }))} /></label>
          <label>{t("context.replyReserve")}<input type="number" min={1} max={131072} value={config.maxOutputTokens ?? ""} disabled={disabled} onChange={event => setConfig(current => ({ ...current, maxOutputTokens: Number(event.target.value) }))} /></label>
          <label>{t("context.messageLimit")}<input type="number" min={0} max={10000} value={config.maxMessages ?? 0} disabled={disabled} onChange={event => setConfig(current => ({ ...current, maxMessages: Number(event.target.value) }))} /><small>{t("context.zeroUnlimited")}</small></label>
          <label className="context-toggle"><input type="checkbox" checked={config.includeReasoning !== false} disabled={disabled} onChange={event => setConfig(current => ({ ...current, includeReasoning: event.target.checked }))} /><span>{t("context.includeReasoning")}</span></label>
          <label>{t("context.summary")}<textarea value={config.summary || ""} rows={5} disabled={disabled} maxLength={100000} onChange={event => setConfig(current => ({ ...current, summary: event.target.value }))} placeholder={t("context.summaryPlaceholder")} /></label>
          <div className="context-control-actions"><button className="context-button" disabled={disabled || !!pending || preview.history.filter(row => row.id !== "__draft__").length < 2} onClick={() => { void compress(); }}>{t("context.compress")}</button><button className="context-button is-quiet" disabled={disabled} onClick={() => { void save(true); }}>{t("context.reset")}</button></div>
          {busy && <p className="context-hint">{t("context.busy")}</p>}
        </aside>
      </div>
    </>}
  </ModalShell>;
}
