export interface WallpaperThemePalette {
  accent: string;
  accentHover: string;
  accentSubtle: string;
  accentBorder: string;
  surfaceDark: string;
  surfaceLight: string;
  tintDark: string;
  tintLight: string;
  swatches: string[];
}

const ENABLED_KEY = "vellium.wallpaperTheme.enabled";
const PALETTE_KEY = "vellium.wallpaperTheme.palette";
const OVERRIDE_KEYS = [
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
  "--color-bg-hover",
  "--color-bg-active",
  "--color-border",
  "--color-border-subtle",
  "--color-border-strong",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-inverse",
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-subtle",
  "--color-accent-border",
  "--color-accent-secondary",
  "--color-accent-tertiary",
  "--color-success",
  "--color-success-subtle",
  "--color-success-border",
  "--color-warning",
  "--color-warning-subtle",
  "--color-warning-border",
  "--color-danger",
  "--color-danger-subtle",
  "--color-danger-border",
  "--scrollbar-thumb",
  "--scrollbar-thumb-hover",
  "--range-track",
  "--checkbox-bg",
  "--checkbox-border",
  "--checkbox-check",
  "--prose-em",
  "--prose-code-bg",
  "--prose-code-border",
  "--prose-pre-bg",
  "--prose-pre-border",
  "--prose-blockquote",
  "--prose-hr",
  "--prose-table-border",
  "--prose-th-bg",
  "--shadow-panel",
  "--shadow-float",
  "--shadow-settings-tab",
  "--simple-wallpaper-tint",
  "--simple-ui-glass",
  "--simple-ui-glass-strong",
  "--simple-ui-glass-row"
] as const;

let previousInlineValues: Map<string, string> | null = null;

interface Rgb { r: number; g: number; b: number }
interface Hsl { h: number; s: number; l: number }

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation, l: lightness };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255)
  };
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function parseColor(value: string | null | undefined): Rgb | null {
  const normalized = String(value || "").trim();
  const hex = normalized.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }
  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return null;
  return {
    r: clamp(Number(rgb[1]) / 255) * 255,
    g: clamp(Number(rgb[2]) / 255) * 255,
    b: clamp(Number(rgb[3]) / 255) * 255
  };
}

function alphaColor(color: Rgb, alpha: number) {
  return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)} / ${alpha})`;
}

function harmonizedStatus(hue: number, accent: Rgb, light: boolean) {
  const semantic = hslToRgb({ h: hue, s: light ? 0.62 : 0.68, l: light ? 0.42 : 0.64 });
  return mixRgb(semantic, accent, 0.12);
}

function normalizedSwatch(value: string | undefined, fallbackHue: number, light: boolean) {
  const parsed = parseColor(value);
  const hsl = parsed ? rgbToHsl(parsed) : { h: fallbackHue, s: 0.62, l: 0.56 };
  return hslToRgb({
    h: hsl.h,
    s: clamp(Math.max(hsl.s, 0.42), 0.42, 0.76),
    l: light ? clamp(hsl.l, 0.38, 0.56) : clamp(hsl.l, 0.54, 0.7)
  });
}

export function deriveWallpaperThemeVariables(palette: WallpaperThemePalette, light: boolean): Record<string, string> {
  const sourceAccent = parseColor(palette.accent) || { r: 168, g: 85, b: 247 };
  const sourceAccentHsl = rgbToHsl(sourceAccent);
  const accentHsl = {
    ...sourceAccentHsl,
    l: light ? clamp(sourceAccentHsl.l, 0.36, 0.52) : clamp(sourceAccentHsl.l, 0.5, 0.7)
  };
  const accent = hslToRgb(accentHsl);
  const accentHover = hslToRgb({ ...accentHsl, l: clamp(accentHsl.l - 0.08, 0.3, 0.62) });
  const surfaceSeed = parseColor(light ? palette.surfaceLight : palette.surfaceDark) || accent;
  const surfaceHsl = rgbToHsl(surfaceSeed);
  const surfaceSaturation = clamp(Math.max(surfaceHsl.s, 0.1), 0.1, light ? 0.24 : 0.3);
  const surface = (level: number, saturation = surfaceSaturation) => hslToRgb({
    h: surfaceHsl.h,
    s: saturation,
    l: level
  });
  const backgroundPrimary = surface(light ? 0.965 : 0.075);
  const backgroundSecondary = surface(light ? 0.925 : 0.105);
  const backgroundTertiary = surface(light ? 0.88 : 0.145);
  const backgroundHover = surface(light ? 0.825 : 0.185);
  const backgroundActive = surface(light ? 0.775 : 0.225);
  const borderSubtle = surface(light ? 0.86 : 0.145, surfaceSaturation * 0.82);
  const border = surface(light ? 0.79 : 0.2, surfaceSaturation * 0.78);
  const borderStrong = surface(light ? 0.7 : 0.285, surfaceSaturation * 0.72);
  const textPrimary = surface(light ? 0.12 : 0.95, Math.min(surfaceSaturation, 0.16));
  const textSecondary = surface(light ? 0.34 : 0.7, Math.min(surfaceSaturation, 0.14));
  const textTertiary = surface(light ? 0.5 : 0.5, Math.min(surfaceSaturation, 0.12));
  const textInverse = backgroundPrimary;
  const secondaryAccent = normalizedSwatch(palette.swatches[1], accentHsl.h + 52, light);
  const tertiaryAccent = normalizedSwatch(palette.swatches[2], accentHsl.h - 52, light);
  const success = harmonizedStatus(142, accent, light);
  const warning = harmonizedStatus(42, accent, light);
  const danger = harmonizedStatus(2, accent, light);
  const whiteOrBlack = light ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const shadow = light ? { r: 35, g: 25, b: 45 } : { r: 0, g: 0, b: 0 };

  return {
    "--color-bg-primary": rgbToHex(backgroundPrimary),
    "--color-bg-secondary": rgbToHex(backgroundSecondary),
    "--color-bg-tertiary": rgbToHex(backgroundTertiary),
    "--color-bg-hover": rgbToHex(backgroundHover),
    "--color-bg-active": rgbToHex(backgroundActive),
    "--color-border": rgbToHex(border),
    "--color-border-subtle": rgbToHex(borderSubtle),
    "--color-border-strong": rgbToHex(borderStrong),
    "--color-text-primary": rgbToHex(textPrimary),
    "--color-text-secondary": rgbToHex(textSecondary),
    "--color-text-tertiary": rgbToHex(textTertiary),
    "--color-text-inverse": rgbToHex(textInverse),
    "--color-accent": rgbToHex(accent),
    "--color-accent-hover": rgbToHex(accentHover),
    "--color-accent-subtle": alphaColor(accent, light ? 0.11 : 0.15),
    "--color-accent-border": alphaColor(accent, light ? 0.28 : 0.38),
    "--color-accent-secondary": rgbToHex(secondaryAccent),
    "--color-accent-tertiary": rgbToHex(tertiaryAccent),
    "--color-success": rgbToHex(success),
    "--color-success-subtle": alphaColor(success, light ? 0.11 : 0.14),
    "--color-success-border": alphaColor(success, light ? 0.28 : 0.34),
    "--color-warning": rgbToHex(warning),
    "--color-warning-subtle": alphaColor(warning, light ? 0.11 : 0.14),
    "--color-warning-border": alphaColor(warning, light ? 0.28 : 0.34),
    "--color-danger": rgbToHex(danger),
    "--color-danger-subtle": alphaColor(danger, light ? 0.11 : 0.14),
    "--color-danger-border": alphaColor(danger, light ? 0.28 : 0.34),
    "--scrollbar-thumb": rgbToHex(backgroundActive),
    "--scrollbar-thumb-hover": rgbToHex(borderStrong),
    "--range-track": rgbToHex(border),
    "--checkbox-bg": rgbToHex(backgroundTertiary),
    "--checkbox-border": rgbToHex(borderStrong),
    "--checkbox-check": rgbToHex(textInverse),
    "--prose-em": rgbToHex(mixRgb(textPrimary, accent, light ? 0.16 : 0.2)),
    "--prose-code-bg": alphaColor(whiteOrBlack, light ? 0.05 : 0.065),
    "--prose-code-border": alphaColor(whiteOrBlack, light ? 0.09 : 0.1),
    "--prose-pre-bg": alphaColor(shadow, light ? 0.045 : 0.26),
    "--prose-pre-border": alphaColor(whiteOrBlack, light ? 0.09 : 0.075),
    "--prose-blockquote": rgbToHex(mixRgb(textSecondary, accent, 0.12)),
    "--prose-hr": alphaColor(whiteOrBlack, light ? 0.13 : 0.12),
    "--prose-table-border": alphaColor(whiteOrBlack, light ? 0.11 : 0.12),
    "--prose-th-bg": alphaColor(whiteOrBlack, light ? 0.035 : 0.05),
    "--shadow-panel": `0 14px 34px ${alphaColor(shadow, light ? 0.1 : 0.3)}`,
    "--shadow-float": `0 10px 22px ${alphaColor(shadow, light ? 0.12 : 0.28)}`,
    "--shadow-settings-tab": `0 8px 20px ${alphaColor(accent, light ? 0.22 : 0.32)}`,
    "--simple-wallpaper-tint": light ? palette.tintLight : palette.tintDark,
    "--simple-ui-glass": `color-mix(in srgb, ${rgbToHex(backgroundSecondary)} 76%, transparent)`,
    "--simple-ui-glass-strong": `color-mix(in srgb, ${rgbToHex(backgroundSecondary)} 88%, transparent)`,
    "--simple-ui-glass-row": `color-mix(in srgb, ${rgbToHex(backgroundPrimary)} 68%, transparent)`
  };
}

function mixRgb(source: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: Math.round(source.r + (target.r - source.r) * amount),
    g: Math.round(source.g + (target.g - source.g) * amount),
    b: Math.round(source.b + (target.b - source.b) * amount)
  };
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Wallpaper palette could not be generated"));
    image.src = source;
  });
}

export function isWallpaperThemeEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setWallpaperThemeEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // Local storage may be unavailable in hardened browser contexts.
  }
}

export function readWallpaperThemePalette(): WallpaperThemePalette | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PALETTE_KEY) || "null") as WallpaperThemePalette | null;
    if (!parsed?.accent || !Array.isArray(parsed.swatches)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeWallpaperThemePalette(palette: WallpaperThemePalette) {
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
  } catch {
    // The palette can still be used for the current session.
  }
}

export async function generateWallpaperThemePalette(source: string): Promise<WallpaperThemePalette> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = 56;
  canvas.height = 56;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Wallpaper palette generation is unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map<number, { score: number; r: number; g: number; b: number; count: number }>();
  let average = { r: 0, g: 0, b: 0 };
  let averageCount = 0;

  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 160) continue;
    const rgb = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    const hsl = rgbToHsl(rgb);
    average.r += rgb.r;
    average.g += rgb.g;
    average.b += rgb.b;
    averageCount += 1;
    if (hsl.l < 0.12 || hsl.l > 0.9) continue;
    const bucketKey = Math.round(hsl.h / 18) % 20;
    const vividness = (0.28 + hsl.s * 1.45) * (1 - Math.abs(hsl.l - 0.55) * 1.15);
    const bucket = buckets.get(bucketKey) || { score: 0, r: 0, g: 0, b: 0, count: 0 };
    bucket.score += vividness;
    bucket.r += rgb.r * vividness;
    bucket.g += rgb.g * vividness;
    bucket.b += rgb.b * vividness;
    bucket.count += vividness;
    buckets.set(bucketKey, bucket);
  }

  const fallbackAverage: Rgb = averageCount > 0
    ? { r: average.r / averageCount, g: average.g / averageCount, b: average.b / averageCount }
    : { r: 160, g: 115, b: 210 };
  const ranked = [...buckets.values()].sort((left, right) => right.score - left.score);
  const selected = ranked.slice(0, 4).map((bucket) => ({
    r: bucket.r / Math.max(bucket.count, 0.001),
    g: bucket.g / Math.max(bucket.count, 0.001),
    b: bucket.b / Math.max(bucket.count, 0.001)
  }));
  const sourceAccent = selected[0] || fallbackAverage;
  const sourceHsl = rgbToHsl(sourceAccent);
  const accentHsl = {
    h: sourceHsl.h,
    s: clamp(Math.max(sourceHsl.s, 0.54), 0.54, 0.82),
    l: clamp(sourceHsl.l, 0.48, 0.66)
  };
  const accent = hslToRgb(accentHsl);
  const accentHover = hslToRgb({ ...accentHsl, l: clamp(accentHsl.l - 0.08, 0.38, 0.58) });
  const surfaceDark = mixRgb(fallbackAverage, { r: 15, g: 14, b: 22 }, 0.78);
  const surfaceLight = mixRgb(fallbackAverage, { r: 245, g: 244, b: 242 }, 0.84);
  const swatches = [accent, ...selected.slice(1, 4)].map(rgbToHex);

  return {
    accent: rgbToHex(accent),
    accentHover: rgbToHex(accentHover),
    accentSubtle: `rgb(${accent.r} ${accent.g} ${accent.b} / 0.14)`,
    accentBorder: `rgb(${accent.r} ${accent.g} ${accent.b} / 0.34)`,
    surfaceDark: rgbToHex(surfaceDark),
    surfaceLight: rgbToHex(surfaceLight),
    tintDark: `${surfaceDark.r} ${surfaceDark.g} ${surfaceDark.b}`,
    tintLight: `${surfaceLight.r} ${surfaceLight.g} ${surfaceLight.b}`,
    swatches
  };
}

export function clearWallpaperTheme(root = document.documentElement) {
  if (previousInlineValues) {
    for (const key of OVERRIDE_KEYS) {
      const previous = previousInlineValues.get(key) || "";
      if (previous) root.style.setProperty(key, previous);
      else root.style.removeProperty(key);
    }
  }
  previousInlineValues = null;
  delete root.dataset.wallpaperTheme;
}

export function applyWallpaperThemePalette(palette: WallpaperThemePalette, root = document.documentElement) {
  if (!previousInlineValues) {
    previousInlineValues = new Map(OVERRIDE_KEYS.map((key) => [key, root.style.getPropertyValue(key)]));
  }
  const variables = deriveWallpaperThemeVariables(palette, root.classList.contains("theme-light"));
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
  root.dataset.wallpaperTheme = "active";
}

export function applyStoredWallpaperTheme(wallpaperPresent: boolean, root = document.documentElement) {
  const palette = readWallpaperThemePalette();
  if (!wallpaperPresent || !isWallpaperThemeEnabled() || !palette) {
    clearWallpaperTheme(root);
    return;
  }
  applyWallpaperThemePalette(palette, root);
}
