import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ThreePanelLayout, PanelTitle, Badge, EmptyState } from "../../components/Panels";
import { PluginActionBar, PluginSlotMount } from "../plugins/PluginHost";
import { api, resolveApiAssetUrl } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type {
  BranchNode,
  ChatMessage,
  ChatSession,
  CustomInspectorField,
  FileAttachment,
  PromptBlock,
  RpSceneState,
  CharacterDetail,
  LoreBook,
  RagCollection,
  SamplerConfig,
  ProviderProfile,
  ProviderModel,
  SecuritySettings,
  UserPersona
} from "../../shared/types/contracts";
import {
  DEFAULT_AUTHOR_NOTE,
  DEFAULT_CHAT_SECURITY_SETTINGS,
  DEFAULT_PROMPT_STACK,
  DEFAULT_SCENE_FIELD_VISIBILITY,
  DEFAULT_SCENE_STATE,
  MESSAGE_DELETE_ANIMATION_MS,
  REASONING_CALL_NAME,
  RP_PRESETS,
  type ChatMode
} from "./constants";
import {
  guessMimeType,
  imageSourceFromAttachment,
  normalizePromptStack,
  parseInlineReasoning,
  parseToolCallContent,
  readSceneVarPercent,
  renderContent,
  resolveChatMode,
  sanitizeSceneVariables,
  type ParsedToolCallContent
} from "./utils";
import {
  buildActivePersonaPayload,
  calcSimpleHomeComposerWidth,
  filterChatsByQuery,
  groupToolMessages,
  resolveActiveProviderType,
  type GroupedToolMessage
} from "./derived";
import {
  useActiveChatHydration,
  useChatBootstrap,
  useProviderModelLoader,
  useTimelineLoader
} from "./hooks";

interface StreamingToolCall {
  callId: string;
  name: string;
  args: string;
  status: "running" | "done";
  result?: string;
}

export function ChatScreen() {
  const { t } = useI18n();
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChat, setActiveChat] = useState<ChatSession | null>(null);
  const [branches, setBranches] = useState<BranchNode[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [authorNote, setAuthorNote] = useState(DEFAULT_AUTHOR_NOTE);
  const [sceneState, setSceneState] = useState<RpSceneState>({
    chatId: "",
    ...DEFAULT_SCENE_STATE
  });
  const [sceneFieldVisibility, setSceneFieldVisibility] = useState({ ...DEFAULT_SCENE_FIELD_VISIBILITY });
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({ ...DEFAULT_CHAT_SECURITY_SETTINGS });
  const [customInspectorFields, setCustomInspectorFields] = useState<CustomInspectorField[]>([]);
  const [promptStack, setPromptStack] = useState<PromptBlock[]>([...DEFAULT_PROMPT_STACK]);
  const [contextSummary, setContextSummary] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamChunks, setStreamChunks] = useState<Array<{ id: number; text: string }>>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingCharacterName, setStreamingCharacterName] = useState<string | null>(null);
  const [streamingToolCalls, setStreamingToolCalls] = useState<StreamingToolCall[]>([]);
  const [streamingReasoningCalls, setStreamingReasoningCalls] = useState<StreamingToolCall[]>([]);
  const [streamingToolsExpanded, setStreamingToolsExpanded] = useState(false);
  const [streamingReasoningExpanded, setStreamingReasoningExpanded] = useState(false);
  const [errorText, setErrorText] = useState<string>("");
  const [activeModelLabel, setActiveModelLabel] = useState<string>("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renamingChatTitle, setRenamingChatTitle] = useState("");

  // Character state
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [showCharacterPicker, setShowCharacterPicker] = useState(false);

  // Multi-character state
  const [chatCharacterIds, setChatCharacterIds] = useState<string[]>([]);
  const [showMultiCharPanel, setShowMultiCharPanel] = useState(false);
  const [autoConvoRunning, setAutoConvoRunning] = useState(false);
  const [autoTurnsCount, setAutoTurnsCount] = useState(5);
  const [multiCharCollapsed, setMultiCharCollapsed] = useState(false);
  const autoConvoRef = useRef(false);
  const [draggingCharacterId, setDraggingCharacterId] = useState<string | null>(null);

  // Sampler state
  const [samplerConfig, setSamplerConfig] = useState<SamplerConfig>({
    temperature: 0.9, topP: 1.0, frequencyPenalty: 0.0,
    presencePenalty: 0.0, maxTokens: 2048, stop: [],
    topK: 100, topA: 0, minP: 0, typical: 1, tfs: 1,
    nSigma: 0,
    repetitionPenalty: 1.1, repetitionPenaltyRange: 0, repetitionPenaltySlope: 1,
    samplerOrder: [6, 0, 1, 3, 4, 2, 5],
    koboldMemory: "",
    koboldBannedPhrases: [],
    koboldUseDefaultBadwords: false
  });

  // File attachments
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);

  // Model selector in chat — auto-loading
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [chatProviderId, setChatProviderId] = useState("");
  const [chatModelId, setChatModelId] = useState("");
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // Translate state
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translatedTexts, setTranslatedTexts] = useState<Record<string, string>>({});
  const [inPlaceTranslations, setInPlaceTranslations] = useState<Record<string, string>>({});
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);

  // Active preset
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [lorebooks, setLorebooks] = useState<LoreBook[]>([]);
  const [activeLorebookIds, setActiveLorebookIds] = useState<string[]>([]);
  const [ragCollections, setRagCollections] = useState<RagCollection[]>([]);
  const [chatRagEnabled, setChatRagEnabled] = useState(false);
  const [chatRagCollectionIds, setChatRagCollectionIds] = useState<string[]>([]);
  const [chatRagTopK, setChatRagTopK] = useState(6);

  // User persona
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [activePersona, setActivePersona] = useState<UserPersona | null>(null);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null);
  const [koboldBansInput, setKoboldBansInput] = useState("");

  // Per-chat sampler — auto-save debounce
  const [samplerSaved, setSamplerSaved] = useState(false);
  const samplerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptStackSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const samplerInitializedRef = useRef(false);
  const authorNoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authorNoteInitializedRef = useRef(false);
  const sceneStateInitializedRef = useRef(false);

  // Collapsible sections in left sidebar
  const [presetsCollapsed, setPresetsCollapsed] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [alternateSimpleMode, setAlternateSimpleMode] = useState(false);
  const [simpleSidebarOpen, setSimpleSidebarOpen] = useState(false);
  const [simpleSceneOpen, setSimpleSceneOpen] = useState(false);
  const [simpleInspectorOpen, setSimpleInspectorOpen] = useState(false);
  const [simpleGreetingIndex, setSimpleGreetingIndex] = useState(0);

  // Inspector collapse
  const [inspectorSection, setInspectorSection] = useState<Record<string, boolean>>({
    scene: true, sampler: false, context: false
  });
  const [toolPanelsExpanded, setToolPanelsExpanded] = useState<Record<string, boolean>>({});
  const [reasoningPanelsExpanded, setReasoningPanelsExpanded] = useState<Record<string, boolean>>({});
  const [deletingMessageIds, setDeletingMessageIds] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatSearchInputRef = useRef<HTMLInputElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const modelSelectorTriggerRef = useRef<HTMLButtonElement>(null);
  const streamChunkIdRef = useRef(0);
  const promptStackRef = useRef<PromptBlock[]>([...DEFAULT_PROMPT_STACK]);

  const orderedBlocks = useMemo(
    () => normalizePromptStack(promptStack),
    [promptStack]
  );
  useEffect(() => {
    promptStackRef.current = promptStack;
  }, [promptStack]);
  const chatMode = resolveChatMode(sceneState);
  const pureChatMode = chatMode === "pure_chat";
  const simpleModeActive = alternateSimpleMode && !zenMode;
  const simpleSidebarCollapsed = simpleModeActive && !simpleSidebarOpen;
  const simpleHomeState = simpleModeActive && messages.length === 0 && !streaming;
  const simpleGreetings = [
    t("chat.simpleGreetingOne"),
    t("chat.simpleGreetingTwo"),
    t("chat.simpleGreetingThree"),
    t("chat.simpleGreetingFour")
  ];
  const simpleGreeting = simpleGreetings[simpleGreetingIndex % simpleGreetings.length] || t("chat.simpleGreetingOne");
  const hasDraftPayload = input.trim().length > 0 || attachments.length > 0;
  const canResendLast = messages.length > 0 && messages[messages.length - 1]?.role === "user";
  const simpleHomeComposerWidth = useMemo(() => {
    return calcSimpleHomeComposerWidth(simpleHomeState, input, attachments.length);
  }, [simpleHomeState, input, attachments.length]);
  const visibleCustomSceneFields = useMemo(() => {
    return customInspectorFields
      .filter((field) => field.section === "scene" && (!pureChatMode || field.visibleInPureChat))
      .sort((a, b) => a.order - b.order);
  }, [customInspectorFields, pureChatMode]);
  const systemPromptBlock = useMemo(
    () => orderedBlocks.find((block) => block.kind === "system") || null,
    [orderedBlocks]
  );

  function getCustomSceneFieldValue(field: CustomInspectorField) {
    const key = `ext:${field.key}`;
    const current = String(sceneState.variables?.[key] ?? "");
    return current || field.defaultValue || "";
  }

  function setCustomSceneFieldValue(field: CustomInspectorField, value: string) {
    setSceneVariable(`ext:${field.key}`, value);
  }

  function renderCustomSceneField(field: CustomInspectorField) {
    const value = getCustomSceneFieldValue(field);
    if (field.type === "toggle") {
      const checked = value === "true" || value === "1" || value === "yes";
      return (
        <div key={field.id} className="rounded-xl border border-border-subtle bg-bg-secondary/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <label className="block text-[10px] text-text-tertiary">{field.label}</label>
              {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
            </div>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setCustomSceneFieldValue(field, e.target.checked ? "true" : "false")}
              className="h-4 w-4"
            />
          </div>
        </div>
      );
    }
    if (field.type === "select") {
      return (
        <div key={field.id}>
          <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
          <select
            value={value}
            onChange={(e) => setCustomSceneFieldValue(field, e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          >
            <option value="">{field.placeholder || "—"}</option>
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
        </div>
      );
    }
    if (field.type === "range") {
      const min = Number.isFinite(field.min) ? Number(field.min) : 0;
      const max = Number.isFinite(field.max) ? Number(field.max) : 100;
      const step = Number.isFinite(field.step) ? Number(field.step) : 1;
      const numericValue = Number(value || field.defaultValue || min);
      return (
        <div key={field.id}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <label className="text-[10px] text-text-tertiary">{field.label}</label>
            <span className="text-[10px] text-text-tertiary">{Number.isFinite(numericValue) ? numericValue : min}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(numericValue) ? numericValue : min}
            onChange={(e) => setCustomSceneFieldValue(field, e.target.value)}
            className="w-full"
          />
          {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
        </div>
      );
    }
    if (field.type === "textarea") {
      return (
        <div key={field.id}>
          <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
          <textarea
            value={value}
            rows={field.rows || 3}
            placeholder={field.placeholder || ""}
            onChange={(e) => setCustomSceneFieldValue(field, e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
        </div>
      );
    }
    return (
      <div key={field.id}>
        <label className="mb-1 block text-[10px] text-text-tertiary">{field.label}</label>
        <input
          value={value}
          placeholder={field.placeholder || ""}
          onChange={(e) => setCustomSceneFieldValue(field, e.target.value)}
          className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        />
        {field.helpText && <p className="mt-1 text-[10px] text-text-tertiary">{field.helpText}</p>}
      </div>
    );
  }

  const totalTokens = useMemo(
    () => messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0),
    [messages]
  );
  const visibleMessages = useMemo(
    () => messages.filter((msg) => msg.role !== "tool"),
    [messages]
  );
  const groupedToolsByParent = useMemo(() => {
    return groupToolMessages(messages);
  }, [messages]);
  const activePersonaPayload = useMemo(() => {
    return buildActivePersonaPayload(activePersona, t("chat.user"));
  }, [activePersona, t]);
  const activeProviderType = useMemo(() => {
    return resolveActiveProviderType(providers, chatProviderId);
  }, [providers, chatProviderId]);
  const filteredChats = useMemo(() => {
    return filterChatsByQuery(chats, chatSearchQuery, characters);
  }, [chats, chatSearchQuery, characters]);
  const selectedLorebooks = useMemo(
    () => lorebooks.filter((book) => activeLorebookIds.includes(book.id)),
    [lorebooks, activeLorebookIds]
  );
  useEffect(() => {
    const raw = samplerConfig.koboldBannedPhrases;
    if (Array.isArray(raw)) {
      setKoboldBansInput(raw.join(", "));
      return;
    }
    setKoboldBansInput(typeof raw === "string" ? raw : "");
  }, [samplerConfig.koboldBannedPhrases]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  useEffect(() => {
    if (!zenMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZenMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zenMode]);

  useEffect(() => {
    setDeletingMessageIds((prev) => {
      const liveIds = new Set(messages.map((msg) => msg.id));
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (!value) continue;
        if (liveIds.has(id)) {
          next[id] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  useEffect(() => {
    if (!simpleModeActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (simpleSceneOpen) {
        setSimpleSceneOpen(false);
        return;
      }
      if (simpleInspectorOpen) {
        setSimpleInspectorOpen(false);
        return;
      }
      if (simpleSidebarOpen && window.innerWidth < 1280) {
        setSimpleSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [simpleModeActive, simpleSceneOpen, simpleInspectorOpen, simpleSidebarOpen]);

  useEffect(() => {
    if (simpleModeActive) return;
    setSimpleInspectorOpen(false);
    setSimpleSceneOpen(false);
    setShowModelSelector(false);
  }, [simpleModeActive]);

  useEffect(() => {
    if (!showModelSelector) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (modelSelectorRef.current?.contains(target)) return;
      if (modelSelectorTriggerRef.current?.contains(target)) return;
      setShowModelSelector(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowModelSelector(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showModelSelector]);

  useChatBootstrap({
    setChats,
    setActiveChat,
    setChatProviderId,
    setActiveModelLabel,
    setChatModelId,
    setSamplerConfig,
    setPromptStack,
    setAlternateSimpleMode,
    setSimpleSidebarOpen,
    setSceneFieldVisibility,
    setSecuritySettings,
    setCustomInspectorFields,
    setChatRagTopK,
    setCharacters,
    setLorebooks,
    setRagCollections,
    setProviders,
    setPersonas,
    setActivePersona
  });

  useEffect(() => {
    return () => {
      if (promptStackSaveTimerRef.current) {
        clearTimeout(promptStackSaveTimerRef.current);
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      if (ttsAudioUrlRef.current) {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
        ttsAudioUrlRef.current = null;
      }
    };
  }, []);

  useProviderModelLoader({
    chatProviderId,
    setModels,
    setChatModelId,
    setLoadingModels
  });

  useActiveChatHydration({
    activeChat,
    setMessages,
    setBranches,
    setActiveBranchId,
    setChatCharacterIds,
    setActiveLorebookIds,
    setChatRagEnabled,
    setChatRagCollectionIds,
    setSceneState,
    setAuthorNote,
    setActivePreset,
    setToolPanelsExpanded,
    setReasoningPanelsExpanded,
    setSamplerConfig,
    setLorebooks,
    setSamplerSaved,
    samplerInitializedRef,
    authorNoteInitializedRef,
    sceneStateInitializedRef
  });

  useTimelineLoader({
    activeChatId: activeChat?.id,
    activeBranchId,
    setMessages
  });

  // Auto-save sampler config when it changes (debounced)
  useEffect(() => {
    if (!activeChat || !samplerInitializedRef.current) return;
    if (samplerSaveTimerRef.current) clearTimeout(samplerSaveTimerRef.current);
    samplerSaveTimerRef.current = setTimeout(() => {
      api.chatSaveSampler(activeChat.id, samplerConfig).then(() => {
        setSamplerSaved(true);
        setTimeout(() => setSamplerSaved(false), 1500);
      }).catch(() => {});
    }, 800);
    return () => { if (samplerSaveTimerRef.current) clearTimeout(samplerSaveTimerRef.current); };
  }, [samplerConfig, activeChat]);

  useEffect(() => {
    if (!activeChat || !authorNoteInitializedRef.current) return;
    if (authorNoteSaveTimerRef.current) clearTimeout(authorNoteSaveTimerRef.current);
    authorNoteSaveTimerRef.current = setTimeout(() => {
      api.rpUpdateAuthorNote(activeChat.id, authorNote).catch(() => {});
    }, 600);
    return () => {
      if (authorNoteSaveTimerRef.current) clearTimeout(authorNoteSaveTimerRef.current);
    };
  }, [authorNote, activeChat]);

  useEffect(() => {
    if (!activeChat || !sceneStateInitializedRef.current) return;
    if (sceneStateSaveTimerRef.current) clearTimeout(sceneStateSaveTimerRef.current);
    sceneStateSaveTimerRef.current = setTimeout(() => {
      api.rpSetSceneState({ ...sceneState, chatId: activeChat.id }).catch(() => {});
    }, 600);
    return () => {
      if (sceneStateSaveTimerRef.current) clearTimeout(sceneStateSaveTimerRef.current);
    };
  }, [sceneState, activeChat]);

  const refreshActiveTimeline = useCallback(async () => {
    if (!activeChat) return;
    setMessages(await api.chatTimeline(activeChat.id, activeBranchId || undefined));
  }, [activeChat, activeBranchId]);

  function openSimpleSidebar(next?: boolean) {
    if (!simpleModeActive) return;
    if (next !== false) setShowModelSelector(false);
    setSimpleSidebarOpen((prev) => (typeof next === "boolean" ? next : !prev));
  }

  function openSimpleInspector(next?: boolean) {
    if (!simpleModeActive) return;
    if (next !== false) setShowModelSelector(false);
    setSimpleInspectorOpen((prev) => (typeof next === "boolean" ? next : !prev));
  }

  useEffect(() => {
    if (!simpleHomeState) return;
    setSimpleGreetingIndex(Math.floor(Math.random() * simpleGreetings.length));
  }, [simpleHomeState, activeChat?.id, simpleGreetings.length]);

  function startStreamingUi(characterName: string | null) {
    setStreamText("");
    setStreamChunks([]);
    streamChunkIdRef.current = 0;
    setStreaming(true);
    setStreamingCharacterName(characterName);
    setStreamingToolCalls([]);
    setStreamingReasoningCalls([]);
    setStreamingToolsExpanded(false);
    setStreamingReasoningExpanded(false);
  }

  function stopStreamingUi() {
    setStreaming(false);
    setStreamText("");
    setStreamChunks([]);
    streamChunkIdRef.current = 0;
    setStreamingCharacterName(null);
    setStreamingToolCalls([]);
    setStreamingReasoningCalls([]);
    setStreamingToolsExpanded(false);
    setStreamingReasoningExpanded(false);
  }

  function handleStreamingToolEvent(event: {
    phase: "start" | "delta" | "done";
    callId: string;
    name: string;
    args?: string;
    result?: string;
  }) {
    const targetSetter = event.name === REASONING_CALL_NAME ? setStreamingReasoningCalls : setStreamingToolCalls;
    targetSetter((prev) => {
      const callId = String(event.callId || "").trim() || `${event.name || "tool"}-${Date.now()}`;
      const idx = prev.findIndex((item) => item.callId === callId);
      if (idx === -1) {
        const next: StreamingToolCall = {
          callId,
          name: event.name || "tool",
          args: event.args || "{}",
          status: event.phase === "done" ? "done" : "running",
          result: event.result || ""
        };
        return [...prev, next];
      }
      const updated = [...prev];
      const prevResult = updated[idx].result || "";
      const deltaResult = event.result || "";
      const mergedResult = event.phase === "delta"
        ? `${prevResult}${deltaResult}`
        : (event.result ?? prevResult);
      updated[idx] = {
        ...updated[idx],
        name: event.name || updated[idx].name,
        args: event.args ?? updated[idx].args,
        status: event.phase === "done" ? "done" : "running",
        result: mergedResult
      };
      return updated;
    });
  }

  const appendStreamDelta = useCallback((delta: string) => {
    if (!delta) return;
    setStreamText((prev) => prev + delta);
    setStreamChunks((prev) => [...prev, { id: ++streamChunkIdRef.current, text: delta }]);
  }, []);

  const savePromptStack = useCallback(
    (newBlocks: PromptBlock[]) => {
      const normalized = normalizePromptStack(newBlocks);
      promptStackRef.current = normalized;
      setPromptStack(normalized);
      if (promptStackSaveTimerRef.current) clearTimeout(promptStackSaveTimerRef.current);
      promptStackSaveTimerRef.current = setTimeout(() => {
        api.settingsUpdate({ promptStack: normalized }).then((updated) => {
          const persisted = normalizePromptStack(updated.promptStack);
          promptStackRef.current = persisted;
          setPromptStack(persisted);
        }).catch(() => {});
      }, 350);
    },
    []
  );

  const flushPromptStack = useCallback(async () => {
    if (!promptStackSaveTimerRef.current) return;
    clearTimeout(promptStackSaveTimerRef.current);
    promptStackSaveTimerRef.current = null;
    const normalized = normalizePromptStack(promptStackRef.current);
    const updated = await api.settingsUpdate({ promptStack: normalized });
    const persisted = normalizePromptStack(updated.promptStack);
    promptStackRef.current = persisted;
    setPromptStack(persisted);
  }, []);

  async function handleCreateChat(characterId?: string, multiCharIds?: string[]) {
    const ids = multiCharIds || (characterId ? [characterId] : []);
    const character = ids[0] ? characters.find((c) => c.id === ids[0]) : null;
    const title = character ? (ids.length > 1 ? `${character.name} & others` : character.name) : `Session ${new Date().toLocaleTimeString()}`;
    const created = await api.chatCreate(title, ids[0] || undefined, ids.length > 1 ? ids : undefined);
    const branchList = await api.chatBranches(created.id);
    const initialBranchId = branchList[0]?.id ?? null;
    const timeline = await api.chatTimeline(created.id, initialBranchId || undefined);
    setChats((prev) => [created, ...prev]);
    setActiveChat(created);
    setBranches(branchList);
    setActiveBranchId(initialBranchId);
    setChatCharacterIds(ids);
    setMessages(timeline);
    setShowCharacterPicker(false);
    setShowMultiCharPanel(false);
    textareaRef.current?.focus();
  }

  async function handleDeleteChat(chatId: string) {
    await api.chatDelete(chatId);
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (renamingChatId === chatId) {
      cancelRenameChat();
    }
    if (activeChat?.id === chatId) {
      setActiveChat(null);
      setBranches([]);
      setActiveBranchId(null);
      setMessages([]);
    }
  }

  function startRenameChat(chat: ChatSession) {
    setErrorText("");
    setRenamingChatId(chat.id);
    setRenamingChatTitle(chat.title || "");
  }

  function cancelRenameChat() {
    setRenamingChatId(null);
    setRenamingChatTitle("");
  }

  async function submitRenameChat(chatId: string) {
    const nextTitle = renamingChatTitle.trim();
    if (!nextTitle) {
      setErrorText(t("chat.renameEmptyError"));
      return;
    }
    try {
      const result = await api.chatRename(chatId, nextTitle);
      setChats((prev) => prev.map((chat) => (
        chat.id === chatId ? { ...chat, title: result.title } : chat
      )));
      setActiveChat((prev) => (prev && prev.id === chatId ? { ...prev, title: result.title } : prev));
      cancelRenameChat();
    } catch (error) {
      setErrorText(String(error));
    }
  }

  async function handleSend() {
    if ((!input.trim() && attachments.length === 0) || autoConvoRunning) return;
    setErrorText("");
    setShowModelSelector(false);
    try {
      let chatId = activeChat?.id;
      let branchId = activeBranchId;
      if (!chatId) {
        const title = input.trim().slice(0, 40) + (input.trim().length > 40 ? "..." : "");
        const created = await api.chatCreate(title);
        setChats((prev) => [created, ...prev]);
        setActiveChat(created);
        chatId = created.id;
        const branchList = await api.chatBranches(chatId);
        setBranches(branchList);
        branchId = branchList[0]?.id ?? null;
        setActiveBranchId(branchId);
      }
      await flushPromptStack();
      await api.rpSetSceneState({ ...sceneState, chatId });
      await api.rpUpdateAuthorNote(chatId, authorNote);

      let outgoing = input;
      const currentAttachments = [...attachments];
      if (currentAttachments.length > 0) {
        const textAttachments = currentAttachments.filter((a) => a.type === "text" && a.content);
        if (textAttachments.length > 0) {
          outgoing += "\n\n---\n[Attached files]\n" +
            textAttachments.map((a) => `[${a.filename}]:\n${a.content!.slice(0, 4000)}`).join("\n\n");
        }
      }
      setInput("");
      setAttachments([]);

      const optimisticMsg: ChatMessage = {
        id: `temp-${Date.now()}`, chatId, branchId: branchId || "main",
        role: "user", content: outgoing, attachments: currentAttachments, tokenCount: 0, createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      startStreamingUi(null);

      const updated = await api.chatSend(chatId, outgoing, branchId || undefined, {
        onDelta: appendStreamDelta,
        onToolEvent: handleStreamingToolEvent,
        onDone: () => { stopStreamingUi(); }
      }, activePersonaPayload, currentAttachments);
      setMessages(updated);
    } catch (error) {
      stopStreamingUi();
      setErrorText(String(error));
    }
  }

  async function handleAbort() {
    if (!activeChat) return;
    try {
      await api.chatAbort(activeChat.id);
      stopStreamingUi();
      autoConvoRef.current = false;
      setAutoConvoRunning(false);
      await refreshActiveTimeline();
    } catch (error) {
      setErrorText(String(error));
    }
  }

  async function handleRegenerate() {
    if (!activeChat || autoConvoRunning) return;
    setErrorText("");
    try {
      await flushPromptStack();
      startStreamingUi(null);
      const updated = await api.chatRegenerate(activeChat.id, activeBranchId || undefined, {
        onDelta: appendStreamDelta,
        onToolEvent: handleStreamingToolEvent,
        onDone: () => { stopStreamingUi(); }
      });
      setMessages(updated);
    } catch (error) {
      stopStreamingUi();
      setErrorText(String(error));
    }
  }

  async function handleCompress() {
    if (!activeChat) return;
    setErrorText("");
    setCompressing(true);
    try {
      const result = await api.chatCompressContext(activeChat.id, activeBranchId || undefined);
      setContextSummary(result.summary);
      setInspectorSection((prev) => ({ ...prev, context: true }));
    } catch (error) {
      setErrorText(String(error));
    }
    setCompressing(false);
  }

  async function handleTranslate(msgId: string, inPlace?: boolean) {
    if (translatingId) return;
    setTranslatingId(msgId);
    try {
      const result = await api.chatTranslateMessage(msgId);
      if (inPlace) {
        setInPlaceTranslations((prev) => ({ ...prev, [msgId]: result.translation }));
        // Clear side translation if exists
        setTranslatedTexts((prev) => { const n = { ...prev }; delete n[msgId]; return n; });
      } else {
        setTranslatedTexts((prev) => ({ ...prev, [msgId]: result.translation }));
        // Clear in-place if exists
        setInPlaceTranslations((prev) => { const n = { ...prev }; delete n[msgId]; return n; });
      }
    } catch (error) {
      setErrorText(String(error));
    }
    setTranslatingId(null);
  }

  async function handleTts(msgId: string) {
    if (ttsLoadingId) return;

    if (ttsPlayingId === msgId && ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      setTtsPlayingId(null);
      return;
    }

    setTtsLoadingId(msgId);
    try {
      const blob = await api.chatTtsMessage(msgId);

      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      if (ttsAudioUrlRef.current) {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(blob);
      ttsAudioUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      ttsAudioRef.current = audio;
      audio.onended = () => {
        setTtsPlayingId((prev) => (prev === msgId ? null : prev));
      };
      audio.onerror = () => {
        setTtsPlayingId((prev) => (prev === msgId ? null : prev));
      };
      setTtsPlayingId(msgId);
      await audio.play();
    } catch (error) {
      setTtsPlayingId(null);
      setErrorText(String(error));
    } finally {
      setTtsLoadingId(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(e.target.files)) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => { const r = reader.result as string; resolve(r.split(",")[1] || r); };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const attachment = await api.uploadFile(base64, file.name);
        const mimeType = attachment.mimeType || file.type || guessMimeType(file.name);
        const normalizedAttachment: FileAttachment = {
          ...attachment,
          mimeType
        };
        if (attachment.type === "image") {
          normalizedAttachment.dataUrl = `data:${mimeType};base64,${base64}`;
        }
        setAttachments((prev) => [...prev, normalizedAttachment]);
      }
    } catch (error) { setErrorText(String(error)); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) { setAttachments((prev) => prev.filter((a) => a.id !== id)); }

  async function handleFork(message: ChatMessage) {
    if (!activeChat) return;
    try {
      const branch = await api.chatFork(activeChat.id, message.id, `Branch ${message.id.slice(0, 6)}`);
      const branchList = await api.chatBranches(activeChat.id);
      setBranches(branchList);
      setActiveBranchId(branch.id);
      setMessages(await api.chatTimeline(activeChat.id, branch.id));
    } catch (error) {
      setErrorText(String(error));
    }
  }

  async function handleDelete(messageId: string) {
    if (deletingMessageIds[messageId]) return;
    setDeletingMessageIds((prev) => ({ ...prev, [messageId]: true }));
    try {
      await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELETE_ANIMATION_MS));
      const result = await api.chatDeleteMessage(messageId);
      setMessages(result.timeline);
    } catch (error) {
      setErrorText(String(error));
    } finally {
      setDeletingMessageIds((prev) => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  }

  async function saveEdit(messageId: string) {
    const result = await api.chatEditMessage(messageId, editingValue);
    setEditingId(null);
    setEditingValue("");
    setMessages(result.timeline);
  }

  async function applyPreset(preset: string) {
    if (!activeChat) return;
    try {
      const result = await api.rpApplyStylePreset(activeChat.id, preset);
      if (result.sceneState) {
        const nextMode = resolveChatMode(result.sceneState);
        setSceneState({
          chatId: activeChat.id,
          mood: result.sceneState.mood || DEFAULT_SCENE_STATE.mood,
          pacing: result.sceneState.pacing || DEFAULT_SCENE_STATE.pacing,
          intensity: typeof result.sceneState.intensity === "number" ? result.sceneState.intensity : DEFAULT_SCENE_STATE.intensity,
          variables: sanitizeSceneVariables(result.sceneState.variables),
          chatMode: nextMode,
          pureChatMode: nextMode === "pure_chat"
        });
      }
      setActivePreset(preset);
      api.chatSavePreset(activeChat.id, preset).catch(() => {});
    } catch (error) {
      setErrorText(String(error));
    }
  }

  async function applyModelFromChat() {
    if (!chatProviderId || !chatModelId) return;
    try {
      const updated = await api.providerSetActive(chatProviderId, chatModelId);
      setActiveModelLabel(updated.activeModel || "");
      if (updated.activeProviderId) setChatProviderId(updated.activeProviderId);
      if (updated.activeModel) setChatModelId(updated.activeModel);
      setShowModelSelector(false);
      if (updated.samplerConfig) setSamplerConfig(updated.samplerConfig);
    } catch (error) {
      setErrorText(String(error));
    }
  }

  function parsePhraseBansInput(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function applyChatCharactersResult(
    chatId: string,
    result: { characterIds: string[]; characterId: string | null }
  ) {
    setChatCharacterIds(result.characterIds);
    setActiveChat((prev) => (
      prev && prev.id === chatId
        ? { ...prev, characterIds: result.characterIds, characterId: result.characterId }
        : prev
    ));
    setChats((prev) => prev.map((chat) => (
      chat.id === chatId
        ? { ...chat, characterIds: result.characterIds, characterId: result.characterId }
        : chat
    )));
  }

  // Multi-character: add/remove characters from chat
  async function addCharacterToChat(charId: string) {
    if (!activeChat || chatCharacterIds.includes(charId)) return;
    const chatId = activeChat.id;
    const prevIds = [...chatCharacterIds];
    const newIds = [...chatCharacterIds, charId];
    setChatCharacterIds(newIds);
    try {
      const result = await api.chatUpdateCharacters(chatId, newIds);
      applyChatCharactersResult(chatId, result);
    } catch (error) {
      setChatCharacterIds(prevIds);
      setErrorText(String(error));
    }
  }

  async function removeCharacterFromChat(charId: string) {
    if (!activeChat) return;
    const chatId = activeChat.id;
    const prevIds = [...chatCharacterIds];
    const newIds = chatCharacterIds.filter((id) => id !== charId);
    setChatCharacterIds(newIds);
    try {
      const result = await api.chatUpdateCharacters(chatId, newIds);
      applyChatCharactersResult(chatId, result);
    } catch (error) {
      setChatCharacterIds(prevIds);
      setErrorText(String(error));
    }
  }

  async function reorderCharactersInChat(sourceId: string, targetId: string) {
    if (!activeChat || sourceId === targetId) return;
    const chatId = activeChat.id;
    const prevIds = [...chatCharacterIds];
    const sourceIndex = prevIds.indexOf(sourceId);
    const targetIndex = prevIds.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextIds = [...prevIds];
    const [moved] = nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, moved);

    setChatCharacterIds(nextIds);
    try {
      const result = await api.chatUpdateCharacters(chatId, nextIds);
      applyChatCharactersResult(chatId, result);
    } catch (error) {
      setChatCharacterIds(prevIds);
      setErrorText(String(error));
    }
  }

  async function saveLorebooksForChat(nextLorebookIds: string[]) {
    if (!activeChat) return;
    const normalizedIds = Array.from(new Set(nextLorebookIds.map((id) => String(id || "").trim()).filter(Boolean)));
    const primaryLorebookId = normalizedIds[0] || null;
    setActiveLorebookIds(normalizedIds);
    setActiveChat({ ...activeChat, lorebookId: primaryLorebookId, lorebookIds: normalizedIds });
    setChats((prev) => prev.map((chat) => (
      chat.id === activeChat.id ? { ...chat, lorebookId: primaryLorebookId, lorebookIds: normalizedIds } : chat
    )));

    if (normalizedIds.length > 0) {
      const hasEnabledLoreBlock = orderedBlocks.some((block) => block.kind === "lore" && block.enabled);
      if (!hasEnabledLoreBlock) {
        const updatedBlocks = orderedBlocks.map((block) => (
          block.kind === "lore" ? { ...block, enabled: true } : block
        ));
        savePromptStack(updatedBlocks);
      }
    }

    try {
      await api.chatSaveLorebooks(activeChat.id, normalizedIds);
    } catch (error) {
      setErrorText(String(error));
    }
  }

  async function toggleLorebookForChat(lorebookId: string, enabled: boolean) {
    const nextIds = enabled
      ? [...activeLorebookIds, lorebookId]
      : activeLorebookIds.filter((id) => id !== lorebookId);
    await saveLorebooksForChat(nextIds);
  }

  async function updateChatRag(nextEnabled: boolean, nextCollectionIds: string[]) {
    if (!activeChat) return;
    const normalizedIds = Array.from(new Set(nextCollectionIds.map((id) => String(id || "").trim()).filter(Boolean)));
    setChatRagEnabled(nextEnabled);
    setChatRagCollectionIds(normalizedIds);
    try {
      await api.chatSaveRag(activeChat.id, nextEnabled, normalizedIds);
    } catch (error) {
      setErrorText(String(error));
    }
  }

  // Next turn for a specific character (multi-char)
  async function handleNextTurn(characterName: string) {
    if (!activeChat || streaming || autoConvoRunning) return;
    setErrorText("");
    startStreamingUi(characterName);
    try {
      await flushPromptStack();
      const updated = await api.chatNextTurn(activeChat.id, characterName, activeBranchId || undefined, {
        onDelta: appendStreamDelta,
        onToolEvent: handleStreamingToolEvent,
        onDone: () => { stopStreamingUi(); }
      }, false, activePersonaPayload);
      setMessages(updated);
    } catch (error) {
      stopStreamingUi();
      setErrorText(String(error));
    }
  }

  // Auto-conversation: characters take turns automatically
  async function startAutoConversation() {
    if (!activeChat || chatCharacterIds.length < 2 || autoConvoRunning || streaming) return;
    await flushPromptStack();
    autoConvoRef.current = true;
    setAutoConvoRunning(true);

    const charNames = chatCharacterIds
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is CharacterDetail => Boolean(c))
      .map((c) => c.name);

    if (charNames.length < 2) {
      autoConvoRef.current = false;
      setAutoConvoRunning(false);
      return;
    }
    const lastAssistantChar = [...messages]
      .reverse()
      .find((msg) => msg.role === "assistant" && msg.characterName && charNames.includes(msg.characterName))
      ?.characterName;
    const startIndex = lastAssistantChar
      ? (Math.max(0, charNames.indexOf(lastAssistantChar)) + 1) % charNames.length
      : 0;
    const turns = Number.isFinite(autoTurnsCount) ? Math.max(1, Math.min(50, Math.floor(autoTurnsCount))) : 1;

    for (let turn = 0; turn < turns; turn++) {
      if (!autoConvoRef.current) break;

      const charName = charNames[(startIndex + turn) % charNames.length];
      startStreamingUi(charName);

      try {
        const updated = await api.chatNextTurn(activeChat.id, charName, activeBranchId || undefined, {
          onDelta: appendStreamDelta,
          onToolEvent: handleStreamingToolEvent,
          onDone: () => { stopStreamingUi(); }
        }, true, activePersonaPayload); // isAutoConvo = true
        setMessages(updated);
      } catch (error) {
        stopStreamingUi();
        setErrorText(String(error));
        break;
      }

      if (autoConvoRef.current && turn < turns - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    autoConvoRef.current = false;
    setAutoConvoRunning(false);
    stopStreamingUi();
  }

  function stopAutoConversation() {
    autoConvoRef.current = false;
    setAutoConvoRunning(false);
    stopStreamingUi();
    if (activeChat) {
      api.chatAbort(activeChat.id).catch(() => {});
    }
  }

  function setChatMode(nextMode: ChatMode) {
    setSceneState((prev) => ({
      ...prev,
      chatMode: nextMode,
      pureChatMode: nextMode === "pure_chat"
    }));
  }

  function setSystemPromptContent(content: string) {
    const normalized = String(content || "");
    const existing = orderedBlocks.find((block) => block.kind === "system");
    let updated: PromptBlock[];
    if (existing) {
      updated = orderedBlocks.map((block) => (
        block.kind === "system" ? { ...block, content: normalized } : block
      ));
    } else {
      const maxOrder = orderedBlocks.reduce((max, block) => Math.max(max, block.order), 0);
      updated = [
        ...orderedBlocks,
        {
          id: `system-${Date.now()}`,
          kind: "system",
          enabled: true,
          order: maxOrder + 1,
          content: normalized
        }
      ];
    }
    savePromptStack(updated);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function setSceneVariable(key: string, value: string) {
    setSceneState((prev) => ({
      ...prev,
      variables: { ...prev.variables, [key]: value }
    }));
  }

  function setSceneVariablePercent(key: string, value: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setSceneVariable(key, String(clamped));
  }

  function toggleSection(key: string) {
    setInspectorSection((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Get character info for message display
  const chatCharacters = useMemo(() => {
    return chatCharacterIds
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is CharacterDetail => Boolean(c));
  }, [chatCharacterIds, characters]);

  const chatRagCollectionsAvailable = useMemo(
    () => ragCollections.filter((collection) => collection.scope === "global" || collection.scope === "chat"),
    [ragCollections]
  );

  const activeChatCharacter = useMemo(() => {
    if (!activeChat?.characterId && chatCharacterIds.length === 0) return null;
    const primaryId = chatCharacterIds[0] || activeChat?.characterId;
    return primaryId ? characters.find((c) => c.id === primaryId) ?? null : null;
  }, [activeChat, chatCharacterIds, characters]);

  const streamingRenderedHtml = useMemo(() => {
    if (!streamText) return "";
    const streamChar = streamingCharacterName
      ? (chatCharacters.find((item) => item.name === streamingCharacterName) ?? null)
      : activeChatCharacter;
    const renderCharName = streamChar?.name || activeChatCharacter?.name;
    return renderContent(
      streamText,
      renderCharName,
      activePersona?.name || t("chat.user"),
      securitySettings
    );
  }, [streamText, streamingCharacterName, chatCharacters, activeChatCharacter, activePersona, t, securitySettings]);

  function getCharacterForMessage(msg: ChatMessage): CharacterDetail | null {
    if (msg.characterName) {
      return chatCharacters.find((c) => c.name === msg.characterName) ?? null;
    }
    return activeChatCharacter;
  }

  async function handleRenderedContentClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) {
      event.preventDefault();
      return;
    }
    if (!securitySettings.allowExternalLinks) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (window.electronAPI) {
      await window.electronAPI.openExternal(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  // Persona helpers
  async function savePersona() {
    if (!editingPersona) return;
    if (editingPersona.id) {
      const updated = await api.personaUpdate(editingPersona.id, editingPersona);
      setPersonas((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      if (activePersona?.id === updated.id) setActivePersona(updated);
    } else {
      const created = await api.personaCreate(editingPersona);
      setPersonas((prev) => [...prev, created]);
      setActivePersona(created);
    }
    setEditingPersona(null);
  }

  async function deletePersona(id: string) {
    await api.personaDelete(id);
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    if (activePersona?.id === id) setActivePersona(null);
    setEditingPersona(null);
  }

  return (
    <>
      {/* Persona Modal */}
      {showPersonaModal && (
        <div className="overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowPersonaModal(false); setEditingPersona(null); }}>
          <div className="modal-pop w-full max-w-lg rounded-xl border border-border bg-bg-secondary p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t("chat.personas")}</h2>
              <button onClick={() => { setShowPersonaModal(false); setEditingPersona(null); }}
                className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editingPersona ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaName")}</label>
                  <input value={editingPersona.name} onChange={(e) => setEditingPersona({ ...editingPersona, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaDesc")}</label>
                  <textarea value={editingPersona.description} onChange={(e) => setEditingPersona({ ...editingPersona, description: e.target.value })}
                    className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaPersonality")}</label>
                  <textarea value={editingPersona.personality} onChange={(e) => setEditingPersona({ ...editingPersona, personality: e.target.value })}
                    className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={savePersona}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">
                    {t("chat.save")}
                  </button>
                  <button onClick={() => setEditingPersona(null)}
                    className="rounded-lg border border-border px-4 py-2 text-xs text-text-secondary hover:bg-bg-hover">
                    {t("chat.cancel")}
                  </button>
                  {editingPersona.id && (
                    <button onClick={() => deletePersona(editingPersona.id)}
                      className="ml-auto rounded-lg px-4 py-2 text-xs text-danger/70 hover:bg-danger-subtle hover:text-danger">
                      {t("chat.deletePersona")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {personas.map((p) => (
                  <div key={p.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    activePersona?.id === p.id ? "border-accent bg-accent-subtle" : "border-border bg-bg-primary"
                  }`}>
                    <button onClick={() => { setActivePersona(p); setShowPersonaModal(false); }}
                      className="flex-1 text-left">
                      <div className="text-sm font-medium text-text-primary">
                        {p.name} {p.isDefault && <span className="text-[10px] text-accent">★ {t("chat.default")}</span>}
                      </div>
                      {p.description && <div className="mt-0.5 truncate text-xs text-text-tertiary">{p.description}</div>}
                    </button>
                    <div className="ml-2 flex gap-1">
                      {!p.isDefault && (
                        <button onClick={async () => {
                          await api.personaSetDefault(p.id);
                          setPersonas((prev) => prev.map((x) => ({ ...x, isDefault: x.id === p.id })));
                        }}
                          className="rounded-md px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-accent">
                          {t("chat.setDefault")}
                        </button>
                      )}
                      <button onClick={() => setEditingPersona(p)}
                        className="rounded-md px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">
                        {t("chat.edit")}
                      </button>
                    </div>
                  </div>
                ))}
                <button onClick={() => setEditingPersona({ id: "", name: "", description: "", personality: "", scenario: "", isDefault: false, createdAt: "" })}
                  className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">
                  + {t("chat.newPersona")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {simpleModeActive && simpleSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="chat-simple-overlay chat-simple-overlay-sidebar xl:hidden"
          onClick={() => openSimpleSidebar(false)}
        />
      )}

      {simpleModeActive && simpleSceneOpen && (
        <>
          <div className="chat-simple-scene-modal" role="dialog" aria-modal="true">
            <div className="chat-simple-scene-modal-header">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">{t("inspector.sceneState")}</h3>
                <p className="mt-0.5 text-[11px] text-text-tertiary">{t("inspector.sceneState")}</p>
              </div>
              <button
                onClick={() => setSimpleSceneOpen(false)}
                className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
              >
                {t("chat.cancel")}
              </button>
            </div>
            <div className="chat-simple-scene-modal-body">
              <fieldset disabled={pureChatMode} className="space-y-2 disabled:opacity-50">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.mood")}</label>
                    <input
                      value={sceneState.mood}
                      onChange={(e) => setSceneState((prev) => ({ ...prev, mood: e.target.value }))}
                      className="chat-simple-scene-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.pacing")}</label>
                    <select
                      value={sceneState.pacing}
                      onChange={(e) => setSceneState((prev) => ({ ...prev, pacing: e.target.value as "slow" | "balanced" | "fast" }))}
                      className="chat-simple-scene-select"
                    >
                      <option value="slow">{t("inspector.slow")}</option>
                      <option value="balanced">{t("inspector.balanced")}</option>
                      <option value="fast">{t("inspector.fast")}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[10px] text-text-tertiary">{t("inspector.intensity")}</label>
                    <span className="text-[10px] font-medium text-text-secondary">{Math.round(sceneState.intensity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sceneState.intensity}
                    onChange={(e) => setSceneState((prev) => ({ ...prev, intensity: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
                {sceneFieldVisibility.dialogueStyle && (
                  <div>
                    <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.dialogueStyle")}</label>
                    <select
                      value={sceneState.variables.dialogueStyle || "teasing"}
                      onChange={(e) => setSceneVariable("dialogueStyle", e.target.value)}
                      className="chat-simple-scene-select"
                    >
                      <option value="teasing">{t("inspector.dialogueStyleTeasing")}</option>
                      <option value="playful">{t("inspector.dialogueStylePlayful")}</option>
                      <option value="dominant">{t("inspector.dialogueStyleDominant")}</option>
                      <option value="tender">{t("inspector.dialogueStyleTender")}</option>
                      <option value="formal">{t("inspector.dialogueStyleFormal")}</option>
                      <option value="chaotic">{t("inspector.dialogueStyleChaotic")}</option>
                    </select>
                  </div>
                )}
                {[
                  { key: "initiative", label: t("inspector.initiative") },
                  { key: "descriptiveness", label: t("inspector.descriptiveness") },
                  { key: "unpredictability", label: t("inspector.unpredictability") },
                  { key: "emotionalDepth", label: t("inspector.emotionalDepth") }
                ].filter((item) => sceneFieldVisibility[item.key as keyof typeof sceneFieldVisibility]).map((item) => {
                  const value = readSceneVarPercent(sceneState.variables, item.key, 60);
                  return (
                    <div key={item.key}>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] text-text-tertiary">{item.label}</label>
                        <span className="text-[10px] font-medium text-text-secondary">{value}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={value}
                        onChange={(e) => setSceneVariablePercent(item.key, Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  );
                })}
                {visibleCustomSceneFields.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {visibleCustomSceneFields.map((field) => renderCustomSceneField(field))}
                  </div>
                )}
              </fieldset>
              {pureChatMode && (
                <p className="text-[10px] text-text-tertiary">{t("inspector.pureChatSceneDisabled")}</p>
              )}
            </div>
          </div>
        </>
      )}

      <ThreePanelLayout
        layout={zenMode ? "center" : "three"}
        className={simpleModeActive ? `chat-simple-layout ${simpleSidebarOpen ? "is-sidebar-open" : "is-sidebar-closed"} ${simpleInspectorOpen ? "is-inspector-open" : "is-inspector-closed"} ${simpleHomeState ? "is-home" : "is-thread"}` : ""}
        leftClassName={simpleModeActive ? "chat-simple-sidebar-panel" : ""}
        centerClassName={simpleModeActive ? "chat-simple-center-panel" : ""}
        rightClassName={simpleModeActive ? "chat-simple-right-panel" : ""}
        left={
          <>
            {simpleModeActive ? (
              <>
                <div className={`chat-simple-sidebar-header ${simpleSidebarCollapsed ? "is-collapsed" : "is-open"}`}>
                  <button
                    onClick={() => openSimpleSidebar()}
                    className="chat-simple-sidebar-toggle"
                    title={simpleSidebarCollapsed ? t("chat.title") : t("chat.cancel")}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  {!simpleSidebarCollapsed && (
                    <div className="min-w-0">
                      <div className="truncate text-2xl font-semibold text-text-primary">{t("app.name")}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{t("chat.title")}</div>
                    </div>
                  )}
                </div>
                <div className={`chat-simple-actions ${simpleSidebarCollapsed ? "is-collapsed" : "is-open"}`}>
                  <button
                    onClick={() => handleCreateChat()}
                    className="chat-simple-action-button"
                    title={t("chat.new")}
                  >
                    <span className="chat-simple-action-icon">+</span>
                    {!simpleSidebarCollapsed && <span>{t("chat.new")}</span>}
                  </button>
                  <button
                    onClick={() => {
                      setSimpleSidebarOpen(true);
                      setTimeout(() => chatSearchInputRef.current?.focus(), 80);
                    }}
                    className="chat-simple-action-button"
                    title={t("chat.searchChats")}
                  >
                    <svg className="chat-simple-action-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
                    </svg>
                    {!simpleSidebarCollapsed && <span>{t("chat.searchChats")}</span>}
                  </button>
                  <button
                    onClick={() => {
                      setSimpleSidebarOpen(true);
                      setShowCharacterPicker((prev) => !prev);
                    }}
                    className="chat-simple-action-button"
                    title={t("chat.pickCharacter")}
                  >
                    <svg className="chat-simple-action-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {!simpleSidebarCollapsed && <span>{t("chat.pickCharacter")}</span>}
                  </button>
                  <button
                    onClick={() => {
                      setSimpleSidebarOpen(true);
                      setShowMultiCharPanel((prev) => !prev);
                    }}
                    className="chat-simple-action-button"
                    title={t("chat.multiChar")}
                  >
                    <svg className="chat-simple-action-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {!simpleSidebarCollapsed && <span>{t("chat.multiChar")}</span>}
                  </button>
                </div>
              </>
            ) : (
              <PanelTitle
                action={
                  <div className="flex gap-1">
                    <button onClick={() => setShowMultiCharPanel(!showMultiCharPanel)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                      title={t("chat.multiChar")}>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </button>
                    <button onClick={() => setShowCharacterPicker(true)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                      title={t("chat.pickCharacter")}>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </button>
                    <button onClick={() => handleCreateChat()}
                      className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {t("chat.new")}
                    </button>
                  </div>
                }
              >
                {t("chat.title")}
              </PanelTitle>
            )}

            {!simpleSidebarCollapsed && showCharacterPicker && (
              <div className="mb-3 rounded-lg border border-accent-border bg-bg-primary p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t("chat.pickCharacter")}</span>
                  <button onClick={() => setShowCharacterPicker(false)} className="text-text-tertiary hover:text-text-primary">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {characters.length === 0 ? (
                  <p className="text-xs text-text-tertiary">{t("chat.noCharacters")}</p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {characters.map((char) => (
                      <button key={char.id}
                        onClick={() => handleCreateChat(char.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-hover">
                        {char.avatarUrl ? (
                          <img src={resolveApiAssetUrl(char.avatarUrl) ?? undefined}
                            alt={char.name} className="h-6 w-6 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-subtle text-[10px] font-bold text-accent">
                            {char.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate text-xs font-medium text-text-primary">{char.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => handleCreateChat()}
                  className="mt-2 w-full rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover">
                  {t("chat.noCharacter")}
                </button>
              </div>
            )}

            {/* Multi-character panel */}
            {!simpleSidebarCollapsed && showMultiCharPanel && (
              <div className="mb-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">{t("chat.multiChar")}</span>
                  <button onClick={() => setShowMultiCharPanel(false)} className="text-text-tertiary hover:text-text-primary">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {chatCharacterIds.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {chatCharacterIds.map((cid) => {
                      const ch = characters.find((c) => c.id === cid);
                      if (!ch) return null;
                      return (
                        <div
                          key={cid}
                          className={`flex items-center justify-between rounded-md bg-bg-secondary px-2 py-1 ${draggingCharacterId === cid ? "opacity-60" : ""}`}
                          draggable={chatCharacterIds.length > 1}
                          onDragStart={(e) => {
                            setDraggingCharacterId(cid);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (!draggingCharacterId || draggingCharacterId === cid) return;
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!draggingCharacterId || draggingCharacterId === cid) return;
                            void reorderCharactersInChat(draggingCharacterId, cid);
                            setDraggingCharacterId(null);
                          }}
                          onDragEnd={() => setDraggingCharacterId(null)}
                        >
                          <span className="truncate text-xs text-text-primary">{ch.name}</span>
                          <button onClick={() => removeCharacterFromChat(cid)}
                            className="text-[10px] text-danger/60 hover:text-danger">{t("chat.removeCharacter")}</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {characters.filter((c) => !chatCharacterIds.includes(c.id)).map((char) => (
                    <button key={char.id} onClick={() => addCharacterToChat(char.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-text-secondary hover:bg-bg-hover">
                      <span>+</span>
                      <span>{char.name}</span>
                    </button>
                  ))}
                </div>

                {chatCharacterIds.length >= 2 && (
                  <button onClick={() => {
                    const multiIds = [...chatCharacterIds];
                    setShowMultiCharPanel(false);
                    handleCreateChat(multiIds[0], multiIds);
                  }}
                    className="mt-2 w-full rounded-md bg-purple-500/20 px-2 py-1.5 text-[11px] font-medium text-purple-300 hover:bg-purple-500/30">
                    Create Multi-Char Chat ({chatCharacterIds.length})
                  </button>
                )}
              </div>
            )}

            {!simpleSidebarCollapsed && (
            <div className="mb-2">
              <input
                ref={chatSearchInputRef}
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                placeholder={t("chat.searchChats")}
                className="w-full rounded-lg border border-border bg-bg-primary px-2.5 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
              />
            </div>
            )}

            {!simpleSidebarCollapsed && (
            <div className="chat-sidebar-list flex-1 space-y-1 overflow-y-auto">
              {chats.length === 0 ? (
                <EmptyState title={t("chat.noChatYet")} description={t("chat.noChatDesc")} />
              ) : filteredChats.length === 0 ? (
                <EmptyState title={t("chat.noSearchResults")} description={t("chat.noSearchResultsDesc")} />
              ) : (
                filteredChats.map((chat, index) => {
                  const primaryChatCharacterId = chat.characterId || chat.characterIds?.[0] || null;
                  const chatChar = primaryChatCharacterId ? characters.find((c) => c.id === primaryChatCharacterId) : null;
                  const multiCount = chat.characterIds?.length || 0;
                  const isRenaming = renamingChatId === chat.id;
                  return (
                    <div key={chat.id}
                      style={{ animationDelay: `${Math.min(index, 20) * 20}ms` }}
                      className={`chat-sidebar-item group relative flex items-start gap-2 rounded-lg ${simpleModeActive ? "px-2 py-2" : "px-3 py-2"} transition-colors ${
                        activeChat?.id === chat.id ? "bg-accent-subtle text-text-primary" : "text-text-secondary hover:bg-bg-hover"
                      }`}>
                      {isRenaming ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            value={renamingChatTitle}
                            onChange={(e) => setRenamingChatTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void submitRenameChat(chat.id);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRenameChat();
                              }
                            }}
                            className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
                            autoFocus
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void submitRenameChat(chat.id);
                            }}
                            className="rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            title={t("chat.rename")}
                          >
                            {t("chat.save")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelRenameChat();
                            }}
                            className="rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            title={t("chat.cancel")}
                          >
                            {t("chat.cancel")}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => {
                            setActiveChat(chat);
                            if (simpleModeActive && window.innerWidth < 1280) {
                              setSimpleSidebarOpen(false);
                            }
                          }} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                            {chatChar?.avatarUrl ? (
                              <img src={resolveApiAssetUrl(chatChar.avatarUrl) ?? undefined}
                                alt="" className="h-6 w-6 flex-shrink-0 rounded-full object-cover" />
                            ) : chatChar ? (
                              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[9px] font-bold text-accent">
                                {chatChar.name.charAt(0).toUpperCase()}
                              </div>
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="break-words whitespace-normal text-sm font-medium leading-snug">{chat.title}</div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <span className="text-[11px] text-text-tertiary">{new Date(chat.createdAt).toLocaleTimeString()}</span>
                                {multiCount > 1 && <Badge>{multiCount} chars</Badge>}
                              </div>
                            </div>
                          </button>
                          <div className={`flex flex-shrink-0 items-center gap-0.5 transition-opacity ${
                            activeChat?.id === chat.id ? "opacity-100" : "opacity-60 group-hover:opacity-100"
                          }`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startRenameChat(chat);
                              }}
                              className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                              title={t("chat.renameChat")}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 8.586-8.586z" />
                              </svg>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); if (confirm(t("chat.confirmDeleteChat"))) handleDeleteChat(chat.id); }}
                              className="rounded-md p-1 text-text-tertiary hover:bg-danger-subtle hover:text-danger"
                              title={t("chat.deleteChat")}>
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            )}

            {/* RP Presets — collapsible */}
            {!simpleSidebarCollapsed && (
            <div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary p-3">
              <button onClick={() => setPresetsCollapsed(!presetsCollapsed)}
                className="flex w-full items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.rpPresets")}</span>
                <svg className={`h-3 w-3 text-text-tertiary transition-transform ${presetsCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!presetsCollapsed && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {RP_PRESETS.map((preset) => (
                    <button key={preset} onClick={() => applyPreset(preset)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                        activePreset === preset
                          ? "bg-accent text-text-inverse"
                          : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      }`}>
                      {t(`preset.${preset}` as keyof typeof import("../../shared/i18n").translations.en)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {!simpleSidebarCollapsed && simpleModeActive && (
            <div className="mt-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.lorebook")}</label>
              <div className="space-y-1.5">
                <button
                  onClick={() => { void saveLorebooksForChat([]); }}
                  className="w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-left text-[11px] text-text-secondary hover:bg-bg-hover"
                >
                  {t("chat.none")}
                </button>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {lorebooks.map((book) => {
                    const checked = activeLorebookIds.includes(book.id);
                    return (
                      <label
                        key={book.id}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          checked
                            ? "border-accent-border bg-accent-subtle text-text-primary"
                            : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => { void toggleLorebookForChat(book.id, event.target.checked); }}
                        />
                        <span className="min-w-0 flex-1 truncate">{book.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            )}

            {/* User Persona — compact, opens modal */}
            {!simpleSidebarCollapsed && simpleModeActive && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.userPersona")}:</span>
              <span className="flex-1 truncate text-xs font-medium text-text-primary">{activePersona?.name || t("chat.user")}</span>
              <button onClick={() => setShowPersonaModal(true)}
                className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">
                {t("chat.edit")}
              </button>
            </div>
            )}
            <PluginSlotMount
              slotId="chat.sidebar.bottom"
              contextPayload={{
                chatId: activeChat?.id || null,
                branchId: activeBranchId,
                mode: chatMode,
                simpleMode: simpleModeActive
              }}
            />
          </>
        }
        center={
          <>
            {simpleModeActive && (
              <div className={`chat-simple-ambient ${simpleHomeState ? "is-home" : "is-thread"}`} aria-hidden="true">
                <span className="chat-simple-blob blob-a" />
                <span className="chat-simple-blob blob-b" />
                <span className="chat-simple-blob blob-c" />
              </div>
            )}
            {simpleModeActive && simpleHomeState && (
              <div className="chat-simple-top-controls">
                <button
                  onClick={() => openSimpleSidebar()}
                  className="chat-simple-top-button chat-simple-top-sidebar xl:hidden"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  {t("chat.title")}
                </button>
              </div>
            )}

            {(!simpleModeActive || !simpleHomeState) && (
            <div className={`mb-3 ${simpleModeActive ? "chat-simple-thread-header" : ""}`}>
              {!simpleModeActive ? (
                <div className="rounded-xl border border-border-subtle bg-bg-primary/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-text-primary">
                          {activeChat ? activeChat.title : t("tab.chat")}
                        </h2>
                        {!zenMode && totalTokens > 0 && <Badge>{totalTokens.toLocaleString()} tok</Badge>}
                        {!zenMode && branches.length > 0 && (
                          <select
                            value={activeBranchId || ""}
                            onChange={(e) => setActiveBranchId(e.target.value || null)}
                            className="rounded-md border border-border bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary"
                            title={t("chat.branch")}
                          >
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(180px,1fr)_minmax(240px,1.2fr)_160px_auto]">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("settings.provider")}</label>
                          <select
                            value={chatProviderId}
                            onChange={(e) => setChatProviderId(e.target.value)}
                            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary"
                          >
                            <option value="">{t("settings.selectProvider")}</option>
                            {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.model")}</label>
                          <select
                            value={chatModelId}
                            onChange={(e) => setChatModelId(e.target.value)}
                            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary"
                          >
                            <option value="">{t("settings.selectModel")}</option>
                            {models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("inspector.chatMode")}</label>
                          <select
                            value={chatMode}
                            onChange={(e) => setChatMode(e.target.value as ChatMode)}
                            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary"
                          >
                            <option value="rp">{t("inspector.modeRp")}</option>
                            <option value="light_rp">{t("inspector.modeLightRp")}</option>
                            <option value="pure_chat">{t("inspector.modePureChat")}</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => { void applyModelFromChat(); }}
                            disabled={!chatProviderId || !chatModelId}
                            className="w-full rounded-lg bg-accent px-3 py-2 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t("chat.ok")}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
                        {activeModelLabel ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2 py-1 text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            {activeModelLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-2 py-1 text-warning">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            {t("chat.noModel")}
                          </span>
                        )}
                        {loadingModels && <span>{t("chat.loading")}</span>}
                        {chatMode === "light_rp" && <span>{t("inspector.modeLightRpHint")}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {streaming && (
                        <button onClick={handleAbort}
                          className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-danger/20">
                          {t("chat.stop")}
                        </button>
                      )}
                      <button onClick={handleRegenerate}
                        disabled={streaming || autoConvoRunning || !activeChat || messages.length === 0}
                        className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40">
                        {t("chat.regenerate")}
                      </button>
                      <button onClick={handleCompress}
                        disabled={compressing || streaming || !activeChat || messages.length < 4}
                        className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          compressing
                            ? "border-accent bg-accent-subtle text-accent"
                            : "border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        } disabled:cursor-not-allowed disabled:opacity-40`}>
                        {compressing ? t("chat.compressing") : t("chat.compress")}
                      </button>
                      <button
                        onClick={() => setZenMode((prev) => !prev)}
                        className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          zenMode
                            ? "border-accent-border bg-accent-subtle text-accent"
                            : "border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        }`}
                        title={zenMode ? t("chat.exitZenMode") : t("chat.zenMode")}
                      >
                        {zenMode ? t("chat.exitZenMode") : t("chat.zenMode")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="chat-simple-thread-bar">
                  <button
                    onClick={() => openSimpleSidebar()}
                    className="chat-simple-thread-sidebar xl:hidden"
                    title={t("chat.title")}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <h2 className="chat-simple-thread-title truncate">
                    {activeChat ? activeChat.title : t("tab.chat")}
                  </h2>
                  {!zenMode && totalTokens > 0 && <Badge>{totalTokens.toLocaleString()} tok</Badge>}
                  {!zenMode && branches.length > 0 && (
                    <select
                      value={activeBranchId || ""}
                      onChange={(e) => setActiveBranchId(e.target.value || null)}
                      className="rounded-md border border-border bg-bg-primary px-2 py-0.5 text-[10px] text-text-secondary"
                      title={t("chat.branch")}
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex-1" />
                  {activeModelLabel && (
                    <span className="chat-simple-thread-model-badge">
                      <span className="chat-simple-thread-model-dot" />
                      {activeModelLabel}
                    </span>
                  )}
                  <div className="chat-simple-thread-actions">
                    {streaming && (
                      <button onClick={handleAbort}
                        className="chat-simple-thread-action-btn is-danger">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                        {t("chat.stop")}
                      </button>
                    )}
                    <button onClick={handleRegenerate}
                      disabled={streaming || autoConvoRunning || !activeChat || messages.length === 0}
                      className="chat-simple-thread-action-btn" title={t("chat.regenerate")}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h4.586M20 20v-5h-4.586M4.93 9A8 8 0 0119.07 9M19.07 15A8 8 0 014.93 15" />
                      </svg>
                    </button>
                    <button onClick={handleCompress}
                      disabled={compressing || streaming || !activeChat || messages.length < 4}
                      className={`chat-simple-thread-action-btn ${compressing ? "is-active" : ""}`}
                      title={compressing ? t("chat.compressing") : t("chat.compress")}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                    <span className="chat-simple-thread-divider" />
                    <button
                      onClick={() => {
                        setSimpleSceneOpen((prev) => {
                          const next = !prev;
                          if (next) openSimpleInspector(false);
                          return next;
                        });
                      }}
                      className={`chat-simple-thread-action-btn ${simpleSceneOpen ? "is-active" : ""}`}
                      title={t("inspector.sceneState")}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        setSimpleSceneOpen(false);
                        openSimpleInspector();
                      }}
                      className={`chat-simple-thread-action-btn ${simpleInspectorOpen ? "is-active" : ""}`}
                      title={t("inspector.title")}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {errorText && (
              <div className={`mb-3 flex items-center gap-2 rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 ${simpleModeActive ? "chat-simple-inline-alert" : ""}`}>
                <span className="text-xs text-danger">{errorText}</span>
                <button onClick={() => setErrorText("")} className="ml-auto text-danger hover:text-danger/80">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Multi-character bar */}
            {!zenMode && chatCharacters.length > 0 && (!simpleModeActive || !simpleHomeState) && (
              <div className="chat-multi-bar mb-3">
                <div className="chat-multi-bar-row">
                  <div className="chat-multi-bar-chars">
                    {chatCharacters.map((ch) => (
                      <div
                        key={ch.id}
                        className={`chat-multi-bar-chip ${draggingCharacterId === ch.id ? "is-dragging" : ""}`}
                        draggable={chatCharacters.length > 1 && !streaming && !autoConvoRunning}
                        onDragStart={(e) => {
                          setDraggingCharacterId(ch.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (!draggingCharacterId || draggingCharacterId === ch.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!draggingCharacterId || draggingCharacterId === ch.id) return;
                          void reorderCharactersInChat(draggingCharacterId, ch.id);
                          setDraggingCharacterId(null);
                        }}
                        onDragEnd={() => setDraggingCharacterId(null)}
                        onClick={() => {
                          if (chatCharacters.length > 1 && !streaming && !autoConvoRunning) {
                            void handleNextTurn(ch.name);
                          }
                        }}
                        title={chatCharacters.length > 1 ? `${t("chat.nextTurn")}: ${ch.name}` : ch.name}
                      >
                        {ch.avatarUrl ? (
                          <img src={resolveApiAssetUrl(ch.avatarUrl) ?? undefined}
                            alt="" className="h-5 w-5 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-500/20 text-[9px] font-bold text-purple-300">
                            {ch.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="truncate">{ch.name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeCharacterFromChat(ch.id);
                          }}
                          className="chat-multi-bar-chip-remove"
                          title={t("chat.removeCharacter")}
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        if (simpleModeActive) setSimpleSidebarOpen(true);
                        setShowMultiCharPanel(true);
                      }}
                      className="chat-multi-bar-add"
                      title={t("chat.multiChar")}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                  {chatCharacters.length > 1 && (
                    <div className="chat-multi-bar-auto">
                      <input type="number" min={1} max={50} value={autoTurnsCount}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const next = Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.floor(parsed))) : 1;
                          setAutoTurnsCount(next);
                        }}
                        className="chat-multi-bar-turns-input" />
                      <span className="text-[9px] text-text-tertiary">{t("chat.turns")}</span>
                      {autoConvoRunning ? (
                        <button onClick={stopAutoConversation}
                          className="chat-multi-bar-auto-btn is-stop">
                          {t("chat.autoConvoStop")}
                        </button>
                      ) : (
                        <button onClick={startAutoConversation} disabled={streaming || autoConvoRunning}
                          className="chat-multi-bar-auto-btn">
                          {t("chat.autoConvoStart")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {simpleModeActive && simpleHomeState && (
              <div className="chat-simple-hero">
                <h2 className="chat-simple-hero-title">
                  {simpleGreeting}
                </h2>
              </div>
            )}

            {simpleModeActive && simpleHomeState && (
              <div className="chat-simple-home-setup">
                <button
                  ref={modelSelectorTriggerRef}
                  onClick={() => setShowModelSelector((prev) => !prev)}
                  className="chat-simple-home-control"
                >
                  <span className="truncate">{activeModelLabel || t("chat.selectModel")}</span>
                </button>
                <button
                  onClick={() => openSimpleInspector(true)}
                  className="chat-simple-home-control"
                >
                  {t("chat.contextSetup")}
                </button>
                <button
                  onClick={() => {
                    setShowModelSelector(false);
                    setSimpleSceneOpen(true);
                    setSimpleInspectorOpen(false);
                  }}
                  className="chat-simple-home-control"
                >
                  {t("inspector.sceneState")}
                </button>
              </div>
            )}

            <div className={`chat-scroll flex-1 space-y-1.5 overflow-y-auto rounded-lg border border-border-subtle bg-bg-primary p-3 ${simpleModeActive ? "chat-simple-scroll chat-simple-surface" : ""} ${simpleHomeState ? "chat-simple-scroll-home" : ""}`}>
              {messages.length === 0 && !streaming && (
                <EmptyState title={t("chat.startConvo")} description={t("chat.startConvoDesc")} />
              )}

              {visibleMessages.map((msg) => {
                const relatedReasoningMessages = groupedToolsByParent.reasoningGrouped.get(msg.id) || [];
                const relatedToolMessages = groupedToolsByParent.toolGrouped.get(msg.id) || [];
                const reasoningPanelOpen = reasoningPanelsExpanded[msg.id] === true;
                const toolPanelOpen = toolPanelsExpanded[msg.id] === true;
                const inlineReasoning = msg.role === "assistant"
                  ? parseInlineReasoning(msg.content)
                  : { content: msg.content, reasoning: "" };
                const reasoningText = [inlineReasoning.reasoning]
                  .concat(relatedReasoningMessages.map((item) => String(item.payload.result || "").trim()))
                  .filter(Boolean)
                  .join("\n\n");
                const msgChar = msg.role === "assistant" ? getCharacterForMessage(msg) : null;
                const renderCharName = msgChar?.name || activeChatCharacter?.name;
                return (
                  <article key={msg.id}
                    className={`chat-message group max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed ${deletingMessageIds[msg.id] ? "is-deleting" : ""} ${
                      msg.role === "user"
                        ? "chat-message-user ml-auto bg-accent-subtle text-text-primary"
                        : "chat-message-assistant mr-auto border border-border-subtle bg-bg-secondary text-text-primary"
                    }`}>
                    <div className="mb-1.5 flex items-center gap-2">
                      {msgChar ? (
                        <>
                          {msgChar.avatarUrl ? (
                            <img src={resolveApiAssetUrl(msgChar.avatarUrl) ?? undefined}
                              alt="" className="h-4 w-4 rounded-full object-cover" />
                          ) : null}
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">{msg.characterName || msgChar.name}</span>
                        </>
                      ) : msg.role === "user" && msg.characterName ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{msg.characterName}</span>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                          {msg.role === "user" ? (activePersona?.name || t("chat.user")) : msg.role}
                        </span>
                      )}
                      {msg.tokenCount > 0 && <Badge>{msg.tokenCount} tok</Badge>}
                    </div>

                    {editingId === msg.id ? (
                      <div>
                        <textarea value={editingValue} onChange={(e) => setEditingValue(e.target.value)}
                          className="h-28 w-full rounded-lg border border-border bg-bg-primary p-3 text-sm text-text-primary" />
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => saveEdit(msg.id)}
                            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-text-inverse hover:bg-accent-hover">{t("chat.save")}</button>
                          <button onClick={() => setEditingId(null)}
                            className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover">{t("chat.cancel")}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {!zenMode && reasoningText && (
                          <div className="mb-2 rounded-md border border-border-subtle bg-bg-tertiary/80">
                            <button
                              onClick={() => {
                                setReasoningPanelsExpanded((prev) => ({ ...prev, [msg.id]: !reasoningPanelOpen }));
                              }}
                              className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                            >
                              <span className="text-[11px] font-semibold text-text-secondary">{t("chat.reasoning")}</span>
                              <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${reasoningPanelOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {reasoningPanelOpen && (
                              <div className="border-t border-border-subtle px-2 py-2">
                                <div className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{reasoningText}</div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="prose-chat" dangerouslySetInnerHTML={{
                          __html: renderContent(
                            inPlaceTranslations[msg.id] || inlineReasoning.content,
                            renderCharName,
                            activePersona?.name || t("chat.user"),
                            securitySettings
                          )
                        }} onClick={handleRenderedContentClick} />
                        {inPlaceTranslations[msg.id] && (
                          <button onClick={() => setInPlaceTranslations((prev) => { const n = { ...prev }; delete n[msg.id]; return n; })}
                            className="mt-1 text-[10px] text-accent hover:underline">{t("chat.showOriginal")}</button>
                        )}
                        {translatedTexts[msg.id] && (
                          <div className="mt-2 rounded-md border border-border-subtle bg-bg-tertiary p-2">
                            <span className="mb-1 block text-[10px] font-semibold uppercase text-text-tertiary">{t("chat.translate")}</span>
                            <div className="prose-chat text-xs text-text-secondary" dangerouslySetInnerHTML={{
                              __html: renderContent(translatedTexts[msg.id], renderCharName, activePersona?.name || t("chat.user"), securitySettings)
                            }} onClick={handleRenderedContentClick} />
                          </div>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {msg.attachments.map((att, idx) => {
                              const key = `${msg.id}-att-${att.id || idx}`;
                              const imageSrc = imageSourceFromAttachment(att);
                              if (att.type === "image" && imageSrc) {
                                return (
                                  <a
                                    key={key}
                                    href={imageSrc}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-md border border-border-subtle bg-bg-primary">
                                    <img src={imageSrc} alt={att.filename || t("chat.imageAttachment")} className="h-24 w-24 object-cover" />
                                  </a>
                                );
                              }
                              return (
                                <a
                                  key={key}
                                  href={att.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover">
                                  <svg className="h-3.5 w-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  <span className="max-w-[180px] truncate">{att.filename || t("chat.attachment")}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                        {!zenMode && msg.ragSources && msg.ragSources.length > 0 && (
                          <div className="mt-2 rounded-md border border-border-subtle bg-bg-tertiary p-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase text-text-tertiary">
                              {t("chat.ragRetrievedSources")} ({msg.ragSources.length})
                            </div>
                            <div className="space-y-1">
                              {msg.ragSources.map((source) => (
                                <div key={`${msg.id}-${source.chunkId}`} className="rounded border border-border-subtle bg-bg-primary px-2 py-1">
                                  <div className="text-[10px] font-medium text-text-secondary">{source.documentTitle}</div>
                                  <div className="mt-0.5 line-clamp-2 text-[10px] text-text-tertiary">{source.preview}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!zenMode && relatedToolMessages.length > 0 && (
                          <div className="mt-2 rounded-md border border-warning-border bg-warning-subtle">
                            <button
                              onClick={() => {
                                setToolPanelsExpanded((prev) => ({ ...prev, [msg.id]: !toolPanelOpen }));
                              }}
                              className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                            >
                              <span className="text-[11px] font-semibold text-text-secondary">
                                {t("chat.toolCall")} ({relatedToolMessages.length})
                              </span>
                              <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${toolPanelOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {toolPanelOpen && (
                              <div className="space-y-1.5 border-t border-warning-border/60 px-2 py-2">
                                {relatedToolMessages.map((item) => {
                                  const payload = item.payload;
                                  return (
                                    <div key={item.id} className="rounded-md border border-warning-border/60 bg-bg-primary px-2 py-1.5">
                                      <div className="text-[11px] font-semibold text-text-primary">{payload.name}</div>
                                      <div className="mt-1 text-[10px] text-text-tertiary">{t("chat.args")}</div>
                                      <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary">{payload.args || "{}"}</pre>
                                      <div className="mt-1 text-[10px] text-text-tertiary">{t("chat.result")}</div>
                                      <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary">{payload.result || t("chat.empty")}</pre>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        <PluginSlotMount
                          slotId="chat.message.bottom"
                          instanceKey={msg.id}
                          contextPayload={{
                            chatId: activeChat?.id || null,
                            branchId: activeBranchId,
                            messageId: msg.id,
                            role: msg.role,
                            characterId: msgChar?.id || null,
                            characterName: msg.characterName || null,
                            hasAttachments: (msg.attachments?.length || 0) > 0
                          }}
                        />
                      </>
                    )}

                    {!zenMode && !msg.id.startsWith("temp-") && (
                      <div className="message-actions mt-2 flex flex-wrap items-center gap-1">
                        <button onClick={() => handleFork(msg)}
                          className="rounded-md px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">{t("chat.fork")}</button>
                        <button onClick={() => { setEditingId(msg.id); setEditingValue(msg.content); }}
                          className="rounded-md px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">{t("chat.edit")}</button>
                        <button onClick={() => handleTranslate(msg.id, false)}
                          disabled={translatingId === msg.id}
                          className="rounded-md px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
                          title={t("chat.translateSide")}>
                          {translatingId === msg.id ? t("chat.translating") : t("chat.translate")}
                        </button>
                        <button onClick={() => handleTranslate(msg.id, true)}
                          disabled={translatingId === msg.id}
                          className="rounded-md px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
                          title={t("chat.translateInPlace")}>
                          {t("chat.translateReplace")}
                        </button>
                        {(msg.role === "assistant" || msg.role === "user") && String(msg.content || "").trim() && (
                          <button
                            onClick={() => { void handleTts(msg.id); }}
                            disabled={ttsLoadingId === msg.id}
                            className="rounded-md px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
                            title={t("chat.tts")}
                          >
                            {ttsLoadingId === msg.id
                              ? t("chat.ttsLoading")
                              : (ttsPlayingId === msg.id ? t("chat.ttsStop") : t("chat.tts"))}
                          </button>
                        )}
                        <button onClick={() => handleDelete(msg.id)}
                          disabled={deletingMessageIds[msg.id]}
                          className="rounded-md px-2 py-0.5 text-[11px] text-danger/60 hover:bg-danger-subtle hover:text-danger disabled:opacity-40">{t("chat.delete")}</button>
                        <PluginActionBar
                          location="chat.message"
                          contextPayload={{
                            chatId: activeChat?.id || null,
                            branchId: activeBranchId,
                            messageId: msg.id,
                            role: msg.role,
                            characterName: msg.characterName || null
                          }}
                        />
                      </div>
                    )}
                  </article>
                );
              })}

              {streaming && (
                <article className="chat-message chat-streaming mr-auto max-w-[88%] rounded-xl border border-accent-border bg-bg-secondary px-4 py-3 text-sm text-text-primary">
                  {(() => {
                    const streamChar = streamingCharacterName
                      ? (chatCharacters.find((item) => item.name === streamingCharacterName) ?? null)
                      : activeChatCharacter;
                    return (
                      <>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{streamingCharacterName || streamChar?.name || t("chat.assistant")}</span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                      <span className="text-[10px] text-accent">{t("chat.streaming")}</span>
                    </span>
                  </div>
                  {!zenMode && streamingReasoningCalls.length > 0 && (
                    <div className="mb-2 rounded-md border border-border-subtle bg-bg-tertiary/80">
                      <button
                        onClick={() => setStreamingReasoningExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary">
                          {streamingReasoningCalls.some((call) => call.status === "running") && (
                            <svg className="h-3 w-3 animate-spin text-text-tertiary" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-30" />
                              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                          {t("chat.reasoning")}
                        </span>
                        <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${streamingReasoningExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {streamingReasoningExpanded && (
                        <div className="border-t border-border-subtle px-2 py-2">
                          <div className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                            {streamingReasoningCalls.map((call) => String(call.result || "")).join("\n")}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="chat-stream-content chat-stream-live">
                    {streamText ? (
                      <div
                        className="prose-chat"
                        dangerouslySetInnerHTML={{ __html: streamingRenderedHtml }}
                        onClick={handleRenderedContentClick}
                      />
                    ) : "..."}
                  </div>
                  {!zenMode && streamingToolCalls.length > 0 && (
                    <div className="mt-2 rounded-md border border-warning-border bg-warning-subtle">
                      <button
                        onClick={() => setStreamingToolsExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary">
                          {streamingToolCalls.some((call) => call.status === "running") && (
                            <svg className="h-3 w-3 animate-spin text-warning" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-30" />
                              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                          {t("chat.toolCall")} ({streamingToolCalls.length})
                        </span>
                        <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${streamingToolsExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {streamingToolsExpanded && (
                        <div className="space-y-1.5 border-t border-warning-border/60 px-2 py-2">
                          {streamingToolCalls.map((call) => (
                            <div key={call.callId} className="rounded-md border border-warning-border/60 bg-bg-primary px-2 py-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[11px] font-semibold text-text-primary">{call.name}</span>
                                {call.status === "running" ? (
                                  <span className="flex items-center gap-1 text-[10px] text-warning">
                                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-30" />
                                      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                    {t("chat.running")}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-success">{t("chat.done")}</span>
                                )}
                              </div>
                              <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary">{call.args || "{}"}</pre>
                              {call.result && (
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary">{call.result}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                      </>
                    );
                  })()}
                </article>
              )}

              <div ref={messagesEndRef} />
            </div>

            {attachments.length > 0 && (
              <div
                className={`list-animate mt-2 flex flex-wrap gap-1.5 ${simpleModeActive ? "chat-simple-attachments" : ""} ${simpleHomeState ? "is-home" : "is-docked"}`}
                style={simpleModeActive && simpleHomeState ? ({ ["--simple-home-composer-width"]: simpleHomeComposerWidth } as Record<string, string>) : undefined}
              >
                {attachments.map((att) => (
                  <div key={att.id} className="float-card flex items-center gap-1.5 rounded-md border border-border bg-bg-primary px-2 py-1">
                    {att.type === "image" ? (
                      <img src={imageSourceFromAttachment(att) || att.url} alt="" className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <svg className="h-3.5 w-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className="max-w-[100px] truncate text-[10px] text-text-secondary">{att.filename}</span>
                    <button onClick={() => removeAttachment(att.id)} className="text-text-tertiary hover:text-danger">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`mt-2 ${simpleModeActive ? `chat-simple-composer ${simpleHomeState ? "is-home" : "is-docked"}` : "flex gap-2"}`}
              style={simpleModeActive && simpleHomeState ? ({ ["--simple-home-composer-width"]: simpleHomeComposerWidth } as Record<string, string>) : undefined}
            >
              <div className={simpleModeActive ? "chat-simple-composer-shell" : "relative flex-1"}>
                <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className={simpleModeActive
                    ? "chat-simple-textarea"
                    : "h-[80px] w-full resize-none rounded-xl border border-border bg-bg-primary px-4 py-2.5 pr-10 text-sm text-text-primary placeholder:text-text-tertiary"}
                  placeholder={simpleHomeState ? t("chat.simplePlaceholder") : t("chat.placeholder")} />
                {simpleModeActive && (
                  <div className="chat-simple-composer-bar">
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="chat-simple-bar-btn" title={t("chat.attachFile")}>
                      {uploading ? (
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}
                    </button>
                    {!simpleHomeState && (
                      <button
                        ref={modelSelectorTriggerRef}
                        onClick={() => setShowModelSelector((prev) => !prev)}
                        className="chat-simple-bar-model"
                        title={t("chat.selectModel")}
                      >
                        <span className="truncate">{activeModelLabel || t("chat.selectModel")}</span>
                        <svg className="h-3 w-3 flex-shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                    {!simpleHomeState && (
                      <span className="chat-simple-bar-mode">
                        {chatMode === "rp" ? t("inspector.modeRp") : chatMode === "light_rp" ? t("inspector.modeLightRp") : t("inspector.modePureChat")}
                      </span>
                    )}
                    <div className="flex-1" />
                    <button onClick={streaming ? handleAbort : (hasDraftPayload ? handleSend : handleRegenerate)}
                      disabled={!streaming && !hasDraftPayload && !canResendLast}
                      className={`chat-simple-send-btn ${streaming ? "is-stop" : ""}`}>
                      {streaming ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                {simpleModeActive && showModelSelector && (
                  <div ref={modelSelectorRef} className="chat-simple-model-popover">
                    <div className="chat-simple-model-current">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {activeModelLabel || t("chat.noModel")}
                        </div>
                      </div>
                      {activeModelLabel && (
                        <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="chat-simple-model-form">
                      <label className="chat-simple-model-label">{t("settings.provider")}</label>
                      <select value={chatProviderId} onChange={(e) => setChatProviderId(e.target.value)}
                        className="chat-simple-model-select">
                        <option value="">{t("settings.selectProvider")}</option>
                        {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                      </select>
                      <label className="chat-simple-model-label">{t("chat.model")}</label>
                      <select value={chatModelId} onChange={(e) => setChatModelId(e.target.value)}
                        className="chat-simple-model-select">
                        <option value="">{t("settings.selectModel")}</option>
                        {models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                      </select>
                    </div>
                    <div className="chat-simple-model-footer">
                      {loadingModels && (
                        <span className="text-[10px] text-text-tertiary">{t("chat.loading")}</span>
                      )}
                      <button onClick={() => { void applyModelFromChat(); }}
                        className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover">
                        {t("chat.ok")}
                      </button>
                    </div>
                  </div>
                )}
                {!simpleModeActive && (
                  <>
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="absolute bottom-2 right-2 rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
                      title={t("chat.attachFile")}>
                      {uploading ? (
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
                <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden"
                  accept="image/*,.txt,.md,.json,.csv,.log,.xml,.html,.js,.ts,.py,.rb,.yaml,.yml,.pdf,.docx" />
              </div>
              {!simpleModeActive && (
                <button onClick={streaming ? handleAbort : (hasDraftPayload ? handleSend : handleRegenerate)}
                  disabled={!streaming && !hasDraftPayload && !canResendLast}
                  className={`flex h-[80px] w-[80px] flex-col items-center justify-center rounded-xl text-text-inverse ${
                    streaming
                      ? "bg-danger hover:bg-danger/80"
                      : "bg-accent hover:bg-accent-hover disabled:opacity-40"
                  }`}>
                  {streaming ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                    </svg>
                  )}
                  <span className="mt-1 text-[10px] font-semibold">{streaming ? t("chat.stop") : (hasDraftPayload ? t("chat.send") : t("chat.resend"))}</span>
                </button>
              )}
            </div>
            <PluginSlotMount
              slotId="chat.composer.bottom"
              contextPayload={{
                chatId: activeChat?.id || null,
                branchId: activeBranchId,
                mode: chatMode,
                simpleMode: simpleModeActive,
                homeState: simpleHomeState,
                hasDraft: hasDraftPayload,
                attachmentCount: attachments.length
              }}
            />
            <PluginActionBar
              location="chat.composer"
              className="mt-2 flex flex-wrap items-center gap-1.5"
              contextPayload={{
                chatId: activeChat?.id || null,
                branchId: activeBranchId,
                mode: chatMode,
                simpleMode: simpleModeActive,
                homeState: simpleHomeState,
                input,
                attachmentCount: attachments.length
              }}
            />
            {simpleModeActive && simpleHomeState && (
              <div className="chat-simple-quick-row">
                {[
                  { label: t("chat.simpleQuickWrite"), value: "Write with clear structure and vivid detail." },
                  { label: t("chat.simpleQuickLearn"), value: "Explain this topic step by step with examples." },
                  { label: t("chat.simpleQuickCode"), value: "Help me implement this in code with best practices." },
                  { label: t("chat.simpleQuickLife"), value: "Give practical advice and a short action plan." },
                  { label: t("chat.simpleQuickChoice"), value: "Choose the best option and justify it briefly." }
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setInput(item.value)}
                    className="chat-simple-quick-chip"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </>
        }
        right={(
          <div className="flex h-full flex-col gap-3 overflow-y-auto">
            <PanelTitle
              action={simpleModeActive ? (
                <button
                  onClick={() => openSimpleInspector(false)}
                  className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
                >
                  {t("chat.cancel")}
                </button>
              ) : null}
            >
              {t("inspector.title")}
            </PanelTitle>

            <div className="rounded-lg border border-border-subtle bg-bg-primary p-3">
              {simpleModeActive && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("inspector.chatMode")}</label>
                  <select
                    value={chatMode}
                    onChange={(e) => setChatMode(e.target.value as ChatMode)}
                    className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary"
                  >
                    <option value="rp">{t("inspector.modeRp")}</option>
                    <option value="light_rp">{t("inspector.modeLightRp")}</option>
                    <option value="pure_chat">{t("inspector.modePureChat")}</option>
                  </select>
                </div>
              )}
              {chatMode === "light_rp" && (
                <p className="mt-2 text-[10px] text-text-tertiary">{t("inspector.modeLightRpHint")}</p>
              )}
              <div className="mt-3">
                <div className="mb-2 text-sm font-medium text-text-primary">{t("inspector.systemPrompt")}</div>
                <textarea
                  value={systemPromptBlock?.content || ""}
                  onChange={(e) => setSystemPromptContent(e.target.value)}
                  className="h-20 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
                  placeholder={t("inspector.systemPromptPlaceholder")}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border-subtle bg-bg-primary p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{t("chat.contextSetup")}</div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary">{t("chat.userPersona")} / {t("chat.lorebook")} / RAG</div>
                  </div>
                  <button
                    onClick={() => setShowPersonaModal(true)}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  >
                    {t("chat.edit")}
                  </button>
                </div>

                <div className="mt-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.userPersona")}</div>
                  <div className="mt-1 text-sm font-medium text-text-primary">{activePersona?.name || t("chat.user")}</div>
                  {(activePersonaPayload?.description || activePersonaPayload?.scenario || activePersonaPayload?.personality) && (
                    <div className="mt-1 line-clamp-2 text-[11px] text-text-tertiary">
                      {activePersonaPayload?.description || activePersonaPayload?.scenario || activePersonaPayload?.personality}
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{t("chat.lorebook")}</div>
                    <span className="text-[10px] text-text-tertiary">
                      {selectedLorebooks.length === 0 ? t("chat.none") : selectedLorebooks.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <button
                      onClick={() => { void saveLorebooksForChat([]); }}
                      className={`w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                        selectedLorebooks.length === 0
                          ? "border-accent-border bg-accent-subtle text-text-primary"
                          : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover"
                      }`}
                    >
                      {t("chat.none")}
                    </button>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {lorebooks.map((book) => {
                        const checked = activeLorebookIds.includes(book.id);
                        return (
                          <label
                            key={book.id}
                            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                              checked
                                ? "border-accent-border bg-accent-subtle text-text-primary"
                                : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => { void toggleLorebookForChat(book.id, event.target.checked); }}
                            />
                            <span className="min-w-0 flex-1 truncate">{book.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-border-subtle bg-bg-secondary p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-text-primary">{t("chat.ragEnabled")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">
                        {t("chat.ragTopK")}: {chatRagTopK}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={chatRagEnabled}
                      onChange={(e) => { void updateChatRag(e.target.checked, chatRagCollectionIds); }}
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{t("chat.ragCollections")}</div>
                    {chatRagCollectionsAvailable.length === 0 ? (
                      <p className="text-[10px] text-text-tertiary">{t("chat.ragNoCollections")}</p>
                    ) : (
                      chatRagCollectionsAvailable.map((collection) => {
                        const checked = chatRagCollectionIds.includes(collection.id);
                        return (
                          <label key={collection.id} className="flex items-center justify-between rounded-md border border-border bg-bg-primary px-2 py-1.5">
                            <span className="truncate text-[11px] text-text-secondary">{collection.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextIds = e.target.checked
                                  ? [...chatRagCollectionIds, collection.id]
                                  : chatRagCollectionIds.filter((id) => id !== collection.id);
                                void updateChatRag(chatRagEnabled || e.target.checked, nextIds);
                              }}
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("inspector.authorNote")}</label>
              <textarea
                value={authorNote}
                onChange={(e) => setAuthorNote(e.target.value)}
                disabled={pureChatMode}
                className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
              />
              {pureChatMode && (
                <p className="mt-1 text-[10px] text-text-tertiary">{t("inspector.pureChatAuthorNoteDisabled")}</p>
              )}
            </div>

            {!simpleModeActive && (
              <div>
                <button onClick={() => toggleSection("scene")}
                  className="mb-1.5 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {t("inspector.sceneState")}
                  <svg className={`h-3 w-3 transition-transform ${inspectorSection.scene ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {inspectorSection.scene && (
                  <fieldset disabled={pureChatMode} className="space-y-2 disabled:opacity-50">
                    <div>
                      <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.mood")}</label>
                      <input value={sceneState.mood}
                        onChange={(e) => setSceneState((prev) => ({ ...prev, mood: e.target.value }))}
                        className="w-full rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.pacing")}</label>
                      <select value={sceneState.pacing}
                        onChange={(e) => setSceneState((prev) => ({ ...prev, pacing: e.target.value as "slow" | "balanced" | "fast" }))}
                        className="w-full rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary">
                        <option value="slow">{t("inspector.slow")}</option>
                        <option value="balanced">{t("inspector.balanced")}</option>
                        <option value="fast">{t("inspector.fast")}</option>
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] text-text-tertiary">{t("inspector.intensity")}</label>
                        <span className="text-[10px] font-medium text-text-secondary">{Math.round(sceneState.intensity * 100)}%</span>
                      </div>
                      <input type="range" min={0} max={1} step={0.05} value={sceneState.intensity}
                        onChange={(e) => setSceneState((prev) => ({ ...prev, intensity: Number(e.target.value) }))}
                        className="w-full" />
                    </div>
                    {sceneFieldVisibility.dialogueStyle && (
                      <div>
                        <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.dialogueStyle")}</label>
                        <select
                          value={sceneState.variables.dialogueStyle || "teasing"}
                          onChange={(e) => setSceneVariable("dialogueStyle", e.target.value)}
                          className="w-full rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary"
                        >
                          <option value="teasing">{t("inspector.dialogueStyleTeasing")}</option>
                          <option value="playful">{t("inspector.dialogueStylePlayful")}</option>
                          <option value="dominant">{t("inspector.dialogueStyleDominant")}</option>
                          <option value="tender">{t("inspector.dialogueStyleTender")}</option>
                          <option value="formal">{t("inspector.dialogueStyleFormal")}</option>
                          <option value="chaotic">{t("inspector.dialogueStyleChaotic")}</option>
                        </select>
                      </div>
                    )}
                    {[
                      { key: "initiative", label: t("inspector.initiative") },
                      { key: "descriptiveness", label: t("inspector.descriptiveness") },
                      { key: "unpredictability", label: t("inspector.unpredictability") },
                      { key: "emotionalDepth", label: t("inspector.emotionalDepth") }
                    ].filter((item) => sceneFieldVisibility[item.key as keyof typeof sceneFieldVisibility]).map((item) => {
                      const value = readSceneVarPercent(sceneState.variables, item.key, 60);
                      return (
                        <div key={item.key}>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] text-text-tertiary">{item.label}</label>
                            <span className="text-[10px] font-medium text-text-secondary">{value}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={value}
                            onChange={(e) => setSceneVariablePercent(item.key, Number(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      );
                    })}
                    {visibleCustomSceneFields.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {visibleCustomSceneFields.map((field) => renderCustomSceneField(field))}
                      </div>
                    )}
                  </fieldset>
                )}
                {pureChatMode && inspectorSection.scene && (
                  <p className="mt-1 text-[10px] text-text-tertiary">{t("inspector.pureChatSceneDisabled")}</p>
                )}
              </div>
            )}

            {/* Sampler section — auto-saves */}
            <div>
              <button onClick={() => toggleSection("sampler")}
                className="mb-1.5 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                <span className="flex items-center gap-1.5">
                  {t("inspector.sampler")}
                  {samplerSaved && <span className="text-[9px] font-normal text-success">({t("chat.samplerSaved")})</span>}
                </span>
                <svg className={`h-3 w-3 transition-transform ${inspectorSection.sampler ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {inspectorSection.sampler && (
                <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-primary p-2">
                  {[
                    { key: "temperature" as const, label: t("inspector.temperature"), min: 0, max: 2 },
                    { key: "topP" as const, label: t("inspector.topP"), min: 0, max: 1 },
                    { key: "frequencyPenalty" as const, label: t("inspector.freqPenalty"), min: 0, max: 2 },
                    { key: "presencePenalty" as const, label: t("inspector.presPenalty"), min: 0, max: 2 }
                  ].map(({ key, label, min, max }) => (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] text-text-tertiary">{label}</label>
                        <span className="text-[10px] font-medium text-text-secondary">{samplerConfig[key].toFixed(2)}</span>
                      </div>
                      <input type="range" min={min} max={max} step={0.05} value={samplerConfig[key]}
                        onChange={(e) => setSamplerConfig((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-full" />
                    </div>
                  ))}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-[10px] text-text-tertiary">{t("inspector.maxTokens")}</label>
                      <input type="number" value={samplerConfig.maxTokens}
                        onChange={(e) => setSamplerConfig((p) => ({ ...p, maxTokens: Number(e.target.value) }))}
                        className="w-20 rounded border border-border bg-bg-primary px-1.5 py-0.5 text-right text-[10px] text-text-primary" />
                    </div>
                  </div>
                  {activeProviderType === "koboldcpp" && (
                    <>
                      {[
                        { key: "topK" as const, label: "Top-K", min: 0, max: 300, step: 1 },
                        { key: "topA" as const, label: "Top-A", min: 0, max: 1, step: 0.01 },
                        { key: "minP" as const, label: "Min-P", min: 0, max: 1, step: 0.01 },
                        { key: "typical" as const, label: "Typical", min: 0, max: 1, step: 0.01 },
                        { key: "tfs" as const, label: "TFS", min: 0, max: 1, step: 0.01 },
                        { key: "nSigma" as const, label: "N-Sigma", min: 0, max: 1, step: 0.01 },
                        { key: "repetitionPenalty" as const, label: "Repetition Penalty", min: 0, max: 2, step: 0.01 }
                      ].map(({ key, label, min, max, step }) => (
                        <div key={key}>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] text-text-tertiary">{label}</label>
                            <span className="text-[10px] font-medium text-text-secondary">{Number(samplerConfig[key] ?? 0).toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={Number(samplerConfig[key] ?? 0)}
                            onChange={(e) => setSamplerConfig((p) => ({ ...p, [key]: Number(e.target.value) }))}
                            className="w-full"
                          />
                        </div>
                      ))}
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-[10px] text-text-tertiary">{t("chat.memoryLabel")}</label>
                        </div>
                        <textarea
                          value={samplerConfig.koboldMemory || ""}
                          onChange={(e) => setSamplerConfig((p) => ({ ...p, koboldMemory: e.target.value }))}
                          className="h-20 w-full rounded border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-primary"
                          placeholder={t("chat.memoryPlaceholder")}
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-[10px] text-text-tertiary">{t("chat.phraseBansLabel")}</label>
                        </div>
                        <input
                          type="text"
                          value={koboldBansInput}
                          onChange={(e) => setKoboldBansInput(e.target.value)}
                          onBlur={() => setSamplerConfig((p) => ({
                            ...p,
                            koboldBannedPhrases: parsePhraseBansInput(koboldBansInput)
                          }))}
                          className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-primary"
                          placeholder={t("chat.phraseBansPlaceholder")}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded border border-border-subtle bg-bg-secondary px-2 py-1.5">
                        <label className="text-[10px] text-text-tertiary">{t("chat.useDefaultBadwordsLabel")}</label>
                        <input
                          type="checkbox"
                          checked={samplerConfig.koboldUseDefaultBadwords === true}
                          onChange={(e) => setSamplerConfig((p) => ({ ...p, koboldUseDefaultBadwords: e.target.checked }))}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Compressed Context section */}
            {contextSummary && (
              <div>
                <button onClick={() => toggleSection("context")}
                  className="mb-1.5 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {t("inspector.compressedContext")}
                  <svg className={`h-3 w-3 transition-transform ${inspectorSection.context ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {inspectorSection.context && (
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border-subtle bg-bg-primary p-3 font-mono text-[11px] text-text-secondary">
                    {contextSummary}
                  </pre>
                )}
              </div>
            )}
            <PluginSlotMount
              slotId="chat.inspector.bottom"
              contextPayload={{
                chatId: activeChat?.id || null,
                branchId: activeBranchId,
                mode: chatMode,
                simpleMode: simpleModeActive
              }}
            />
          </div>
        )}
      />
    </>
  );
}
