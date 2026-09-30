import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../../shared/api";
import type { ChatMessage } from "../../../shared/types/contracts";

export function useChatGenerationFailure(chatId: string | null, branchId: string | null, setMessages: Dispatch<SetStateAction<ChatMessage[]>>) {
  const active = useRef({ chatId, branchId });
  active.current = { chatId, branchId };
  const [failures, setFailures] = useState<Record<string, { error: string; characterName?: string }>>({});
  const key = `${chatId}:${branchId}`;

  function clearFailure(targetChatId: string, targetBranchId: string | null) {
    setFailures(previous => {
      const next = { ...previous };
      delete next[`${targetChatId}:${targetBranchId}`];
      return next;
    });
  }

  async function reportFailure(error: unknown, targetChatId: string, targetBranchId: string | null, characterName?: string) {
    setFailures(previous => ({ ...previous, [`${targetChatId}:${targetBranchId}`]: { error: String(error), characterName } }));
    // A failed send still persists the user turn. Replace the optimistic row before retrying.
    try {
      const timeline = await api.chatTimeline(targetChatId, targetBranchId || undefined);
      if (active.current.chatId === targetChatId && active.current.branchId === targetBranchId) setMessages(timeline);
    } catch { /* Keep the original failure visible if the local API is also unavailable. */ }
  }

  return { generationFailure: failures[key], clearGenerationFailure: clearFailure, reportGenerationFailure: reportFailure };
}
