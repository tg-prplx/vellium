import { describe, expect, it } from "vitest";
import type { TranslationKey } from "../../shared/i18n";
import { en } from "../../shared/locales/en";
import {
  buildSettingsSearchEntries,
  searchSettingsEntries
} from "./settingsSearch";

const entries = buildSettingsSearchEntries((key: TranslationKey) => en[key]);

describe("settings search", () => {
  it("indexes every settings section with unique result ids", () => {
    const ids = entries.map((entry) => entry.id);

    expect(entries.filter((entry) => entry.kind === "section").length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds a specific slider and keeps its navigation target", () => {
    const [result] = searchSettingsEntries(entries, "background blur");

    expect(result).toMatchObject({
      kind: "setting",
      category: "interface",
      sectionId: "settings-wallpaper",
      label: "Background blur",
      targetLabel: "Background blur"
    });
  });

  it("matches localized aliases independently of the active locale", () => {
    const [result] = searchSettingsEntries(entries, "размытие фона");

    expect(result).toMatchObject({
      category: "interface",
      sectionId: "settings-wallpaper",
      targetLabel: "Background blur"
    });
  });

  it("supports multi-word intent searches for reasoning controls", () => {
    const [result] = searchSettingsEntries(entries, "reasoning context");

    expect(result).toMatchObject({
      category: "context",
      sectionId: "settings-chat-behaviour",
      label: "Keep reasoning in context"
    });
  });

  it("routes general interface controls to the section that owns them", () => {
    const [result] = searchSettingsEntries(entries, "text size");

    expect(result).toMatchObject({
      category: "interface",
      sectionId: "settings-general",
      targetLabel: "Text Size"
    });
  });

  it("shows sections as the compact default view", () => {
    expect(searchSettingsEntries(entries, "")).toHaveLength(18);
    expect(searchSettingsEntries(entries, "").every((entry) => entry.kind === "section")).toBe(true);
  });
});
