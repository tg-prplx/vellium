import { ToggleSwitch } from "../../../components/FormControls";
import { useI18n } from "../../../shared/i18n";
import { getSceneLevelTranslationKey } from "../../../shared/sceneLevels";
import type { CharacterSceneDefaults } from "../../../shared/types/contracts";

const DIALOGUE_STYLES = ["teasing", "playful", "dominant", "tender", "formal", "chaotic"] as const;
const PERCENT_FIELDS = [
  ["initiative", "inspector.initiative"],
  ["descriptiveness", "inspector.descriptiveness"],
  ["unpredictability", "inspector.unpredictability"],
  ["emotionalDepth", "inspector.emotionalDepth"]
] as const;

function readPercent(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

interface CharacterSceneStateEditorProps {
  value: CharacterSceneDefaults;
  onChange: (value: CharacterSceneDefaults) => void;
}

export function CharacterSceneStateEditor({ value, onChange }: CharacterSceneStateEditorProps) {
  const { t } = useI18n();

  function update(patch: Partial<CharacterSceneDefaults>) {
    onChange({ ...value, ...patch });
  }

  function updateVariable(key: string, nextValue: string) {
    onChange({
      ...value,
      variables: {
        ...value.variables,
        [key]: nextValue
      }
    });
  }

  return (
    <div className="character-scene-editor">
      <div className="character-scene-editor-intro">
        <div>
          <h2>{t("chars.sceneDefaultsTitle")}</h2>
          <p>{t("chars.sceneDefaultsDescription")}</p>
        </div>
        <div className="character-scene-editor-toggle">
          <div>
            <strong>{t("chars.sceneDefaultsEnabled")}</strong>
            <span>{t("chars.sceneDefaultsEnabledDescription")}</span>
          </div>
          <ToggleSwitch
            checked={value.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
            ariaLabel={t("chars.sceneDefaultsEnabled")}
          />
        </div>
      </div>

      <fieldset disabled={!value.enabled} className="character-scene-editor-fields">
        <div className="character-scene-field">
          <label htmlFor="character-scene-mood">{t("inspector.mood")}</label>
          <input
            id="character-scene-mood"
            value={value.mood}
            onChange={(event) => update({ mood: event.target.value })}
          />
        </div>

        <div className="character-scene-field">
          <label htmlFor="character-scene-pacing">{t("inspector.pacing")}</label>
          <select
            id="character-scene-pacing"
            value={value.pacing}
            onChange={(event) => update({ pacing: event.target.value as CharacterSceneDefaults["pacing"] })}
          >
            <option value="slow">{t("inspector.slow")}</option>
            <option value="balanced">{t("inspector.balanced")}</option>
            <option value="fast">{t("inspector.fast")}</option>
          </select>
        </div>

        <div className="character-scene-slider">
          <div>
            <label htmlFor="character-scene-intensity">{t("inspector.intensity")}</label>
            <output htmlFor="character-scene-intensity">
              {Math.round(value.intensity * 100)}% ({t(getSceneLevelTranslationKey("intensity", value.intensity * 100))})
            </output>
          </div>
          <input
            id="character-scene-intensity"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(value.intensity * 100)}
            onChange={(event) => update({ intensity: Number(event.target.value) / 100 })}
            className="scene-level-range"
          />
        </div>

        <div className="character-scene-field">
          <label htmlFor="character-scene-dialogue-style">{t("inspector.dialogueStyle")}</label>
          <select
            id="character-scene-dialogue-style"
            value={value.variables.dialogueStyle || "teasing"}
            onChange={(event) => updateVariable("dialogueStyle", event.target.value)}
          >
            {DIALOGUE_STYLES.map((style) => (
              <option key={style} value={style}>
                {t(`inspector.dialogueStyle${style[0].toUpperCase()}${style.slice(1)}` as
                  | "inspector.dialogueStyleTeasing"
                  | "inspector.dialogueStylePlayful"
                  | "inspector.dialogueStyleDominant"
                  | "inspector.dialogueStyleTender"
                  | "inspector.dialogueStyleFormal"
                  | "inspector.dialogueStyleChaotic")}
              </option>
            ))}
          </select>
        </div>

        {PERCENT_FIELDS.map(([key, label], index) => {
          const fallback = [65, 70, 45, 75][index];
          const percent = readPercent(value.variables[key], fallback);
          return (
            <div className="character-scene-slider" key={key}>
              <div>
                <label htmlFor={`character-scene-${key}`}>{t(label)}</label>
                <output htmlFor={`character-scene-${key}`}>
                  {percent}% ({t(getSceneLevelTranslationKey(key, percent))})
                </output>
              </div>
              <input
                id={`character-scene-${key}`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={percent}
                onChange={(event) => updateVariable(key, event.target.value)}
                className="scene-level-range"
              />
            </div>
          );
        })}
      </fieldset>

      {!value.enabled ? (
        <div className="character-scene-editor-disabled-note">
          {t("chars.sceneDefaultsDisabledHint")}
        </div>
      ) : null}
    </div>
  );
}
