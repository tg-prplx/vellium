import { describe, expect, it } from "vitest";
import { buildLocalWhisperArgs } from "./localInference";

describe("local Whisper command", () => {
  it("uses automatic language detection when no language is configured", () => {
    expect(buildLocalWhisperArgs("model.bin", "input.wav", "transcript")).toEqual([
      "--model", "model.bin",
      "--file", "input.wav",
      "--language", "auto",
      "--output-txt",
      "--output-file", "transcript",
      "--no-timestamps"
    ]);
  });

  it("passes a configured recognition language to whisper-cli", () => {
    const args = buildLocalWhisperArgs("model.bin", "input.wav", "transcript", "RU");
    expect(args.slice(args.indexOf("--language"), args.indexOf("--language") + 2))
      .toEqual(["--language", "ru"]);
  });

  it("falls back to automatic detection for invalid language values", () => {
    const args = buildLocalWhisperArgs("model.bin", "input.wav", "transcript", "--translate");
    expect(args.slice(args.indexOf("--language"), args.indexOf("--language") + 2))
      .toEqual(["--language", "auto"]);
  });
});
