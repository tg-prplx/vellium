import { useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";
import { requestOpenNovel } from "../../../shared/appNavigation";
import type { ChatSession } from "../../../shared/types/contracts";

/** Open a chat requested by another screen (a novel continued in chat). */
export function useOpenChatRequest(onOpen: (chats: ChatSession[], chat: ChatSession) => void) {
  const handler = useRef(onOpen); handler.current = onOpen;
  useEffect(() => {
    const listener = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: unknown }>).detail?.chatId;
      if (typeof chatId !== "string") return;
      void api.chatList().then((chats) => { const chat = chats.find((item) => item.id === chatId); if (chat) handler.current(chats, chat); }).catch(() => {});
    };
    window.addEventListener("open-chat", listener);
    return () => window.removeEventListener("open-chat", listener);
  }, []);
}

/** Start a visual novel from the active chat branch; the chat is unchanged. */
export function useNovelFromChat(onError: (message: string) => void) {
  const [creating, setCreating] = useState(false);
  const running = useRef(false);
  async function start(chatId: string, branchId?: string | null) {
    if (running.current) return;
    running.current = true; setCreating(true);
    try { const story = await api.novelFromChat(chatId, branchId || undefined); requestOpenNovel(story.id); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; setCreating(false); }
  }
  return { creating, start };
}
