import { useEffect, useMemo, useState } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { ModalShell } from "../../../components/ModalShell";
import { resolveApiAssetUrl } from "../../../shared/api/core";
import type { CharacterDetail } from "../../../shared/types/contracts";

export function LiveCharacterPickerModal({
  open,
  characters,
  selectedCharacterId,
  onClose,
  onSelect,
  t
}: {
  open: boolean;
  characters: CharacterDetail[];
  selectedCharacterId: string;
  onClose: () => void;
  onSelect: (characterId: string) => void;
  t: (key: any) => string;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const filteredCharacters = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return characters;
    return characters.filter((character) => (
      [character.name, character.personality, ...(character.tags || [])]
        .some((value) => String(value || "").toLocaleLowerCase().includes(needle))
    ));
  }, [characters, query]);

  if (!open) return null;
  return (
    <ModalShell
      title={t("chat.pickCharacter")}
      description={t("live.characterPickerDesc")}
      closeLabel={t("chat.cancel")}
      onClose={onClose}
      size="md"
      originId="live-character"
      surfaceClassName="live-picker-modal"
      bodyClassName="live-picker-body"
    >
      <div className="live-picker-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chat.pickCharacter")}
          autoFocus
          data-modal-autofocus
        />
      </div>
      <div className="live-picker-list">
        <button
          type="button"
          className={`live-picker-option ${selectedCharacterId ? "" : "is-active"}`}
          onClick={() => onSelect("")}
        >
          <span className="live-picker-empty-avatar" aria-hidden="true">—</span>
          <span><strong>{t("live.noCharacter")}</strong><small>{t("live.noCharacterDesc")}</small></span>
          <i aria-hidden="true" />
        </button>
        {filteredCharacters.map((character) => (
          <button
            type="button"
            key={character.id}
            className={`live-picker-option ${selectedCharacterId === character.id ? "is-active" : ""}`}
            onClick={() => onSelect(character.id)}
          >
            <AvatarBadge
              name={character.name}
              src={resolveApiAssetUrl(character.avatarUrl)}
              alt=""
              className="live-picker-avatar"
            />
            <span>
              <strong>{character.name}</strong>
              <small>{character.tags?.slice(0, 2).join(" · ") || character.personality || t("chat.pickCharacter")}</small>
            </span>
            <i aria-hidden="true" />
          </button>
        ))}
        {filteredCharacters.length === 0 ? (
          <div className="live-picker-empty">{t("chat.noCharacters")}</div>
        ) : null}
      </div>
    </ModalShell>
  );
}
