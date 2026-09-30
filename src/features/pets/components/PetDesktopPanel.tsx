import { useI18n } from "../../../shared/i18n";
import type { DesktopPetVoice } from "../desktopPet";
import { PetAssetPreview } from "./PetAssetPreview";

/** Right inspector: how the pet looks on the desktop and the controls for its window. */
export function PetDesktopPanel({
  name, src, spriteSheetUrl, bubble, scale, voice, onDesktop, isElectron, busy,
  onScale, onVoice, onShow, onHide
}: {
  name: string;
  src?: string | null;
  spriteSheetUrl?: string | null;
  bubble: string;
  scale: number;
  voice: DesktopPetVoice;
  onDesktop: boolean;
  isElectron: boolean;
  busy: boolean;
  onScale: (scale: number) => void;
  onVoice: (voice: DesktopPetVoice) => void;
  onShow: () => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const percent = Math.round(scale * 100);
  return (
    <div className="flex h-full flex-col">
      <div className="characters-inspector-tabs" role="group" aria-label={t("pets.desktop")}>
        <button type="button" className="is-active" aria-pressed="true">{t("pets.preview")}</button>
      </div>
      <div className="characters-inspector-panel-body characters-preview">
        <div className="pet-desktop-preview">
          <div className="pet-desktop-bubble">{bubble}</div>
          <div className="pet-desktop-figure" style={{ transform: `scale(${scale})` }}>
            <PetAssetPreview name={name} src={src} spriteSheetUrl={spriteSheetUrl} className="pet-desktop-avatar" />
          </div>
        </div>

        <div className={`pet-desktop-state${onDesktop ? " is-on" : ""}`}>
          <i aria-hidden="true" />
          {onDesktop ? t("pets.onDesktopNow") : t("pets.notOnDesktop")}
        </div>

        <div className="pet-desktop-actions">
          <button type="button" className="char-editor-btn is-primary" onClick={onShow} disabled={!isElectron || busy}>
            {onDesktop ? t("pets.updateOnDesktop") : t("pets.showOnDesktop")}
          </button>
          {onDesktop ? (
            <button type="button" className="char-editor-btn" onClick={onHide} disabled={!isElectron || busy}>
              {t("pets.hideFromDesktop")}
            </button>
          ) : null}
        </div>
        {!isElectron ? <p className="characters-preview-description">{t("pets.desktopUnavailable")}</p> : null}

        <label className="pet-desktop-field">
          <span className="char-editor-label">{t("pets.size")} · {percent}%</span>
          <input type="range" min={0.75} max={1.35} step={0.05} value={scale} aria-valuetext={`${percent}%`}
            onChange={(event) => onScale(Number(event.target.value))} />
        </label>
        <label className="pet-desktop-field">
          <span className="char-editor-label">{t("pets.voice")}</span>
          <select className="char-editor-input" value={voice} onChange={(event) => onVoice(event.target.value as DesktopPetVoice)}>
            <option value="soft">{t("pets.voiceSoft")}</option>
            <option value="playful">{t("pets.voicePlayful")}</option>
            <option value="quiet">{t("pets.voiceQuiet")}</option>
          </select>
        </label>
        <p className="characters-preview-description">{t("pets.desktopHint")}</p>
      </div>
    </div>
  );
}
