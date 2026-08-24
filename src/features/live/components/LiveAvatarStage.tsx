import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../shared/i18n";
import type { InochiAvatarStatus } from "../../../shared/types/inochiAvatar";
import type { SequencedLiveAvatarCue } from "../useLiveAvatarControls";
import { InochiCanvas } from "./InochiCanvas";
import { LiveIcon } from "./LiveIcon";

interface LiveAvatarStageProps {
  avatarUrl: string | null;
  characterName: string;
  characterSelected: boolean;
  phase: "ready" | "listening" | "thinking" | "speaking";
  audioLevel: number;
  avatarCue: SequencedLiveAvatarCue | null;
  phaseLabel: string;
  hint: string;
  micActionLabel: string;
  fallbackUploading: boolean;
  inochiStatus: InochiAvatarStatus;
  inochiBusy: boolean;
  onMicAction: () => void;
  onFallbackFile: (file: File) => void;
  onResetFallback: () => void;
  canResetFallback: boolean;
  onInochiFile: (file: File) => void;
  onRemoveInochi: () => void;
  onRenderError: (message: string) => void;
}

export function LiveAvatarStage({
  avatarUrl, characterName, characterSelected, phase, audioLevel, avatarCue, phaseLabel, hint,
  micActionLabel, fallbackUploading, inochiStatus, inochiBusy, onMicAction,
  onFallbackFile, onResetFallback, canResetFallback, onInochiFile, onRemoveInochi, onRenderError
}: LiveAvatarStageProps) {
  const { t } = useI18n();
  const inochiInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [draggingModel, setDraggingModel] = useState(false);
  const [renderFailedAsset, setRenderFailedAsset] = useState("");
  const [renderError, setRenderError] = useState("");
  const hasInochi = Boolean(inochiStatus.avatar && inochiStatus.runtime.available
    && inochiStatus.avatar.assetId !== renderFailedAsset);

  useEffect(() => {
    if (!setupOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSetupOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setupOpen]);
  useEffect(() => {
    setRenderFailedAsset("");
    setRenderError("");
  }, [inochiStatus.avatar?.assetId, inochiStatus.runtime.wasmUrl]);

  const handleRenderError = useCallback((message: string) => {
    setRenderFailedAsset(inochiStatus.avatar?.assetId || "unknown");
    setRenderError(message);
    onRenderError(message);
  }, [inochiStatus.avatar?.assetId, onRenderError]);
  const acceptInochi = (file: File | undefined) => { if (file) onInochiFile(file); };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingModel(false);
    acceptInochi(Array.from(event.dataTransfer.files || [])[0]);
  };

  return (
    <div className={`live-avatar-stage${draggingModel ? " is-avatar-drop" : ""}${renderError ? " has-avatar-error" : ""}`}>
      {hasInochi && inochiStatus.avatar ? (
        <InochiCanvas
          modelUrl={inochiStatus.avatar.modelUrl}
          wasmUrl={inochiStatus.runtime.wasmUrl}
          parameters={inochiStatus.avatar.parameters}
          audioLevel={audioLevel}
          phase={phase}
          cue={avatarCue}
          onError={handleRenderError}
        />
      ) : (
        <div className="live-avatar-static-fallback" aria-label={characterName}>
          {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} /> : <LiveIcon name="voice" />}
          <span>{renderError || t("live.inochiFallback")}</span>
        </div>
      )}
      <div className="live-avatar-rings" aria-hidden="true"><i /><i /><i /></div>
      <button type="button" className="live-avatar-mic" onClick={onMicAction} aria-label={micActionLabel} title={micActionLabel}>
        <LiveIcon name={phase === "ready" ? "mic" : "stop"} />
      </button>
      <div className="live-avatar-copy"><strong>{phaseLabel}</strong><span>{hint}</span></div>
      <div className="live-avatar-tools">
        <span className="inochi2d-experimental-badge">{t("live.inochiExperimental")}</span>
        <button type="button" onClick={() => setSetupOpen(true)}>{t("live.inochiSetup")}</button>
      </div>

      {setupOpen ? createPortal((
        <div className="inochi2d-setup-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSetupOpen(false);
        }}>
          <section className="inochi2d-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="inochi2d-setup-title">
            <header>
              <div><strong id="inochi2d-setup-title">{t("live.inochiSetupTitle")}</strong><span>{t("live.inochiSetupDescription")}</span></div>
              <button type="button" onClick={() => setSetupOpen(false)} aria-label={t("common.close")}>×</button>
            </header>

            <div className="inochi2d-runtime-status">
              <div><strong>{t("live.inochiRuntime")}</strong><span>{inochiStatus.runtime.version}</span></div>
              <span className="is-ready">{t("live.inochiBundled")}</span>
            </div>

            <div className={`inochi2d-model-drop${draggingModel ? " is-dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDraggingModel(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingModel(false); }}
              onDrop={handleDrop}>
              <input ref={inochiInputRef} type="file" accept=".inp,.inx,application/octet-stream" hidden onChange={(event) => {
                acceptInochi(event.currentTarget.files?.[0]); event.currentTarget.value = "";
              }} />
              <strong>{inochiStatus.avatar?.displayName || t("live.inochiImportTitle")}</strong>
              <span>{characterSelected ? t("live.inochiImportHint") : t("live.inochiSelectCharacter")}</span>
              {inochiStatus.avatar ? <small>{inochiStatus.avatar.filename} · {inochiStatus.avatar.parameters.length} {t("live.inochiParameters")}</small> : null}
              <div>
                <button type="button" disabled={!characterSelected || inochiBusy} onClick={() => inochiInputRef.current?.click()}>{inochiBusy ? t("live.inochiImporting") : (inochiStatus.avatar ? t("live.inochiReplace") : t("live.inochiImport"))}</button>
                {inochiStatus.avatar ? <button type="button" className="danger" disabled={inochiBusy} onClick={onRemoveInochi}>{t("live.inochiRemove")}</button> : null}
              </div>
            </div>

            <p className="inochi2d-compatibility-note">{t("live.inochiCompatibility")}</p>

            <div className="inochi2d-setup-section is-fallback">
              <input ref={fallbackInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0]; if (file) onFallbackFile(file); event.currentTarget.value = "";
              }} />
              <div><strong>{t("live.inochiFallbackTitle")}</strong><span>{t("live.inochiFallbackDescription")}</span></div>
              <button type="button" disabled={fallbackUploading} onClick={() => fallbackInputRef.current?.click()}>{fallbackUploading ? t("live.avatarUploading") : t("live.avatarReplace")}</button>
              {canResetFallback ? <button type="button" onClick={onResetFallback}>{t("live.avatarReset")}</button> : null}
            </div>
          </section>
        </div>
      ), document.body) : null}
    </div>
  );
}
