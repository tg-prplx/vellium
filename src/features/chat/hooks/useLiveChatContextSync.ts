import { useEffect, useRef } from "react";
import { api } from "../../../shared/api";
import {
  CHAT_CONTEXT_FOR_LIVE_EVENT,
  LIVE_CHAT_CONTEXT_CHANGED_EVENT,
  LIVE_REQUEST_CHAT_CONTEXT_EVENT,
  dispatchSharedChatContext,
  normalizeSharedChatContext,
  type SharedChatContext
} from "../../../shared/chatContextBridge";
import type { BranchNode, ChatMessage, ChatSession, UserPersona } from "../../../shared/types/contracts";

interface LiveChatContextSyncOptions {
  activeChat: ChatSession | null;
  activePersona: UserPersona | null;
  activeBranchId: string | null;
  personas: UserPersona[];
  setChats: (value: ChatSession[]) => void;
  setActiveChat: (value: ChatSession) => void;
  setBranches: (value: BranchNode[]) => void;
  setActiveBranchId: (value: string | null) => void;
  setMessages: (value: ChatMessage[]) => void;
  setActivePersona: (value: UserPersona) => void;
}

export function useLiveChatContextSync(options: LiveChatContextSyncOptions) {
  const sequenceRef = useRef(0);
  const {
    activeBranchId, activeChat, activePersona, personas,
    setActiveBranchId, setActiveChat, setActivePersona, setBranches, setChats, setMessages
  } = options;

  useEffect(() => {
    const provide = () => dispatchSharedChatContext(CHAT_CONTEXT_FOR_LIVE_EVENT, {
      chatId: activeChat?.id || "",
      personaId: activePersona?.id || "",
      branchId: activeBranchId || ""
    });
    window.addEventListener(LIVE_REQUEST_CHAT_CONTEXT_EVENT, provide);
    provide();
    return () => window.removeEventListener(LIVE_REQUEST_CHAT_CONTEXT_EVENT, provide);
  }, [activeBranchId, activeChat?.id, activePersona?.id]);

  useEffect(() => {
    const adopt = async (event: Event) => {
      const context = normalizeSharedChatContext(
        (event as CustomEvent<Partial<SharedChatContext>>).detail
      );
      if (!context.chatId) return;
      const sequence = ++sequenceRef.current;
      try {
        const [nextChats, nextBranches] = await Promise.all([api.chatList(), api.chatBranches(context.chatId)]);
        const nextChat = nextChats.find((candidate) => candidate.id === context.chatId);
        if (!nextChat || sequence !== sequenceRef.current) return;
        const branchId = nextBranches.some((branch) => branch.id === context.branchId)
          ? context.branchId
          : nextBranches[0]?.id || null;
        const timeline = await api.chatTimeline(context.chatId, branchId || undefined);
        if (sequence !== sequenceRef.current) return;
        setChats(nextChats);
        setActiveChat(nextChat);
        setBranches(nextBranches);
        setActiveBranchId(branchId);
        setMessages(timeline);
        const nextPersona = personas.find((persona) => persona.id === context.personaId);
        if (nextPersona) setActivePersona(nextPersona);
      } catch {
        // Live remains usable if the hidden Chat screen cannot refresh immediately.
      }
    };
    window.addEventListener(LIVE_CHAT_CONTEXT_CHANGED_EVENT, adopt);
    return () => {
      sequenceRef.current += 1;
      window.removeEventListener(LIVE_CHAT_CONTEXT_CHANGED_EVENT, adopt);
    };
  }, [personas, setActiveBranchId, setActiveChat, setActivePersona, setBranches, setChats, setMessages]);
}
