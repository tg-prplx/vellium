import { useEffect, useMemo, useState } from "react";
import type { AppSettings, CustomInspectorField } from "../../../shared/types/contracts";
import type { TranslationKey } from "../../../shared/i18n";
import { InputField, ToggleSwitch } from "../../settings/components/FormControls";
import { DEFAULT_SCENE_FIELD_VISIBILITY } from "../constants";

type SceneFieldVisibility = AppSettings["sceneFieldVisibility"];

const BUILT_IN_SCENE_FIELDS = [
  { key: "dialogueStyle", labelKey: "inspector.dialogueStyle" },
  { key: "initiative", labelKey: "inspector.initiative" },
  { key: "descriptiveness", labelKey: "inspector.descriptiveness" },
  { key: "unpredictability", labelKey: "inspector.unpredictability" },
  { key: "emotionalDepth", labelKey: "inspector.emotionalDepth" }
] as const;

interface SceneControlsEditorProps {
  open: boolean;
  saving: boolean;
  errorText: string;
  builtInVisibility: SceneFieldVisibility;
  customFields: CustomInspectorField[];
  onClose: () => void;
  onSave: (nextVisibility: SceneFieldVisibility, nextFields: CustomInspectorField[]) => void;
  t: (key: TranslationKey) => string;
}

interface NewSliderDraft {
  label: string;
  min: string;
  max: string;
  step: string;
  defaultValue: string;
  visibleInPureChat: boolean;
  enabled: boolean;
}

function createSliderDraft(): NewSliderDraft {
  return {
    label: "",
    min: "0",
    max: "100",
    step: "5",
    defaultValue: "50",
    visibleInPureChat: false,
    enabled: true
  };
}

function parseFiniteNumber(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeFieldOrder(fields: CustomInspectorField[]): CustomInspectorField[] {
  return [...fields]
    .sort((a, b) => a.order - b.order)
    .map((field, index) => ({ ...field, order: index + 1 }));
}

function normalizeRangeField(field: CustomInspectorField): CustomInspectorField {
  if (field.type !== "range") {
    return {
      ...field,
      enabled: field.enabled !== false
    };
  }

  let min = Number.isFinite(field.min) ? Number(field.min) : 0;
  let max = Number.isFinite(field.max) ? Number(field.max) : 100;
  if (max < min) {
    const nextMin = max;
    max = min;
    min = nextMin;
  }
  const step = Number.isFinite(field.step) && Number(field.step) > 0 ? Number(field.step) : 1;
  const rawDefault = parseFiniteNumber(String(field.defaultValue ?? min));
  const defaultValue = String(clampNumber(rawDefault ?? min, min, max));

  return {
    ...field,
    enabled: field.enabled !== false,
    min,
    max,
    step,
    defaultValue
  };
}

function normalizeCustomFields(fields: CustomInspectorField[]): CustomInspectorField[] {
  return normalizeFieldOrder(fields).map(normalizeRangeField);
}

function slugifyControlKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildUniqueControlKey(label: string, fields: CustomInspectorField[]) {
  const base = slugifyControlKey(label) || "scene-slider";
  const seen = new Set(fields.map((field) => field.key));
  if (!seen.has(base)) return base;
  let suffix = 2;
  while (seen.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function SceneControlsEditor({
  open,
  saving,
  errorText,
  builtInVisibility,
  customFields,
  onClose,
  onSave,
  t
}: SceneControlsEditorProps) {
  const [draftVisibility, setDraftVisibility] = useState<SceneFieldVisibility>({ ...DEFAULT_SCENE_FIELD_VISIBILITY });
  const [draftFields, setDraftFields] = useState<CustomInspectorField[]>([]);
  const [newSlider, setNewSlider] = useState<NewSliderDraft>(createSliderDraft());
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftVisibility({
      ...DEFAULT_SCENE_FIELD_VISIBILITY,
      ...builtInVisibility
    });
    setDraftFields(normalizeCustomFields(customFields.map((field) => ({
      ...field,
      enabled: field.enabled !== false
    }))));
    setNewSlider(createSliderDraft());
    setLocalError("");
  }, [open, builtInVisibility, customFields]);

  const sceneCustomFields = useMemo(() => {
    return draftFields
      .filter((field) => field.section === "scene")
      .sort((a, b) => a.order - b.order);
  }, [draftFields]);

  const newSliderPreview = useMemo(() => {
    const min = parseFiniteNumber(newSlider.min) ?? 0;
    const max = parseFiniteNumber(newSlider.max) ?? 100;
    const step = parseFiniteNumber(newSlider.step) ?? 5;
    const defaultValue = parseFiniteNumber(newSlider.defaultValue) ?? min;
    const rangeMin = Math.min(min, max);
    const rangeMax = Math.max(min, max);
    return {
      min: rangeMin,
      max: rangeMax,
      step: step > 0 ? step : 1,
      value: clampNumber(defaultValue, rangeMin, rangeMax)
    };
  }, [newSlider]);

  if (!open) return null;

  function updateField(fieldId: string, patch: Partial<CustomInspectorField>) {
    setDraftFields((prev) => prev.map((field) => (
      field.id === fieldId ? { ...field, ...patch } : field
    )));
  }

  function updateRangeNumberField(fieldId: string, key: "min" | "max" | "step", raw: string) {
    const value = parseFiniteNumber(raw);
    if (value === null) return;
    updateField(fieldId, { [key]: value } as Pick<CustomInspectorField, typeof key>);
  }

  function updateRangeDefaultValue(fieldId: string, raw: string) {
    if (!raw.trim()) {
      updateField(fieldId, { defaultValue: undefined });
      return;
    }
    const value = parseFiniteNumber(raw);
    if (value === null) return;
    updateField(fieldId, { defaultValue: String(value) });
  }

  function removeField(fieldId: string) {
    setDraftFields((prev) => prev.filter((field) => field.id !== fieldId));
  }

  function addSlider() {
    const label = newSlider.label.trim();
    const min = parseFiniteNumber(newSlider.min);
    const max = parseFiniteNumber(newSlider.max);
    const step = parseFiniteNumber(newSlider.step);
    const defaultValue = parseFiniteNumber(newSlider.defaultValue);

    if (!label || min === null || max === null || step === null || step <= 0 || defaultValue === null) {
      setLocalError(t("chat.sceneControlsCreateError"));
      return;
    }

    const rangeMin = Math.min(min, max);
    const rangeMax = Math.max(min, max);
    const nextOrder = draftFields.reduce((currentMax, field) => Math.max(currentMax, field.order), 0) + 1;
    const nextField: CustomInspectorField = {
      id: `scene-slider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key: buildUniqueControlKey(label, draftFields),
      label,
      type: "range",
      section: "scene",
      enabled: newSlider.enabled,
      min: rangeMin,
      max: rangeMax,
      step,
      order: nextOrder,
      defaultValue: String(clampNumber(defaultValue, rangeMin, rangeMax)),
      visibleInPureChat: newSlider.visibleInPureChat
    };

    setDraftFields((prev) => normalizeCustomFields([...prev, nextField]));
    setNewSlider(createSliderDraft());
    setLocalError("");
  }

  function handleSave() {
    onSave(draftVisibility, normalizeCustomFields(draftFields));
  }

  const resolvedError = localError || errorText;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 overlay-animate"
      onClick={onClose}
    >
      <div
        className="modal-pop w-full max-w-4xl rounded-2xl border border-border bg-bg-secondary shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-text-primary">{t("chat.sceneControlsEdit")}</div>
            <div className="mt-1 text-xs text-text-tertiary">{t("chat.sceneControlsDesc")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
          >
            {t("common.close")}
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-auto px-5 py-4">
          <div className="rounded-xl border border-border-subtle bg-bg-primary p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{t("chat.sceneControlsBuiltIn")}</div>
                <div className="mt-1 text-xs text-text-tertiary">{t("chat.sceneControlsBuiltInDesc")}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {BUILT_IN_SCENE_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5"
                >
                  <span className="text-sm text-text-primary">{t(field.labelKey)}</span>
                  <ToggleSwitch
                    checked={draftVisibility[field.key]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDraftVisibility((prev) => ({ ...prev, [field.key]: checked }));
                    }}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border-subtle bg-bg-primary p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{t("chat.sceneControlsCustom")}</div>
                <div className="mt-1 text-xs text-text-tertiary">{t("chat.sceneControlsCustomDesc")}</div>
              </div>
              <span className="rounded-full border border-border-subtle bg-bg-secondary px-2.5 py-1 text-[11px] text-text-secondary">
                {sceneCustomFields.length}
              </span>
            </div>

            {sceneCustomFields.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border-subtle bg-bg-secondary px-3 py-4 text-sm text-text-tertiary">
                {t("chat.sceneControlsEmpty")}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {sceneCustomFields.map((field) => (
                  <div key={field.id} className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-text-primary">{field.label}</span>
                          <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                            {field.type === "range" ? t("chat.sceneControlsTypeRange") : field.type}
                          </span>
                          {field.enabled === false && (
                            <span className="rounded-full border border-warning-border bg-warning-subtle px-2 py-0.5 text-[10px] text-warning">
                              {t("chat.disable")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-text-tertiary">ext:{field.key}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeField(field.id)}
                        className="rounded-lg border border-danger-border px-2.5 py-1.5 text-[11px] font-medium text-danger hover:bg-danger-subtle"
                      >
                        {t("common.delete")}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsName")}</label>
                        <InputField
                          value={field.label}
                          onChange={(value) => updateField(field.id, { label: value })}
                          placeholder={t("chat.sceneControlsNamePlaceholder")}
                          className="text-sm"
                        />
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{t("chat.sceneControlsKey")}</div>
                        <div className="mt-1 text-xs font-medium text-text-secondary">{field.key}</div>
                      </div>
                    </div>

                    {field.type === "range" && (
                      <>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsMin")}</label>
                            <InputField
                              type="number"
                              value={String(field.min ?? 0)}
                              onChange={(value) => updateRangeNumberField(field.id, "min", value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsMax")}</label>
                            <InputField
                              type="number"
                              value={String(field.max ?? 100)}
                              onChange={(value) => updateRangeNumberField(field.id, "max", value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsStep")}</label>
                            <InputField
                              type="number"
                              value={String(field.step ?? 1)}
                              onChange={(value) => updateRangeNumberField(field.id, "step", value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsDefault")}</label>
                            <InputField
                              type="number"
                              value={String(field.defaultValue ?? field.min ?? 0)}
                              onChange={(value) => updateRangeDefaultValue(field.id, value)}
                            />
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary px-3 py-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{t("chat.sceneControlsPreview")}</span>
                            <span className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[11px] text-text-secondary">
                              {normalizeRangeField(field).defaultValue}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={normalizeRangeField(field).min}
                            max={normalizeRangeField(field).max}
                            step={normalizeRangeField(field).step}
                            value={Number(normalizeRangeField(field).defaultValue ?? normalizeRangeField(field).min ?? 0)}
                            readOnly
                            className="w-full"
                          />
                        </div>
                      </>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm text-text-primary">{t("chat.sceneControlsEnabled")}</div>
                        </div>
                        <ToggleSwitch
                          checked={field.enabled !== false}
                          onChange={(event) => updateField(field.id, { enabled: event.target.checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm text-text-primary">{t("chat.sceneControlsPureChat")}</div>
                        </div>
                        <ToggleSwitch
                          checked={field.visibleInPureChat === true}
                          onChange={(event) => updateField(field.id, { visibleInPureChat: event.target.checked })}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-subtle bg-bg-primary p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{t("chat.sceneControlsCreate")}</div>
                <div className="mt-1 text-xs text-text-tertiary">{t("chat.sceneControlsCreateDesc")}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsName")}</label>
                <InputField
                  value={newSlider.label}
                  onChange={(value) => {
                    setNewSlider((prev) => ({ ...prev, label: value }));
                    setLocalError("");
                  }}
                  placeholder={t("chat.sceneControlsNamePlaceholder")}
                />
              </div>
              <div className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{t("chat.sceneControlsKey")}</div>
                <div className="mt-1 text-xs font-medium text-text-secondary">
                  {newSlider.label.trim() ? buildUniqueControlKey(newSlider.label, draftFields) : "scene-slider"}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsMin")}</label>
                <InputField type="number" value={newSlider.min} onChange={(value) => setNewSlider((prev) => ({ ...prev, min: value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsMax")}</label>
                <InputField type="number" value={newSlider.max} onChange={(value) => setNewSlider((prev) => ({ ...prev, max: value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsStep")}</label>
                <InputField type="number" value={newSlider.step} onChange={(value) => setNewSlider((prev) => ({ ...prev, step: value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("chat.sceneControlsDefault")}</label>
                <InputField type="number" value={newSlider.defaultValue} onChange={(value) => setNewSlider((prev) => ({ ...prev, defaultValue: value }))} />
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5">
                <span className="text-sm text-text-primary">{t("chat.sceneControlsEnabled")}</span>
                <ToggleSwitch
                  checked={newSlider.enabled}
                  onChange={(event) => setNewSlider((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5">
                <span className="text-sm text-text-primary">{t("chat.sceneControlsPureChat")}</span>
                <ToggleSwitch
                  checked={newSlider.visibleInPureChat}
                  onChange={(event) => setNewSlider((prev) => ({ ...prev, visibleInPureChat: event.target.checked }))}
                />
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{t("chat.sceneControlsPreview")}</span>
                <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[11px] text-text-secondary">
                  {newSliderPreview.value}
                </span>
              </div>
              <input
                type="range"
                min={newSliderPreview.min}
                max={newSliderPreview.max}
                step={newSliderPreview.step}
                value={newSliderPreview.value}
                readOnly
                className="w-full"
              />
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={addSlider}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
              >
                {t("chat.sceneControlsCreate")}
              </button>
            </div>
          </div>

          {resolvedError && (
            <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger">
              {resolvedError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
          >
            {t("chat.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? t("settings.autosaveSaving") : t("chat.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
