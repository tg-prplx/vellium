import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import {
  readDesktopPetThemeSnapshot,
  readStoredDesktopPetConfig,
  storeDesktopPetConfig,
  type DesktopPetConfig,
  type DesktopPetVoice
} from "./desktopPet";

export function DesktopPetControl() {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<DesktopPetConfig>(() => readStoredDesktopPetConfig());
  const isElectron = Boolean(window.electronAPI?.toggleDesktopPet);

  const statusLabel = useMemo(() => (
    isElectron
      ? (visible ? t("pets.visible") : t("pets.hidden"))
      : t("pets.desktopOnly")
  ), [isElectron, visible, t]);

  useEffect(() => {
    if (!isElectron) return;
    void window.electronAPI?.isDesktopPetVisible?.().then(setVisible).catch(() => setVisible(false));
  }, [isElectron]);

  useEffect(() => {
    storeDesktopPetConfig(config, false);
  }, [config]);

  useEffect(() => {
    function onConfigChange(event: Event) {
      const detail = (event as CustomEvent<DesktopPetConfig>).detail;
      if (detail && typeof detail === "object") {
        setConfig((prev) => JSON.stringify(prev) === JSON.stringify(detail) ? prev : detail);
      }
    }
    window.addEventListener("desktop-pet-config-change", onConfigChange);
    return () => window.removeEventListener("desktop-pet-config-change", onConfigChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  async function togglePet() {
    if (!isElectron) {
      setOpen(true);
      return;
    }
    const result = await window.electronAPI!.toggleDesktopPet({ ...config, theme: readDesktopPetThemeSnapshot() });
    setVisible(result.visible);
  }

  async function applyConfig(next = config) {
    const themedNext = { ...next, theme: readDesktopPetThemeSnapshot() };
    storeDesktopPetConfig(themedNext);
    if (!isElectron) return;
    const result = visible
      ? await window.electronAPI!.showDesktopPet(themedNext)
      : await window.electronAPI!.configureDesktopPet(themedNext);
    setVisible(result.visible);
  }

  return (
    <div className="desktop-pet-control">
      <button
        ref={buttonRef}
        type="button"
        className={`desktop-pet-button ${visible ? "is-active" : ""}`}
        title={t("pets.title")}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 9.5C5.6 9.2 4 7.8 4 6.1c0-1.2.8-2.1 1.9-2.1 1.4 0 2.4 1.5 2.8 3.2M16.5 9.5c1.9-.3 3.5-1.7 3.5-3.4 0-1.2-.8-2.1-1.9-2.1-1.4 0-2.4 1.5-2.8 3.2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 13.6C5.5 9.9 8.4 7 12 7s6.5 2.9 6.5 6.6c0 3.4-2.4 5.9-6.5 5.9s-6.5-2.5-6.5-5.9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.3 13.2h.01M14.7 13.2h.01M10.2 16c.9.7 2.7.7 3.6 0" />
        </svg>
      </button>

      {open && (
        <div ref={panelRef} className="desktop-pet-panel">
          <div className="desktop-pet-panel-head">
            <div>
              <div className="desktop-pet-title">{t("pets.title")}</div>
              <div className="desktop-pet-status">{statusLabel}</div>
            </div>
            <button
              type="button"
              className="desktop-pet-close"
              onClick={() => setOpen(false)}
              title={t("common.close")}
            >
              x
            </button>
          </div>

          <div className="desktop-pet-fields">
            <label>
              <span>{t("pets.name")}</span>
              <input
                value={config.name}
                onChange={(event) => setConfig((prev) => ({ ...prev, name: event.target.value.slice(0, 32) }))}
                onBlur={() => void applyConfig()}
              />
            </label>
            <label>
              <span>{t("pets.spriteUrl")}</span>
              <input
                value={config.spriteUrl}
                placeholder="https://.../pet.gif"
                onChange={(event) => setConfig((prev) => ({ ...prev, spriteUrl: event.target.value.slice(0, 4000) }))}
                onBlur={() => void applyConfig()}
              />
            </label>
            <div className="desktop-pet-grid">
              <label>
                <span>{t("pets.voice")}</span>
                <select
                  value={config.voice}
                  onChange={(event) => {
                    const next = { ...config, voice: event.target.value as DesktopPetVoice };
                    setConfig(next);
                    void applyConfig(next);
                  }}
                >
                  <option value="soft">{t("pets.voiceSoft")}</option>
                  <option value="playful">{t("pets.voicePlayful")}</option>
                  <option value="quiet">{t("pets.voiceQuiet")}</option>
                </select>
              </label>
              <label>
                <span>{t("pets.size")}</span>
                <input
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.05}
                  value={config.scale}
                  onChange={(event) => {
                    const next = { ...config, scale: Number(event.target.value) };
                    setConfig(next);
                    void applyConfig(next);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="desktop-pet-actions">
            <button type="button" onClick={togglePet} disabled={!isElectron}>
              {visible ? t("pets.hide") : t("pets.show")}
            </button>
            <button type="button" onClick={() => void applyConfig()} disabled={!isElectron}>
              {t("pets.apply")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
