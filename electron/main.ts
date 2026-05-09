import { app, BrowserWindow, ipcMain, dialog, shell, screen, desktopCapturer, type Rectangle, type WebContents } from "electron";
import path from "path";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { pathToFileURL } from "url";
import { ManagedBackendManager } from "./managedBackends";
import type { ManagedBackendConfig } from "../src/shared/types/contracts";
import { applyServerRuntimeEnv, formatServerUrl, parseServerRuntimeOptions } from "../server/runtimeConfig";

const isDev = !app.isPackaged;
const runtimeOptions = parseServerRuntimeOptions(process.argv.slice(1));
const isHeadless = runtimeOptions.headless;

// Prevent multiple production instances, but allow a local dev build
// to run alongside the packaged app.
const gotTheLock = isDev || isHeadless ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Set data directory — use userData in packaged app, ./data in dev
if (!isDev) {
  process.env.SLV_DATA_DIR = path.join(app.getPath("userData"), "data");
}

let mainWindow: BrowserWindow | null = null;
let desktopPetWindow: BrowserWindow | null = null;
const desktopPetInstances = new Map<string, DesktopPetInstance>();
let desktopPetConfig: DesktopPetConfig = {
  name: "Velli",
  spriteUrl: "",
  spriteSheetUrl: "",
  scale: 1,
  voice: "soft",
  ttsEnabled: false,
  actions: [
    { id: "idle", label: "Idle", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", codexState: "jumping", assetUrl: "", soundUrl: "" },
    { id: "alert", label: "Alert", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
    { id: "spin", label: "Spin", animation: "spin", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "shake", label: "Shake", animation: "shake", codexState: "failed", assetUrl: "", soundUrl: "" }
  ],
  emotions: [
    { id: "calm", label: "Calm", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", codexState: "waving", assetUrl: "", soundUrl: "" },
    { id: "curious", label: "Curious", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
    { id: "excited", label: "Excited", animation: "bounce", codexState: "jumping", assetUrl: "", soundUrl: "" }
  ],
  autonomyEnabled: false,
  assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help.",
  persistentMemory: "",
  chatContextTokenLimit: 2400
};
let desktopPetUiPlacement: DesktopPetUiPlacement = "above";
const desktopPetDragState = new Map<number, {
  startX: number;
  startY: number;
  bounds: Rectangle;
}>();
let desktopPetConversationKey = "";
let desktopPetStoreLoaded = false;
let desktopPetStoreWriteTimer: NodeJS.Timeout | null = null;
let desktopPetStore: DesktopPetStore = { pets: {} };
let creatingWindow = false;
let embeddedServerStart: Promise<void> | null = null;
const desktopPetPeerSeenAt = new Map<string, number>();
const managedBackendManager = new ManagedBackendManager();

const SERVER_PORT = runtimeOptions.port;
const SERVER_HOST = runtimeOptions.host;
const SERVER_START_TIMEOUT_MS = 20000;

type DesktopPetConfig = {
  characterId?: string;
  name: string;
  spriteUrl: string;
  spriteSheetUrl: string;
  scale: number;
  voice: "soft" | "playful" | "quiet";
  ttsEnabled: boolean;
  autonomyEnabled: boolean;
  actions: DesktopPetStatePreset[];
  emotions: DesktopPetStatePreset[];
  assistantInstructions: string;
  persistentMemory: string;
  chatContextTokenLimit: number;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  systemPrompt?: string;
  theme?: DesktopPetTheme;
};

type DesktopPetTheme = {
  mode: "dark" | "light";
  variables: Record<string, string>;
};

type DesktopPetChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: DesktopPetChatAttachment[];
};

type DesktopPetChatAttachment = {
  type: "image";
  dataUrl: string;
  mimeType: string;
  filename: string;
  createdAt: number;
};

type DesktopPetChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: DesktopPetChatMessage[];
};

type DesktopPetRuntimeState = {
  persistentMemory: string;
  profileMemory: string;
  defaultChatId: string;
  chats: DesktopPetChat[];
};

type DesktopPetStore = {
  pets: Record<string, DesktopPetRuntimeState>;
};

type DesktopPetScreenContext = {
  dataUrl: string;
  width: number;
  height: number;
};

type DesktopPetInstance = {
  key: string;
  window: BrowserWindow;
  config: DesktopPetConfig;
  uiPlacement: DesktopPetUiPlacement;
};

type DesktopPetAnimation = "none" | "idle" | "hop" | "pop" | "sway" | "spin" | "shake" | "bounce";
type DesktopPetUiPlacement = "above" | "below";
type DesktopPetCodexState = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

type DesktopPetStatePreset = {
  id: string;
  label: string;
  animation: DesktopPetAnimation;
  codexState: DesktopPetCodexState;
  assetUrl: string;
  soundUrl: string;
};

function sanitizeFilename(name: string, fallback = "export.txt"): string {
  const trimmed = String(name || "").trim();
  const normalized = trimmed.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isAllowedAppNavigation(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) {
      return parsed.origin === "http://localhost:1420";
    }
    return parsed.origin === new URL(formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).origin;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeDesktopPetConfig(raw: unknown): DesktopPetConfig {
  const row = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const name = String(row.name || desktopPetConfig.name || "Velli").trim().slice(0, 32) || "Velli";
  const resolveRuntimeAssetUrl = (value: unknown) => {
    const rawUrl = String(value || "").trim().slice(0, 4000);
    if (!rawUrl) return "";
    if (/^(https?:)/i.test(rawUrl)) {
      try {
        const parsed = new URL(rawUrl);
        const isFrontendDevAsset = (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
          parsed.port === "1420" &&
          /^\/api\/(uploads|avatars)\//.test(parsed.pathname);
        if (isFrontendDevAsset) {
          return new URL(`${parsed.pathname}${parsed.search}`, formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).toString();
        }
      } catch {
        return rawUrl;
      }
      return rawUrl;
    }
    if (/^(data:|file:|blob:)/i.test(rawUrl)) return rawUrl;
    if (rawUrl.startsWith("/")) {
      try {
        return new URL(rawUrl, formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).toString();
      } catch {
        return rawUrl;
      }
    }
    return rawUrl;
  };
  const spriteUrl = resolveRuntimeAssetUrl(row.spriteUrl || desktopPetConfig.spriteUrl || "");
  const hasSpriteSheetUrl = Object.prototype.hasOwnProperty.call(row, "spriteSheetUrl");
  const spriteSheetUrl = resolveRuntimeAssetUrl(
    hasSpriteSheetUrl ? row.spriteSheetUrl : (spriteUrl ? "" : desktopPetConfig.spriteSheetUrl || "")
  );
  const scaleRaw = Number(row.scale ?? desktopPetConfig.scale ?? 1);
  const scale = Number.isFinite(scaleRaw) ? Math.max(0.75, Math.min(1.35, scaleRaw)) : 1;
  const voice = row.voice === "playful" || row.voice === "quiet" ? row.voice : row.voice === "soft" ? "soft" : desktopPetConfig.voice || "soft";
  const ttsEnabled = row.ttsEnabled === true;
  const autonomyEnabled = row.autonomyEnabled === true;
  const normalizeAnimation = (value: unknown): DesktopPetAnimation => (
    value === "none" || value === "hop" || value === "pop" || value === "sway" || value === "spin" || value === "shake" || value === "bounce" || value === "idle"
      ? value
      : "idle"
  );
  const codexStates = new Set<DesktopPetCodexState>(["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]);
  const normalizeCodexState = (value: unknown, fallback: DesktopPetCodexState = "idle"): DesktopPetCodexState => {
    return codexStates.has(value as DesktopPetCodexState) ? value as DesktopPetCodexState : fallback;
  };
  const defaultAnimationForId = (id: string): DesktopPetAnimation => {
    if (/happy|joy|excited|play/.test(id)) return "hop";
    if (/alert|curious|think|focus/.test(id)) return "pop";
    if (/sleep|tired|calm/.test(id)) return "sway";
    if (/spin/.test(id)) return "spin";
    if (/shake|no|angry/.test(id)) return "shake";
    if (/bounce/.test(id)) return "bounce";
    return "idle";
  };
  const defaultCodexStateForId = (id: string, animation?: DesktopPetAnimation): DesktopPetCodexState => {
    if (/running-right|right/.test(id)) return "running-right";
    if (/running-left|left/.test(id)) return "running-left";
    if (/running|working|progress|busy|task/.test(id)) return "running";
    if (/review|alert|curious|think|focus|inspect/.test(id)) return "review";
    if (/wait|waiting|idle2|patient/.test(id)) return "waiting";
    if (/sleep|sad|failed|fail|tired|shake|angry/.test(id)) return "failed";
    if (/jump|excited|bounce/.test(id) || animation === "bounce") return "jumping";
    if (/happy|joy|play|wave|hello|hi/.test(id)) return animation === "hop" ? "jumping" : "waving";
    if (animation === "hop") return "jumping";
    if (animation === "pop") return "review";
    if (animation === "sway") return "waiting";
    return normalizeCodexState(id, "idle");
  };
  const normalizeId = (value: unknown) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  const themeKeys = new Set([
    "--color-bg-primary",
    "--color-bg-secondary",
    "--color-bg-tertiary",
    "--color-bg-hover",
    "--color-border",
    "--color-border-subtle",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-tertiary",
    "--color-text-inverse",
    "--color-accent",
    "--color-accent-hover",
    "--color-accent-subtle",
    "--color-accent-border"
  ]);
  const sanitizeTheme = (value: unknown): DesktopPetTheme | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const themeRow = value as Record<string, unknown>;
    const rawVars = themeRow.variables && typeof themeRow.variables === "object" && !Array.isArray(themeRow.variables)
      ? themeRow.variables as Record<string, unknown>
      : {};
    const variables: Record<string, string> = {};
    for (const key of themeKeys) {
      const next = String(rawVars[key] || "").trim().slice(0, 240);
      if (next) variables[key] = next;
    }
    return Object.keys(variables).length
      ? { mode: themeRow.mode === "light" ? "light" : "dark", variables }
      : undefined;
  };
  const normalizePresets = (value: unknown, fallback: DesktopPetStatePreset[]) => {
    const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [];
    const unique = new Map<string, DesktopPetStatePreset>();
    for (const item of source) {
      if (typeof item === "string") {
        const id = normalizeId(item);
        const animation = defaultAnimationForId(id);
        if (id && !unique.has(id)) unique.set(id, { id, label: id, animation, codexState: defaultCodexStateForId(id, animation), assetUrl: "", soundUrl: "" });
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const id = normalizeId(record.id);
      if (!id || unique.has(id)) continue;
      const animation = normalizeAnimation(record.animation);
      unique.set(id, {
        id,
        label: String(record.label || id).trim().slice(0, 48) || id,
        animation,
        codexState: normalizeCodexState(record.codexState, defaultCodexStateForId(id, animation)),
        assetUrl: resolveRuntimeAssetUrl(record.assetUrl),
        soundUrl: resolveRuntimeAssetUrl(record.soundUrl)
      });
    }
    return unique.size ? [...unique.values()].slice(0, 12) : fallback;
  };
  const characterId = String(row.characterId || "").trim().slice(0, 120) || undefined;
  const description = String(row.description || "").trim().slice(0, 2000);
  const personality = String(row.personality || "").trim().slice(0, 4000);
  const scenario = String(row.scenario || "").trim().slice(0, 4000);
  const greeting = String(row.greeting || "").trim().slice(0, 1000);
  const systemPrompt = String(row.systemPrompt || "").trim().slice(0, 4000);
  const assistantInstructions = String(row.assistantInstructions || desktopPetConfig.assistantInstructions || "").trim().slice(0, 3000);
  const persistentMemory = String(row.persistentMemory ?? desktopPetConfig.persistentMemory ?? "").trim().slice(0, 6000);
  const chatContextTokenLimitRaw = Number(row.chatContextTokenLimit ?? desktopPetConfig.chatContextTokenLimit ?? 2400);
  const chatContextTokenLimit = Number.isFinite(chatContextTokenLimitRaw)
    ? Math.max(800, Math.min(16000, Math.round(chatContextTokenLimitRaw)))
    : 2400;
  const actions = normalizePresets(row.actions, desktopPetConfig.actions);
  const emotions = normalizePresets(row.emotions, desktopPetConfig.emotions);
  const theme = sanitizeTheme(row.theme) || desktopPetConfig.theme;
  return { characterId, name, spriteUrl, spriteSheetUrl, scale, voice, ttsEnabled, autonomyEnabled, actions, emotions, assistantInstructions, persistentMemory, chatContextTokenLimit, description, personality, scenario, greeting, systemPrompt, theme };
}

function desktopPetWindowSize(config: DesktopPetConfig, expanded = false) {
  const scale = config.scale;
  if (expanded) {
    const compactHeight = 190 * scale;
    const uiHeight = 238 * Math.max(1, scale * 0.82);
    return {
      width: Math.round(Math.max(330, 292 * scale)),
      height: Math.round(compactHeight + uiHeight)
    };
  }
  return {
    width: Math.round(190 * scale),
    height: Math.round(190 * scale)
  };
}

function clampDesktopPetWindowSize(size: { width: number; height: number }, area: Rectangle) {
  return {
    width: Math.max(160, Math.min(size.width, area.width - 16)),
    height: Math.max(160, Math.min(size.height, area.height - 16))
  };
}

function placeDesktopPetWindow(window: BrowserWindow, config: DesktopPetConfig, expanded = false) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const { width, height } = clampDesktopPetWindowSize(desktopPetWindowSize(config, expanded), area);
  const current = window.getBounds();
  const hasPosition = current.x !== 0 || current.y !== 0;
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  const x = hasPosition
    ? Math.max(area.x, Math.min(area.x + area.width - width, Math.round(centerX - width / 2)))
    : area.x + area.width - width - 28;
  const y = hasPosition
    ? Math.max(area.y, Math.min(area.y + area.height - height, bottom - height))
    : area.y + area.height - height - 28;
  window.setBounds({ x, y, width, height });
}

function resolveDesktopPetUiPlacement(
  bounds: Rectangle,
  displayArea: Rectangle,
  compactHeight: number,
  currentPlacement: DesktopPetUiPlacement = desktopPetUiPlacement
): DesktopPetUiPlacement {
  const isExpanded = bounds.height > compactHeight + 24;
  const petCenterY = isExpanded
    ? currentPlacement === "below"
      ? bounds.y + compactHeight / 2
      : bounds.y + bounds.height - compactHeight / 2
    : bounds.y + bounds.height / 2;
  return petCenterY < displayArea.y + displayArea.height / 2 ? "below" : "above";
}

function resizeDesktopPetInstanceWindowForUi(instance: DesktopPetInstance, expanded: boolean): DesktopPetUiPlacement {
  if (!instance.window || instance.window.isDestroyed()) return instance.uiPlacement;
  const current = instance.window.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  const { width, height } = clampDesktopPetWindowSize(desktopPetWindowSize(instance.config, expanded), area);
  const compact = clampDesktopPetWindowSize(desktopPetWindowSize(instance.config, false), area);
  const placement = expanded ? resolveDesktopPetUiPlacement(current, area, compact.height, instance.uiPlacement) : instance.uiPlacement;
  if (expanded) instance.uiPlacement = placement;
  const centerX = current.x + current.width / 2;
  const nextX = Math.max(area.x, Math.min(area.x + area.width - width, Math.round(centerX - width / 2)));
  const preferredY = placement === "below" ? current.y : current.y + current.height - height;
  const nextY = Math.max(area.y, Math.min(area.y + area.height - height, preferredY));
  instance.window.setBounds({ x: nextX, y: nextY, width, height }, false);
  return placement;
}

function resizeDesktopPetWindowForUi(expanded: boolean): DesktopPetUiPlacement {
  const instance = desktopPetWindow ? getDesktopPetInstanceForWindow(desktopPetWindow) : null;
  if (!instance) return desktopPetUiPlacement;
  return resizeDesktopPetInstanceWindowForUi(instance, expanded);
}

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function readPetApiJson<T>(pathName: string, init?: RequestInit): Promise<T> {
  const baseUrl = formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT }).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.trim() || `HTTP ${response.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function readPetApiAudio(pathName: string, init?: RequestInit): Promise<{ contentType: string; base64: string }> {
  const baseUrl = formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT }).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trim() || `HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "audio/mpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { contentType, base64: buffer.toString("base64") };
}

function desktopPetStoragePath(): string {
  return path.join(app.getPath("userData"), "desktop-pets.json");
}

function desktopPetKey(config = desktopPetConfig): string {
  const key = config.characterId || `pet:${config.name || "Velli"}`;
  return String(key).trim().slice(0, 160) || "pet:Velli";
}

function getDesktopPetInstanceForWindow(window: BrowserWindow | null): DesktopPetInstance | null {
  if (!window || window.isDestroyed()) return null;
  for (const instance of desktopPetInstances.values()) {
    if (instance.window === window && !instance.window.isDestroyed()) return instance;
  }
  return null;
}

function getDesktopPetInstanceForSender(sender: WebContents): DesktopPetInstance | null {
  return getDesktopPetInstanceForWindow(BrowserWindow.fromWebContents(sender));
}

function setActiveDesktopPetInstance(instance: DesktopPetInstance) {
  desktopPetWindow = instance.window;
  desktopPetConfig = instance.config;
  desktopPetUiPlacement = instance.uiPlacement;
}

function resolveDesktopPetConfigForRequest(sender: WebContents, rawConfig?: unknown): DesktopPetConfig {
  if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
    return sanitizeDesktopPetConfig(rawConfig);
  }
  const instance = getDesktopPetInstanceForSender(sender);
  return instance?.config || desktopPetConfig;
}

function maybeNotifyNearbyDesktopPets(instance: DesktopPetInstance) {
  const bounds = instance.window.getBounds();
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  for (const other of desktopPetInstances.values()) {
    if (other.key === instance.key || other.window.isDestroyed() || !other.window.isVisible()) continue;
    const otherBounds = other.window.getBounds();
    const otherCenter = { x: otherBounds.x + otherBounds.width / 2, y: otherBounds.y + otherBounds.height / 2 };
    const distance = Math.hypot(center.x - otherCenter.x, center.y - otherCenter.y);
    if (distance > 180) continue;
    const pairKey = [instance.key, other.key].sort().join("::");
    const now = Date.now();
    if (now - (desktopPetPeerSeenAt.get(pairKey) || 0) < 30000) continue;
    desktopPetPeerSeenAt.set(pairKey, now);
    instance.window.webContents.send("desktop-pet:peer-near", { name: other.config.name });
    other.window.webContents.send("desktop-pet:peer-near", { name: instance.config.name });
  }
}

async function captureDesktopPetScreenContext(instance: DesktopPetInstance): Promise<DesktopPetScreenContext> {
  const visiblePets = [...desktopPetInstances.values()]
    .filter((item) => !item.window.isDestroyed() && item.window.isVisible());
  for (const item of visiblePets) item.window.hide();
  await sleep(120);
  try {
    const display = screen.getDisplayMatching(instance.window.getBounds());
    const scaleFactor = display.scaleFactor || 1;
    const captureWidth = Math.min(2560, Math.round(display.size.width * scaleFactor));
    const captureHeight = Math.min(1600, Math.round(display.size.height * scaleFactor));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: captureWidth, height: captureHeight },
      fetchWindowIcons: false
    });
    const source = sources.find((item) => String(item.display_id || "") === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Screen capture is unavailable");
    }
    const sourceSize = source.thumbnail.getSize();
    const maxWidth = 1400;
    const image = sourceSize.width > maxWidth
      ? source.thumbnail.resize({ width: maxWidth, quality: "best" })
      : source.thumbnail;
    const size = image.getSize();
    return {
      dataUrl: image.toDataURL(),
      width: size.width,
      height: size.height
    };
  } finally {
    for (const item of visiblePets) {
      if (!item.window.isDestroyed()) item.window.showInactive();
    }
  }
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function roughPetTokenCount(text: string): number {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function sanitizePetAttachments(value: unknown): DesktopPetChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: DesktopPetChatAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "image") continue;
    const dataUrl = String(row.dataUrl || "").slice(0, 8 * 1024 * 1024);
    if (!dataUrl.startsWith("data:image/")) continue;
    out.push({
      type: "image",
      dataUrl,
      mimeType: String(row.mimeType || "image/png").slice(0, 80),
      filename: String(row.filename || "screen-context.png").slice(0, 160),
      createdAt: Number(row.createdAt) || Date.now()
    });
  }
  return out.slice(0, 2);
}

function sanitizePetMessage(value: unknown): DesktopPetChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
  const content = String(row.content || "").trim().slice(0, 1600);
  if (!role || !content) return null;
  const createdAt = Number(row.createdAt);
  return {
    role,
    content,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    attachments: sanitizePetAttachments(row.attachments)
  };
}

function sanitizePetChat(value: unknown): DesktopPetChat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || nowId("chat");
  const title = String(row.title || "New chat").trim().slice(0, 64) || "New chat";
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  const messages = Array.isArray(row.messages)
    ? row.messages.flatMap((message) => {
      const normalized = sanitizePetMessage(message);
      return normalized ? [normalized] : [];
    }).slice(-80)
    : [];
  return {
    id,
    title,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    messages
  };
}

async function loadDesktopPetStore(): Promise<DesktopPetStore> {
  if (desktopPetStoreLoaded) return desktopPetStore;
  desktopPetStoreLoaded = true;
  try {
    const raw = JSON.parse(await readFile(desktopPetStoragePath(), "utf8")) as DesktopPetStore;
    const pets: Record<string, DesktopPetRuntimeState> = {};
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.pets : {};
    for (const [key, value] of Object.entries(source || {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const chats = Array.isArray(row.chats)
        ? row.chats.flatMap((chat) => {
          const normalized = sanitizePetChat(chat);
          return normalized ? [normalized] : [];
        }).slice(-20)
        : [];
      const defaultChatId = String(row.defaultChatId || "").trim();
      pets[key] = {
        persistentMemory: String(row.persistentMemory || "").trim().slice(0, 6000),
        profileMemory: String(row.profileMemory || "").trim().slice(0, 6000),
        defaultChatId,
        chats
      };
    }
    desktopPetStore = { pets };
  } catch {
    desktopPetStore = { pets: {} };
  }
  return desktopPetStore;
}

function scheduleDesktopPetStoreWrite() {
  if (desktopPetStoreWriteTimer) clearTimeout(desktopPetStoreWriteTimer);
  desktopPetStoreWriteTimer = setTimeout(() => {
    desktopPetStoreWriteTimer = null;
    void (async () => {
      const filePath = desktopPetStoragePath();
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(desktopPetStore, null, 2), "utf8");
    })().catch((error) => {
      console.warn("Failed to write desktop pet store", error);
    });
  }, 120);
}

function createDesktopPetChat(title = "New chat"): DesktopPetChat {
  const now = Date.now();
  return { id: nowId("chat"), title, createdAt: now, updatedAt: now, messages: [] };
}

async function getDesktopPetRuntimeState(config = desktopPetConfig): Promise<DesktopPetRuntimeState> {
  const store = await loadDesktopPetStore();
  const key = desktopPetKey(config);
  let state = store.pets[key];
  if (!state) {
    const chat = createDesktopPetChat("Default");
    const profileMemory = String(config.persistentMemory || "").trim().slice(0, 6000);
    state = { persistentMemory: profileMemory, profileMemory, defaultChatId: chat.id, chats: [chat] };
    store.pets[key] = state;
    scheduleDesktopPetStoreWrite();
  }
  if (!state.chats.some((chat) => chat.id === state.defaultChatId)) {
    const chat = state.chats[0] || createDesktopPetChat("Default");
    if (!state.chats.length) state.chats.push(chat);
    state.defaultChatId = chat.id;
    scheduleDesktopPetStoreWrite();
  }
  return state;
}

async function syncDesktopPetRuntimeState(config: DesktopPetConfig) {
  const state = await getDesktopPetRuntimeState(config);
  const configMemory = String(config.persistentMemory || "").trim().slice(0, 6000);
  if (configMemory && configMemory !== state.profileMemory) {
    state.persistentMemory = configMemory;
    state.profileMemory = configMemory;
    scheduleDesktopPetStoreWrite();
  }
  desktopPetConversationKey = desktopPetKey(config);
}

async function getDesktopPetActiveChat(config = desktopPetConfig): Promise<DesktopPetChat> {
  const state = await getDesktopPetRuntimeState(config);
  let chat = state.chats.find((item) => item.id === state.defaultChatId);
  if (!chat) {
    chat = createDesktopPetChat("Default");
    state.chats.unshift(chat);
    state.defaultChatId = chat.id;
    scheduleDesktopPetStoreWrite();
  }
  return chat;
}

function summarizeDesktopPetChats(state: DesktopPetRuntimeState) {
  return state.chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((chat) => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, count: chat.messages.length }));
}

function summarizeDesktopPetChatHistory(state: DesktopPetRuntimeState) {
  return state.chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      count: chat.messages.length,
      messages: chat.messages
    }));
}

function selectDesktopPetHistoryForContext(chat: DesktopPetChat, tokenLimit: number) {
  const limit = Math.max(800, Math.min(16000, Math.round(tokenLimit || 2400)));
  const selected: DesktopPetChatMessage[] = [];
  let used = 0;
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    const cost = roughPetTokenCount(message.content) + 8;
    if (selected.length > 0 && used + cost > limit) break;
    selected.unshift(message);
    used += cost;
  }
  return selected.map(({ role, content }) => ({ role, content }));
}

function selectDesktopPetImagesForContext(chat: DesktopPetChat, current?: DesktopPetScreenContext | null) {
  const images: DesktopPetScreenContext[] = [];
  if (current?.dataUrl?.startsWith("data:image/")) images.push(current);
  for (let messageIndex = chat.messages.length - 1; messageIndex >= 0 && images.length < 2; messageIndex -= 1) {
    const message = chat.messages[messageIndex];
    for (let attachmentIndex = (message.attachments || []).length - 1; attachmentIndex >= 0 && images.length < 2; attachmentIndex -= 1) {
      const attachment = message.attachments?.[attachmentIndex];
      if (attachment?.type === "image" && attachment.dataUrl.startsWith("data:image/")) {
        images.push({ dataUrl: attachment.dataUrl, width: 0, height: 0 });
      }
    }
  }
  return images.slice(0, 2);
}

function stripDesktopPetToolLine(text: string): string {
  return String(text || "").replace(/<PET_TOOL>[\s\S]*?<\/PET_TOOL>/gi, "").trim();
}

function mergeDesktopPetToolValue(previous: unknown, next: unknown): unknown {
  if (previous === undefined || previous === null || previous === "") return next;
  if (next === undefined || next === null || next === "") return previous;
  if (Array.isArray(previous) || Array.isArray(next)) {
    return [
      ...(Array.isArray(previous) ? previous : [previous]),
      ...(Array.isArray(next) ? next : [next])
    ];
  }
  return next;
}

function parseDesktopPetTool(text: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const matches = String(text || "").matchAll(/<PET_TOOL>([\s\S]*?)<\/PET_TOOL>/gi);
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        merged[key] = mergeDesktopPetToolValue(merged[key], value);
      }
    } catch {
      // Ignore malformed tool blocks, but still strip them from the visible reply.
    }
  }
  return merged;
}

function updatePersistentMemory(current: string, tool: Record<string, unknown>): string {
  let lines = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const removeRaw = tool.memory_remove ?? tool.forget;
  const addRaw = tool.memory_add ?? tool.remember;
  const removeItems = Array.isArray(removeRaw) ? removeRaw : removeRaw ? [removeRaw] : [];
  const addItems = Array.isArray(addRaw) ? addRaw : addRaw ? [addRaw] : [];
  for (const item of removeItems) {
    const needle = String(item || "").trim().toLowerCase();
    if (!needle) continue;
    lines = lines.filter((line) => !line.toLowerCase().includes(needle));
  }
  for (const item of addItems) {
    const line = String(item || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (line && !lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) lines.push(line);
  }
  return lines.slice(-40).join("\n").slice(0, 6000);
}

function inferDesktopPetMemoryToolFromUserMessage(message: string): Record<string, unknown> {
  const text = String(message || "").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!text) return {};
  const forgetMatch = text.match(/(?:забудь|удали(?: это)? из памяти|убери(?: это)? из памяти|forget|remove (?:this )?from memory)\s*[:,-]?\s*(.+)?/i);
  if (forgetMatch) {
    const target = String(forgetMatch[1] || "").trim();
    return target ? { memory_remove: target } : {};
  }
  const rememberMatch = text.match(/(?:запомни|запиши(?: себе)?|помни|не забудь|remember|remember that|note that|keep in mind)\s*[:,-]?\s*(.+)/i);
  if (!rememberMatch) return {};
  const fact = String(rememberMatch[1] || "")
    .replace(/^(что|that)\s+/i, "")
    .replace(/[.!?…]+$/g, "")
    .trim()
    .slice(0, 240);
  return fact ? { memory_add: fact } : {};
}

function buildDesktopPetRuntimePrompt(config: DesktopPetConfig, persistentMemory: string): string {
  const describe = (preset: DesktopPetStatePreset) => `${preset.id}${preset.label && preset.label !== preset.id ? ` (${preset.label})` : ""}: animation=${preset.animation}, codex_row=${preset.codexState || "idle"}${preset.assetUrl ? ", custom_asset=true" : ""}${preset.soundUrl ? ", sound=true" : ""}`;
  const statesById = new Map<string, DesktopPetStatePreset>();
  for (const preset of [...(config.actions || []), ...(config.emotions || [])]) {
    const existing = statesById.get(preset.id);
    if (!existing || (!existing.assetUrl && preset.assetUrl)) statesById.set(preset.id, preset);
  }
  const states = [...statesById.values()].map(describe).join("; ") || "idle: animation=idle; happy: animation=hop; alert: animation=pop";
  return [
    "[Desktop Pet Runtime]",
    "You are speaking through a Vellium desktop pet UI.",
    config.assistantInstructions ? `Assistant instructions: ${config.assistantInstructions}` : "",
    persistentMemory ? `Persistent memory:\n${persistentMemory}` : "",
    "Reply naturally and briefly as the selected character. You are a persistent screen-dwelling companion, not a toy mascot or game UI.",
    "Behave like a small living presence on the desktop: notice attention, keep continuity, and be useful like a personal assistant when the user asks for help.",
    "Treat persistent memory as stable identity and relationship memory. Remember durable facts about the user, the user's preferences, devices, projects, routines, and important plans.",
    "Also remember durable facts about yourself as this pet: your chosen preferences, likes, dislikes, self-descriptions, habits, and long-term opinions. If you once established that you like a programming language, food, activity, or style, keep that preference consistent instead of changing it just because the user asks again.",
    "Do not store throwaway small talk, temporary moods, one-off jokes, or facts that are likely to expire soon unless the user explicitly asks you to remember them.",
    "Choose one pet state after your text to change the visible pet asset and animation. You may update persistent memory when a stable fact about you or the user should persist across future pet chats.",
    "If you tell the user that you remembered or forgot something, you MUST include memory_add or memory_remove in the PET_TOOL line. Never merely claim that memory changed.",
    `Available states: ${states}.`,
    "Append exactly one final machine-readable line in this format. Put state/action/emotion and memory_add/memory_remove in the same JSON object, not in separate PET_TOOL blocks:",
    '<PET_TOOL>{"state":"happy"}</PET_TOOL>',
    'To remember or forget stable facts, use: <PET_TOOL>{"state":"happy","memory_add":"User prefers concise replies"}</PET_TOOL>, <PET_TOOL>{"state":"happy","memory_add":"Pet likes Rust and keeps this preference consistent"}</PET_TOOL>, or <PET_TOOL>{"state":"alert","memory_remove":"old fact"}</PET_TOOL>.',
    "Use only a state id from the available list. Do not explain the tool line."
  ].filter(Boolean).join("\n");
}

async function sendDesktopPetMessageToLlm(
  message: string,
  config = desktopPetConfig,
  screenContext?: DesktopPetScreenContext | null
): Promise<{ ok: boolean; reply: string; chatId?: string }> {
  const text = String(message || "").trim().slice(0, 4000);
  if (!text) return { ok: false, reply: "" };
  await syncDesktopPetRuntimeState(config);
  const runtime = await getDesktopPetRuntimeState(config);
  const chat = await getDesktopPetActiveChat(config);
  const response = await readPetApiJson<{ reply?: string }>("/api/chats/desktop-pet/reply", {
    method: "POST",
    body: JSON.stringify({
      content: text,
      history: selectDesktopPetHistoryForContext(chat, config.chatContextTokenLimit),
      pet: {
        name: config.name,
        description: config.description || "",
        personality: config.personality || "",
        scenario: config.scenario || "",
        systemPrompt: config.systemPrompt || ""
      },
      screenContexts: selectDesktopPetImagesForContext(chat, screenContext),
      runtimeSystemPrompt: buildDesktopPetRuntimePrompt(config, runtime.persistentMemory)
    })
  });
  const reply = String(response.reply || "").trim() || "...";
  const tool = parseDesktopPetTool(reply);
  const inferredMemoryTool = inferDesktopPetMemoryToolFromUserMessage(text);
  const nextMemory = updatePersistentMemory(updatePersistentMemory(runtime.persistentMemory, inferredMemoryTool), tool);
  if (nextMemory !== runtime.persistentMemory) runtime.persistentMemory = nextMemory;
  const now = Date.now();
  if (chat.messages.length === 0) chat.title = text.slice(0, 42) || "New chat";
  const userAttachments = screenContext?.dataUrl?.startsWith("data:image/")
    ? [{
      type: "image" as const,
      dataUrl: screenContext.dataUrl.slice(0, 8 * 1024 * 1024),
      mimeType: "image/png",
      filename: `screen-context-${now}.png`,
      createdAt: now
    }]
    : [];
  chat.messages = [
    ...chat.messages,
    { role: "user", content: text, createdAt: now, attachments: userAttachments },
    { role: "assistant", content: stripDesktopPetToolLine(reply).slice(0, 1200) || "...", createdAt: now }
  ].slice(-80);
  chat.updatedAt = now;
  runtime.defaultChatId = chat.id;
  scheduleDesktopPetStoreWrite();
  return { ok: true, reply, chatId: chat.id };
}

async function synthesizeDesktopPetSpeech(text: string, config = desktopPetConfig): Promise<{ ok: boolean; contentType: string; base64: string }> {
  const input = stripDesktopPetToolLine(text).trim().slice(0, 1200);
  if (!config.ttsEnabled || !input) {
    return { ok: false, contentType: "", base64: "" };
  }
  const audio = await readPetApiAudio("/api/chats/tts", {
    method: "POST",
    body: JSON.stringify({ input })
  });
  return { ok: true, ...audio };
}

function buildDesktopPetHtml(config: DesktopPetConfig) {
  const cfg = safeScriptJson(config);
  const themeVars = config.theme?.variables || {};
  const cssValue = (value: string, fallback: string) => {
    const next = String(value || "").replace(/[;{}<>]/g, "").trim().slice(0, 220);
    return next || fallback;
  };
  const theme = {
    accent: cssValue(themeVars["--color-accent"], "#d97757"),
    accentHover: cssValue(themeVars["--color-accent-hover"] || themeVars["--color-accent"], "#c4664a"),
    accentSubtle: cssValue(themeVars["--color-accent-subtle"], "rgba(217, 119, 87, 0.12)"),
    accentBorder: cssValue(themeVars["--color-accent-border"], "rgba(217, 119, 87, 0.3)"),
    ink: cssValue(themeVars["--color-text-primary"], "#f7efe9"),
    muted: cssValue(themeVars["--color-text-secondary"], "rgba(247, 239, 233, 0.68)"),
    panel: cssValue(themeVars["--color-bg-secondary"], "#171419"),
    field: cssValue(themeVars["--color-bg-tertiary"], "#231f26"),
    hover: cssValue(themeVars["--color-bg-hover"], "#302a33"),
    line: cssValue(themeVars["--color-border"], "#343039"),
    subtleLine: cssValue(themeVars["--color-border-subtle"] || themeVars["--color-border"], "#2a2730")
  };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: file:; media-src data: http: https: file: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root {
      color-scheme: ${config.theme?.mode === "light" ? "light" : "dark"};
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --accent: ${theme.accent};
      --accent-hover: ${theme.accentHover};
      --accent-subtle: ${theme.accentSubtle};
      --accent-border: ${theme.accentBorder};
      --ink: ${theme.ink};
      --muted: ${theme.muted};
      --panel: ${theme.panel};
      --field: ${theme.field};
      --hover: ${theme.hover};
      --line: ${theme.line};
      --line-subtle: ${theme.subtleLine};
      --pet-scale: ${config.scale};
      --root-pad: calc(6px * var(--pet-scale));
      --ui-side: calc(10px * var(--pet-scale));
      --stage-size: calc(178px * var(--pet-scale));
      --sprite-size: calc(164px * var(--pet-scale));
      --ui-offset: calc(var(--stage-size) + (16px * var(--pet-scale)));
      --ui-space: calc(100vh - var(--ui-offset) - (18px * var(--pet-scale)));
      --bubble-max: clamp(52px, calc(var(--ui-space) - 62px), calc(150px * var(--pet-scale)));
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      user-select: none;
    }
    body {
      display: grid;
      place-items: end center;
    }
    .pet-root {
      position: relative;
      width: 100%;
      height: 100%;
      display: grid;
      place-items: end center;
      padding: var(--root-pad);
      box-sizing: border-box;
    }
    .pet-root.ui-open.ui-below {
      place-items: start center;
    }
    .pet-ui {
      position: absolute;
      left: var(--ui-side);
      right: var(--ui-side);
      bottom: var(--ui-offset);
      z-index: 3;
      display: grid;
      gap: 7px;
      max-height: var(--ui-space);
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px) scale(0.98);
      transform-origin: 50% 100%;
      transition: opacity 160ms ease, transform 180ms ease, visibility 0s linear 180ms;
    }
    .pet-root.ui-below .pet-ui {
      top: var(--ui-offset);
      bottom: auto;
      transform: translateY(-8px) scale(0.98);
      transform-origin: 50% 0;
    }
    .pet-root.ui-open .pet-ui,
    .pet-ui:focus-within {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition-delay: 0s;
    }
    .bubble {
      min-height: 28px;
      max-height: var(--bubble-max);
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 8px 11px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      color: var(--ink);
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
      transform-origin: 50% 100%;
      animation: bubbleIn 180ms ease-out both;
      user-select: text;
      scrollbar-width: thin;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .chatbar {
      display: none;
      grid-template-columns: 1fr auto;
      gap: 6px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
    }
    .stage {
      position: relative;
      width: var(--stage-size);
      height: var(--stage-size);
      display: grid;
      place-items: center;
      cursor: grab;
      z-index: 2;
    }
    .stage:active {
      cursor: grabbing;
    }
    .sprite {
      max-width: var(--sprite-size);
      max-height: var(--sprite-size);
      object-fit: contain;
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
      border-radius: 18px;
    }
    .sheet-sprite {
      width: calc(var(--sprite-size) * 0.923);
      height: var(--sprite-size);
      background-repeat: no-repeat;
      background-size: 800% 900%;
      background-position: 0 0;
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
    }
    .css-pet {
      position: relative;
      width: 132px;
      height: 132px;
      zoom: var(--pet-scale);
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
    }
    .ear {
      position: absolute;
      top: 12px;
      width: 44px;
      height: 52px;
      border-radius: 12px 28px 10px 28px;
      background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 38%, var(--field)), var(--accent) 72%);
      border: 2px solid var(--accent-border);
    }
    .ear.left { left: 18px; transform: rotate(-28deg); }
    .ear.right { right: 18px; transform: rotate(28deg) scaleX(-1); }
    .head {
      position: absolute;
      inset: 26px 8px 6px;
      border-radius: 44% 44% 38% 38%;
      background: radial-gradient(circle at 36% 28%, color-mix(in srgb, var(--ink) 72%, transparent) 0 18%, transparent 19%),
        linear-gradient(145deg, color-mix(in srgb, var(--accent) 36%, var(--panel)), var(--accent) 58%, color-mix(in srgb, var(--field) 72%, var(--accent)));
      border: 2px solid var(--accent-border);
      box-shadow: inset -14px -16px 24px rgba(0, 0, 0, 0.18);
    }
    .eye {
      position: absolute;
      top: 72px;
      width: 12px;
      height: 18px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ink) 82%, #000);
      animation: blink 5.4s infinite;
    }
    .eye.left { left: 46px; }
    .eye.right { right: 46px; }
    .mouth {
      position: absolute;
      left: 60px;
      top: 94px;
      width: 12px;
      height: 7px;
      border-bottom: 2px solid color-mix(in srgb, var(--ink) 72%, #000);
      border-radius: 0 0 999px 999px;
    }
    .paw {
      position: absolute;
      bottom: 0;
      width: 34px;
      height: 22px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 72%, var(--field));
      border: 2px solid var(--accent-border);
    }
    .paw.left { left: 28px; }
    .paw.right { right: 28px; }
    .stage.is-happy .css-pet,
    .stage.is-happy .sprite,
    .stage.is-happy .sheet-sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.is-sleepy .css-pet,
    .stage.is-sleepy .sprite,
    .stage.is-sleepy .sheet-sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.is-alert .css-pet,
    .stage.is-alert .sprite,
    .stage.is-alert .sheet-sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-hop .css-pet,
    .stage.anim-hop .sprite,
    .stage.anim-hop .sheet-sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.anim-sway .css-pet,
    .stage.anim-sway .sprite,
    .stage.anim-sway .sheet-sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.anim-pop .css-pet,
    .stage.anim-pop .sprite,
    .stage.anim-pop .sheet-sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-spin .css-pet,
    .stage.anim-spin .sprite,
    .stage.anim-spin .sheet-sprite { animation: petSpin 720ms ease-in-out 1; }
    .stage.anim-shake .css-pet,
    .stage.anim-shake .sprite,
    .stage.anim-shake .sheet-sprite { animation: petShake 480ms ease-in-out 1; }
    .stage.anim-bounce .css-pet,
    .stage.anim-bounce .sprite,
    .stage.anim-bounce .sheet-sprite { animation: petBounce 900ms ease-in-out 1; }
    .stage.is-present .css-pet,
    .stage.is-present .sprite,
    .stage.is-present .sheet-sprite { animation: attentiveShift 1.3s ease-in-out 1; }
    .stage.is-listening .css-pet,
    .stage.is-listening .sprite,
    .stage.is-listening .sheet-sprite { animation: listeningTilt 1.15s ease-in-out 1; }
    .stage.is-resting .css-pet,
    .stage.is-resting .sprite,
    .stage.is-resting .sheet-sprite { animation: quietRest 3.6s ease-in-out infinite; filter: saturate(0.9) brightness(0.96); }
    .pet-root.emotion-happy .bubble { border-color: #6ee7b7; }
    .pet-root.emotion-excited .bubble { border-color: #fbbf24; }
    .pet-root.emotion-sleepy .bubble { border-color: #93c5fd; }
    .pet-root.emotion-curious .bubble { border-color: #c4b5fd; }
    .controls {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 6px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    }
    input,
    select {
      min-width: 0;
      border: 0;
      outline: 0;
      border-radius: 9px;
      background: var(--field);
      color: var(--ink);
      padding: 8px 9px;
      font-size: 12px;
    }
    button {
      border: 1px solid var(--line-subtle);
      border-radius: 9px;
      background: var(--field);
      color: var(--ink);
      height: 32px;
      padding: 0 9px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover {
      background: var(--accent-subtle);
      border-color: var(--accent-border);
    }
    .close {
      position: absolute;
      top: 8px;
      right: 9px;
      width: 28px;
      padding: 0;
      opacity: 0.62;
      display: none;
    }
    @keyframes idleFloat {
      0%, 100% { transform: translateY(0) rotate(-1deg); }
      50% { transform: translateY(-7px) rotate(1deg); }
    }
    @keyframes blink {
      0%, 93%, 100% { transform: scaleY(1); }
      95%, 97% { transform: scaleY(0.1); }
    }
    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(8px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes happyHop {
      0%, 100% { transform: translateY(0) scale(1); }
      35% { transform: translateY(-20px) scale(1.04, 0.96); }
      70% { transform: translateY(2px) scale(0.97, 1.05); }
    }
    @keyframes sleepySway {
      0%, 100% { transform: translateY(0) rotate(-4deg); }
      50% { transform: translateY(-5px) rotate(4deg); }
    }
    @keyframes alertPop {
      0% { transform: scale(0.94); }
      45% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    @keyframes petSpin {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.08); }
      100% { transform: rotate(360deg) scale(1); }
    }
    @keyframes petShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px) rotate(-4deg); }
      40% { transform: translateX(7px) rotate(4deg); }
      60% { transform: translateX(-5px) rotate(-3deg); }
      80% { transform: translateX(4px) rotate(2deg); }
    }
    @keyframes petBounce {
      0%, 100% { transform: translateY(0) scale(1); }
      25% { transform: translateY(-18px) scale(1.03, 0.97); }
      50% { transform: translateY(2px) scale(0.98, 1.04); }
      75% { transform: translateY(-10px) scale(1.02, 0.98); }
    }
    @keyframes attentiveShift {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      35% { transform: translateY(-5px) rotate(-3deg); }
      70% { transform: translateY(-3px) rotate(2deg); }
    }
    @keyframes listeningTilt {
      0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
      45% { transform: translateY(-4px) rotate(4deg) scale(1.02); }
    }
    @keyframes quietRest {
      0%, 100% { transform: translateY(2px) rotate(-2deg) scale(0.99); }
      50% { transform: translateY(-3px) rotate(2deg) scale(1); }
    }
  </style>
</head>
<body>
  <main class="pet-root">
    <div class="stage" id="stage">
      <img class="sprite" id="imageSprite" alt="" hidden />
      <video class="sprite" id="videoSprite" muted loop playsinline autoplay hidden></video>
      <div class="sheet-sprite" id="sheetSprite" aria-hidden="true" hidden></div>
      <audio id="stateSound" preload="auto"></audio>
      <div class="css-pet" id="cssPet" aria-hidden="true">
        <div class="ear left"></div>
        <div class="ear right"></div>
        <div class="head"></div>
        <div class="eye left"></div>
        <div class="eye right"></div>
        <div class="mouth"></div>
        <div class="paw left"></div>
        <div class="paw right"></div>
      </div>
    </div>
    <section class="pet-ui" id="petUi">
      <button class="close" title="Hide">&times;</button>
      <div class="chatbar">
        <select id="chatSelect" title="Pet chat"></select>
        <button type="button" id="newChat" title="New chat">+</button>
      </div>
      <div class="bubble" id="bubble"></div>
      <form class="controls" id="form">
        <input id="input" placeholder="Say something..." autocomplete="off" />
        <button type="button" id="play">Pet</button>
        <button type="button" id="look" title="Send screen context">Look</button>
        <button type="submit">Send</button>
      </form>
    </section>
  </main>
  <script>
    const config = ${cfg};
    const bubble = document.getElementById("bubble");
    const root = document.querySelector(".pet-root");
    const petUi = document.getElementById("petUi");
    const stage = document.getElementById("stage");
    const imageSprite = document.getElementById("imageSprite");
    const videoSprite = document.getElementById("videoSprite");
    const sheetSprite = document.getElementById("sheetSprite");
    const stateSound = document.getElementById("stateSound");
    const cssPet = document.getElementById("cssPet");
    const input = document.getElementById("input");
    const chatSelect = document.getElementById("chatSelect");
    const newChat = document.getElementById("newChat");
    const form = document.getElementById("form");
    const play = document.getElementById("play");
    const look = document.getElementById("look");
    const close = document.querySelector(".close");
    const lines = {
      soft: ["I'm here.", "I noticed you.", "Still with you.", "I'm listening."],
      playful: ["I'm here.", "That got my attention.", "Ready when you are.", "I saw you."],
      quiet: ["Still here.", "I'm listening.", "No rush.", "I'll stay nearby."]
    };
    const idleLines = ["I drifted off for a moment.", "Still here if you need me.", "I'll stay close."];
    const touchLines = ["I'm here.", "That got my attention.", "I felt that.", "Still with you."];
    let moodTimer = 0;
    let hideTimer = 0;
    let autonomyTimer = 0;
    let presenceTimer = 0;
    let lastInteractionAt = Date.now();
    let lastWanderAt = Date.now();
    let lastPresenceAt = Date.now();
    let lastIdleMoodAt = 0;
    let lastSpokenAt = 0;
    let nextWanderDelay = 22000 + Math.random() * 18000;
    let nextPresenceDelay = 6000 + Math.random() * 9000;
    function clean(value, max = 120) {
      return String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
    }
    function safeId(value, fallback = "alert") {
      const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      return id || fallback;
    }
    const voice = lines[config.voice] ? config.voice : "soft";
    const autonomyEnabled = config.autonomyEnabled === true;
    const actionPresets = new Map((Array.isArray(config.actions) ? config.actions : []).map((preset) => [safeId(preset.id, ""), preset]));
    const emotionPresets = new Map((Array.isArray(config.emotions) ? config.emotions : []).map((preset) => [safeId(preset.id, ""), preset]));
    const baseSpriteUrl = clean(config.spriteUrl, 4000);
    const baseSpriteSheetUrl = clean(config.spriteSheetUrl, 4000);
    const ttsEnabled = config.ttsEnabled === true;
    const sheetStates = {
      idle: { row: 0, frames: [280, 110, 110, 140, 140, 320] },
      "running-right": { row: 1, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
      "running-left": { row: 2, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
      waving: { row: 3, frames: [140, 140, 140, 280] },
      jumping: { row: 4, frames: [140, 140, 140, 140, 280] },
      failed: { row: 5, frames: [140, 140, 140, 140, 140, 140, 140, 240] },
      waiting: { row: 6, frames: [150, 150, 150, 150, 150, 260] },
      running: { row: 7, frames: [120, 120, 120, 120, 120, 220] },
      review: { row: 8, frames: [150, 150, 150, 150, 150, 280] }
    };
    let uiRequestId = 0;
    let sheetAnimationTimer = 0;
    let activeSheetState = "";
    function isVideoUrl(url) {
      return /^data:video\\//i.test(url) || /\\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);
    }
    function hideMedia() {
      imageSprite.hidden = true;
      videoSprite.hidden = true;
      videoSprite.pause();
      sheetSprite.hidden = true;
      window.clearTimeout(sheetAnimationTimer);
      cssPet.hidden = false;
    }
    function positionSheetFrame(row, frame) {
      const x = frame <= 0 ? 0 : (frame / 7) * 100;
      const y = row <= 0 ? 0 : (row / 8) * 100;
      sheetSprite.style.backgroundPosition = x + "% " + y + "%";
    }
    function setSheetState(url, state = "idle") {
      const nextUrl = clean(url, 4000);
      if (!nextUrl) return false;
      const spec = sheetStates[state] || sheetStates.idle;
      activeSheetState = sheetStates[state] ? state : "idle";
      imageSprite.hidden = true;
      videoSprite.hidden = true;
      videoSprite.pause();
      cssPet.hidden = true;
      sheetSprite.hidden = false;
      if (sheetSprite.dataset.src !== nextUrl) {
        sheetSprite.dataset.src = nextUrl;
        sheetSprite.style.backgroundImage = "url(" + JSON.stringify(nextUrl) + ")";
      }
      window.clearTimeout(sheetAnimationTimer);
      let frame = 0;
      const tick = () => {
        positionSheetFrame(spec.row, frame);
        const delay = spec.frames[frame] || 140;
        frame = (frame + 1) % spec.frames.length;
        sheetAnimationTimer = window.setTimeout(tick, delay);
      };
      tick();
      return true;
    }
    function setSpriteUrl(url) {
      const nextUrl = clean(url, 4000);
      if (nextUrl) {
        window.clearTimeout(sheetAnimationTimer);
        sheetSprite.hidden = true;
        if (isVideoUrl(nextUrl)) {
          if (videoSprite.src !== nextUrl) {
            videoSprite.src = nextUrl;
            videoSprite.load();
          }
          videoSprite.hidden = false;
          imageSprite.hidden = true;
          cssPet.hidden = true;
          void videoSprite.play().catch(() => {});
          return;
        }
        if (imageSprite.src !== nextUrl) imageSprite.src = nextUrl;
        imageSprite.hidden = false;
        videoSprite.hidden = true;
        videoSprite.pause();
        cssPet.hidden = true;
      } else {
        hideMedia();
      }
    }
    function resolveSheetState(stateId, animation, preset) {
      const presetCodexState = safeId(preset?.codexState || "", "");
      if (sheetStates[presetCodexState]) return presetCodexState;
      const id = safeId(stateId || "", "");
      const anim = safeId(animation || "", "");
      if (/sleep|sad|failed|fail|tired/.test(id)) return "failed";
      if (/alert|curious|think|focus|review/.test(id)) return "review";
      if (/happy|joy|excited|play|wave/.test(id)) return anim === "bounce" || anim === "hop" ? "jumping" : "waving";
      if (/walk|wander|move/.test(id)) return "running-right";
      if (anim === "hop" || anim === "bounce") return "jumping";
      if (anim === "pop") return "review";
      if (anim === "sway") return "waiting";
      return sheetStates[id] ? id : "idle";
    }
    imageSprite.addEventListener("error", hideMedia);
    videoSprite.addEventListener("error", hideMedia);
    function playStateSound(url) {
      const nextUrl = clean(url, 4000);
      if (!nextUrl) return;
      if (stateSound.src !== nextUrl) stateSound.src = nextUrl;
      stateSound.currentTime = 0;
      void stateSound.play().catch(() => {});
    }
    function markInteraction() {
      lastInteractionAt = Date.now();
    }
    function clearPresenceClasses() {
      stage.classList.remove("is-present", "is-listening", "is-resting");
    }
    function pulsePresence(className = "is-present", state = "review", duration = 1300) {
      window.clearTimeout(presenceTimer);
      clearPresenceClasses();
      stage.classList.add(className);
      if (baseSpriteSheetUrl && state) setSheetState(baseSpriteSheetUrl, state);
      presenceTimer = window.setTimeout(() => {
        clearPresenceClasses();
        if (baseSpriteSheetUrl && !root.classList.contains("ui-open") && !dragging) setSheetState(baseSpriteSheetUrl, "idle");
      }, duration);
    }
    function acknowledgePresence() {
      const now = Date.now();
      pulsePresence("is-listening", "waving", 1100);
      if (now - lastSpokenAt > 8500) say(randomLine(), "idle", "calm");
    }
    function applyUiPlacement(placement) {
      root.classList.toggle("ui-below", placement === "below");
    }
    async function showUi() {
      markInteraction();
      clearTimeout(hideTimer);
      const requestId = ++uiRequestId;
      const result = await window.electronAPI?.resizeDesktopPetUi?.(true);
      if (requestId !== uiRequestId) return;
      applyUiPlacement(result?.placement || "above");
      root.classList.add("ui-open");
      pulsePresence("is-listening", "review", 900);
    }
    function queueHideUi() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (petUi.matches(":hover") || stage.matches(":hover") || document.activeElement === input) return;
        uiRequestId += 1;
        root.classList.remove("ui-open");
        void window.electronAPI?.resizeDesktopPetUi?.(false);
      }, 500);
    }
    function findPresetForId(id) {
      const candidates = [emotionPresets.get(id), actionPresets.get(id)].filter(Boolean);
      return candidates.find((preset) => clean(preset.assetUrl, 4000)) || candidates[0] || null;
    }
    function resolvePetPreset(actionId, emotionId) {
      const ids = [];
      if (emotionId) ids.push(emotionId);
      if (actionId && actionId !== emotionId) ids.push(actionId);
      for (const id of ids) {
        const preset = findPresetForId(id);
        if (preset && clean(preset.assetUrl, 4000)) return preset;
      }
      for (const id of ids) {
        const preset = findPresetForId(id);
        if (preset) return preset;
      }
      return null;
    }
    function applyPetState(action = "", emotion = "") {
      const actionId = action ? safeId(action, "") : "";
      const emotionId = emotion ? safeId(emotion, "") : "";
      if (!actionId && !emotionId) return;
      const visualStateId = emotionId || actionId;
      const preset = resolvePetPreset(actionId, emotionId);
      const animation = safeId(preset?.animation || "", "idle");
      const presetAsset = clean(preset?.assetUrl || "", 4000);
      const presetSound = clean(preset?.soundUrl || "", 4000);
      [...stage.classList].forEach((name) => {
        if (name.startsWith("anim-") || name === "is-happy" || name === "is-sleepy" || name === "is-alert") {
          stage.classList.remove(name);
        }
      });
      [...root.classList].forEach((name) => {
        if (name.startsWith("emotion-")) root.classList.remove(name);
      });
      if (animation !== "idle" && animation !== "none") stage.classList.add("anim-" + animation);
      if (presetAsset) {
        setSpriteUrl(presetAsset);
      } else if (baseSpriteSheetUrl) {
        setSheetState(baseSpriteSheetUrl, resolveSheetState(visualStateId, animation, preset));
      } else {
        setSpriteUrl(baseSpriteUrl);
      }
      playStateSound(presetSound);
      if (visualStateId) root.classList.add("emotion-" + visualStateId);
    }
    function parsePetTool(raw) {
      const text = String(raw || "");
      const toolBlocks = [...text.matchAll(/<PET_TOOL>([\\s\\S]*?)<\\/PET_TOOL>/gi)];
      const visibleText = text.replace(/<PET_TOOL>[\\s\\S]*?<\\/PET_TOOL>/gi, "").trim();
      if (!toolBlocks.length) return { message: text.trim(), action: "", emotion: "" };
      const tool = {};
      for (const match of toolBlocks) {
        try {
          const parsed = JSON.parse(match[1]);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
          Object.assign(tool, parsed);
        } catch {}
      }
      const state = tool.state || tool.emotion || tool.action || tool.animation || "";
      return {
        message: visibleText || clean(tool.message, 180) || "...",
        action: tool.action || state,
        emotion: tool.emotion || state
      };
    }
    function say(text, mood = "", emotion = "") {
      bubble.textContent = text;
      bubble.scrollTop = 0;
      lastSpokenAt = Date.now();
      if (mood || emotion) applyPetState(mood, emotion);
      clearTimeout(moodTimer);
      moodTimer = setTimeout(() => {
        [...stage.classList].forEach((name) => {
          if (name.startsWith("anim-")) stage.classList.remove(name);
        });
      }, 1800);
    }
    let ttsAudio = null;
    async function speak(text) {
      if (!ttsEnabled) return;
      const inputText = String(text || "").trim();
      if (!inputText) return;
      try {
        const result = await window.electronAPI?.speakDesktopPetText?.(inputText);
        if (!result?.ok || !result.base64) return;
        if (ttsAudio) {
          ttsAudio.pause();
          ttsAudio = null;
        }
        ttsAudio = new Audio("data:" + (result.contentType || "audio/mpeg") + ";base64," + result.base64);
        await ttsAudio.play();
      } catch {}
    }
    function randomLine() {
      const list = lines[voice] || lines.soft;
      return list[Math.floor(Math.random() * list.length)];
    }
    async function sendMessageWithOptionalScreen(text, includeScreen = false) {
      const messageText = clean(text, 4000);
      if (!messageText) return say(randomLine());
      showUi();
      say(includeScreen ? "Looking..." : "...", "running", "running");
      try {
        const screenContext = includeScreen
          ? await window.electronAPI?.captureDesktopPetScreenContext?.()
          : undefined;
        const result = await window.electronAPI?.sendDesktopPetMessage?.(messageText, screenContext?.ok ? screenContext : undefined);
        void refreshChats();
        const parsed = parsePetTool(result?.reply || "");
        say(parsed.message || "...", parsed.action, parsed.emotion);
        void speak(parsed.message || "");
      } catch (error) {
        say(clean(error?.message || error, 160) || "LLM is unavailable.", "sleepy", "sleepy");
      }
    }
    function renderChats(payload) {
      const chats = Array.isArray(payload?.chats) ? payload.chats : [];
      const active = payload?.activeChatId || "";
      chatSelect.replaceChildren(...chats.map((chat) => {
        const option = document.createElement("option");
        option.value = chat.id;
        option.textContent = (chat.title || "New chat") + (chat.count ? " (" + chat.count + ")" : "");
        option.selected = chat.id === active;
        return option;
      }));
      chatSelect.hidden = chats.length === 0;
    }
    async function refreshChats() {
      try {
        const payload = await window.electronAPI?.listDesktopPetChats?.();
        renderChats(payload);
      } catch {}
    }
    if (baseSpriteSheetUrl) {
      setSheetState(baseSpriteSheetUrl, "idle");
    } else {
      setSpriteUrl(baseSpriteUrl);
    }
    void refreshChats();
    const offPeerNear = window.electronAPI?.onDesktopPetPeerNear?.((payload) => {
      if (dragging || document.activeElement === input) return;
      const name = clean(payload?.name || "", 32);
      pulsePresence("is-present", "waving", 1500);
      if (!root.classList.contains("ui-open") && Date.now() - lastSpokenAt > 16000) {
        say(name ? "I noticed " + name + "." : "I noticed someone nearby.", "happy", "happy");
      }
    });
    window.addEventListener("beforeunload", () => offPeerNear?.(), { once: true });
    say(clean(config.greeting, 140) || ("Hi, I'm " + clean(config.name, 32) + "."));
    function runAutonomyTick() {
      if (!autonomyEnabled || dragging || root.classList.contains("ui-open") || document.activeElement === input) return;
      const now = Date.now();
      if (now - lastPresenceAt > nextPresenceDelay) {
        lastPresenceAt = now;
        nextPresenceDelay = 6500 + Math.random() * 12000;
        if (now - lastInteractionAt > 45000) {
          pulsePresence("is-resting", "waiting", 2500);
        } else {
          pulsePresence("is-present", "review", 1200);
        }
      }
      if (now - lastInteractionAt > 180000 && now - lastIdleMoodAt > 90000) {
        lastIdleMoodAt = now;
        const line = idleLines[Math.floor(Math.random() * idleLines.length)];
        say(line, "sleepy", "sleepy");
      } else if (now - lastInteractionAt > 90000 && now - lastIdleMoodAt > 90000) {
        lastIdleMoodAt = now;
        pulsePresence("is-resting", "waiting", 2600);
      }
      if (now - lastWanderAt > nextWanderDelay && now - lastInteractionAt > 10000) {
        lastWanderAt = now;
        nextWanderDelay = 22000 + Math.random() * 22000;
        const dx = Math.round((Math.random() - 0.5) * 120);
        const dy = Math.round((Math.random() - 0.5) * 42);
        const direction = dx < 0 ? "running-left" : "running-right";
        if (baseSpriteSheetUrl && activeSheetState !== direction) setSheetState(baseSpriteSheetUrl, direction);
        void Promise.resolve(window.electronAPI?.autonomyDesktopPetStep?.({ dx, dy }))
          .finally(() => {
            window.setTimeout(() => {
              if (!dragging && !root.classList.contains("ui-open")) {
                if (baseSpriteSheetUrl) setSheetState(baseSpriteSheetUrl, "idle");
              }
            }, 650);
          });
      }
    }
    if (autonomyEnabled) {
      autonomyTimer = window.setInterval(runAutonomyTick, 3000);
      window.addEventListener("beforeunload", () => window.clearInterval(autonomyTimer), { once: true });
    }
    stage.addEventListener("mouseenter", showUi);
    stage.addEventListener("mouseleave", queueHideUi);
    petUi.addEventListener("mouseenter", showUi);
    petUi.addEventListener("mouseleave", queueHideUi);
    stage.addEventListener("click", () => { markInteraction(); showUi(); acknowledgePresence(); });
    play.addEventListener("click", () => {
      markInteraction();
      pulsePresence("is-present", "waving", 1200);
      say(touchLines[Math.floor(Math.random() * touchLines.length)], "happy", "happy");
    });
    look.addEventListener("click", () => {
      markInteraction();
      const text = input.value.trim() || "Look at my screen and tell me what you notice.";
      input.value = "";
      void sendMessageWithOptionalScreen(text, true);
    });
    newChat.addEventListener("click", async () => {
      markInteraction();
      const payload = await window.electronAPI?.createDesktopPetChat?.("New chat");
      renderChats(payload);
      say("We can start fresh.", "happy", "happy");
      input.focus();
    });
    chatSelect.addEventListener("change", async () => {
      markInteraction();
      const payload = await window.electronAPI?.selectDesktopPetChat?.(chatSelect.value);
      renderChats(payload);
      say("I remember this thread.", "idle", "calm");
      input.focus();
    });
    close.addEventListener("click", () => window.electronAPI?.hideDesktopPet?.());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markInteraction();
      const text = input.value.trim();
      if (!text) return say(randomLine());
      input.value = "";
      void sendMessageWithOptionalScreen(text, false);
    });
    let dragging = false;
    stage.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest?.("button,input,select,textarea,a")) return;
      markInteraction();
      dragging = true;
      stage.setPointerCapture(event.pointerId);
      await window.electronAPI?.startDesktopPetDrag?.({ screenX: event.screenX, screenY: event.screenY });
    });
    stage.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      void window.electronAPI?.moveDesktopPetDrag?.({ screenX: event.screenX, screenY: event.screenY })
        .then((result) => {
          if (dragging && result?.placement) applyUiPlacement(result.placement);
        });
    });
    stage.addEventListener("pointerup", () => { dragging = false; });
    stage.addEventListener("pointercancel", () => { dragging = false; });
  </script>
</body>
</html>`;
}

async function ensureDesktopPetWindow(config?: unknown) {
  const nextConfig = sanitizeDesktopPetConfig(config);
  await syncDesktopPetRuntimeState(nextConfig);
  const key = desktopPetKey(nextConfig);
  const existing = desktopPetInstances.get(key);
  if (existing && !existing.window.isDestroyed()) {
    existing.config = nextConfig;
    setActiveDesktopPetInstance(existing);
    placeDesktopPetWindow(existing.window, nextConfig);
    await existing.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(nextConfig))}`);
    existing.window.showInactive();
    existing.window.setAlwaysOnTop(true, "floating");
    return existing.window;
  }

  const { width, height } = desktopPetWindowSize(nextConfig);
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  const instance: DesktopPetInstance = { key, window, config: nextConfig, uiPlacement: "above" };
  desktopPetInstances.set(key, instance);
  setActiveDesktopPetInstance(instance);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, "floating");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("closed", () => {
    desktopPetInstances.delete(key);
    if (desktopPetWindow === window) {
      const next = [...desktopPetInstances.values()].find((item) => !item.window.isDestroyed()) || null;
      if (next) {
        setActiveDesktopPetInstance(next);
      } else {
        desktopPetWindow = null;
      }
    }
  });
  placeDesktopPetWindow(window, nextConfig);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(nextConfig))}`);
  window.showInactive();
  return window;
}

function resolveBundledServerScript(): string {
  if (isDev) {
    return path.join(__dirname, "..", "server-bundle.mjs");
  }
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "server-bundle.mjs");
  if (existsSync(unpacked)) return unpacked;
  return path.join(__dirname, "..", "server-bundle.mjs");
}

function resolveBundledDistPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "dist");
  }
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
  if (existsSync(unpacked)) return unpacked;
  return path.join(__dirname, "..", "dist");
}

function resolveBundledPluginsPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "data", "bundled-plugins");
  }
  return path.join(process.resourcesPath, "data", "bundled-plugins");
}

async function isServerHealthy(): Promise<boolean> {
  const healthUrl = `${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}/api/health`;
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady(timeoutMs = SERVER_START_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  const healthUrl = `${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}/api/health`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is not ready yet.
    }
    await sleep(150);
  }

  throw new Error(`Timed out waiting for bundled server at ${healthUrl}`);
}

/** In production, boot the bundled server directly in the Electron main process. */
function startProductionServer(): Promise<void> {
  if (embeddedServerStart) return embeddedServerStart;
  embeddedServerStart = (async () => {
    if (await isServerHealthy()) return;

    const serverScript = resolveBundledServerScript();
    const distPath = resolveBundledDistPath();

    // These are read at module init time in the bundled server.
    process.env.SLV_DATA_DIR = process.env.SLV_DATA_DIR || path.join(app.getPath("userData"), "data");
    applyServerRuntimeEnv({
      ...runtimeOptions,
      headless: isHeadless || runtimeOptions.headless,
      serveStatic: true
    });
    process.env.SLV_SERVER_AUTOSTART = "0";
    process.env.ELECTRON_SERVE_STATIC = "1";
    process.env.ELECTRON_DIST_PATH = distPath;
    process.env.SLV_DIST_PATH = distPath;
    process.env.SLV_BUNDLED_PLUGINS_DIR = resolveBundledPluginsPath();
    process.env.NODE_ENV = "production";

    const moduleUrl = pathToFileURL(serverScript).href;
    const mod = await import(moduleUrl) as { startServer?: (port?: number, host?: string) => Promise<number> };
    if (typeof mod.startServer !== "function") {
      throw new Error(`Bundled server missing startServer(): ${serverScript}`);
    }
    await mod.startServer(SERVER_PORT, SERVER_HOST);
    await waitForServerReady();
  })();
  return embeddedServerStart;
}

async function createWindow() {
  if (mainWindow || creatingWindow) {
    mainWindow?.focus();
    return;
  }
  creatingWindow = true;

  // In dev mode, the server is already running via concurrently
  // In production, start the server as a child process
  try {
    if (!isDev) {
      await startProductionServer();
    }

    const isMac = process.platform === "darwin";

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      frame: isMac, // macOS uses native frame with hidden title bar; Windows/Linux fully frameless
      titleBarStyle: isMac ? "hiddenInset" : undefined,
      trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
      transparent: false,
      backgroundColor: "#0f0f14",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    const session = mainWindow.webContents.session;
    session.setPermissionCheckHandler?.(() => false);
    session.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));
    session.setDevicePermissionHandler?.(() => false);

    managedBackendManager.attachWindow(mainWindow);

    const forceShowTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 8000);

    mainWindow.once("ready-to-show", () => {
      clearTimeout(forceShowTimer);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Renderer failed to load URL "${validatedURL}" (${errorCode}): ${errorDescription}`
      );
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("Renderer process exited:", details.reason, details.exitCode);
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isAllowedAppNavigation(url)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      }
    });

    if (isDev) {
      // In dev, Vite proxies /api to the server, so load Vite dev server
      void mainWindow.loadURL("http://localhost:1420").catch((error) => {
        console.error("Failed to load Vite URL:", error);
      });
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      // In prod, server serves both API and static frontend
      void mainWindow.loadURL(formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })).catch((error) => {
        console.error("Failed to load bundled app URL:", error);
      });
    }

    // Forward maximize/unmaximize events to renderer
    mainWindow.on("maximize", () => {
      mainWindow?.webContents.send("window:maximized", true);
    });
    mainWindow.on("unmaximize", () => {
      mainWindow?.webContents.send("window:maximized", false);
    });

    mainWindow.on("closed", () => {
      clearTimeout(forceShowTimer);
      mainWindow = null;
      for (const instance of desktopPetInstances.values()) instance.window.close();
      desktopPetInstances.clear();
      desktopPetWindow?.close();
      desktopPetWindow = null;
    });
  } finally {
    creatingWindow = false;
  }
}

// IPC handlers for window controls
ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:isMaximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("window:getPlatform", () => {
  return process.platform;
});

ipcMain.handle("file:save", async (_event, payload: { filename?: unknown; base64Data?: unknown }) => {
  if (!payload || typeof payload !== "object") {
    return { ok: false, canceled: true };
  }
  const filename = sanitizeFilename(String(payload.filename || "export.txt"), "export.txt");
  const base64Data = String(payload.base64Data || "").trim();
  if (!base64Data) {
    throw new Error("Missing file payload");
  }

  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    defaultPath: filename,
    buttonLabel: "Save"
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const buffer = Buffer.from(base64Data, "base64");
  await writeFile(result.filePath, buffer);
  return { ok: true, canceled: false, filePath: result.filePath };
});

ipcMain.handle("shell:openExternal", async (_event, rawUrl: unknown) => {
  const url = String(rawUrl || "").trim();
  if (!isAllowedExternalUrl(url)) {
    return { ok: false };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("desktop-pet:show", async (_event, rawConfig: unknown) => {
  const window = await ensureDesktopPetWindow(rawConfig);
  return { ok: true, visible: Boolean(window && !window.isDestroyed() && window.isVisible()) };
});

ipcMain.handle("desktop-pet:hide", (event) => {
  const instance = getDesktopPetInstanceForSender(event.sender) || (desktopPetWindow ? getDesktopPetInstanceForWindow(desktopPetWindow) : null);
  if (instance) {
    instance.window.hide();
  } else {
    desktopPetWindow?.hide();
  }
  return { ok: true, visible: false };
});

ipcMain.handle("desktop-pet:toggle", async (_event, rawConfig: unknown) => {
  const nextConfig = sanitizeDesktopPetConfig(rawConfig);
  const existing = desktopPetInstances.get(desktopPetKey(nextConfig));
  if (existing && !existing.window.isDestroyed() && existing.window.isVisible()) {
    setActiveDesktopPetInstance(existing);
    existing.window.hide();
    return { ok: true, visible: false };
  }
  const window = await ensureDesktopPetWindow(nextConfig);
  return { ok: true, visible: Boolean(window && !window.isDestroyed() && window.isVisible()) };
});

ipcMain.handle("desktop-pet:configure", async (_event, rawConfig: unknown) => {
  const nextConfig = sanitizeDesktopPetConfig(rawConfig);
  const key = desktopPetKey(nextConfig);
  const instance = desktopPetInstances.get(key) || (desktopPetWindow ? getDesktopPetInstanceForWindow(desktopPetWindow) : null);
  const shouldShow = Boolean(instance && !instance.window.isDestroyed() && instance.window.isVisible());
  desktopPetConfig = nextConfig;
  await syncDesktopPetRuntimeState(nextConfig);
  if (instance && !instance.window.isDestroyed()) {
    if (instance.key !== key) {
      desktopPetInstances.delete(instance.key);
      instance.key = key;
      desktopPetInstances.set(key, instance);
    }
    instance.config = nextConfig;
    setActiveDesktopPetInstance(instance);
    placeDesktopPetWindow(instance.window, nextConfig);
    void instance.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(nextConfig))}`);
    if (shouldShow) instance.window.showInactive();
  }
  return { ok: true, visible: shouldShow };
});

ipcMain.handle("desktop-pet:isVisible", () => {
  return [...desktopPetInstances.values()].some((instance) => !instance.window.isDestroyed() && instance.window.isVisible());
});

ipcMain.handle("desktop-pet:drag-start", (event, point: { screenX?: unknown; screenY?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  const instance = getDesktopPetInstanceForSender(event.sender);
  if (!target || !instance || target !== instance.window) return { ok: false };
  setActiveDesktopPetInstance(instance);
  desktopPetDragState.set(event.sender.id, {
    startX: Number(point?.screenX) || 0,
    startY: Number(point?.screenY) || 0,
    bounds: target.getBounds()
  });
  return { ok: true };
});

ipcMain.handle("desktop-pet:drag-move", (event, point: { screenX?: unknown; screenY?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  const instance = getDesktopPetInstanceForSender(event.sender);
  const drag = desktopPetDragState.get(event.sender.id);
  if (!target || !instance || target !== instance.window || !drag) return { ok: false };
  const nextX = drag.bounds.x + Math.round((Number(point?.screenX) || 0) - drag.startX);
  const nextY = drag.bounds.y + Math.round((Number(point?.screenY) || 0) - drag.startY);
  target.setPosition(nextX, nextY, false);
  const bounds = target.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const compact = desktopPetWindowSize(instance.config, false);
  const placement = resolveDesktopPetUiPlacement(bounds, display.workArea, compact.height, instance.uiPlacement);
  if (placement !== instance.uiPlacement && bounds.height > compact.height + 24) {
    const current = target.getBounds();
    const delta = desktopPetWindowSize(instance.config, true).height - compact.height;
    const preferredY = placement === "below" ? current.y + delta : current.y - delta;
    const area = display.workArea;
    const adjustedY = Math.max(area.y, Math.min(area.y + area.height - current.height, preferredY));
    target.setPosition(current.x, adjustedY, false);
    drag.bounds = { ...drag.bounds, y: drag.bounds.y + (adjustedY - current.y) };
  }
  instance.uiPlacement = placement;
  setActiveDesktopPetInstance(instance);
  maybeNotifyNearbyDesktopPets(instance);
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:ui-expanded", (event, expanded: unknown) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  const instance = getDesktopPetInstanceForSender(event.sender);
  if (!target || !instance || target !== instance.window) return { ok: false };
  const placement = resizeDesktopPetInstanceWindowForUi(instance, Boolean(expanded));
  setActiveDesktopPetInstance(instance);
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:autonomy-step", (event, delta: { dx?: unknown; dy?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  const instance = getDesktopPetInstanceForSender(event.sender);
  if (!target || !instance || target !== instance.window) return { ok: false };
  const bounds = target.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const dx = Math.max(-48, Math.min(48, Math.round(Number(delta?.dx) || 0)));
  const dy = Math.max(-28, Math.min(28, Math.round(Number(delta?.dy) || 0)));
  const nextX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + dx));
  const nextY = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y + dy));
  target.setPosition(nextX, nextY, false);
  const compact = desktopPetWindowSize(instance.config, false);
  const placement = resolveDesktopPetUiPlacement(target.getBounds(), area, compact.height, instance.uiPlacement);
  instance.uiPlacement = placement;
  setActiveDesktopPetInstance(instance);
  maybeNotifyNearbyDesktopPets(instance);
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:chats", async (event, rawConfig?: unknown) => {
  const config = resolveDesktopPetConfigForRequest(event.sender, rawConfig);
  await syncDesktopPetRuntimeState(config);
  const state = await getDesktopPetRuntimeState(config);
  return {
    ok: true,
    activeChatId: state.defaultChatId,
    persistentMemory: state.persistentMemory,
    chats: summarizeDesktopPetChats(state),
    history: summarizeDesktopPetChatHistory(state)
  };
});

ipcMain.handle("desktop-pet:new-chat", async (event, rawTitle: unknown, rawConfig?: unknown) => {
  const config = resolveDesktopPetConfigForRequest(event.sender, rawConfig);
  await syncDesktopPetRuntimeState(config);
  const state = await getDesktopPetRuntimeState(config);
  const chat = createDesktopPetChat(String(rawTitle || "New chat").trim().slice(0, 64) || "New chat");
  state.chats.unshift(chat);
  state.defaultChatId = chat.id;
  state.chats = state.chats.slice(0, 20);
  scheduleDesktopPetStoreWrite();
  return { ok: true, activeChatId: chat.id, chats: summarizeDesktopPetChats(state), history: summarizeDesktopPetChatHistory(state) };
});

ipcMain.handle("desktop-pet:select-chat", async (event, rawChatId: unknown, rawConfig?: unknown) => {
  const config = resolveDesktopPetConfigForRequest(event.sender, rawConfig);
  await syncDesktopPetRuntimeState(config);
  const state = await getDesktopPetRuntimeState(config);
  const chatId = String(rawChatId || "").trim();
  if (state.chats.some((chat) => chat.id === chatId)) {
    state.defaultChatId = chatId;
    scheduleDesktopPetStoreWrite();
  }
  return { ok: true, activeChatId: state.defaultChatId, chats: summarizeDesktopPetChats(state), history: summarizeDesktopPetChatHistory(state) };
});

ipcMain.handle("desktop-pet:message", async (event, message: unknown, rawScreenContext?: unknown) => {
  try {
    const instance = getDesktopPetInstanceForSender(event.sender);
    const screenContext = rawScreenContext && typeof rawScreenContext === "object" && !Array.isArray(rawScreenContext)
      ? rawScreenContext as Record<string, unknown>
      : null;
    const dataUrl = String(screenContext?.dataUrl || "").slice(0, 8 * 1024 * 1024);
    const normalizedScreenContext = dataUrl.startsWith("data:image/")
      ? {
        dataUrl,
        width: Number(screenContext?.width) || 0,
        height: Number(screenContext?.height) || 0
      }
      : null;
    return await sendDesktopPetMessageToLlm(String(message || ""), instance?.config || desktopPetConfig, normalizedScreenContext);
  } catch (error) {
    return {
      ok: false,
      reply: error instanceof Error ? error.message : "Desktop pet LLM request failed"
    };
  }
});

ipcMain.handle("desktop-pet:screen-context", async (event) => {
  try {
    const instance = getDesktopPetInstanceForSender(event.sender) || (desktopPetWindow ? getDesktopPetInstanceForWindow(desktopPetWindow) : null);
    if (!instance) return { ok: false, error: "Desktop pet is unavailable" };
    const result = await captureDesktopPetScreenContext(instance);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Screen capture failed"
    };
  }
});

ipcMain.handle("desktop-pet:tts", async (event, text: unknown) => {
  try {
    const instance = getDesktopPetInstanceForSender(event.sender);
    return await synthesizeDesktopPetSpeech(String(text || ""), instance?.config || desktopPetConfig);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Desktop pet TTS request failed"
    };
  }
});

ipcMain.handle("managed-backends:list", () => {
  return managedBackendManager.listRuntimeStates();
});

ipcMain.handle("managed-backends:start", async (_event, rawConfig: unknown) => {
  return managedBackendManager.start(rawConfig as ManagedBackendConfig);
});

ipcMain.handle("managed-backends:stop", async (_event, backendId: unknown) => {
  return managedBackendManager.stop(String(backendId || "").trim());
});

ipcMain.handle("managed-backends:stop-active", async () => {
  await managedBackendManager.stopActive();
  return { ok: true };
});

ipcMain.handle("managed-backends:logs", (_event, backendId: unknown) => {
  return managedBackendManager.getLogs(String(backendId || "").trim());
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (isHeadless) {
    app.dock?.hide();
    void startProductionServer()
      .then(() => {
        console.log(`Vellium headless mode running at ${formatServerUrl({ host: SERVER_HOST, port: SERVER_PORT })}`);
      })
      .catch((error) => {
        console.error("Failed to start headless server:", error);
        app.quit();
      });
    return;
  }
  void createWindow().catch((error) => {
    console.error("Failed to create main window:", error);
    const message = error instanceof Error ? error.stack || error.message : String(error);
    dialog.showErrorBox("Vellium startup error", message);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (isHeadless) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => {
      console.error("Failed to recreate main window:", error);
    });
  }
});

// Bundled server runs in-process; no child teardown needed.
app.on("before-quit", () => {
  desktopPetWindow?.close();
  void managedBackendManager.stopActive();
});
