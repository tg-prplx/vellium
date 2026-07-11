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
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-subtle",
  "--color-accent-border",
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
  const light = root.classList.contains("theme-light");
  const surface = light ? palette.surfaceLight : palette.surfaceDark;
  root.style.setProperty("--color-accent", palette.accent);
  root.style.setProperty("--color-accent-hover", palette.accentHover);
  root.style.setProperty("--color-accent-subtle", palette.accentSubtle);
  root.style.setProperty("--color-accent-border", palette.accentBorder);
  root.style.setProperty("--simple-wallpaper-tint", light ? palette.tintLight : palette.tintDark);
  root.style.setProperty("--simple-ui-glass", `color-mix(in srgb, ${surface} 76%, transparent)`);
  root.style.setProperty("--simple-ui-glass-strong", `color-mix(in srgb, ${surface} 88%, transparent)`);
  root.style.setProperty("--simple-ui-glass-row", `color-mix(in srgb, ${surface} 68%, transparent)`);
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
