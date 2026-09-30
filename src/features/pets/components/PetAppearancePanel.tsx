import { useI18n } from "../../../shared/i18n";
import { PetAssetPreview } from "./PetAssetPreview";

/** Upload-first appearance editing; raw URLs stay available for advanced users. */
export function PetAppearancePanel({
  name, spriteUrl, spriteSheetUrl, uploading,
  onUploadAsset, onUploadSheet, onClearAsset, onClearSheet, onSpriteUrl, onSpriteSheetUrl
}: {
  name: string;
  spriteUrl: string;
  spriteSheetUrl: string;
  uploading: boolean;
  onUploadAsset: () => void;
  onUploadSheet: () => void;
  onClearAsset: () => void;
  onClearSheet: () => void;
  onSpriteUrl: (value: string) => void;
  onSpriteSheetUrl: (value: string) => void;
}) {
  const { t } = useI18n();
  const tiles = [
    {
      id: "asset", title: t("pets.petAsset"), set: Boolean(spriteUrl),
      hint: spriteUrl ? t("pets.assetSet") : t("pets.assetEmptyHint"),
      upload: spriteUrl ? t("pets.replaceAsset") : t("pets.uploadAsset"),
      preview: <PetAssetPreview name={name} src={spriteUrl || null} className="pet-asset-thumb" />,
      onUpload: onUploadAsset, onClear: onClearAsset
    },
    {
      id: "sheet", title: t("pets.spriteSheet"), set: Boolean(spriteSheetUrl),
      hint: spriteSheetUrl ? t("pets.spriteSheetSet") : t("pets.spriteSheetHint"),
      upload: spriteSheetUrl ? t("pets.replaceAsset") : t("pets.uploadSpriteSheet"),
      preview: <PetAssetPreview name={name} spriteSheetUrl={spriteSheetUrl || null} className="pet-asset-thumb" />,
      onUpload: onUploadSheet, onClear: onClearSheet
    }
  ];
  return (
    <div className="pet-editor-body">
      <div className="pet-asset-grid">
        {tiles.map((tile) => (
          <div key={tile.id} className="pet-asset-tile">
            {tile.preview}
            <div className="pet-asset-copy">
              <strong>{tile.title}</strong>
              <span>{tile.hint}</span>
              <span className="pet-asset-actions">
                <button type="button" className="char-editor-btn" onClick={tile.onUpload} disabled={uploading}>
                  {uploading ? t("pets.assetUploading") : tile.upload}
                </button>
                {tile.set ? <button type="button" className="char-editor-btn" onClick={tile.onClear}>{t("pets.clearAsset")}</button> : null}
              </span>
            </div>
          </div>
        ))}
      </div>

      <details className="pet-advanced">
        <summary>{t("pets.useUrlInstead")}</summary>
        <div className="pet-advanced-fields">
          <label>
            <span className="char-editor-label">{t("pets.petAsset")}</span>
            <input className="char-editor-input" value={spriteUrl} placeholder={t("pets.petAssetPlaceholder")}
              onChange={(event) => onSpriteUrl(event.target.value.slice(0, 4000))} />
          </label>
          <label>
            <span className="char-editor-label">{t("pets.spriteSheet")}</span>
            <input className="char-editor-input" value={spriteSheetUrl} placeholder={t("pets.spriteSheetPlaceholder")}
              onChange={(event) => onSpriteSheetUrl(event.target.value.slice(0, 4000))} />
          </label>
        </div>
      </details>
    </div>
  );
}
