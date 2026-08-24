import { describe, expect, it } from "vitest";
import { deriveWallpaperThemeVariables, type WallpaperThemePalette } from "./wallpaperTheme";

const palette: WallpaperThemePalette = {
  accent: "#c06bf2",
  accentHover: "#a84fd8",
  accentSubtle: "rgb(192 107 242 / 0.14)",
  accentBorder: "rgb(192 107 242 / 0.34)",
  surfaceDark: "#282132",
  surfaceLight: "#eee8f2",
  tintDark: "40 33 50",
  tintLight: "238 232 242",
  swatches: ["#c06bf2", "#4fa8c4", "#df9f53"]
};

describe("wallpaper theme variables", () => {
  it("derives a complete dark semantic theme instead of only an accent", () => {
    const variables = deriveWallpaperThemeVariables(palette, false);
    expect(variables).toMatchObject({
      "--color-accent": "#c06bf2",
      "--color-accent-secondary": "#4fa8c4",
      "--color-accent-tertiary": "#df9f53",
      "--simple-wallpaper-tint": "40 33 50"
    });
    for (const key of [
      "--color-bg-primary", "--color-bg-secondary", "--color-bg-active",
      "--color-border", "--color-border-strong", "--color-text-primary",
      "--color-success", "--color-warning", "--color-danger",
      "--scrollbar-thumb", "--checkbox-bg", "--prose-code-bg", "--shadow-panel"
    ]) {
      expect(variables[key], key).toBeTruthy();
    }
    expect(variables["--color-bg-primary"]).not.toBe("#1a1a1a");
  });

  it("keeps the light palette light while using the same wallpaper hues", () => {
    const dark = deriveWallpaperThemeVariables(palette, false);
    const light = deriveWallpaperThemeVariables(palette, true);
    expect(light["--color-bg-primary"]).not.toBe(dark["--color-bg-primary"]);
    expect(light["--color-text-primary"]).not.toBe(dark["--color-text-primary"]);
    expect(light["--color-accent-secondary"]).toBe("#4fa8c4");
    expect(light["--simple-wallpaper-tint"]).toBe("238 232 242");
  });
});
