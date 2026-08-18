import {
  LOCAL_INFERENCE_SETTINGS_URL,
  LOCAL_TERATTS_DEFAULT_VOICE,
  LOCAL_TERATTS_MODEL_ID,
  LOCAL_TERATTS_VOICES,
  LOCAL_WHISPER_MODEL_ID
} from "../shared/localModelConfig";
import type { AppSettings } from "../shared/types/contracts";

type SpeechComponentId = "stt" | "tts";

export function isBundledSpeechActive(id: SpeechComponentId, settings: AppSettings | null) {
  if (!settings) return false;
  if (id === "stt") {
    return settings.sttSource === "whisper"
      && settings.sttBaseUrl === LOCAL_INFERENCE_SETTINGS_URL
      && settings.sttModel === LOCAL_WHISPER_MODEL_ID;
  }
  return settings.ttsBaseUrl === LOCAL_INFERENCE_SETTINGS_URL
    && settings.ttsModel === LOCAL_TERATTS_MODEL_ID;
}

export function bundledSpeechSettingsPatch(
  id: SpeechComponentId,
  settings: AppSettings | null,
  locale: "en" | "ru" | "zh" | "ja"
): Partial<AppSettings> {
  if (id === "stt") {
    return {
      sttSource: "whisper",
      sttBaseUrl: LOCAL_INFERENCE_SETTINGS_URL,
      sttApiKey: "",
      sttModel: LOCAL_WHISPER_MODEL_ID
    };
  }

  const currentVoice = settings?.ttsVoice;
  const voice = currentVoice && LOCAL_TERATTS_VOICES.includes(currentVoice as (typeof LOCAL_TERATTS_VOICES)[number])
    ? currentVoice
    : locale === "ru" ? LOCAL_TERATTS_DEFAULT_VOICE : "eng_f3";
  return {
    ttsBaseUrl: LOCAL_INFERENCE_SETTINGS_URL,
    ttsApiKey: "",
    ttsAdapterId: null,
    ttsModel: LOCAL_TERATTS_MODEL_ID,
    ttsVoice: voice,
    ttsRealtime: true
  };
}
