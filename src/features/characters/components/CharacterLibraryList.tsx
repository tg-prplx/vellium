import { useState, type DragEvent, type KeyboardEvent } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { Badge, EmptyState } from "../../../components/Panels";
import type { TranslationKey } from "../../../shared/i18n";
import type { CharacterDetail } from "../../../shared/types/contracts";

interface CharacterLibraryListProps {
  characters: CharacterDetail[];
  visibleCharacters: CharacterDetail[];
  selectedId?: string;
  loading: boolean;
  queryActive: boolean;
  reordering: boolean;
  avatarSrc: (url: string | null, characterId: string) => string | null;
  onSelect: (character: CharacterDetail) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  t: (key: TranslationKey) => string;
}

export function CharacterLibraryList({
  characters,
  visibleCharacters,
  selectedId,
  loading,
  queryActive,
  reordering,
  avatarSrc,
  onSelect,
  onReorder,
  t
}: CharacterLibraryListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const canReorder = !queryActive && !reordering;

  function handleDragStart(event: DragEvent<HTMLButtonElement>, characterId: string) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", characterId);
    setDraggedId(characterId);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>, targetId: string) {
    event.preventDefault();
    const sourceId = draggedId || event.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDropTargetId(null);
    if (canReorder && sourceId && sourceId !== targetId) onReorder(sourceId, targetId);
  }

  function handleKeyboardMove(event: KeyboardEvent<HTMLButtonElement>, characterId: string) {
    if (!canReorder || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const index = characters.findIndex((character) => character.id === characterId);
    const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
    const target = characters[targetIndex];
    if (!target) return;
    event.preventDefault();
    onReorder(characterId, target.id);
  }

  return (
    <div className="list-animate flex-1 space-y-1.5 overflow-y-auto">
      {loading ? (
        <div className="py-8 text-center text-xs text-text-tertiary">{t("chars.loading")}</div>
      ) : characters.length === 0 ? (
        <EmptyState title={t("chars.noChars")} description={t("chars.noCharsDesc")} />
      ) : visibleCharacters.length === 0 ? (
        <EmptyState title={t("chars.noSearchResults")} description={t("chars.noSearchResultsDesc")} />
      ) : (
        visibleCharacters.map((character) => (
          <button
            key={character.id}
            type="button"
            draggable={canReorder}
            onDragStart={(event) => handleDragStart(event, character.id)}
            onDragOver={(event) => {
              if (!canReorder || draggedId === character.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetId(character.id);
            }}
            onDragLeave={() => setDropTargetId((current) => current === character.id ? null : current)}
            onDrop={(event) => handleDrop(event, character.id)}
            onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
            onKeyDown={(event) => handleKeyboardMove(event, character.id)}
            onClick={() => onSelect(character)}
            title={canReorder ? t("chars.reorderHint") : undefined}
            className={`character-library-item ${selectedId === character.id ? "is-active" : ""} ${draggedId === character.id ? "is-dragging" : ""} ${dropTargetId === character.id ? "is-drop-target" : ""}`}
          >
            <AvatarBadge
              name={character.name}
              src={avatarSrc(character.avatarUrl, character.id)}
              className="h-8 w-8 flex-shrink-0 rounded-full"
              fallbackClassName="bg-accent-subtle text-xs font-bold text-accent"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{character.name}</div>
              {(character.agentProfile?.enabled || character.tags.length > 0) && (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {character.agentProfile?.enabled ? <Badge variant="accent">{t("chars.agentCharacter")}</Badge> : null}
                  {character.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                </div>
              )}
            </div>
            {canReorder ? (
              <span className="character-library-drag-handle" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="7" r="1.35" /><circle cx="16" cy="7" r="1.35" /><circle cx="8" cy="12" r="1.35" /><circle cx="16" cy="12" r="1.35" /><circle cx="8" cy="17" r="1.35" /><circle cx="16" cy="17" r="1.35" /></svg>
              </span>
            ) : null}
          </button>
        ))
      )}
    </div>
  );
}
