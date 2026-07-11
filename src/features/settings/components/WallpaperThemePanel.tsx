import type { TranslationKey } from "../../../shared/i18n";
import type { WallpaperThemePalette } from "../../../shared/wallpaperTheme";
import { ToggleSwitch } from "./FormControls";

interface WallpaperThemePanelProps {
  enabled: boolean;
  generating: boolean;
  palette: WallpaperThemePalette | null;
  secondaryActionClass: string;
  onToggle: (enabled: boolean) => void;
  onRegenerate: () => void;
  t: (key: TranslationKey) => string;
}

export function WallpaperThemePanel({
  enabled,
  generating,
  palette,
  secondaryActionClass,
  onToggle,
  onRegenerate,
  t
}: WallpaperThemePanelProps) {
  return (
    <div className="settings-wallpaper-theme">
      <div className="settings-wallpaper-theme-main">
        <span className="settings-wallpaper-theme-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5l1.7 4.1 4.3 1.7-4.3 1.7-1.7 4.1-1.7-4.1L6 9.3l4.3-1.7L12 3.5ZM18.5 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="settings-wallpaper-theme-title">{t("settings.wallpaperThemeTitle")}</div>
          <p className="settings-wallpaper-theme-desc">{t("settings.wallpaperThemeDesc")}</p>
        </div>
        <ToggleSwitch checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
      </div>
      <div className="settings-wallpaper-theme-footer">
        <div className="settings-wallpaper-swatches" aria-label={t("settings.wallpaperThemePalette")}>
          {(palette?.swatches || []).slice(0, 4).map((color, index) => (
            <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
          ))}
        </div>
        <button
          type="button"
          disabled={!enabled || generating}
          onClick={onRegenerate}
          className={secondaryActionClass}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 10-2.34 5.66M20 4v7h-7" />
          </svg>
          {generating ? t("settings.wallpaperThemeGenerating") : t("settings.wallpaperThemeRegenerate")}
        </button>
      </div>
    </div>
  );
}
