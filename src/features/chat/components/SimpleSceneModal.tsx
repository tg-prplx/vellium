import type { Dispatch, SetStateAction } from "react";
import { ModalShell } from "../../../components/ModalShell";
import type { TranslationKey } from "../../../shared/i18n";
import { getSceneLevelTranslationKey } from "../../../shared/sceneLevels";
import type { CustomInspectorField, RpSceneState } from "../../../shared/types/contracts";
import { DEFAULT_SCENE_FIELD_VISIBILITY } from "../constants";
import { readSceneVarPercent } from "../utils";
import { CustomSceneFieldInput } from "./CustomSceneFieldInput";

type SceneFieldVisibility = typeof DEFAULT_SCENE_FIELD_VISIBILITY;

interface SimpleSceneModalProps {
  open: boolean;
  pureChatMode: boolean;
  sceneState: RpSceneState;
  sceneFieldVisibility: SceneFieldVisibility;
  visibleCustomSceneFields: CustomInspectorField[];
  onClose: () => void;
  onEditControls: () => void;
  onSceneStateChange: Dispatch<SetStateAction<RpSceneState>>;
  onSceneVariableChange: (key: string, value: string) => void;
  onSceneVariablePercentChange: (key: string, value: number) => void;
  t: (key: TranslationKey) => string;
}

const PERCENT_FIELDS = [
  ["initiative", "inspector.initiative"],
  ["descriptiveness", "inspector.descriptiveness"],
  ["unpredictability", "inspector.unpredictability"],
  ["emotionalDepth", "inspector.emotionalDepth"]
] as const;

export function SimpleSceneModal({
  open,
  pureChatMode,
  sceneState,
  sceneFieldVisibility,
  visibleCustomSceneFields,
  onClose,
  onEditControls,
  onSceneStateChange,
  onSceneVariableChange,
  onSceneVariablePercentChange,
  t
}: SimpleSceneModalProps) {
  if (!open) return null;

  return (
    <ModalShell
      title={t("inspector.sceneState")}
      description={t("chat.sceneControlsDesc")}
      closeLabel={t("chat.cancel")}
      onClose={onClose}
      size="lg"
      originId="scene-state"
      surfaceClassName="scene-state-modal"
      bodyClassName="scene-state-modal-body"
      icon={(
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" />
        </svg>
      )}
      headerActions={(
        <button
          type="button"
          data-modal-trigger="scene-controls"
          onClick={onEditControls}
          className="vellium-button vellium-button-secondary"
        >
          {t("chat.sceneControlsEdit")}
        </button>
      )}
    >
      <fieldset disabled={pureChatMode} className="space-y-2 disabled:opacity-50">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.mood")}</label>
            <input
              value={sceneState.mood}
              onChange={(event) => onSceneStateChange((previous) => ({ ...previous, mood: event.target.value }))}
              className="chat-simple-scene-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.pacing")}</label>
            <select
              value={sceneState.pacing}
              onChange={(event) => onSceneStateChange((previous) => ({
                ...previous,
                pacing: event.target.value as RpSceneState["pacing"]
              }))}
              className="chat-simple-scene-select"
            >
              <option value="slow">{t("inspector.slow")}</option>
              <option value="balanced">{t("inspector.balanced")}</option>
              <option value="fast">{t("inspector.fast")}</option>
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] text-text-tertiary">{t("inspector.intensity")}</label>
            <span className="text-[10px] font-medium text-text-secondary">
              {Math.round(sceneState.intensity * 100)}% ({t(getSceneLevelTranslationKey("intensity", sceneState.intensity * 100))})
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sceneState.intensity}
            onChange={(event) => onSceneStateChange((previous) => ({
              ...previous,
              intensity: Number(event.target.value)
            }))}
            className="scene-level-range w-full"
          />
        </div>

        {sceneFieldVisibility.dialogueStyle && (
          <div>
            <label className="mb-1 block text-[10px] text-text-tertiary">{t("inspector.dialogueStyle")}</label>
            <select
              value={sceneState.variables.dialogueStyle || "teasing"}
              onChange={(event) => onSceneVariableChange("dialogueStyle", event.target.value)}
              className="chat-simple-scene-select"
            >
              <option value="teasing">{t("inspector.dialogueStyleTeasing")}</option>
              <option value="playful">{t("inspector.dialogueStylePlayful")}</option>
              <option value="dominant">{t("inspector.dialogueStyleDominant")}</option>
              <option value="tender">{t("inspector.dialogueStyleTender")}</option>
              <option value="formal">{t("inspector.dialogueStyleFormal")}</option>
              <option value="chaotic">{t("inspector.dialogueStyleChaotic")}</option>
            </select>
          </div>
        )}

        {PERCENT_FIELDS
          .filter(([key]) => sceneFieldVisibility[key])
          .map(([key, labelKey]) => {
            const value = readSceneVarPercent(sceneState.variables, key, 60);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[10px] text-text-tertiary">{t(labelKey)}</label>
                  <span className="text-[10px] font-medium text-text-secondary">
                    {value}% ({t(getSceneLevelTranslationKey(key, value))})
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={value}
                  onChange={(event) => onSceneVariablePercentChange(key, Number(event.target.value))}
                  className="scene-level-range w-full"
                />
              </div>
            );
          })}

        {visibleCustomSceneFields.length > 0 && (
          <div className="space-y-2 pt-1">
            {visibleCustomSceneFields.map((field) => {
              const key = `ext:${field.key}`;
              const current = String(sceneState.variables?.[key] ?? "");
              return (
                <CustomSceneFieldInput
                  key={field.id}
                  field={field}
                  value={current || field.defaultValue || ""}
                  onChange={(nextValue) => onSceneVariableChange(key, nextValue)}
                />
              );
            })}
          </div>
        )}
      </fieldset>

      {pureChatMode && (
        <p className="text-[10px] text-text-tertiary">{t("inspector.pureChatSceneDisabled")}</p>
      )}
    </ModalShell>
  );
}
