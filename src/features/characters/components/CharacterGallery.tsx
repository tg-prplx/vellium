import { AvatarBadge } from "../../../components/AvatarBadge";
import { useI18n } from "../../../shared/i18n";
import type { CharacterDetail } from "../../../shared/types/contracts";

/** Characters home when nothing is selected: every card at a glance, one click to open. */
export function CharacterGallery({ characters, avatarSrc, onSelect }: {
  characters: CharacterDetail[];
  avatarSrc: (url: string | null, id?: string) => string | null;
  onSelect: (character: CharacterDetail) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="character-gallery">
      <div className="character-gallery-header">
        <h2>{t("chars.galleryTitle")}</h2>
        <p>{t("chars.galleryHint")}</p>
      </div>
      <div className="character-gallery-grid">
        {characters.map((character) => (
          <button key={character.id} type="button" className="character-card" onClick={() => onSelect(character)}>
            <AvatarBadge name={character.name} src={avatarSrc(character.avatarUrl, character.id)} className="character-card-avatar" />
            <span className="character-card-body">
              <strong>{character.name || t("chars.unnamed")}</strong>
              {character.description ? <span className="character-card-description">{character.description}</span> : null}
              {character.tags.length ? (
                <span className="character-card-tags">
                  {character.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
