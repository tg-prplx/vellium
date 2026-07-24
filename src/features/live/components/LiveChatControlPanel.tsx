import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ModalShell } from "../../../components/ModalShell";
import {
  BranchManager,
  RpReasoningToggle,
  RP_PRESETS,
  useChatJsonExport
} from "../../chat/public";
import { api } from "../../../shared/api";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask
} from "../../../shared/backgroundTasks";
import { useI18n } from "../../../shared/i18n";
import type {
  AppSettings,
  BranchNode,
  CharacterDetail,
  ChatMessage,
  ChatSession,
  LoreBook,
  PromptBlock,
  RagCollection,
  RpSceneState,
  SamplerConfig
} from "../../../shared/types/contracts";

type PanelTab = "context" | "generation" | "participants" | "prompts";

const DEFAULT_SCENE: RpSceneState = {
  chatId: "",
  variables: {
    dialogueStyle: "teasing",
    initiative: "65",
    descriptiveness: "70",
    unpredictability: "45",
    emotionalDepth: "75"
  },
  mood: "teasing",
  pacing: "slow",
  intensity: 0.7,
  chatMode: "rp",
  pureChatMode: false
};

const DEFAULT_SAMPLER: SamplerConfig = {
  temperature: 0.9,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: 2048,
  stop: [],
  topK: 100,
  minP: 0,
  typical: 1,
  tfs: 1,
  repetitionPenalty: 1.1,
  koboldBannedPhrases: []
};

const ADVANCED_SAMPLERS = [
  ["topK", "Top K", 0, 500, 1],
  ["minP", "Min P", 0, 1, 0.01],
  ["typical", "Typical", 0, 1, 0.01],
  ["tfs", "TFS", 0, 1, 0.01],
  ["repetitionPenalty", "Repetition penalty", 0, 3, 0.01],
  ["frequencyPenalty", "Frequency penalty", -2, 2, 0.05],
  ["presencePenalty", "Presence penalty", -2, 2, 0.05]
] as const;

const SCENE_SLIDERS = [
  { key: "initiative", label: "inspector.initiative" },
  { key: "descriptiveness", label: "inspector.descriptiveness" },
  { key: "unpredictability", label: "inspector.unpredictability" },
  { key: "emotionalDepth", label: "inspector.emotionalDepth" }
] as const;

interface LiveChatControlPanelProps {
  open: boolean;
  chat: ChatSession | null;
  settings: AppSettings | null;
  characters: CharacterDetail[];
  branches: BranchNode[];
  activeBranchId: string | null;
  busy: boolean;
  autoConversationRunning: boolean;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  onClose: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  onChatChange: (chat: ChatSession | null) => void;
  onBranchSelect: (branchId: string) => Promise<void>;
  onBranchRename: (branchId: string, name: string) => Promise<void>;
  onBranchDelete: (branchId: string) => Promise<void>;
  onNextTurn: (characterName: string) => Promise<void>;
  onAutoConversation: (turns: number, delayMs: number) => Promise<void>;
  onStopAutoConversation: () => void;
  onError: (message: string) => void;
}

export function LiveChatControlPanel({
  open,
  chat,
  settings,
  characters,
  branches,
  activeBranchId,
  busy,
  autoConversationRunning,
  setMessages,
  onClose,
  onSettingsChange,
  onChatChange,
  onBranchSelect,
  onBranchRename,
  onBranchDelete,
  onNextTurn,
  onAutoConversation,
  onStopAutoConversation,
  onError
}: LiveChatControlPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PanelTab>("context");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [scene, setScene] = useState<RpSceneState>(DEFAULT_SCENE);
  const [authorNote, setAuthorNote] = useState("");
  const [lorebooks, setLorebooks] = useState<LoreBook[]>([]);
  const [selectedLorebookIds, setSelectedLorebookIds] = useState<string[]>([]);
  const [ragCollections, setRagCollections] = useState<RagCollection[]>([]);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragCollectionIds, setRagCollectionIds] = useState<string[]>([]);
  const [sampler, setSampler] = useState<SamplerConfig | null>(null);
  const [presetId, setPresetId] = useState("");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlock[]>([]);
  const [title, setTitle] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [autoTurns, setAutoTurns] = useState(5);
  const [autoDelayMs, setAutoDelayMs] = useState(500);
  const [contextSummary, setContextSummary] = useState("");
  const { exportingChat, exportChat } = useChatJsonExport(onError);

  const participants = useMemo(() => participantIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is CharacterDetail => Boolean(character)), [characters, participantIds]);
  const samplerBase = sampler || settings?.samplerConfig || DEFAULT_SAMPLER;

  useEffect(() => {
    if (!open) return;
    setTitle(chat?.title || "");
    setParticipantIds(chat?.characterIds?.length
      ? chat.characterIds
      : chat?.characterId ? [chat.characterId] : []);
    setSampler(settings?.samplerConfig || null);
    setAutoTurns(settings?.autoConversationDefaultTurns || 5);
    setAutoDelayMs(settings?.autoConversationDelayMs || 500);
    if (!chat) {
      setScene(DEFAULT_SCENE);
      setAuthorNote("");
      setSelectedLorebookIds([]);
      setRagEnabled(false);
      setRagCollectionIds([]);
      setPromptBlocks(settings?.promptStack || []);
      return;
    }

    let active = true;
    setLoading(true);
    void Promise.all([
      api.rpGetSceneState(chat.id).catch(() => null),
      api.rpGetAuthorNote(chat.id).catch(() => ({ authorNote: "" })),
      api.lorebookList().catch(() => []),
      api.chatGetLorebooks(chat.id).catch(() => ({ lorebookId: null, lorebookIds: chat.lorebookIds || [] })),
      api.ragCollectionList().catch(() => []),
      api.chatGetRag(chat.id).catch(() => ({ enabled: false, collectionIds: [], updatedAt: null })),
      api.chatGetSampler(chat.id).catch(() => null),
      api.chatGetPreset(chat.id).catch(() => ({ presetId: null })),
      api.rpGetBlocks(chat.id).catch(() => settings?.promptStack || [])
    ]).then(([nextScene, nextAuthor, nextLorebooks, loreBinding, nextRagCollections, ragBinding, nextSampler, nextPreset, nextBlocks]) => {
      if (!active) return;
      setScene(nextScene || { ...DEFAULT_SCENE, chatId: chat.id });
      setAuthorNote(nextAuthor.authorNote || "");
      setLorebooks(nextLorebooks);
      setSelectedLorebookIds(loreBinding.lorebookIds || []);
      setRagCollections(nextRagCollections);
      setRagEnabled(ragBinding.enabled);
      setRagCollectionIds(ragBinding.collectionIds || []);
      setSampler(nextSampler || settings?.samplerConfig || null);
      setPresetId(nextPreset.presetId || "");
      setPromptBlocks(nextBlocks);
    }).catch((error) => {
      if (active) onError(String(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [chat?.id, open, settings?.autoConversationDefaultTurns, settings?.autoConversationDelayMs, settings?.promptStack, settings?.samplerConfig]);

  if (!open) return null;

  async function updateSettings(patch: Partial<AppSettings>) {
    try {
      const updated = await api.settingsUpdate(patch);
      onSettingsChange(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    } catch (error) {
      onError(String(error));
    }
  }

  async function saveContext() {
    if (!chat || saving) return;
    setSaving(true);
    try {
      await Promise.all([
        api.rpSetSceneState({ ...scene, chatId: chat.id }),
        api.rpUpdateAuthorNote(chat.id, authorNote),
        api.chatSaveLorebooks(chat.id, selectedLorebookIds),
        api.chatSaveRag(chat.id, ragEnabled, ragCollectionIds),
        sampler ? api.chatSaveSampler(chat.id, sampler) : Promise.resolve(),
        api.chatSavePreset(chat.id, presetId || null),
        api.rpSaveBlocks(chat.id, promptBlocks)
      ]);
      if (presetId) {
        const result = await api.rpApplyStylePreset(chat.id, presetId);
        setScene(result.sceneState);
      }
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveTitle() {
    if (!chat) return;
    const next = title.replace(/\s+/g, " ").trim();
    if (!next) return;
    try {
      await api.chatRename(chat.id, next);
      onChatChange({ ...chat, title: next });
      window.dispatchEvent(new Event("chat-list-refresh"));
    } catch (error) {
      onError(String(error));
    }
  }

  async function deleteChat() {
    if (!chat || !window.confirm(t("chat.confirmDeleteChat"))) return;
    try {
      await api.chatDelete(chat.id);
      onChatChange(null);
      setMessages([]);
      onClose();
      window.dispatchEvent(new Event("chat-list-refresh"));
    } catch (error) {
      onError(String(error));
    }
  }

  async function toggleParticipant(characterId: string) {
    if (!chat) return;
    const nextIds = participantIds.includes(characterId)
      ? participantIds.filter((id) => id !== characterId)
      : [...participantIds, characterId];
    if (nextIds.length === 0) return;
    const previous = participantIds;
    setParticipantIds(nextIds);
    try {
      const result = await api.chatUpdateCharacters(chat.id, nextIds);
      const updated = { ...chat, characterId: result.characterId, characterIds: result.characterIds };
      onChatChange(updated);
    } catch (error) {
      setParticipantIds(previous);
      onError(String(error));
    }
  }

  async function compressContext() {
    if (!chat || compressing) return;
    setCompressing(true);
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "summarize",
      label: t("chat.compress"),
      progressLabel: t("chat.compressing")
    });
    try {
      const result = await api.chatCompressContext(chat.id, activeBranchId || undefined);
      setContextSummary(result.summary);
      finishBackgroundTask(taskId);
    } catch (error) {
      failBackgroundTask(taskId, String(error));
      onError(String(error));
    } finally {
      setCompressing(false);
    }
  }

  const footer = (
    <>
      {chat ? (
        <button type="button" className="vellium-button vellium-button-secondary mr-auto" disabled={exportingChat} onClick={() => { void exportChat(chat.id, chat.title, activeBranchId || undefined); }}>
          {exportingChat ? t("chat.exporting") : t("chat.exportJsonShort")}
        </button>
      ) : <span className="mr-auto text-xs text-text-tertiary">{t("chat.noChatYet")}</span>}
      <button type="button" className="vellium-button vellium-button-secondary" onClick={onClose}>{t("common.close")}</button>
      {chat ? <button type="button" className="vellium-button vellium-button-primary" disabled={saving || loading} onClick={() => { void saveContext(); }}>{saving ? t("settings.autosaveSaving") : t("chat.save")}</button> : null}
    </>
  );

  return (
    <ModalShell
      title={t("live.chatControls")}
      description={t("live.chatControlsDesc")}
      closeLabel={t("common.close")}
      onClose={onClose}
      size="xl"
      originId="live-chat-controls"
      surfaceClassName="live-chat-controls-modal"
      bodyClassName="live-chat-controls-body"
      footer={footer}
      icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" /></svg>}
    >
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2 border-b border-border-subtle pb-3">
          {(["context", "generation", "participants", "prompts"] as PanelTab[]).map((item) => (
            <button key={item} type="button" className={`vellium-button vellium-button-secondary ${tab === item ? "is-active" : ""}`} onClick={() => setTab(item)}>
              {t(`live.controlsTab.${item}`)}
            </button>
          ))}
        </div>

        {loading ? <div className="py-12 text-center text-sm text-text-tertiary">{t("chat.loading")}</div> : null}

        {!loading && tab === "context" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text-primary">{t("chat.branch")}</h3>
                <BranchManager branches={branches} activeBranchId={activeBranchId} disabled={busy} onSelect={(id) => { void onBranchSelect(id); }} onRename={onBranchRename} onDelete={onBranchDelete} />
              </div>
              <label className="block text-xs text-text-tertiary">
                {t("chat.renameChat")}
                <div className="mt-1 flex gap-2">
                  <input className="vellium-input min-w-0 flex-1" value={title} onChange={(event) => setTitle(event.target.value)} />
                  <button type="button" className="vellium-button vellium-button-secondary" onClick={() => { void saveTitle(); }}>{t("chat.rename")}</button>
                </div>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="vellium-button vellium-button-secondary" disabled={compressing || busy} onClick={() => { void compressContext(); }}>{compressing ? t("chat.compressing") : t("chat.compress")}</button>
                <button type="button" className="vellium-button vellium-button-danger" disabled={busy} onClick={() => { void deleteChat(); }}>{t("chat.deleteChat")}</button>
              </div>
              {contextSummary ? <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-secondary p-3 text-xs text-text-secondary">{contextSummary}</pre> : null}
            </section>

            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{t("inspector.sceneState")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-text-tertiary">{t("inspector.chatMode")}
                  <select className="vellium-input mt-1 w-full" value={scene.chatMode || "rp"} onChange={(event) => setScene((current) => ({ ...current, chatMode: event.target.value as RpSceneState["chatMode"], pureChatMode: event.target.value === "pure_chat" }))}>
                    <option value="rp">{t("inspector.modeRp")}</option>
                    <option value="light_rp">{t("inspector.modeLightRp")}</option>
                    <option value="pure_chat">{t("inspector.modePureChat")}</option>
                  </select>
                </label>
                <label className="text-xs text-text-tertiary">{t("inspector.pacing")}
                  <select className="vellium-input mt-1 w-full" value={scene.pacing} onChange={(event) => setScene((current) => ({ ...current, pacing: event.target.value as RpSceneState["pacing"] }))}>
                    <option value="slow">{t("inspector.slow")}</option>
                    <option value="balanced">{t("inspector.balanced")}</option>
                    <option value="fast">{t("inspector.fast")}</option>
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-xs text-text-tertiary">{t("inspector.mood")}
                <input className="vellium-input mt-1 w-full" value={scene.mood} onChange={(event) => setScene((current) => ({ ...current, mood: event.target.value }))} />
              </label>
              <label className="mt-3 block text-xs text-text-tertiary">{t("inspector.dialogueStyle")}
                <input className="vellium-input mt-1 w-full" value={scene.variables.dialogueStyle || ""} onChange={(event) => setScene((current) => ({ ...current, variables: { ...current.variables, dialogueStyle: event.target.value } }))} />
              </label>
              <label className="mt-3 block text-xs text-text-tertiary">{t("inspector.intensity")} · {Math.round(scene.intensity * 100)}%
                <input className="mt-2 w-full" type="range" min={0} max={100} value={Math.round(scene.intensity * 100)} onChange={(event) => setScene((current) => ({ ...current, intensity: Number(event.target.value) / 100 }))} />
              </label>
              {SCENE_SLIDERS.map(({ key, label }) => (
                <label key={key} className="mt-3 block text-xs text-text-tertiary">{t(label)} · {scene.variables[key] || "50"}%
                  <input className="mt-2 w-full" type="range" min={0} max={100} value={Number(scene.variables[key] || 50)} onChange={(event) => setScene((current) => ({ ...current, variables: { ...current.variables, [key]: event.target.value } }))} />
                </label>
              ))}
              {(settings?.customInspectorFields || []).filter((field) => field.section === "scene" && field.enabled !== false).map((field) => (
                <label key={field.id} className="mt-3 block text-xs text-text-tertiary">{field.label}
                  {field.type === "range" ? (
                    <input className="mt-2 w-full" type="range" min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={Number(scene.variables[field.key] ?? field.defaultValue ?? field.min ?? 0)} onChange={(event) => setScene((current) => ({ ...current, variables: { ...current.variables, [field.key]: event.target.value } }))} />
                  ) : (
                    <input className="vellium-input mt-1 w-full" value={scene.variables[field.key] ?? String(field.defaultValue || "")} onChange={(event) => setScene((current) => ({ ...current, variables: { ...current.variables, [field.key]: event.target.value } }))} />
                  )}
                </label>
              ))}
              <label className="mt-3 block text-xs text-text-tertiary">{t("inspector.authorNote")}
                <textarea className="vellium-input mt-1 min-h-24 w-full resize-y" value={authorNote} onChange={(event) => setAuthorNote(event.target.value)} />
              </label>
            </section>

            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{t("chat.lorebook")}</h3>
              <div className="max-h-48 space-y-2 overflow-auto">
                {lorebooks.length ? lorebooks.map((book) => (
                  <label key={book.id} className="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={selectedLorebookIds.includes(book.id)} onChange={(event) => setSelectedLorebookIds((current) => event.target.checked ? [...current, book.id] : current.filter((id) => id !== book.id))} />
                    <span>{book.name}</span>
                  </label>
                )) : <span className="text-xs text-text-tertiary">{t("chat.none")}</span>}
              </div>
            </section>

            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <label className="flex items-center justify-between gap-3 text-sm font-semibold text-text-primary">
                {t("chat.ragEnabled")}
                <input type="checkbox" checked={ragEnabled} onChange={(event) => setRagEnabled(event.target.checked)} />
              </label>
              <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                {ragCollections.length ? ragCollections.map((collection) => (
                  <label key={collection.id} className="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" disabled={!ragEnabled} checked={ragCollectionIds.includes(collection.id)} onChange={(event) => setRagCollectionIds((current) => event.target.checked ? [...current, collection.id] : current.filter((id) => id !== collection.id))} />
                    <span>{collection.name}</span>
                  </label>
                )) : <span className="text-xs text-text-tertiary">{t("chat.ragNoCollections")}</span>}
              </div>
            </section>
          </div>
        ) : null}

        {!loading && tab === "generation" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="text-sm font-semibold text-text-primary">{t("chat.reasoning")}</h3>
              <RpReasoningToggle enabled={settings?.rpReasoningEnabled === true} disabled={busy} variant="status" onToggle={() => { void updateSettings({ rpReasoningEnabled: settings?.rpReasoningEnabled !== true }); }} />
              <label className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                <span>{t("settings.includeReasoningInContext")}</span>
                <input type="checkbox" checked={settings?.includeReasoningInContext !== false} onChange={(event) => { void updateSettings({ includeReasoningInContext: event.target.checked }); }} />
              </label>
              <p className="text-xs text-text-tertiary">{t("live.reasoningSpeechHint")}</p>
            </section>

            <section className="space-y-3 rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="text-sm font-semibold text-text-primary">{t("chat.toolCall")}</h3>
              <label className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                <span>{t("settings.toolCallingEnabled")}</span>
                <input type="checkbox" checked={settings?.toolCallingEnabled === true} onChange={(event) => { void updateSettings({ toolCallingEnabled: event.target.checked }); }} />
              </label>
              <label className="block text-xs text-text-tertiary">{t("settings.toolCallingPolicy")}
                <select className="vellium-input mt-1 w-full" value={settings?.toolCallingPolicy || "balanced"} onChange={(event) => { void updateSettings({ toolCallingPolicy: event.target.value as AppSettings["toolCallingPolicy"] }); }}>
                  <option value="conservative">conservative</option>
                  <option value="balanced">balanced</option>
                  <option value="aggressive">aggressive</option>
                </select>
              </label>
            </section>

            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{t("chat.rpPresets")}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-text-tertiary">{t("chat.rpPresets")}
                  <select className="vellium-input mt-1 w-full" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                    <option value="">{t("chat.none")}</option>
                    {RP_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                  </select>
                </label>
                <label className="text-xs text-text-tertiary">{t("inspector.temperature")}
                  <input className="vellium-input mt-1 w-full" type="number" min={0} max={2} step={0.05} value={samplerBase.temperature} onChange={(event) => setSampler({ ...samplerBase, temperature: Number(event.target.value) })} />
                </label>
                <label className="text-xs text-text-tertiary">{t("inspector.topP")}
                  <input className="vellium-input mt-1 w-full" type="number" min={0} max={1} step={0.01} value={samplerBase.topP} onChange={(event) => setSampler({ ...samplerBase, topP: Number(event.target.value) })} />
                </label>
                <label className="text-xs text-text-tertiary">{t("inspector.maxTokens")}
                  <input className="vellium-input mt-1 w-full" type="number" min={16} max={32768} step={16} value={samplerBase.maxTokens} onChange={(event) => setSampler({ ...samplerBase, maxTokens: Number(event.target.value) })} />
                </label>
                {ADVANCED_SAMPLERS.map(([key, label, min, max, step]) => (
                  <label key={key} className="text-xs text-text-tertiary">{label}
                    <input className="vellium-input mt-1 w-full" type="number" min={min} max={max} step={step} value={Number(samplerBase[key] ?? 0)} onChange={(event) => setSampler({ ...samplerBase, [key]: Number(event.target.value) })} />
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-text-tertiary">{t("chat.phraseBansLabel")}
                  <textarea className="vellium-input mt-1 min-h-20 w-full resize-y" value={(samplerBase.koboldBannedPhrases || []).join("\n")} onChange={(event) => setSampler({ ...samplerBase, koboldBannedPhrases: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) })} />
                </label>
                <label className="text-xs text-text-tertiary">{t("chat.memoryLabel")}
                  <textarea className="vellium-input mt-1 min-h-20 w-full resize-y" value={samplerBase.koboldMemory || ""} onChange={(event) => setSampler({ ...samplerBase, koboldMemory: event.target.value })} />
                </label>
              </div>
            </section>
          </div>
        ) : null}

        {!loading && tab === "participants" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{t("chat.multiChar")}</h3>
              <div className="max-h-80 space-y-2 overflow-auto">
                {characters.map((character) => (
                  <label key={character.id} className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-secondary">
                    <input type="checkbox" disabled={!chat || busy || (participantIds.length === 1 && participantIds[0] === character.id)} checked={participantIds.includes(character.id)} onChange={() => { void toggleParticipant(character.id); }} />
                    <span className="min-w-0 flex-1 truncate">{character.name}</span>
                    {participantIds.includes(character.id) ? <button type="button" className="vellium-button vellium-button-secondary" disabled={busy} onClick={(event) => { event.preventDefault(); void onNextTurn(character.name); }}>{t("chat.nextTurn")}</button> : null}
                  </label>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
              <h3 className="text-sm font-semibold text-text-primary">{t("chat.autoConvo")}</h3>
              <p className="mt-1 text-xs text-text-tertiary">{t("chat.autoConvoDesc")}</p>
              <label className="mt-4 block text-xs text-text-tertiary">{t("chat.autoTurns")}
                <input className="vellium-input mt-1 w-full" type="number" min={1} max={50} value={autoTurns} onChange={(event) => setAutoTurns(Number(event.target.value))} />
              </label>
              <label className="mt-3 block text-xs text-text-tertiary">{t("live.autoDelay")}
                <input className="vellium-input mt-1 w-full" type="number" min={0} max={30000} step={100} value={autoDelayMs} onChange={(event) => setAutoDelayMs(Number(event.target.value))} />
              </label>
              <button type="button" className="vellium-button vellium-button-primary mt-4 w-full" disabled={!chat || participants.length < 2 || (busy && !autoConversationRunning)} onClick={() => {
                if (autoConversationRunning) onStopAutoConversation();
                else void onAutoConversation(Math.max(1, Math.min(50, autoTurns)), Math.max(0, Math.min(30000, autoDelayMs)));
              }}>
                {autoConversationRunning ? t("chat.autoConvoStop") : t("chat.autoConvoStart")}
              </button>
            </section>
          </div>
        ) : null}

        {!loading && tab === "prompts" ? (
          <section className="space-y-3 rounded-xl border border-border-subtle bg-bg-primary/50 p-4">
            <h3 className="text-sm font-semibold text-text-primary">{t("inspector.promptStack")}</h3>
            {promptBlocks.map((block) => (
              <div key={block.id} className="rounded-lg border border-border-subtle bg-bg-secondary p-3">
                <label className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  <span>{block.kind}</span>
                  <input type="checkbox" checked={block.enabled} onChange={(event) => setPromptBlocks((current) => current.map((item) => item.id === block.id ? { ...item, enabled: event.target.checked } : item))} />
                </label>
                <textarea className="vellium-input mt-2 min-h-24 w-full resize-y" value={block.content} onChange={(event) => setPromptBlocks((current) => current.map((item) => item.id === block.id ? { ...item, content: event.target.value } : item))} />
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </ModalShell>
  );
}
