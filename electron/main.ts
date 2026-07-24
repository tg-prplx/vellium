import { app, BrowserWindow, ipcMain, dialog, shell, screen, desktopCapturer, type Rectangle, type WebContents } from "electron";
import path from "path";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { pathToFileURL } from "url";
import { configureLiveMediaPermissions, registerLiveMediaIpc } from "./liveMedia";
import { ManagedBackendManager } from "./managedBackends";
import { registerManagedBackendIpc } from "./managedBackendIpc";
import { LocalModelInstaller } from "./localModelInstaller";
import { registerLocalModelIpc } from "./localModelIpc";
import { createIpcSenderGuard, decodeBoundedBase64, isAllowedExternalUrl } from "./security";
import { buildDesktopPetHtml } from "./desktopPet/html";
import type {
  DesktopPetAnimation,
  DesktopPetChat,
  DesktopPetChatAttachment,
  DesktopPetChatMessage,
  DesktopPetCodexState,
  DesktopPetConfig,
  DesktopPetInstance,
  DesktopPetRuntimeState,
  DesktopPetScreenContext,
  DesktopPetStatePreset,
  DesktopPetStore,
  DesktopPetTheme,
  DesktopPetUiPlacement
} from "./desktopPet/types";
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
const localModelInstaller = new LocalModelInstaller();
const assertTrustedIpcSender = createIpcSenderGuard({
  getMainWindow: () => mainWindow,
  getDesktopPetWindow: (sender) => getDesktopPetInstanceForSender(sender)?.window || null,
  isAllowedMainUrl: (url) => isAllowedAppNavigation(url)
});
registerLiveMediaIpc(assertTrustedIpcSender, () => mainWindow);
registerLocalModelIpc(localModelInstaller, assertTrustedIpcSender);
registerManagedBackendIpc(managedBackendManager, assertTrustedIpcSender);

const SERVER_PORT = runtimeOptions.port;
const SERVER_HOST = runtimeOptions.host;
const SERVER_START_TIMEOUT_MS = 20000;
const MAX_IPC_SAVE_BYTES = 128 * 1024 * 1024;
function sanitizeFilename(name: string, fallback = "export.txt"): string {
  const trimmed = String(name || "").trim();
  const normalized = trimmed.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return normalized || fallback;
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
  const appendedMessages: DesktopPetChatMessage[] = [
    ...chat.messages,
    { role: "user", content: text, createdAt: now, attachments: userAttachments },
    { role: "assistant", content: stripDesktopPetToolLine(reply).slice(0, 1200) || "...", createdAt: now }
  ];
  chat.messages = appendedMessages.slice(-80);
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
    return path.join(__dirname, "..", "bundled-plugins");
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

    configureLiveMediaPermissions({
      session: mainWindow.webContents.session,
      getMainWindow: () => mainWindow,
      isAllowedAppUrl: isAllowedAppNavigation
    });

    managedBackendManager.attachWindow(mainWindow);
    localModelInstaller.attachWindow(mainWindow);

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
ipcMain.handle("window:minimize", (event) => {
  assertTrustedIpcSender(event);
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", (event) => {
  assertTrustedIpcSender(event);
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:close", (event) => {
  assertTrustedIpcSender(event);
  mainWindow?.close();
});

ipcMain.handle("window:isMaximized", (event) => {
  assertTrustedIpcSender(event);
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("window:getPlatform", (event) => {
  assertTrustedIpcSender(event);
  return process.platform;
});

ipcMain.handle("window:setZoomFactor", (event, requestedFactor: unknown) => {
  assertTrustedIpcSender(event);
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return 1;
  const numericFactor = Number(requestedFactor);
  const safeFactor = Number.isFinite(numericFactor)
    ? Math.max(0.65, Math.min(1.5, numericFactor))
    : 1;
  target.webContents.setZoomFactor(safeFactor);
  return safeFactor;
});

ipcMain.handle("file:save", async (event, payload: { filename?: unknown; base64Data?: unknown }) => {
  assertTrustedIpcSender(event);
  if (!payload || typeof payload !== "object") {
    return { ok: false, canceled: true };
  }
  const filename = sanitizeFilename(String(payload.filename || "export.txt"), "export.txt");
  const buffer = decodeBoundedBase64(String(payload.base64Data || ""), MAX_IPC_SAVE_BYTES);

  const saveDialogOptions = {
    defaultPath: filename,
    buttonLabel: "Save"
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions);
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  await writeFile(result.filePath, buffer);
  return { ok: true, canceled: false, filePath: result.filePath };
});

ipcMain.handle("shell:openExternal", async (event, rawUrl: unknown) => {
  assertTrustedIpcSender(event);
  const url = String(rawUrl || "").trim();
  if (!isAllowedExternalUrl(url)) {
    return { ok: false };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("desktop-pet:show", async (event, rawConfig: unknown) => {
  assertTrustedIpcSender(event);
  const window = await ensureDesktopPetWindow(rawConfig);
  return { ok: true, visible: Boolean(window && !window.isDestroyed() && window.isVisible()) };
});

ipcMain.handle("desktop-pet:hide", (event) => {
  assertTrustedIpcSender(event, true);
  const instance = getDesktopPetInstanceForSender(event.sender) || (desktopPetWindow ? getDesktopPetInstanceForWindow(desktopPetWindow) : null);
  if (instance) {
    instance.window.hide();
  } else {
    desktopPetWindow?.hide();
  }
  return { ok: true, visible: false };
});

ipcMain.handle("desktop-pet:toggle", async (event, rawConfig: unknown) => {
  assertTrustedIpcSender(event);
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

ipcMain.handle("desktop-pet:configure", async (event, rawConfig: unknown) => {
  assertTrustedIpcSender(event);
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

ipcMain.handle("desktop-pet:isVisible", (event) => {
  assertTrustedIpcSender(event);
  return [...desktopPetInstances.values()].some((instance) => !instance.window.isDestroyed() && instance.window.isVisible());
});

ipcMain.handle("desktop-pet:drag-start", (event, point: { screenX?: unknown; screenY?: unknown }) => {
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
  const target = BrowserWindow.fromWebContents(event.sender);
  const instance = getDesktopPetInstanceForSender(event.sender);
  if (!target || !instance || target !== instance.window) return { ok: false };
  const placement = resizeDesktopPetInstanceWindowForUi(instance, Boolean(expanded));
  setActiveDesktopPetInstance(instance);
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:autonomy-step", (event, delta: { dx?: unknown; dy?: unknown }) => {
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
  assertTrustedIpcSender(event, true);
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
