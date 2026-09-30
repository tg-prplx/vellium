import { useI18n } from "../../../shared/i18n";
import {
  CODEX_PET_STATES,
  normalizeDesktopPetAnimation,
  normalizeDesktopPetCodexState,
  type DesktopPetCodexState,
  type DesktopPetStatePreset
} from "../desktopPet";

const trashIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v5m4-5v5" />
  </svg>
);

/** Actions or emotions the model can trigger, laid out like the Characters editor fields. */
export function PetStateEditor({
  title, presets, animations, uploading, codexStateFor, onAdd, onUpdate, onRemove, onUpload
}: {
  title: string;
  presets: DesktopPetStatePreset[];
  animations: readonly string[];
  uploading: boolean;
  codexStateFor: (preset: DesktopPetStatePreset) => DesktopPetCodexState;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<DesktopPetStatePreset>) => void;
  onRemove: (index: number) => void;
  onUpload: (index: number, field: "assetUrl" | "soundUrl") => void;
}) {
  const { t } = useI18n();
  return (
    <section className="char-editor-section pet-state-section">
      <div className="pet-state-section-head">
        <span className="char-editor-section-title">{title}</span>
        <button type="button" className="char-editor-btn" onClick={onAdd}>+ {t("pets.addState")}</button>
      </div>
      <div className="pet-state-list">
        {presets.map((preset, index) => (
          <div key={index} className="pet-state-row">
            <div className="pet-state-grid">
              <label>
                <span className="char-editor-label">{t("pets.stateId")}</span>
                <input className="char-editor-input" value={preset.id} onChange={(event) => onUpdate(index, { id: event.target.value })} />
              </label>
              <label>
                <span className="char-editor-label">{t("pets.stateLabel")}</span>
                <input className="char-editor-input" value={preset.label} onChange={(event) => onUpdate(index, { label: event.target.value })} />
              </label>
              <label>
                <span className="char-editor-label">{t("pets.animation")}</span>
                <select className="char-editor-input" value={preset.animation}
                  onChange={(event) => onUpdate(index, { animation: normalizeDesktopPetAnimation(event.target.value) })}>
                  {animations.map((animation) => (
                    <option key={animation} value={animation}>{animation === "none" ? t("pets.animationNone") : animation}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="char-editor-label">{t("pets.codexState")}</span>
                <select className="char-editor-input" value={preset.codexState || codexStateFor(preset)}
                  onChange={(event) => onUpdate(index, { codexState: normalizeDesktopPetCodexState(event.target.value) })}>
                  {CODEX_PET_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
              <button type="button" className="char-editor-btn is-danger pet-state-remove" onClick={() => onRemove(index)}
                aria-label={t("common.delete")} title={t("common.delete")}>
                {trashIcon}
              </button>
            </div>
            <div className="pet-state-media">
              {(["assetUrl", "soundUrl"] as const).map((field) => (
                <label key={field}>
                  <span className="char-editor-label">{field === "assetUrl" ? t("pets.stateAsset") : t("pets.stateSound")}</span>
                  <span className="pet-media-field">
                    <input className="char-editor-input" value={preset[field] || ""}
                      placeholder={field === "assetUrl" ? t("pets.stateAssetPlaceholder") : t("pets.stateSoundPlaceholder")}
                      onChange={(event) => onUpdate(index, { [field]: event.target.value })} />
                    <button type="button" className="char-editor-btn" onClick={() => onUpload(index, field)} disabled={uploading}>
                      {uploading ? t("pets.assetUploading") : t("pets.upload")}
                    </button>
                    {preset[field] ? (
                      <button type="button" className="char-editor-btn" onClick={() => onUpdate(index, { [field]: "" })}>{t("pets.clearAsset")}</button>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
