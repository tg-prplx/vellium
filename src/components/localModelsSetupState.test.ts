import { describe, expect, it } from "vitest";
import { LOCAL_INFERENCE_SETTINGS_URL, LOCAL_TERATTS_MODEL_ID, LOCAL_WHISPER_MODEL_ID } from "../shared/localModelConfig";
import type { AppSettings } from "../shared/types/contracts";
import { bundledSpeechSettingsPatch, isBundledSpeechActive } from "./localModelsSetupState";

describe("bundled speech settings", () => {
  it("recognizes only the current bundled Whisper model as active", () => {
    const settings = {
      sttSource: "whisper",
      sttBaseUrl: LOCAL_INFERENCE_SETTINGS_URL,
      sttModel: LOCAL_WHISPER_MODEL_ID
    } as AppSettings;
    expect(isBundledSpeechActive("stt", settings)).toBe(true);
    expect(isBundledSpeechActive("stt", { ...settings, sttModel: "whisper-small-q5_1" })).toBe(false);
  });

  it("replaces an incompatible external TTS voice when activating TeraTTS", () => {
    const patch = bundledSpeechSettingsPatch("tts", { ttsVoice: "alloy" } as AppSettings, "ru");
    expect(patch).toMatchObject({
      ttsBaseUrl: LOCAL_INFERENCE_SETTINGS_URL,
      ttsAdapterId: null,
      ttsModel: LOCAL_TERATTS_MODEL_ID,
      ttsVoice: "ru_f1",
      ttsRealtime: true
    });
  });
});
