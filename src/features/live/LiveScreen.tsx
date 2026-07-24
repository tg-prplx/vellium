import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import { PersonaModal } from "../chat/public";
import { api } from "../../shared/api";
import { resolveApiAssetUrl } from "../../shared/api/core";
import { useI18n } from "../../shared/i18n";
import { RealtimeTtsPlayer } from "../../shared/realtimeTts";
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
import { LiveModelSelectorModal } from "./components/LiveModelSelectorModal";
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
type InheritedChatContext = { chatId: string; personaId: string };

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

function LiveIcon({ name }: { name: "mic" | "screen" | "vision" | "voice" | "send" | "stop" | "plus" | "settings" | "handsFree" }) {
  const paths = {
    mic: "M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zm-7 9a7 7 0 0014 0M12 18v4m-4 0h8",
    screen: "M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm4 18h8m-4-4v4",
    vision: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z",
    voice: "M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4",
    send: "M3 11.5L21 3l-8.5 18-2-7.5L3 11.5zm7.5 2L21 3",
    stop: "M7 7h10v10H7z",
    plus: "M12 5v14M5 12h14",
    settings: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.4-3.5a7.3 7.3 0 00-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 00-1.7-1L15 3.5h-4L10.6 6a8 8 0 00-1.7 1L6.5 6 4.5 9.5l2 1.5a7.3 7.3 0 000 2l-2 1.5 2 3.4 2.4-1a8 8 0 001.7 1l.4 2.6h4l.4-2.6a8 8 0 001.7-1l2.4 1 2-3.4-2-1.5a7.3 7.3 0 00.1-1z",
    handsFree: "M5 10v4m3-7v10m4-13v16m4-13v10m3-7v4M3 4l18 16"
  } as const;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} />
    </svg>
  );
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
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [applyingModel, setApplyingModel] = useState(false);
  const [chat, setChat] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
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

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const whisperRecorderRef = useRef<WhisperRecorderController | null>(null);
  const sttRequestControllerRef = useRef<AbortController | null>(null);
  const listeningTokenRef = useRef(0);
  const listeningStartRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const realtimeTtsPlayerRef = useRef<RealtimeTtsPlayer | null>(null);
  const chatIdRef = useRef("");
  const mountedRef = useRef(true);
  const handsFreeRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const inheritedChatContextRef = useRef<InheritedChatContext>({ chatId: "", personaId: "" });
  const microphonePermissionRequestRef = useRef<Promise<boolean> | null>(null);
  const busy = phase === "thinking" || phase === "speaking";
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
    const rows = messages.filter((message) => message.role === "user" || message.role === "assistant").slice(-8);
    if (!streamingReply) return rows;
    return [
      ...rows,
      {
        id: "live-streaming",
        chatId: chat?.id || "",
        branchId: "",
        role: "assistant" as const,
        content: streamingReply,
        tokenCount: 0,
        createdAt: new Date().toISOString()
      }
    ];
  }, [chat?.id, messages, streamingReply]);

  const stopAudio = useCallback(() => {
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
        personaId: typeof detail?.personaId === "string" ? detail.personaId : ""
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
          void api.chatTimeline(inheritedSession.id)
            .then((timeline) => {
              if (!mountedRef.current || chatIdRef.current !== inheritedSession.id) return;
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
      stopAudio();
      const activeChatId = chatIdRef.current;
      if (activeChatId) void api.chatAbort(activeChatId).catch(() => {});
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
    if (!handsFreeRef.current) return;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (mountedRef.current && handsFreeRef.current) void startListening(true);
    }, 320);
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

  async function submitTurn(rawText: string) {
    const text = rawText.trim();
    if (!text || busy) return;
    if (!providerReady) {
      setError(t("live.providerRequired"));
      return;
    }
    setError("");
    setDraft("");
    setInterimTranscript("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopAudio();
    setPhase("thinking");
    setStreamingReply("");

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
      const attachments = await buildScreenAttachments();
      let streamed = "";
      const timeline = await api.chatSend(activeChat.id, text, undefined, {
        onDelta: (delta) => {
          streamed += delta;
          if (mountedRef.current) setStreamingReply(streamed);
        }
      }, selectedPersona ? {
        name: selectedPersona.name,
        description: selectedPersona.description,
        personality: selectedPersona.personality,
        scenario: selectedPersona.scenario
      } : null, attachments);
      if (!mountedRef.current) return;
      setMessages(timeline);
      setStreamingReply("");
      await speak(latestAssistantText(timeline) || streamed);
    } catch (cause) {
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
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopAudio();
    const chatId = chatIdRef.current;
    if (chatId) await api.chatAbort(chatId).catch(() => {});
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
    try {
      let streamed = "";
      const timeline = await api.chatRegenerate(chat.id, undefined, {
        onDelta: (delta) => {
          streamed += delta;
          if (mountedRef.current) setStreamingReply(streamed);
        }
      });
      if (!mountedRef.current) return;
      setMessages(timeline);
      setStreamingReply("");
      await speak(latestAssistantText(timeline) || streamed);
    } catch (cause) {
      if (!mountedRef.current) return;
      setStreamingReply("");
      finishTurn();
      setError(cause instanceof Error ? cause.message : t("live.sendError"));
    }
  }

  function resetConversationState() {
    stopAudio();
    stopListening(true, true);
    setChat(null);
    chatIdRef.current = "";
    setMessages([]);
    setDraft("");
    setStreamingReply("");
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
      const timeline = await api.chatTimeline(nextSession.id);
      if (!mountedRef.current || chatIdRef.current !== nextSession.id) return;
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

        <aside className="live-transcript" aria-label={t("live.transcript")}>
          <div className="live-transcript-heading">
            <div>
              <span>{t("live.transcript")}</span>
              <small>{visibleMessages.length ? t("live.savedInChat") : t("live.privateUntilShared")}</small>
            </div>
            <div className="live-transcript-actions">
              {screenContextEnabled && visionEnabled ? <b>{t("live.screenAttached")}</b> : null}
              <button
                type="button"
                onClick={() => void regenerateResponse()}
                disabled={!chat || busy || !latestAssistantText(messages)}
              >
                {t("live.regenerate")}
              </button>
            </div>
          </div>
          <div className="live-message-list" aria-live="polite">
            {visibleMessages.length === 0 ? (
              <div className="live-empty">
                {selectedCharacter ? (
                  <AvatarBadge
                    name={selectedCharacter.name}
                    src={characterAvatarUrl}
                    alt=""
                    className="live-empty-avatar"
                  />
                ) : <LiveIcon name="voice" />}
                <strong>{selectedCharacter?.name || t("live.emptyTitle")}</strong>
                <span>
                  {selectedCharacter?.greeting
                    ? selectedCharacter.greeting.slice(0, 220)
                    : (speechRecognitionAvailable ? t("live.emptyHint") : t("live.emptyTextHint"))}
                </span>
              </div>
            ) : visibleMessages.map((message) => (
              <article key={message.id} className={`live-message is-${message.role}`}>
                <span>
                  {message.role === "user"
                    ? (selectedPersona?.name || t("live.you"))
                    : (message.characterName || selectedCharacter?.name || t("live.assistant"))}
                </span>
                <p>{message.content}</p>
                {message.attachments?.some((item) => item.type === "image") ? (
                  <small><LiveIcon name="vision" />{t("live.screenWasAttached")}</small>
                ) : null}
              </article>
            ))}
          </div>
          <form
            className="live-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void submitTurn(draft);
            }}
          >
            {error ? (
              <div className="live-error" role="alert">
                <span>{error}</span>
                {!providerReady ? <button type="button" onClick={openProviderSettings}>{t("live.openSettings")}</button> : null}
              </div>
            ) : null}
            <div className="live-compose-row">
              <input
                className="live-compose-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("live.placeholder")}
                aria-label={t("live.placeholder")}
                disabled={busy}
              />
              <button type="submit" disabled={!draft.trim() || busy} aria-label={t("live.send")}>
                <LiveIcon name="send" />
              </button>
            </div>
            <small>{screenContextEnabled && visionEnabled ? t("live.nextFrameHint") : t("live.screenOffHint")}</small>
          </form>
        </aside>
      </div>
      </section>
    </>
  );
}
