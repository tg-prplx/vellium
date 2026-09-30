import { AvatarBadge } from "../../../components/AvatarBadge";
import { Badge, EmptyState } from "../../../components/Panels";
import { resolveApiAssetUrl } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { CharacterDetail, ChatSession } from "../../../shared/types/contracts";

interface ChatHistoryListProps {
  chats: ChatSession[];
  characters: CharacterDetail[];
  activeChatId?: string;
  simple: boolean;
  searching?: boolean;
  renamingId: string | null;
  renamingTitle: string;
  onRenamingTitleChange: (title: string) => void;
  onSelect: (chat: ChatSession) => void;
  onRename: (chat: ChatSession) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
}

export function ChatHistoryList({ chats, characters, activeChatId, simple, searching, renamingId, renamingTitle,
  onRenamingTitleChange, onSelect, onRename, onSaveRename, onCancelRename, onDelete }: ChatHistoryListProps) {
  const { t, locale } = useI18n();
  return (
    <div className="chat-sidebar-list min-h-0 flex-1 space-y-1 overflow-y-auto">
      {chats.length === 0 ? (
        <EmptyState title={t(searching ? "chat.noSearchResults" : "chat.noChatYet")} description={t(searching ? "chat.noSearchResultsDesc" : "chat.noChatDesc")} />
      ) : chats.map((chat) => {
        const primaryId = chat.characterId || chat.characterIds?.[0];
        const character = characters.find((item) => item.id === primaryId);
        const active = activeChatId === chat.id;
        const multiCount = chat.characterIds?.length || 0;
        return (
          <div key={chat.id} className={`chat-sidebar-item group relative flex items-start gap-2 rounded-lg ${simple ? "px-2 py-2" : "px-3 py-2"} ${active ? "bg-accent-subtle text-text-primary" : "text-text-secondary hover:bg-bg-hover"}`}>
            {renamingId === chat.id ? (
              <div className="chat-sidebar-rename flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <input value={renamingTitle} onChange={(event) => onRenamingTitleChange(event.target.value)}
                  aria-label={t("chat.renameChat")} autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); onSaveRename(chat.id); }
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancelRename(); }
                  }} className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary" />
                <button onClick={() => onSaveRename(chat.id)} className="rounded-md bg-accent-subtle px-2 py-1 text-xs text-accent">{t("chat.save")}</button>
                <button onClick={onCancelRename} className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover">{t("chat.cancel")}</button>
              </div>
            ) : (
              <>
                <button onClick={() => onSelect(chat)} aria-current={active ? "true" : undefined}
                  title={simple ? `${chat.title}\n${new Date(chat.createdAt).toLocaleString(locale)}` : chat.title} className="chat-sidebar-select flex min-w-0 flex-1 items-start gap-2 text-left">
                  {(character || simple) && <AvatarBadge name={character?.name || chat.title}
                    src={resolveApiAssetUrl(character?.avatarUrl)} className="h-7 w-7 flex-shrink-0 rounded-lg"
                    fallbackClassName="bg-bg-tertiary text-[10px] font-semibold text-text-secondary" />}
                  <span className="min-w-0 flex-1">
                    <span className="chat-sidebar-item-title block text-sm font-medium leading-snug">{chat.title}</span>
                    {!simple && <span className="chat-sidebar-item-meta mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <time dateTime={chat.createdAt} title={new Date(chat.createdAt).toLocaleString(locale)}>
                        {new Date(chat.createdAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}
                      </time>
                      {multiCount > 1 && <Badge>{multiCount}</Badge>}
                    </span>}
                  </span>
                  {simple && multiCount > 1 && <Badge>{multiCount}</Badge>}
                </button>
                <div className="chat-sidebar-row-actions flex flex-shrink-0 items-center gap-0.5">
                  <button onClick={() => onRename(chat)} aria-label={t("chat.renameChat")} title={t("chat.renameChat")}
                    className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => { if (confirm(t("chat.confirmDeleteChat"))) onDelete(chat.id); }}
                    aria-label={t("chat.deleteChat")} title={t("chat.deleteChat")}
                    className="rounded-md p-1 text-text-tertiary hover:bg-danger-subtle hover:text-danger">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
