import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { api } from "../../shared/api";
import type {
  BranchNode,
  CharacterDetail,
  ChatMessage,
  ChatSession,
  LoreBook,
  PromptBlock,
  ProviderModel,
  ProviderProfile,
  RagCollection,
  RpSceneState,
  SamplerConfig,
  SecuritySettings,
  UserPersona
} from "../../shared/types/contracts";
import {
  DEFAULT_AUTHOR_NOTE,
  DEFAULT_CHAT_SECURITY_SETTINGS,
  DEFAULT_SCENE_FIELD_VISIBILITY,
  DEFAULT_SCENE_STATE,
  type ChatMode
} from "./constants";
import { normalizePromptStack, resolveChatMode, sanitizeSceneVariables } from "./utils";

interface ChatBootstrapParams {
  setChats: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveChat: Dispatch<SetStateAction<ChatSession | null>>;
  setChatProviderId: Dispatch<SetStateAction<string>>;
  setActiveModelLabel: Dispatch<SetStateAction<string>>;
  setChatModelId: Dispatch<SetStateAction<string>>;
  setSamplerConfig: Dispatch<SetStateAction<SamplerConfig>>;
  setPromptStack: Dispatch<SetStateAction<PromptBlock[]>>;
  setAlternateSimpleMode: Dispatch<SetStateAction<boolean>>;
  setSimpleSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setSceneFieldVisibility: Dispatch<SetStateAction<{
    dialogueStyle: boolean;
    initiative: boolean;
    descriptiveness: boolean;
    unpredictability: boolean;
    emotionalDepth: boolean;
  }>>;
  setSecuritySettings: Dispatch<SetStateAction<SecuritySettings>>;
  setChatRagTopK: Dispatch<SetStateAction<number>>;
  setCharacters: Dispatch<SetStateAction<CharacterDetail[]>>;
  setLorebooks: Dispatch<SetStateAction<LoreBook[]>>;
  setRagCollections: Dispatch<SetStateAction<RagCollection[]>>;
  setProviders: Dispatch<SetStateAction<ProviderProfile[]>>;
  setPersonas: Dispatch<SetStateAction<UserPersona[]>>;
  setActivePersona: Dispatch<SetStateAction<UserPersona | null>>;
}

export function useChatBootstrap(params: ChatBootstrapParams) {
  useEffect(() => {
    api.chatList().then((list) => {
      params.setChats(list);
      if (list[0]) params.setActiveChat(list[0]);
    });
    api.settingsGet().then((settings) => {
      if (settings.activeProviderId) {
        params.setChatProviderId(settings.activeProviderId);
      }
      if (settings.activeModel) {
        params.setActiveModelLabel(`${settings.activeModel}`);
        params.setChatModelId(settings.activeModel);
      } else {
        params.setActiveModelLabel("");
        params.setChatModelId("");
      }
      if (settings.samplerConfig) params.setSamplerConfig(settings.samplerConfig);
      params.setPromptStack(normalizePromptStack(settings.promptStack));
      params.setAlternateSimpleMode(settings.alternateSimpleMode === true);
      params.setSimpleSidebarOpen(settings.alternateSimpleMode !== true);
      params.setSceneFieldVisibility({
        ...DEFAULT_SCENE_FIELD_VISIBILITY,
        ...(settings.sceneFieldVisibility || {})
      });
      params.setSecuritySettings({
        ...DEFAULT_CHAT_SECURITY_SETTINGS,
        ...(settings.security || {})
      });
      if (Number.isFinite(Number(settings.ragTopK))) {
        params.setChatRagTopK(Math.max(1, Math.min(12, Math.floor(Number(settings.ragTopK)))));
      }
    });
    api.characterList().then(params.setCharacters).catch(() => {});
    api.lorebookList().then(params.setLorebooks).catch(() => {});
    api.ragCollectionList().then(params.setRagCollections).catch(() => {});
    api.providerList().then(params.setProviders).catch(() => {});
    api.personaList().then((list) => {
      params.setPersonas(list);
      const def = list.find((p) => p.isDefault);
      if (def) params.setActivePersona(def);
    }).catch(() => {});
  }, []);
}

interface ProviderModelLoaderParams {
  chatProviderId: string;
  setModels: Dispatch<SetStateAction<ProviderModel[]>>;
  setChatModelId: Dispatch<SetStateAction<string>>;
  setLoadingModels: Dispatch<SetStateAction<boolean>>;
}

export function useProviderModelLoader(params: ProviderModelLoaderParams) {
  const { chatProviderId, setModels, setChatModelId, setLoadingModels } = params;

  useEffect(() => {
    if (!chatProviderId) {
      setModels([]);
      setChatModelId("");
      return;
    }
    setLoadingModels(true);
    api.providerFetchModels(chatProviderId)
      .then((list) => {
        setModels(list);
        setChatModelId((prev) => {
          if (list.length === 0) return "";
          return list.some((m) => m.id === prev) ? prev : list[0].id;
        });
      })
      .catch(() => {
        setModels([]);
        setChatModelId("");
      })
      .finally(() => setLoadingModels(false));
  }, [chatProviderId]);
}

interface ActiveChatHydrationParams {
  activeChat: ChatSession | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setBranches: Dispatch<SetStateAction<BranchNode[]>>;
  setActiveBranchId: Dispatch<SetStateAction<string | null>>;
  setChatCharacterIds: Dispatch<SetStateAction<string[]>>;
  setActiveLorebookIds: Dispatch<SetStateAction<string[]>>;
  setChatRagEnabled: Dispatch<SetStateAction<boolean>>;
  setChatRagCollectionIds: Dispatch<SetStateAction<string[]>>;
  setSceneState: Dispatch<SetStateAction<RpSceneState>>;
  setAuthorNote: Dispatch<SetStateAction<string>>;
  setActivePreset: Dispatch<SetStateAction<string | null>>;
  setToolPanelsExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setReasoningPanelsExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSamplerConfig: Dispatch<SetStateAction<SamplerConfig>>;
  setLorebooks: Dispatch<SetStateAction<LoreBook[]>>;
  setSamplerSaved: Dispatch<SetStateAction<boolean>>;
  samplerInitializedRef: MutableRefObject<boolean>;
  authorNoteInitializedRef: MutableRefObject<boolean>;
  sceneStateInitializedRef: MutableRefObject<boolean>;
}

export function useActiveChatHydration(params: ActiveChatHydrationParams) {
  const {
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
  } = params;

  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setBranches([]);
      setActiveBranchId(null);
      setChatCharacterIds([]);
      setActiveLorebookIds([]);
      setChatRagEnabled(false);
      setChatRagCollectionIds([]);
      setSceneState({ chatId: "", ...DEFAULT_SCENE_STATE });
      setAuthorNote(DEFAULT_AUTHOR_NOTE);
      setActivePreset(null);
      setToolPanelsExpanded({});
      setReasoningPanelsExpanded({});
      return;
    }

    const chatId = activeChat.id;
    let cancelled = false;

    samplerInitializedRef.current = false;
    authorNoteInitializedRef.current = false;
    sceneStateInitializedRef.current = false;

    api.chatBranches(chatId).then((list) => {
      if (cancelled) return;
      setBranches(list);
      setActiveBranchId((prev) => {
        if (prev && list.some((branch) => branch.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    }).catch(() => {
      if (cancelled) return;
      setBranches([]);
      setActiveBranchId(null);
    });

    api.chatGetSampler(chatId).then((config) => {
      if (cancelled) return;
      setSamplerConfig((prev) => (config ? { ...prev, ...config } : prev));
      samplerInitializedRef.current = true;
    }).catch(() => {
      if (cancelled) return;
      samplerInitializedRef.current = true;
    });

    api.rpGetSceneState(chatId).then((state) => {
      if (cancelled) return;
      if (state) {
        const nextMode: ChatMode = resolveChatMode(state);
        setSceneState({
          chatId,
          mood: state.mood || DEFAULT_SCENE_STATE.mood,
          pacing: state.pacing || DEFAULT_SCENE_STATE.pacing,
          intensity: typeof state.intensity === "number" ? state.intensity : DEFAULT_SCENE_STATE.intensity,
          variables: sanitizeSceneVariables(state.variables),
          chatMode: nextMode,
          pureChatMode: nextMode === "pure_chat"
        });
      } else {
        setSceneState({ chatId, ...DEFAULT_SCENE_STATE });
      }
      sceneStateInitializedRef.current = true;
    }).catch(() => {
      if (cancelled) return;
      setSceneState({ chatId, ...DEFAULT_SCENE_STATE });
      sceneStateInitializedRef.current = true;
    });

    api.rpGetAuthorNote(chatId).then((result) => {
      if (cancelled) return;
      setAuthorNote(result.authorNote || DEFAULT_AUTHOR_NOTE);
      authorNoteInitializedRef.current = true;
    }).catch(() => {
      if (cancelled) return;
      setAuthorNote(DEFAULT_AUTHOR_NOTE);
      authorNoteInitializedRef.current = true;
    });

    api.chatGetPreset(chatId).then((result) => {
      if (cancelled) return;
      setActivePreset(result.presetId || null);
    }).catch(() => {
      if (cancelled) return;
      setActivePreset(null);
    });

    api.lorebookList().then((list) => {
      if (cancelled) return;
      setLorebooks(list);
    }).catch(() => {});

    setChatCharacterIds(activeChat.characterIds || (activeChat.characterId ? [activeChat.characterId] : []));
    api.chatGetLorebooks(chatId).then((binding) => {
      if (cancelled) return;
      setActiveLorebookIds(Array.isArray(binding.lorebookIds) ? binding.lorebookIds : (binding.lorebookId ? [binding.lorebookId] : []));
    }).catch(() => {
      if (cancelled) return;
      setActiveLorebookIds(activeChat.lorebookIds || (activeChat.lorebookId ? [activeChat.lorebookId] : []));
    });
    api.chatGetRag(chatId).then((binding) => {
      if (cancelled) return;
      setChatRagEnabled(binding.enabled === true);
      setChatRagCollectionIds(Array.isArray(binding.collectionIds) ? binding.collectionIds : []);
    }).catch(() => {
      if (cancelled) return;
      setChatRagEnabled(false);
      setChatRagCollectionIds([]);
    });
    setToolPanelsExpanded({});
    setReasoningPanelsExpanded({});
    setSamplerSaved(false);
    return () => {
      cancelled = true;
    };
  }, [activeChat]);
}

interface TimelineLoaderParams {
  activeChatId: string | null | undefined;
  activeBranchId: string | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export function useTimelineLoader(params: TimelineLoaderParams) {
  const { activeChatId, activeBranchId, setMessages } = params;

  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    api.chatTimeline(activeChatId, activeBranchId || undefined).then((timeline) => {
      if (cancelled) return;
      setMessages(timeline);
    }).catch(() => {
      if (cancelled) return;
      setMessages([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeChatId, activeBranchId]);
}
