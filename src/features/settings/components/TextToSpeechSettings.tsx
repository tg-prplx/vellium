import { useEffect, useMemo, useRef, useState } from "react";
import { SettingRow, SettingsGroup } from "./SettingRow";
import { LocalModelsSetup } from "../../../components/LocalModelsSetup";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import {
  LOCAL_INFERENCE_SETTINGS_URL,
  LOCAL_TERATTS_MODEL_ID,
  LOCAL_TERATTS_VOICE_PROFILES,
  type LocalTeraTtsVoiceProfile
} from "../../../shared/localModelConfig";
import { RealtimeTtsPlayer } from "../../../shared/realtimeTts";
import type { AppSettings, ProviderModel } from "../../../shared/types/contracts";
import { InputField, SelectField, TextareaField, ToggleSwitch } from "./FormControls";

const STANDARD_OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
const AUTOSAVE_PROPS = { commitMode: "debounced" as const, debounceMs: 420 };

type Status = { tone: "info" | "success" | "error"; text: string } | null;

function uniqueVoiceOptions(current: string, discovered: ProviderModel[]) {
  const options = new Map<string, ProviderModel>();
  for (const id of STANDARD_OPENAI_VOICES) options.set(id, { id, label: id });
  for (const voice of discovered) options.set(voice.id, voice);
  if (current && !options.has(current)) options.set(current, { id: current, label: current });
  return Array.from(options.values());
}

function voiceLabel(
  profile: LocalTeraTtsVoiceProfile,
  t: ReturnType<typeof useI18n>["t"]
) {
  const language = profile.language === "ru" ? t("settings.teraVoiceRussian") : t("settings.teraVoiceEnglish");
  const gender = profile.gender === "female" ? t("settings.teraVoiceFemale") : t("settings.teraVoiceMale");
  return `${language} · ${gender} ${profile.variant}`;
}

function VoiceIcon({ playing = false }: { playing?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" className="h-4 w-4">
      {playing
        ? <path strokeLinecap="round" d="M7 5v14M17 5v14" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M5 9v6h4l5 4V5L9 9H5zm12 1a4 4 0 010 4m2-7a8 8 0 010 10" />}
    </svg>
  );
}

export function TextToSpeechSettings({
  settings,
  onPatch
}: {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [voices, setVoices] = useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [previewText, setPreviewText] = useState(() => t("settings.ttsPreviewSample"));
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "playing">("idle");
  const [status, setStatus] = useState<Status>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const previewAbortRef = useRef<AbortController | null>(null);
  const realtimePreviewRef = useRef<RealtimeTtsPlayer | null>(null);

  const bundledTeraActive = settings.ttsBaseUrl === LOCAL_INFERENCE_SETTINGS_URL
    && settings.ttsModel === LOCAL_TERATTS_MODEL_ID;
  const externalVoiceOptions = useMemo(
    () => uniqueVoiceOptions(settings.ttsVoice || "", voices),
    [settings.ttsVoice, voices]
  );

  useEffect(() => () => {
    realtimePreviewRef.current?.stop();
    previewAbortRef.current?.abort();
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  function stopPreview() {
    realtimePreviewRef.current?.stop();
    realtimePreviewRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setPreviewState("idle");
  }

  useEffect(() => {
    stopPreview();
  }, [settings.ttsBaseUrl, settings.ttsModel, settings.ttsVoice]);

  async function playPreview() {
    if (previewState !== "idle") {
      stopPreview();
      return;
    }
    const input = previewText.trim();
    if (!input) {
      setStatus({ tone: "error", text: t("settings.ttsPreviewTextRequired") });
      return;
    }
    stopPreview();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewState("loading");
    setStatus(null);
    try {
      if (bundledTeraActive) {
        const player = new RealtimeTtsPlayer({
          onPlaybackStart: () => {
            if (realtimePreviewRef.current === player) setPreviewState("playing");
          }
        });
        realtimePreviewRef.current = player;
        await player.play((onEvent, signal) => api.chatTtsTextRealtime(
          input,
          onEvent,
          signal,
          { voice: settings.ttsVoice }
        ));
        if (realtimePreviewRef.current === player) {
          realtimePreviewRef.current = null;
          previewAbortRef.current = null;
          setPreviewState("idle");
        }
        return;
      }
      const blob = await api.chatTtsText(input, { voice: settings.ttsVoice }, controller.signal);
      if (controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      audioUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => stopPreview();
      audio.onerror = () => {
        stopPreview();
        setStatus({ tone: "error", text: t("settings.ttsPreviewPlaybackFailed") });
      };
      setPreviewState("playing");
      await audio.play();
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus({ tone: "error", text: `${t("settings.ttsPreviewFailed")}: ${String(error)}` });
      }
      stopPreview();
    }
  }

  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    setStatus(null);
    try {
      const list = await api.settingsFetchTtsModels(settings.ttsBaseUrl, settings.ttsApiKey, settings.ttsAdapterId);
      setModels(list);
      setStatus({
        tone: list.length ? "success" : "info",
        text: list.length ? `${t("settings.modelsLoaded")}: ${list.length}` : t("settings.noModelsReturned")
      });
    } catch (error) {
      setModels([]);
      setStatus({ tone: "error", text: `${t("settings.loadModelsFailed")}: ${String(error)}` });
    } finally {
      setLoadingModels(false);
    }
  }

  async function loadVoices() {
    if (loadingVoices) return;
    setLoadingVoices(true);
    setStatus(null);
    try {
      const list = await api.settingsFetchTtsVoices(settings.ttsBaseUrl, settings.ttsApiKey, settings.ttsAdapterId);
      setVoices(list);
      setStatus({
        tone: list.length ? "success" : "info",
        text: list.length ? `${t("settings.voicesLoaded")}: ${list.length}` : t("settings.noVoicesReturned")
      });
    } catch (error) {
      setVoices([]);
      setStatus({ tone: "error", text: `${t("settings.loadVoicesFailed")}: ${String(error)}` });
    } finally {
      setLoadingVoices(false);
    }
  }

  const renderTeraVoiceGroup = (language: "ru" | "en") => (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {language === "ru" ? t("settings.teraRussianVoices") : t("settings.teraEnglishVoices")}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {LOCAL_TERATTS_VOICE_PROFILES.filter((profile) => profile.language === language).map((profile) => {
          const selected = settings.ttsVoice === profile.id;
          return (
            <button
              key={profile.id}
              type="button"
              aria-pressed={selected}
              onClick={() => void onPatch({ ttsVoice: profile.id })}
              className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${selected ? "border-accent bg-accent-subtle" : "border-border-subtle bg-bg-primary hover:border-border hover:bg-bg-hover"}`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${selected ? "bg-accent text-text-inverse" : "bg-bg-secondary text-text-secondary"}`}>
                <VoiceIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-text-primary">{voiceLabel(profile, t)}</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-text-tertiary">{profile.id}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {profile.recommended ? <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[9px] font-semibold text-success">{t("settings.teraRecommended")}</span> : null}
                {profile.whisperReference ? <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[9px] text-text-tertiary">{t("settings.teraWhisperReference")}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <SettingsGroup id="settings-tts" title={t("settings.tts")} description={t("settings.ttsDesc")}>
      <SettingRow toggle label={t("settings.ttsRealtime")} description={t("settings.ttsRealtimeHint")}>
        <ToggleSwitch ariaLabel={t("settings.ttsRealtime")} checked={settings.ttsRealtime === true} onChange={(event) => void onPatch({ ttsRealtime: event.target.checked })} />
      </SettingRow>

      <div className="settings-group-block">
        <LocalModelsSetup locale={settings.interfaceLanguage || "en"} componentIds={["tts"]} />
      </div>

      {bundledTeraActive ? (
        <SettingRow wide label={t("settings.teraVoiceLibrary")} description={t("settings.teraVoiceLibraryDesc")}
          aside={<span className="rounded-full border border-success-border bg-success-subtle px-2.5 py-1 text-[10px] font-semibold text-success">TeraTTSv2 · 44.1 kHz</span>}>
          <div className="space-y-4">
            {renderTeraVoiceGroup("ru")}
            {renderTeraVoiceGroup("en")}
          </div>
        </SettingRow>
      ) : (
        <SettingRow label={t("settings.ttsVoice")}
          aside={<button type="button" onClick={() => void loadVoices()} disabled={loadingVoices || !settings.ttsBaseUrl} className="setting-inline-button">{loadingVoices ? t("settings.loadingOptions") : t("settings.loadVoices")}</button>}>
          <SelectField value={settings.ttsVoice || ""} onChange={(voice) => void onPatch({ ttsVoice: voice })}>
            <option value="">{t("settings.selectVoice")}</option>
            {externalVoiceOptions.map((voice) => <option key={voice.id} value={voice.id}>{voice.label || voice.id}</option>)}
          </SelectField>
        </SettingRow>
      )}

      <SettingRow wide label={t("settings.ttsPreview")} description={settings.ttsVoice || t("settings.selectVoice")}
        aside={(
          <button type="button" onClick={() => void playPreview()} disabled={!settings.ttsVoice || !settings.ttsBaseUrl || !settings.ttsModel}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60">
            <VoiceIcon playing={previewState === "playing"} />
            {previewState === "loading" ? t("settings.ttsPreviewGenerating") : previewState === "playing" ? t("settings.ttsPreviewStop") : t("settings.ttsPreviewPlay")}
          </button>
        )}>
        <TextareaField value={previewText} onChange={setPreviewText} rows={2} placeholder={t("settings.ttsPreviewText")} />
      </SettingRow>

      {status ? (
        <p className={`settings-group-note is-${status.tone}`}>{status.text}</p>
      ) : null}

      <h4 className="settings-subheading">{t("settings.externalEndpoint")}</h4>
      <p className="settings-subheading-desc">{t("localModels.externalTtsHint")}</p>
      <SettingRow label={t("settings.ttsEndpoint")}>
        <InputField value={settings.ttsBaseUrl || ""} onChange={(value) => void onPatch({ ttsBaseUrl: value })} placeholder="https://api.openai.com/v1" {...AUTOSAVE_PROPS} />
      </SettingRow>
      <SettingRow label={t("settings.apiKey")}>
        <InputField type="password" value={settings.ttsApiKey || ""} onChange={(value) => void onPatch({ ttsApiKey: value })} placeholder={t("settings.apiKey")} {...AUTOSAVE_PROPS} />
      </SettingRow>
      <SettingRow label={t("settings.ttsAdapterId")}>
        <InputField value={settings.ttsAdapterId || ""} onChange={(value) => void onPatch({ ttsAdapterId: value.trim() || null })} placeholder={t("settings.ttsAdapterIdPlaceholder")} {...AUTOSAVE_PROPS} />
      </SettingRow>
      <SettingRow label={t("settings.ttsModel")}
        aside={<button type="button" onClick={() => void loadModels()} disabled={loadingModels || !settings.ttsBaseUrl} className="setting-inline-button">{loadingModels ? t("settings.loadingOptions") : t("settings.loadModels")}</button>}>
        <SelectField value={settings.ttsModel || ""} onChange={(model) => void onPatch({ ttsModel: model })}>
          <option value="">{t("settings.selectModel")}</option>
          {settings.ttsModel && !models.some((model) => model.id === settings.ttsModel) ? <option value={settings.ttsModel}>{settings.ttsModel}</option> : null}
          {models.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
        </SelectField>
      </SettingRow>
    </SettingsGroup>
  );
}
