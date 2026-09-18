import { useState } from "react";
import { useI18n } from "../../../shared/i18n";
import type { AppSettings, SamplerPreset } from "../../../shared/types/contracts";

function newPresetId(): string {
  return globalThis.crypto?.randomUUID?.() || `sampler-preset-${Date.now()}`;
}

export function SamplerPresetSettings({
  settings,
  onPatch
}: {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const presets = settings.samplerPresets || [];
  const activeProviderId = settings.activeProviderId || "";
  const activeModel = settings.activeModel || "";
  const hasActiveModel = Boolean(activeProviderId && activeModel);

  async function run(id: string, patch: Partial<AppSettings>) {
    setBusyId(id);
    try {
      await onPatch(patch);
    } finally {
      setBusyId(null);
    }
  }

  async function createPreset() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const preset: SamplerPreset = {
      id: newPresetId(),
      name: trimmedName,
      samplerConfig: { ...settings.samplerConfig },
      providerId: null,
      modelId: null
    };
    await run(preset.id, { samplerPresets: [...presets, preset] });
    setName("");
  }

  function updatePreset(preset: SamplerPreset) {
    return run(preset.id, {
      samplerPresets: presets.map((item) => item.id === preset.id
        ? { ...item, samplerConfig: { ...settings.samplerConfig } }
        : item)
    });
  }

  function toggleModelBinding(preset: SamplerPreset) {
    if (!hasActiveModel) return Promise.resolve();
    const isBound = preset.providerId === activeProviderId && preset.modelId === activeModel;
    return run(preset.id, {
      samplerPresets: presets.map((item) => {
        if (item.id === preset.id) {
          return { ...item, providerId: isBound ? null : activeProviderId, modelId: isBound ? null : activeModel };
        }
        if (!isBound && item.providerId === activeProviderId && item.modelId === activeModel) {
          return { ...item, providerId: null, modelId: null };
        }
        return item;
      })
    });
  }

  return (
    <div className="settings-field-group space-y-3">
      <div>
        <div className="text-xs font-semibold text-text-secondary">{t("settings.samplerPresets")}</div>
        <p className="mt-1 text-[10px] text-text-tertiary">{t("settings.samplerPresetsDesc")}</p>
      </div>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void createPreset(); }}
          maxLength={80}
          placeholder={t("settings.samplerPresetName")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
        />
        <button
          type="button"
          onClick={() => { void createPreset(); }}
          disabled={!name.trim() || busyId !== null}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
        >
          {t("settings.samplerPresetSave")}
        </button>
      </div>
      {presets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-tertiary">
          {t("settings.samplerPresetEmpty")}
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => {
            const boundToActive = preset.providerId === activeProviderId && preset.modelId === activeModel;
            return (
              <div key={preset.id} className="rounded-lg border border-border-subtle bg-bg-secondary p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-primary">{preset.name}</div>
                    <div className="mt-1 truncate text-[10px] text-text-tertiary">
                      {preset.providerId && preset.modelId
                        ? `${t("settings.samplerPresetForModel")}: ${preset.providerId} / ${preset.modelId}`
                        : t("settings.samplerPresetNoModel")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void run(preset.id, { samplerConfig: { ...preset.samplerConfig } }); }}
                    disabled={busyId !== null}
                    className="rounded-md border border-accent-border bg-accent-subtle px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-40"
                  >
                    {t("settings.samplerPresetApply")}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { void updatePreset(preset); }} disabled={busyId !== null} className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40">
                    {t("settings.samplerPresetUpdate")}
                  </button>
                  <button type="button" onClick={() => { void toggleModelBinding(preset); }} disabled={!hasActiveModel || busyId !== null} className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40">
                    {boundToActive ? t("settings.samplerPresetUnbind") : t("settings.samplerPresetBind")}
                  </button>
                  <button type="button" onClick={() => { void run(preset.id, { samplerPresets: presets.filter((item) => item.id !== preset.id) }); }} disabled={busyId !== null} className="rounded-md border border-danger-border px-2.5 py-1 text-[10px] text-danger hover:bg-danger-subtle disabled:opacity-40">
                    {t("settings.samplerPresetDelete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-text-tertiary">
        {hasActiveModel
          ? `${t("settings.samplerPresetActiveModel")}: ${activeProviderId} / ${activeModel}`
          : t("settings.samplerPresetSelectModel")}
      </p>
    </div>
  );
}
