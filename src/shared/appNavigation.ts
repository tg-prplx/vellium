/** Cross-screen requests. The target screen may not be mounted yet (screens
 * load lazily), so a novel request is also kept until NovelsScreen takes it. */
let pendingNovel: string | null = null;

export function requestOpenNovel(id: string) {
  pendingNovel = id;
  window.dispatchEvent(new CustomEvent("open-novel", { detail: { id } }));
  window.dispatchEvent(new CustomEvent("open-app-tab", { detail: { tabId: "novels" } }));
}
export function takePendingNovel() {
  const id = pendingNovel; pendingNovel = null; return id;
}
/** Chat is always mounted, so an event is enough. */
export function requestOpenChat(chatId: string) {
  window.dispatchEvent(new CustomEvent("open-chat", { detail: { chatId } }));
  window.dispatchEvent(new CustomEvent("open-app-tab", { detail: { tabId: "chat" } }));
}
