import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import {
  AttachmentPreviewModal,
  BranchManager,
  REASONING_CALL_NAME,
  PersonaModal,
  RpReasoningToggle,
  guessMimeType,
  imageSourceFromAttachment,
  useBranchManagement,
  useMessageTranslation,
  useTtsPlayback,
  type AttachmentViewerState
} from "../chat/public";
import { api } from "../../shared/api";
import { resolveApiAssetUrl } from "../../shared/api/core";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask
} from "../../shared/backgroundTasks";
import { useI18n } from "../../shared/i18n";
import { RealtimeTtsPlayer } from "../../shared/realtimeTts";
import { StreamingTextTtsSession } from "../../shared/streamingTextTts";
import type {
  AppSettings,
  CharacterDetail,
  ChatMessage,
  ChatSession,
  FileAttachment,
  ProviderModel,
  ProviderProfile,
  UserPersona
} from "../../shared/types/contracts";
import { LiveCharacterPickerModal } from "./components/LiveCharacterPickerModal";
import { LiveChatControlPanel } from "./components/LiveChatControlPanel";
import { LiveIcon } from "./components/LiveIcon";
import { type LiveModelActivityCall } from "./components/LiveModelActivity";
import { LiveModelSelectorModal } from "./components/LiveModelSelectorModal";
import { LiveTranscriptPanel } from "./components/LiveTranscriptPanel";
import {
  isAddressedToCharacter,
  latestAssistantText,
  makeLiveScreenAttachment,
  makeLiveSessionTitle,
  normalizeLiveSttSource,
  normalizeLiveTtsSource,
  resolveLiveTtsSource,
  type LiveSttSource,
  type LiveTtsSource
} from "./utils";
import { createWhisperRecorder, type WhisperRecorderController } from "./whisperRecorder";
type LivePhase = "ready" | "listening" | "thinking" | "speaking";
type InheritedChatContext = { chatId: string; personaId: string; branchId: string };
type LiveStreamingCall = LiveModelActivityCall;
type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
type SpeechRecognitionErrorEventLike = {
  error?: string;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
const LIVE_TTS_SOURCE_KEY = "vellium.live.tts-source";
function localeToSpeechLanguage(locale: string): string {
  if (locale === "ru") return "ru-RU";
  if (locale === "zh") return "zh-CN";
  if (locale === "ja") return "ja-JP";
  return "en-US";
}
function trimForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read recorded audio"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("Recorded audio could not be encoded"));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}
export function LiveScreen() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [modelProviderId, setModelProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [showCharacterPicker, setShowCharacterPicker] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showChatControls, setShowChatControls] = useState(false);
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [applyingModel, setApplyingModel] = useState(false);
  const [chat, setChat] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<LiveStreamingCall[]>([]);
  const [streamingReasoningCalls, setStreamingReasoningCalls] = useState<LiveStreamingCall[]>([]);
  const [streamingReasoningText, setStreamingReasoningText] = useState("");
  const [phase, setPhase] = useState<LivePhase>("ready");
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [ttsSourcePreference, setTtsSourcePreference] = useState<LiveTtsSource | null>(() => {
    try {
      return normalizeLiveTtsSource(window.localStorage.getItem(LIVE_TTS_SOURCE_KEY));
    } catch {
      return null;
    }
  });
  const [handsFree, setHandsFree] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(true);
  const [screenContextEnabled, setScreenContextEnabled] = useState(false);
  const [heardStatus, setHeardStatus] = useState("");
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewerState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autoConversationRunning, setAutoConversationRunning] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const whisperRecorderRef = useRef<WhisperRecorderController | null>(null);
  const sttRequestControllerRef = useRef<AbortController | null>(null);
  const listeningTokenRef = useRef(0);
  const listeningStartRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const realtimeTtsPlayerRef = useRef<RealtimeTtsPlayer | null>(null);
  const streamingTextTtsRef = useRef<StreamingTextTtsSession | null>(null);
  const chatIdRef = useRef("");
  const mountedRef = useRef(true);
  const handsFreeRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const inheritedChatContextRef = useRef<InheritedChatContext>({ chatId: "", personaId: "", branchId: "" });
  const microphonePermissionRequestRef = useRef<Promise<boolean> | null>(null);
  const autoConversationRef = useRef(false);
  const generationTaskRef = useRef<string | null>(null);
  const busy = phase === "thinking" || phase === "speaking" || autoConversationRunning;
  const providerReady = Boolean(settings?.activeProviderId && settings?.activeModel);
  const speechRecognitionAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const mediaRecorderAvailable = typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const customTtsConfigured = Boolean(settings?.ttsBaseUrl?.trim() && settings?.ttsModel?.trim());
  const whisperSttConfigured = Boolean(settings?.sttBaseUrl?.trim() && settings?.sttModel?.trim());
  const ttsSource = resolveLiveTtsSource(ttsSourcePreference, customTtsConfigured);
  const sttSource = normalizeLiveSttSource(settings?.sttSource);
  const speechInputAvailable = sttSource === "whisper"
    ? mediaRecorderAvailable && whisperSttConfigured
    : speechRecognitionAvailable;
  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedCharacterId) || null,
    [characters, selectedCharacterId]
  );
  const selectedPersona = useMemo(
    () => personas.find((persona) => persona.id === selectedPersonaId) || null,
    [personas, selectedPersonaId]
  );
  const {
    branches,
    setBranches,
    activeBranchId,
    setActiveBranchId,
    forkBranch,
    renameBranch,
    removeBranch
  } = useBranchManagement({ activeChat: chat, setMessages, setErrorText: setError });
  const {
    translatingId,
    translatedTexts,
    translateMessage
  } = useMessageTranslation(setError);
  const { ttsLoadingId, ttsPlayingId, handleTts } = useTtsPlayback(settings?.ttsRealtime === true, setError);
  const availableSessions = useMemo(() => sessions.filter((session) => {
    const participantIds = session.characterIds?.length
      ? session.characterIds
      : (session.characterId ? [session.characterId] : []);
    return selectedCharacterId
      ? participantIds.includes(selectedCharacterId)
      : participantIds.length === 0;
  }).slice(0, 30), [sessions, selectedCharacterId]);
  const characterAvatarUrl = resolveApiAssetUrl(selectedCharacter?.avatarUrl);
  const phaseLabel = useMemo(() => {
    if (phase === "listening") return t("live.listening");
    if (phase === "thinking") return t("live.thinking");
    if (phase === "speaking") return t("live.speaking");
    return t("live.ready");
  }, [phase, t]);
  const visibleMessages = useMemo(() => {
    const rows = messages.filter((message) => message.role === "user" || message.role === "assistant");
    if (!streamingReply) return rows;
    return [
      ...rows,
      {
        id: "live-streaming",
        chatId: chat?.id || "",
        branchId: activeBranchId || "",
        role: "assistant" as const,
        content: streamingReply,
        tokenCount: 0,
        createdAt: new Date().toISOString()
      }
    ];
  }, [activeBranchId, chat?.id, messages, streamingReply]);

  function previewAttachment(attachment: FileAttachment) {
    const imageSrc = imageSourceFromAttachment(attachment);
    if (imageSrc) {
      setAttachmentViewer({ attachment, mode: "image", previewUrl: imageSrc });
      return;
    }
    if (attachment.type === "text" && String(attachment.content || "").trim()) {
      setAttachmentViewer({ attachment, mode: "text" });
      return;
    }
    void openAttachmentRaw(attachment);
  }

  async function openAttachmentRaw(attachment: FileAttachment) {
    const href = imageSourceFromAttachment(attachment) || resolveApiAssetUrl(attachment.url);
    if (!href) return;
    if (window.electronAPI) {
      await window.electronAPI.openExternal(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  const stopAudio = useCallback(() => {
    streamingTextTtsRef.current?.stop();
    streamingTextTtsRef.current = null;
    realtimeTtsPlayerRef.current?.stop();
    realtimeTtsPlayerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const receiveChatContext = (event: Event) => {
      const detail = (event as CustomEvent<Partial<InheritedChatContext>>).detail;
      inheritedChatContextRef.current = {
        chatId: typeof detail?.chatId === "string" ? detail.chatId : "",
        personaId: typeof detail?.personaId === "string" ? detail.personaId : "",
        branchId: typeof detail?.branchId === "string" ? detail.branchId : ""
      };
    };
    window.addEventListener("chat-context-for-live", receiveChatContext);
    window.dispatchEvent(new Event("live-request-chat-context"));
    void Promise.all([
      api.settingsGet(),
      api.characterList().catch(() => []),
      api.personaList().catch(() => []),
      api.chatList().catch(() => []),
      api.providerList().catch(() => [])
    ])
      .then(([nextSettings, nextCharacters, nextPersonas, nextSessions, nextProviders]) => {
        setSettings(nextSettings);
        setCharacters(nextCharacters);
        setPersonas(nextPersonas);
        setSessions(nextSessions);
        setProviders(nextProviders);
        setModelProviderId(nextSettings.activeProviderId || nextProviders[0]?.id || "");
        setModelId(nextSettings.activeModel || "");
        const inheritedContext = inheritedChatContextRef.current;
        const inheritedSession = nextSessions.find((session) => session.id === inheritedContext.chatId) || null;
        const inheritedCharacterId = inheritedSession?.characterId || inheritedSession?.characterIds?.[0] || "";
        setSelectedCharacterId((current) => current
          || (inheritedSession ? inheritedCharacterId : nextCharacters[0]?.id)
          || "");
        const defaultPersona = nextPersonas.find((persona) => persona.isDefault) || nextPersonas[0];
        const inheritedPersona = nextPersonas.find((persona) => persona.id === inheritedContext.personaId);
        setSelectedPersonaId((current) => current || inheritedPersona?.id || defaultPersona?.id || "");
        if (inheritedSession) {
          setChat(inheritedSession);
          chatIdRef.current = inheritedSession.id;
          setPhase("thinking");
          void api.chatBranches(inheritedSession.id)
            .then(async (nextBranches) => {
              const branchId = nextBranches.some((branch) => branch.id === inheritedContext.branchId)
                ? inheritedContext.branchId
                : nextBranches[0]?.id || null;
              const timeline = await api.chatTimeline(inheritedSession.id, branchId || undefined);
              if (!mountedRef.current || chatIdRef.current !== inheritedSession.id) return;
              setBranches(nextBranches);
              setActiveBranchId(branchId);
              setMessages(timeline);
              setPhase("ready");
            })
            .catch((cause) => {
              if (!mountedRef.current || chatIdRef.current !== inheritedSession.id) return;
              setPhase("ready");
              setError(cause instanceof Error ? cause.message : t("live.sessionLoadError"));
            });
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("live.settingsError")));
    return () => {
      mountedRef.current = false;
      window.removeEventListener("chat-context-for-live", receiveChatContext);
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      listeningTokenRef.current += 1;
      whisperRecorderRef.current?.abort();
      whisperRecorderRef.current = null;
      sttRequestControllerRef.current?.abort();
      sttRequestControllerRef.current = null;
      autoConversationRef.current = false;
      stopAudio();
      const activeChatId = chatIdRef.current;
      if (activeChatId) void api.chatAbort(activeChatId).catch(() => {});
      if (generationTaskRef.current) failGenerationTask(generationTaskRef.current, t("chat.stop"));
    };
  }, [stopAudio, t]);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<AppSettings>).detail;
      if (next && typeof next === "object") setSettings(next);
    };
    window.addEventListener("settings-change", handleSettingsChange);
    return () => window.removeEventListener("settings-change", handleSettingsChange);
  }, []);

  useEffect(() => {
    chatIdRef.current = chat?.id || "";
  }, [chat?.id]);

  useEffect(() => {
    if (!modelProviderId) {
      setModels([]);
      return;
    }
    let active = true;
    setLoadingModels(true);
    void api.providerFetchModels(modelProviderId)
      .then((nextModels) => {
        if (!active) return;
        setModels(nextModels);
        setModelId((current) => {
          if (current && nextModels.some((model) => model.id === current)) return current;
          if (modelProviderId === settings?.activeProviderId && settings.activeModel) return settings.activeModel;
          return nextModels[0]?.id || "";
        });
      })
      .catch(() => {
        if (active) setModels([]);
      })
      .finally(() => {
        if (active) setLoadingModels(false);
      });
    return () => {
      active = false;
    };
  }, [modelProviderId, settings?.activeModel, settings?.activeProviderId]);

  function openProviderSettings() {
    window.dispatchEvent(new CustomEvent("open-settings-view", {
      detail: { category: "providers", sectionId: "settings-providers" }
    }));
  }

  function openTtsSettings() {
    window.dispatchEvent(new CustomEvent("open-settings-view", {
      detail: { category: "connection", sectionId: "settings-tts" }
    }));
  }

  function openSttSettings() {
    window.dispatchEvent(new CustomEvent("open-settings-view", {
      detail: { category: "connection", sectionId: "settings-stt" }
    }));
  }

  function selectTtsSource(next: LiveTtsSource) {
    setTtsSourcePreference(next);
    try {
      window.localStorage.setItem(LIVE_TTS_SOURCE_KEY, next);
    } catch {
      // The current Live session still keeps the explicit choice.
    }
    setError("");
  }

  async function selectSttSource(next: LiveSttSource) {
    if (!settings || phase === "listening") return;
    setError("");
    try {
      const updated = await api.settingsUpdate({ sttSource: next });
      if (!mountedRef.current) return;
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function toggleRpReasoning() {
    if (!settings || busy) return;
    try {
      const updated = await api.settingsUpdate({ rpReasoningEnabled: settings.rpReasoningEnabled !== true });
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function applyLiveModel() {
    if (!modelProviderId || !modelId || applyingModel) return;
    setApplyingModel(true);
    setError("");
    try {
      const result = await api.providerActivateModel(modelProviderId, modelId);
      if (!mountedRef.current) return;
      setSettings(result.settings);
      setModelProviderId(result.settings.activeProviderId || modelProviderId);
      setModelId(result.actualModelId || result.settings.activeModel || modelId);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: result.settings }));
      setShowModelSelector(false);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setApplyingModel(false);
    }
  }

  async function savePersona() {
    if (!editingPersona) return;
    try {
      if (editingPersona.id) {
        const updated = await api.personaUpdate(editingPersona.id, editingPersona);
        setPersonas((current) => current.map((persona) => persona.id === updated.id ? updated : persona));
        if (selectedPersonaId === updated.id) setSelectedPersonaId(updated.id);
      } else {
        const created = await api.personaCreate(editingPersona);
        setPersonas((current) => [...current, created]);
        setSelectedPersonaId(created.id);
      }
      setEditingPersona(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function deletePersona(personaId: string) {
    try {
      await api.personaDelete(personaId);
      setPersonas((current) => current.filter((persona) => persona.id !== personaId));
      if (selectedPersonaId === personaId) {
        const fallback = personas.find((persona) => persona.id !== personaId && persona.isDefault)
          || personas.find((persona) => persona.id !== personaId);
        setSelectedPersonaId(fallback?.id || "");
      }
      setEditingPersona(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function toggleScreenContext() {
    setError("");
    setScreenContextEnabled((current) => {
      const next = !current;
      if (next) setVisionEnabled(true);
      return next;
    });
  }

  function finishTurn() {
    if (!mountedRef.current) return;
    setPhase("ready");
    if (autoConversationRef.current) return;
    if (!handsFreeRef.current) return;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (mountedRef.current && handsFreeRef.current) void startListening(true);
    }, 320);
  }

  function resetStreamingActivity() {
    setStreamingToolCalls([]);
    setStreamingReasoningCalls([]);
    setStreamingReasoningText("");
  }

  function handleStreamingToolEvent(event: {
    phase: "start" | "delta" | "done";
    callId: string;
    name: string;
    args?: string;
    result?: string;
  }) {
    const reasoning = event.name === REASONING_CALL_NAME;
    const setter = reasoning ? setStreamingReasoningCalls : setStreamingToolCalls;
    setter((current) => {
      const index = current.findIndex((item) => item.callId === event.callId);
      if (index < 0) {
        return [...current, {
          callId: event.callId,
          name: event.name,
          args: event.args || "{}",
          status: event.phase === "done" ? "done" : "running",
          result: event.result || ""
        }];
      }
      const next = [...current];
      const previous = next[index];
      next[index] = {
        ...previous,
        args: event.args ?? previous.args,
        status: event.phase === "done" ? "done" : "running",
        result: event.phase === "delta"
          ? `${previous.result}${event.result || ""}`
          : event.result ?? previous.result
      };
      return next;
    });
  }

  function startGenerationTask(chatId: string, label: string) {
    if (generationTaskRef.current) failBackgroundTask(generationTaskRef.current, t("chat.stop"));
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "generate",
      label,
      progressLabel: t("chat.streaming"),
      cancellable: true,
      cancelLabel: t("taskManager.stop"),
      onCancel: async () => {
        await api.chatAbort(chatId);
      }
    });
    generationTaskRef.current = taskId;
    return taskId;
  }

  function finishGenerationTask(taskId: string) {
    finishBackgroundTask(taskId);
    if (generationTaskRef.current === taskId) generationTaskRef.current = null;
  }

  function failGenerationTask(taskId: string, message: string) {
    failBackgroundTask(taskId, message);
    if (generationTaskRef.current === taskId) generationTaskRef.current = null;
  }

  async function speak(text: string) {
    const input = trimForSpeech(text);
    if (!voiceReplies || !input || !mountedRef.current) {
      finishTurn();
      return;
    }
    stopAudio();
    setPhase("speaking");

    if (ttsSource === "custom") {
      if (!customTtsConfigured) {
        setError(t("live.customTtsNotConfigured"));
        finishTurn();
        return;
      }
      try {
        if (settings?.ttsRealtime) {
          const player = new RealtimeTtsPlayer();
          realtimeTtsPlayerRef.current = player;
          await player.play((onEvent, signal) => api.chatTtsTextRealtime(input, onEvent, signal));
          if (realtimeTtsPlayerRef.current === player) realtimeTtsPlayerRef.current = null;
          if (mountedRef.current) finishTurn();
          return;
        }
        const blob = await api.chatTtsText(input);
        if (!mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          stopAudio();
          finishTurn();
        };
        audio.onerror = () => {
          stopAudio();
          setError(t("live.customTtsError"));
          finishTurn();
        };
        await audio.play();
        return;
      } catch {
        stopAudio();
        setError(t("live.customTtsError"));
        finishTurn();
        return;
      }
    }

    if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      const utterance = new SpeechSynthesisUtterance(input);
      utterance.lang = localeToSpeechLanguage(locale);
      const targetLanguage = utterance.lang.toLocaleLowerCase();
      const targetLanguagePrefix = targetLanguage.split("-")[0];
      const matchingVoice = window.speechSynthesis.getVoices().find((voice) => (
        voice.lang.toLocaleLowerCase() === targetLanguage
      )) || window.speechSynthesis.getVoices().find((voice) => (
        voice.lang.toLocaleLowerCase().split("-")[0] === targetLanguagePrefix
      ));
      if (matchingVoice) utterance.voice = matchingVoice;
      utterance.onend = () => {
        finishTurn();
      };
      utterance.onerror = () => {
        finishTurn();
      };
      window.speechSynthesis.speak(utterance);
      return;
    }
    finishTurn();
  }

  function startStreamingResponseTts(): StreamingTextTtsSession | null {
    if (
      !voiceReplies
      || ttsSource !== "custom"
      || !customTtsConfigured
      || settings?.ttsRealtime !== true
    ) {
      return null;
    }
    const session = new StreamingTextTtsSession(
      (input, onEvent, signal) => api.chatTtsTextRealtime(input, onEvent, signal),
      {
        normalizeText: trimForSpeech,
        onPlaybackStart: () => {
          if (mountedRef.current) setPhase("speaking");
        },
        onError: () => {
          if (mountedRef.current) setError(t("live.customTtsError"));
        }
      }
    );
    streamingTextTtsRef.current = session;
    return session;
  }

  async function finishResponseSpeech(
    session: StreamingTextTtsSession | null,
    completedText: string
  ) {
    if (!session) {
      await speak(completedText);
      return;
    }
    try {
      await session.finish();
    } catch {
      if (mountedRef.current) setError(t("live.customTtsError"));
    } finally {
      if (streamingTextTtsRef.current === session) streamingTextTtsRef.current = null;
      if (mountedRef.current) finishTurn();
    }
  }

  async function buildScreenAttachments(): Promise<FileAttachment[]> {
    if (!visionEnabled || !screenContextEnabled) return [];
    if (!window.electronAPI?.captureLiveScreenContext) {
      setError(t("live.screenUnsupported"));
      return [];
    }
    try {
      const result = await window.electronAPI.captureLiveScreenContext();
      const attachment = result.ok && result.dataUrl
        ? makeLiveScreenAttachment(result.dataUrl)
        : null;
      if (attachment) return [attachment];
      setError(result.error
        ? `${t("live.screenError")} ${result.error}`
        : t("live.screenError"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("live.screenError"));
    }
    return [];
  }

  async function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadComposerFiles(files: File[]) {
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      for (const file of files) {
        const base64 = await readFileAsBase64(file);
        const uploaded = await api.uploadFile(base64, file.name || `live-attachment-${Date.now()}`);
        const mimeType = uploaded.mimeType || file.type || guessMimeType(file.name);
        setAttachments((current) => [...current, {
          ...uploaded,
          mimeType,
          ...(uploaded.type === "image" ? { dataUrl: `data:${mimeType};base64,${base64}` } : {})
        }]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  }

  async function selectBranch(branchId: string) {
    if (!chat || busy || branchId === activeBranchId) return;
    setError("");
    setPhase("thinking");
    try {
      const timeline = await api.chatTimeline(chat.id, branchId);
      if (!mountedRef.current || chatIdRef.current !== chat.id) return;
      setActiveBranchId(branchId);
      setMessages(timeline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setPhase("ready");
    }
  }

  async function editMessage(messageId: string, content: string) {
    try {
      const result = await api.chatEditMessage(messageId, content);
      setMessages(result.timeline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  async function deleteMessage(messageId: string) {
    try {
      const result = await api.chatDeleteMessage(messageId);
      setMessages(result.timeline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  function activePersonaPayload() {
    return selectedPersona ? {
      name: selectedPersona.name,
      description: selectedPersona.description,
      personality: selectedPersona.personality,
      scenario: selectedPersona.scenario
    } : null;
  }

  async function submitTurn(rawText: string) {
    const text = rawText.trim();
    if ((!text && attachments.length === 0) || busy) return;
    if (!providerReady) {
      setError(t("live.providerRequired"));
      return;
    }
    setError("");
    setDraft("");
    const composerAttachments = [...attachments];
    setAttachments([]);
    setInterimTranscript("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopAudio();
    setPhase("thinking");
    setStreamingReply("");
    resetStreamingActivity();

    let taskId = "";
    try {
      const activeChat = chat || await api.chatCreate(
        makeLiveSessionTitle(new Date(), selectedCharacter?.name || ""),
        selectedCharacter?.id
      );
      if (!mountedRef.current) return;
      if (!chat) {
        setChat(activeChat);
        setSessions((current) => [activeChat, ...current.filter((session) => session.id !== activeChat.id)]);
        window.dispatchEvent(new Event("chat-list-refresh"));
      }
      chatIdRef.current = activeChat.id;
      let branchId = chat?.id === activeChat.id ? activeBranchId : null;
      if (!branchId) {
        const nextBranches = await api.chatBranches(activeChat.id);
        branchId = nextBranches[0]?.id || null;
        setBranches(nextBranches);
        setActiveBranchId(branchId);
      }
      const screenAttachments = await buildScreenAttachments();
      const requestAttachments = [...composerAttachments, ...screenAttachments];
      taskId = startGenerationTask(activeChat.id, activeChat.title || t("live.title"));
      let streamed = "";
      const streamingTts = startStreamingResponseTts();
      const timeline = await api.chatSend(activeChat.id, text, branchId || undefined, {
        onDelta: (delta) => {
          streamed += delta;
          streamingTts?.push(delta);
          if (mountedRef.current) setStreamingReply(streamed);
        },
        onReasoningDelta: (delta) => setStreamingReasoningText((current) => `${current}${delta}`),
        onToolEvent: handleStreamingToolEvent
      }, activePersonaPayload(), requestAttachments);
      if (!mountedRef.current) return;
      setMessages(timeline);
      setStreamingReply("");
      await finishResponseSpeech(streamingTts, latestAssistantText(timeline) || streamed);
      if (taskId) finishGenerationTask(taskId);
    } catch (cause) {
      streamingTextTtsRef.current?.stop();
      streamingTextTtsRef.current = null;
      if (taskId) failGenerationTask(taskId, cause instanceof Error ? cause.message : String(cause));
      if (!mountedRef.current) return;
      setStreamingReply("");
      finishTurn();
      setError(cause instanceof Error ? cause.message : t("live.sendError"));
    }
  }

  async function requestMicrophonePermission(): Promise<boolean> {
    if (!window.electronAPI?.requestLiveMicrophonePermission) return true;
    if (microphonePermissionRequestRef.current) return microphonePermissionRequestRef.current;
    const request = window.electronAPI.requestLiveMicrophonePermission()
      .then((result) => {
        if (!result.granted) setError(t("live.micPermissionDenied"));
        return result.granted;
      })
      .catch(() => {
        setError(t("live.micPermissionDenied"));
        return false;
      })
      .finally(() => {
        microphonePermissionRequestRef.current = null;
      });
    microphonePermissionRequestRef.current = request;
    return request;
  }

  function acceptTranscript(rawText: string, forHandsFree: boolean) {
    const text = rawText.trim();
    if (!text) {
      setPhase("ready");
      if (forHandsFree) finishTurn();
      return;
    }
    if (forHandsFree && !isAddressedToCharacter(text, selectedCharacter?.name || "")) {
      setHeardStatus(t("live.waitingForAddress").replace("{name}", selectedCharacter?.name || t("live.character")));
      setInterimTranscript("");
      if (!recognitionRef.current) finishTurn();
      return;
    }
    setDraft(text);
    setHeardStatus("");
    void submitTurn(text);
  }

  async function transcribeWhisperCapture(
    audio: Blob,
    filename: string,
    token: number,
    forHandsFree: boolean
  ) {
    if (!mountedRef.current || token !== listeningTokenRef.current) return;
    whisperRecorderRef.current = null;
    setInterimTranscript(t("live.transcribing"));
    const controller = new AbortController();
    sttRequestControllerRef.current = controller;
    try {
      const audioBase64 = await blobToBase64(audio);
      const result = await api.liveTranscribe(audioBase64, audio.type || "audio/webm", filename, controller.signal);
      if (!mountedRef.current || token !== listeningTokenRef.current) return;
      sttRequestControllerRef.current = null;
      setInterimTranscript("");
      acceptTranscript(result.text, forHandsFree);
    } catch (cause) {
      if (!mountedRef.current || token !== listeningTokenRef.current) return;
      sttRequestControllerRef.current = null;
      setInterimTranscript("");
      setPhase("ready");
      if (controller.signal.aborted) return;
      setError(t("live.sttTranscriptionError").replace(
        "{error}",
        cause instanceof Error ? cause.message : String(cause)
      ));
      if (forHandsFree) {
        handsFreeRef.current = false;
        setHandsFree(false);
      }
    }
  }

  async function startWhisperListening(forHandsFree: boolean, token: number) {
    if (!whisperSttConfigured) {
      setError(t("live.whisperSttNotConfigured"));
      setPhase("ready");
      return;
    }
    if (!mediaRecorderAvailable) {
      setError(t("live.whisperSttUnsupported"));
      setPhase("ready");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      if (!mountedRef.current || token !== listeningTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = createWhisperRecorder(stream, {
        onComplete: (audio, filename) => {
          void transcribeWhisperCapture(audio, filename, token, forHandsFree);
        },
        onEmpty: () => {
          if (!mountedRef.current || token !== listeningTokenRef.current) return;
          whisperRecorderRef.current = null;
          setInterimTranscript("");
          setPhase("ready");
          if (forHandsFree) finishTurn();
        },
        onError: () => {
          if (!mountedRef.current || token !== listeningTokenRef.current) return;
          whisperRecorderRef.current = null;
          setInterimTranscript("");
          setPhase("ready");
          setError(t("live.micError"));
          handsFreeRef.current = false;
          setHandsFree(false);
        }
      });
      whisperRecorderRef.current = recorder;
      setInterimTranscript(t("live.recording"));
      setPhase("listening");
    } catch (cause) {
      if (!mountedRef.current || token !== listeningTokenRef.current) return;
      setPhase("ready");
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setError(denied ? t("live.micPermissionDenied") : t("live.micError"));
      handsFreeRef.current = false;
      setHandsFree(false);
    }
  }

  async function startListening(forHandsFree = handsFreeRef.current) {
    if (listeningStartRef.current) return;
    listeningStartRef.current = true;
    try {
      await startListeningNow(forHandsFree);
    } finally {
      listeningStartRef.current = false;
    }
  }

  async function startListeningNow(forHandsFree: boolean) {
    if (busy || recognitionRef.current || whisperRecorderRef.current || sttRequestControllerRef.current) return;
    const token = ++listeningTokenRef.current;
    setError("");
    setHeardStatus("");
    stopAudio();
    if (sttSource === "system" && !speechRecognitionAvailable) {
      setError(t("live.micUnsupported"));
      document.querySelector<HTMLInputElement>(".live-compose-input")?.focus();
      return;
    }
    if (sttSource === "whisper" && (!mediaRecorderAvailable || !whisperSttConfigured)) {
      setError(!mediaRecorderAvailable ? t("live.whisperSttUnsupported") : t("live.whisperSttNotConfigured"));
      return;
    }
    if (!await requestMicrophonePermission()) {
      setHandsFree(false);
      handsFreeRef.current = false;
      setPhase("ready");
      return;
    }
    if (!mountedRef.current || token !== listeningTokenRef.current) return;
    if (sttSource === "whisper") {
      await startWhisperListening(forHandsFree, token);
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(t("live.micUnsupported"));
      document.querySelector<HTMLInputElement>(".live-compose-input")?.focus();
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.lang = localeToSpeechLanguage(locale);
    recognition.interimResults = true;
    recognition.continuous = forHandsFree;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0]?.transcript || "";
        else interimText += result[0]?.transcript || "";
      }
      setInterimTranscript(interimText);
      if (finalText.trim()) {
        if (forHandsFree && !isAddressedToCharacter(finalText, selectedCharacter?.name || "")) {
          setHeardStatus(t("live.waitingForAddress").replace("{name}", selectedCharacter?.name || t("live.character")));
          setInterimTranscript("");
          return;
        }
        recognitionRef.current = null;
        recognition.stop();
        acceptTranscript(finalText, forHandsFree);
      }
    };
    recognition.onerror = (event) => {
      const errorCode = event.error || "unknown";
      const recoverable = errorCode === "no-speech";
      if (errorCode !== "aborted" && !recoverable) {
        const message = errorCode === "not-allowed"
          ? t("live.micPermissionDenied")
          : errorCode === "service-not-allowed"
            ? t("live.sttServiceError")
            : errorCode === "audio-capture"
              ? t("live.micCaptureError")
              : errorCode === "network"
                ? t("live.sttNetworkError")
                : t("live.micErrorCode").replace("{code}", errorCode);
        setError(message);
        setHandsFree(false);
        handsFreeRef.current = false;
      }
      recognitionRef.current = null;
      setInterimTranscript("");
      if (recoverable && handsFreeRef.current) finishTurn();
      else setPhase("ready");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setInterimTranscript("");
      setPhase((current) => {
        if (current !== "listening") return current;
        if (handsFreeRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            void startListening(true);
          }, 260);
        }
        return "ready";
      });
    };
    recognitionRef.current = recognition;
    setPhase("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setPhase("ready");
      setError(t("live.micError"));
    }
  }

  function stopListening(disableHandsFree = false, discardWhisper = false) {
    if (disableHandsFree) {
      handsFreeRef.current = false;
      setHandsFree(false);
    }
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (discardWhisper || !whisperRecorderRef.current) listeningTokenRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.stop();
    if (whisperRecorderRef.current) {
      const recorder = whisperRecorderRef.current;
      if (discardWhisper) {
        whisperRecorderRef.current = null;
        recorder.abort();
      } else {
        recorder.stop(true);
        setInterimTranscript(t("live.transcribing"));
        return;
      }
    }
    if (sttRequestControllerRef.current) {
      sttRequestControllerRef.current.abort();
      sttRequestControllerRef.current = null;
    }
    setInterimTranscript("");
    setHeardStatus("");
    setPhase("ready");
  }

  async function stopResponse() {
    autoConversationRef.current = false;
    setAutoConversationRunning(false);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopAudio();
    const chatId = chatIdRef.current;
    if (chatId) await api.chatAbort(chatId).catch(() => {});
    if (generationTaskRef.current) {
      failGenerationTask(generationTaskRef.current, t("chat.stop"));
    }
    if (mountedRef.current) {
      setStreamingReply("");
      finishTurn();
    }
  }

  async function regenerateResponse() {
    if (!chat || busy) return;
    stopAudio();
    stopListening(true, true);
    setError("");
    setStreamingReply("");
    setPhase("thinking");
    resetStreamingActivity();
    const taskId = startGenerationTask(chat.id, t("chat.regenerate"));
    try {
      let streamed = "";
      const streamingTts = startStreamingResponseTts();
      const timeline = await api.chatRegenerate(chat.id, activeBranchId || undefined, {
        onDelta: (delta) => {
          streamed += delta;
          streamingTts?.push(delta);
          if (mountedRef.current) setStreamingReply(streamed);
        },
        onReasoningDelta: (delta) => setStreamingReasoningText((current) => `${current}${delta}`),
        onToolEvent: handleStreamingToolEvent
      });
      if (!mountedRef.current) return;
      setMessages(timeline);
      setStreamingReply("");
      await finishResponseSpeech(streamingTts, latestAssistantText(timeline) || streamed);
      finishGenerationTask(taskId);
    } catch (cause) {
      streamingTextTtsRef.current?.stop();
      streamingTextTtsRef.current = null;
      failGenerationTask(taskId, cause instanceof Error ? cause.message : String(cause));
      if (!mountedRef.current) return;
      setStreamingReply("");
      finishTurn();
      setError(cause instanceof Error ? cause.message : t("live.sendError"));
    }
  }

  async function generateCharacterTurn(characterName: string, auto = false): Promise<boolean> {
    if (!chat || (!auto && busy)) return false;
    stopAudio();
    setError("");
    setStreamingReply("");
    setPhase("thinking");
    resetStreamingActivity();
    const taskId = auto ? "" : startGenerationTask(chat.id, `${t("chat.nextTurn")}: ${characterName}`);
    try {
      let streamed = "";
      const streamingTts = startStreamingResponseTts();
      const timeline = await api.chatNextTurn(chat.id, characterName, activeBranchId || undefined, {
        onDelta: (delta) => {
          streamed += delta;
          streamingTts?.push(delta);
          if (mountedRef.current) setStreamingReply(streamed);
        },
        onReasoningDelta: (delta) => setStreamingReasoningText((current) => `${current}${delta}`),
        onToolEvent: handleStreamingToolEvent
      }, auto, activePersonaPayload());
      if (!mountedRef.current) return false;
      setMessages(timeline);
      setStreamingReply("");
      await finishResponseSpeech(streamingTts, latestAssistantText(timeline) || streamed);
      if (taskId) finishGenerationTask(taskId);
      return true;
    } catch (cause) {
      streamingTextTtsRef.current?.stop();
      streamingTextTtsRef.current = null;
      if (taskId) failGenerationTask(taskId, cause instanceof Error ? cause.message : String(cause));
      if (mountedRef.current) {
        setStreamingReply("");
        finishTurn();
        setError(cause instanceof Error ? cause.message : t("live.sendError"));
      }
      return false;
    }
  }

  async function startAutoConversation(turns: number, delayMs: number) {
    if (!chat || autoConversationRunning) return;
    const participantNames = (chat.characterIds?.length ? chat.characterIds : chat.characterId ? [chat.characterId] : [])
      .map((id) => characters.find((character) => character.id === id)?.name || "")
      .filter(Boolean);
    if (participantNames.length < 2) return;
    autoConversationRef.current = true;
    setAutoConversationRunning(true);
    const taskId = startGenerationTask(chat.id, t("chat.autoConvo"));
    let failed = false;
    try {
      const lastSpeaker = [...messages].reverse().find((message) => (
        message.role === "assistant" && message.characterName && participantNames.includes(message.characterName)
      ))?.characterName;
      const startIndex = lastSpeaker
        ? (participantNames.indexOf(lastSpeaker) + 1) % participantNames.length
        : 0;
      for (let turn = 0; turn < turns && autoConversationRef.current; turn += 1) {
        const speaker = participantNames[(startIndex + turn) % participantNames.length];
        const ok = await generateCharacterTurn(speaker, true);
        if (!ok) {
          failed = true;
          break;
        }
        if (turn < turns - 1 && autoConversationRef.current && delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    } finally {
      autoConversationRef.current = false;
      setAutoConversationRunning(false);
      if (generationTaskRef.current === taskId) {
        if (failed) failGenerationTask(taskId, error || t("live.sendError"));
        else finishGenerationTask(taskId);
      }
      if (mountedRef.current) finishTurn();
    }
  }

  function stopAutoConversation() {
    autoConversationRef.current = false;
    setAutoConversationRunning(false);
    stopAudio();
    if (chat) void api.chatAbort(chat.id).catch(() => {});
    if (generationTaskRef.current) failGenerationTask(generationTaskRef.current, t("chat.autoConvoStop"));
  }

  function resetConversationState() {
    stopAutoConversation();
    stopAudio();
    stopListening(true, true);
    setChat(null);
    chatIdRef.current = "";
    setMessages([]);
    setBranches([]);
    setActiveBranchId(null);
    setDraft("");
    setAttachments([]);
    setStreamingReply("");
    resetStreamingActivity();
    setHeardStatus("");
    setError("");
    setPhase("ready");
  }

  function startNewSession() {
    if (busy) return;
    resetConversationState();
  }

  function selectCharacter(characterId: string) {
    if (busy || characterId === selectedCharacterId) return;
    resetConversationState();
    setSelectedCharacterId(characterId);
  }

  async function selectSession(sessionId: string) {
    if (busy) return;
    if (!sessionId) {
      resetConversationState();
      return;
    }
    const nextSession = sessions.find((session) => session.id === sessionId);
    if (!nextSession) return;
    stopAudio();
    stopListening(true, true);
    setError("");
    setChat(nextSession);
    chatIdRef.current = nextSession.id;
    setSelectedCharacterId(nextSession.characterId || nextSession.characterIds?.[0] || "");
    setPhase("thinking");
    try {
      const nextBranches = await api.chatBranches(nextSession.id);
      const branchId = nextBranches[0]?.id || null;
      const timeline = await api.chatTimeline(nextSession.id, branchId || undefined);
      if (!mountedRef.current || chatIdRef.current !== nextSession.id) return;
      setBranches(nextBranches);
      setActiveBranchId(branchId);
      setMessages(timeline);
      setPhase("ready");
    } catch (cause) {
      if (!mountedRef.current) return;
      setPhase("ready");
      setError(cause instanceof Error ? cause.message : t("live.sessionLoadError"));
    }
  }

  function toggleHandsFree() {
    if (!speechInputAvailable) {
      setError(sttSource === "whisper"
        ? (!mediaRecorderAvailable ? t("live.whisperSttUnsupported") : t("live.whisperSttNotConfigured"))
        : t("live.micUnsupported"));
      return;
    }
    if (!selectedCharacter) {
      setError(t("live.characterRequired"));
      return;
    }
    const next = !handsFreeRef.current;
    handsFreeRef.current = next;
    setHandsFree(next);
    setHeardStatus("");
    if (next) void startListening(true);
    else stopListening(false, true);
  }

  return (
    <>
      <AttachmentPreviewModal
        viewer={attachmentViewer}
        onClose={() => setAttachmentViewer(null)}
        onOpenRaw={openAttachmentRaw}
        t={t}
      />
      <LiveCharacterPickerModal
        open={showCharacterPicker}
        characters={characters}
        selectedCharacterId={selectedCharacterId}
        onClose={() => setShowCharacterPicker(false)}
        onSelect={(characterId) => {
          selectCharacter(characterId);
          setShowCharacterPicker(false);
        }}
        t={t}
      />
      <PersonaModal
        open={showPersonaModal}
        personas={personas}
        activePersona={selectedPersona}
        editingPersona={editingPersona}
        onClose={() => {
          setShowPersonaModal(false);
          setEditingPersona(null);
        }}
        onSelect={(persona) => {
          setSelectedPersonaId(persona.id);
          setShowPersonaModal(false);
        }}
        onSetDefault={async (personaId) => {
          await api.personaSetDefault(personaId);
          setPersonas((current) => current.map((persona) => ({ ...persona, isDefault: persona.id === personaId })));
        }}
        onStartEdit={setEditingPersona}
        onEditChange={setEditingPersona}
        onCreateNew={() => setEditingPersona({
          id: "",
          name: "",
          description: "",
          personality: "",
          scenario: "",
          isDefault: false,
          createdAt: ""
        })}
        onSave={savePersona}
        onDelete={deletePersona}
        t={t}
      />
      <LiveModelSelectorModal
        open={showModelSelector}
        providers={providers}
        models={models}
        providerId={modelProviderId}
        modelId={modelId}
        activeModel={settings?.activeModel || ""}
        loadingModels={loadingModels}
        applying={applyingModel}
        onClose={() => setShowModelSelector(false)}
        onProviderChange={(providerId) => {
          setModelProviderId(providerId);
          setModelId("");
        }}
        onModelChange={setModelId}
        onApply={() => void applyLiveModel()}
        onOpenSettings={openProviderSettings}
        t={t}
      />
      <LiveChatControlPanel
        open={showChatControls}
        chat={chat}
        settings={settings}
        characters={characters}
        branches={branches}
        activeBranchId={activeBranchId}
        busy={busy}
        autoConversationRunning={autoConversationRunning}
        setMessages={setMessages}
        onClose={() => setShowChatControls(false)}
        onSettingsChange={setSettings}
        onChatChange={(nextChat) => {
          if (!nextChat) {
            const removedId = chat?.id;
            resetConversationState();
            if (removedId) setSessions((current) => current.filter((session) => session.id !== removedId));
            return;
          }
          setChat(nextChat);
          setSessions((current) => current.map((session) => session.id === nextChat.id ? nextChat : session));
          setSelectedCharacterId(nextChat.characterId || nextChat.characterIds?.[0] || "");
        }}
        onBranchSelect={selectBranch}
        onBranchRename={renameBranch}
        onBranchDelete={removeBranch}
        onNextTurn={async (characterName) => {
          await generateCharacterTurn(characterName);
        }}
        onAutoConversation={startAutoConversation}
        onStopAutoConversation={stopAutoConversation}
        onError={setError}
      />
      <section className={`live-screen live-phase-${phase}`} aria-label={t("live.title")}>
      <header className="live-header">
        <div>
          <div className="live-kicker">
            <span className="live-status-dot" aria-hidden="true" />
            {t("live.title")} · {phaseLabel}
          </div>
          <h1>{selectedCharacter?.name || t("live.title")}</h1>
          <p>{chat?.title || t("live.newSession")}</p>
        </div>
        <div className="live-header-actions">
          <button type="button" className="live-quiet-button" onClick={() => setShowChatControls(true)}>
            <LiveIcon name="settings" />
            <span>{t("live.chatControls")}</span>
          </button>
          <button type="button" className="live-quiet-button" onClick={startNewSession} disabled={busy}>
            <LiveIcon name="plus" />
            <span>{t("live.new")}</span>
          </button>
          {!providerReady ? (
            <button type="button" className="live-quiet-button is-warning" onClick={openProviderSettings}>
              <LiveIcon name="settings" />
              <span>{t("live.configure")}</span>
            </button>
          ) : null}
          {ttsSource === "custom" && !customTtsConfigured ? (
            <button type="button" className="live-quiet-button is-warning" onClick={openTtsSettings}>
              <LiveIcon name="voice" />
              <span>{t("live.configureTts")}</span>
            </button>
          ) : null}
          {sttSource === "whisper" && !whisperSttConfigured ? (
            <button type="button" className="live-quiet-button is-warning" onClick={openSttSettings}>
              <LiveIcon name="mic" />
              <span>{t("live.configureStt")}</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="live-context-bar" aria-label={t("live.context")}>
        <button
          type="button"
          className="live-model-context live-entity-context"
          onClick={() => setShowCharacterPicker(true)}
          disabled={busy}
          data-modal-trigger="live-character"
        >
          <span>{t("live.character")}</span>
          <strong>{selectedCharacter?.name || t("live.noCharacter")}</strong>
        </button>
        <button
          type="button"
          className="live-model-context live-entity-context"
          onClick={() => setShowPersonaModal(true)}
          disabled={busy}
          data-modal-trigger="persona"
        >
          <span>{t("live.persona")}</span>
          <strong>{selectedPersona?.name || t("live.defaultPersona")}</strong>
        </button>
        <label className="live-context-session">
          <span>{t("live.conversation")}</span>
          <select
            value={chat?.id || ""}
            onChange={(event) => void selectSession(event.target.value)}
            disabled={busy}
          >
            <option value="">{t("live.newConversation")}</option>
            {availableSessions.map((session) => (
              <option key={session.id} value={session.id}>{session.title}</option>
            ))}
          </select>
        </label>
        {chat && branches.length ? (
          <BranchManager
            branches={branches}
            activeBranchId={activeBranchId}
            disabled={busy}
            simple
            onSelect={(branchId) => { void selectBranch(branchId); }}
            onRename={renameBranch}
            onDelete={removeBranch}
          />
        ) : null}
        <RpReasoningToggle
          enabled={settings?.rpReasoningEnabled === true}
          disabled={busy}
          variant="status"
          onToggle={() => { void toggleRpReasoning(); }}
        />
        <button
          type="button"
          className="live-model-context"
          onClick={() => setShowModelSelector(true)}
          data-modal-trigger="live-model"
        >
          <span>{t("live.model")}</span>
          <strong>{settings?.activeModel || t("live.configure")}</strong>
        </button>
        <label className="live-tts-context">
          <span>{t("live.tts")}</span>
          <select
            value={ttsSource}
            onChange={(event) => selectTtsSource(event.target.value as LiveTtsSource)}
            disabled={phase === "speaking"}
            title={ttsSource === "custom" ? t("live.customTtsHint") : t("live.systemTtsHint")}
          >
            <option value="system">{t("live.systemTts")}</option>
            <option value="custom">
              {t("live.customTts")} · {customTtsConfigured
                ? (settings?.ttsVoice || settings?.ttsModel)
                : t("live.notConfigured")}
            </option>
          </select>
        </label>
        <label className="live-stt-context">
          <span>{t("live.stt")}</span>
          <select
            value={sttSource}
            onChange={(event) => void selectSttSource(event.target.value as LiveSttSource)}
            disabled={phase === "listening" || Boolean(sttRequestControllerRef.current)}
            title={sttSource === "whisper" ? t("live.whisperSttHint") : t("live.sttHint")}
          >
            <option value="system">
              {t("live.systemStt")} · {speechRecognitionAvailable ? t("live.available") : t("live.sttUnavailable")}
            </option>
            <option value="whisper">
              {t("live.whisperStt")} · {whisperSttConfigured
                ? (settings?.sttModel || "whisper-1")
                : t("live.notConfigured")}
            </option>
          </select>
        </label>
      </div>

      <div className="live-workspace">
        <div className="live-stage">
          {characterAvatarUrl ? (
            <div
              className="live-character-backdrop"
              style={{ backgroundImage: `url(${JSON.stringify(characterAvatarUrl)})` }}
              aria-hidden="true"
            />
          ) : null}
          <div className="live-stage-shade" aria-hidden="true" />
          <div className="live-focus">
            <div className="live-orbit live-orbit-one" aria-hidden="true" />
            <div className="live-orbit live-orbit-two" aria-hidden="true" />
            <button
              type="button"
              className="live-mic-button"
              onClick={phase === "listening"
                ? () => stopListening(handsFree)
                : (busy ? stopResponse : () => { void startListening(false); })}
              aria-label={phase === "listening" ? t("live.stopListening") : (busy ? t("live.stopResponse") : t("live.startListening"))}
            >
              {characterAvatarUrl && selectedCharacter ? (
                <AvatarBadge
                  name={selectedCharacter.name}
                  src={characterAvatarUrl}
                  alt=""
                  className="live-character-avatar"
                />
              ) : null}
              <span className="live-mic-icon">
                <LiveIcon name={phase === "listening" || busy ? "stop" : "mic"} />
              </span>
              <span className="live-wave" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </span>
            </button>
            <div className="live-focus-copy">
              <strong>{phaseLabel}</strong>
              <span>
                {interimTranscript
                  || heardStatus
                  || (handsFree
                    ? t("live.handsFreeHint").replace("{name}", selectedCharacter?.name || t("live.character"))
                    : (phase === "listening" ? t("live.listeningHint") : t("live.readyHint")))}
              </span>
            </div>
          </div>

          <div className="live-controls" aria-label={t("live.controls")}>
            <button
              type="button"
              className={handsFree ? "is-on" : ""}
              onClick={toggleHandsFree}
              aria-pressed={handsFree}
            >
              <LiveIcon name="handsFree" />
              <span>{t("live.handsFree")}</span>
              <i />
            </button>
            <button
              type="button"
              className={voiceReplies ? "is-on" : ""}
              onClick={() => {
                const next = !voiceReplies;
                setVoiceReplies(next);
                if (!next) {
                  stopAudio();
                  if (phase === "speaking") finishTurn();
                }
              }}
              aria-pressed={voiceReplies}
            >
              <LiveIcon name="voice" />
              <span>{t("live.voiceReplies")}</span>
              <i />
            </button>
            <button
              type="button"
              className={visionEnabled ? "is-on" : ""}
              onClick={() => setVisionEnabled((current) => {
                const next = !current;
                if (!next) setScreenContextEnabled(false);
                return next;
              })}
              aria-pressed={visionEnabled}
            >
              <LiveIcon name="vision" />
              <span>{t("live.vision")}</span>
              <i />
            </button>
            <button
              type="button"
              className={screenContextEnabled ? "is-on is-screen" : ""}
              onClick={toggleScreenContext}
              aria-pressed={screenContextEnabled}
            >
              <LiveIcon name="screen" />
              <span>{screenContextEnabled ? t("live.stopSharing") : t("live.shareScreen")}</span>
              <i />
            </button>
          </div>
        </div>

        <LiveTranscriptPanel
          messages={visibleMessages}
          character={selectedCharacter}
          characterAvatarUrl={characterAvatarUrl}
          persona={selectedPersona}
          security={settings?.security}
          busy={busy}
          uploading={uploading}
          error={error}
          draft={draft}
          attachments={attachments}
          providerReady={providerReady}
          speechInputAvailable={speechRecognitionAvailable}
          screenAttached={screenContextEnabled && visionEnabled}
          canRegenerate={Boolean(chat) && !busy && Boolean(latestAssistantText(messages))}
          streamingReply={streamingReply}
          toolCalls={streamingToolCalls}
          reasoningCalls={streamingReasoningCalls}
          reasoningText={streamingReasoningText}
          translatedTexts={translatedTexts}
          translatingId={translatingId}
          ttsLoadingId={ttsLoadingId}
          ttsPlayingId={ttsPlayingId}
          onDraftChange={setDraft}
          onSubmit={() => { void submitTurn(draft); }}
          onUploadFiles={(files) => { void uploadComposerFiles(files); }}
          onRemoveAttachment={(attachmentId) =>
            setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
          onRegenerate={() => { void regenerateResponse(); }}
          onOpenProviderSettings={openProviderSettings}
          onEditMessage={editMessage}
          onDeleteMessage={deleteMessage}
          onTranslateMessage={async (messageId) => { await translateMessage(messageId, false); }}
          onTtsMessage={handleTts}
          onForkMessage={async (messageId) => { await forkBranch(messageId); }}
          onPreviewAttachment={previewAttachment}
        />
      </div>
      </section>
    </>
  );
}
