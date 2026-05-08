import { app, BrowserWindow, ipcMain, dialog, shell, screen, type Rectangle } from "electron";
import path from "path";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
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
let desktopPetConfig: DesktopPetConfig = {
  name: "Velli",
  spriteUrl: "",
  scale: 1,
  voice: "soft",
  actions: [
    { id: "idle", label: "Idle", animation: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", assetUrl: "", soundUrl: "" },
    { id: "alert", label: "Alert", animation: "pop", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", assetUrl: "", soundUrl: "" },
    { id: "spin", label: "Spin", animation: "spin", assetUrl: "", soundUrl: "" },
    { id: "shake", label: "Shake", animation: "shake", assetUrl: "", soundUrl: "" }
  ],
  emotions: [
    { id: "calm", label: "Calm", animation: "idle", assetUrl: "", soundUrl: "" },
    { id: "happy", label: "Happy", animation: "hop", assetUrl: "", soundUrl: "" },
    { id: "curious", label: "Curious", animation: "pop", assetUrl: "", soundUrl: "" },
    { id: "sleepy", label: "Sleepy", animation: "sway", assetUrl: "", soundUrl: "" },
    { id: "excited", label: "Excited", animation: "bounce", assetUrl: "", soundUrl: "" }
  ],
  autonomyEnabled: false,
  assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help."
};
let desktopPetUiPlacement: DesktopPetUiPlacement = "above";
const desktopPetDragState = new Map<number, {
  startX: number;
  startY: number;
  bounds: Rectangle;
}>();
let desktopPetConversationKey = "";
let desktopPetConversation: Array<{ role: "user" | "assistant"; content: string }> = [];
let creatingWindow = false;
let embeddedServerStart: Promise<void> | null = null;
const managedBackendManager = new ManagedBackendManager();

const SERVER_PORT = runtimeOptions.port;
const SERVER_HOST = runtimeOptions.host;
const SERVER_START_TIMEOUT_MS = 20000;

type DesktopPetConfig = {
  characterId?: string;
  name: string;
  spriteUrl: string;
  scale: number;
  voice: "soft" | "playful" | "quiet";
  autonomyEnabled: boolean;
  actions: DesktopPetStatePreset[];
  emotions: DesktopPetStatePreset[];
  assistantInstructions: string;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  systemPrompt?: string;
};

type DesktopPetAnimation = "none" | "idle" | "hop" | "pop" | "sway" | "spin" | "shake" | "bounce";
type DesktopPetUiPlacement = "above" | "below";

type DesktopPetStatePreset = {
  id: string;
  label: string;
  animation: DesktopPetAnimation;
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
  const scaleRaw = Number(row.scale ?? desktopPetConfig.scale ?? 1);
  const scale = Number.isFinite(scaleRaw) ? Math.max(0.75, Math.min(1.35, scaleRaw)) : 1;
  const voice = row.voice === "playful" || row.voice === "quiet" ? row.voice : row.voice === "soft" ? "soft" : desktopPetConfig.voice || "soft";
  const autonomyEnabled = row.autonomyEnabled === true;
  const normalizeAnimation = (value: unknown): DesktopPetAnimation => (
    value === "none" || value === "hop" || value === "pop" || value === "sway" || value === "spin" || value === "shake" || value === "bounce" || value === "idle"
      ? value
      : "idle"
  );
  const defaultAnimationForId = (id: string): DesktopPetAnimation => {
    if (/happy|joy|excited|play/.test(id)) return "hop";
    if (/alert|curious|think|focus/.test(id)) return "pop";
    if (/sleep|tired|calm/.test(id)) return "sway";
    if (/spin/.test(id)) return "spin";
    if (/shake|no|angry/.test(id)) return "shake";
    if (/bounce/.test(id)) return "bounce";
    return "idle";
  };
  const normalizeId = (value: unknown) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  const normalizePresets = (value: unknown, fallback: DesktopPetStatePreset[]) => {
    const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [];
    const unique = new Map<string, DesktopPetStatePreset>();
    for (const item of source) {
      if (typeof item === "string") {
        const id = normalizeId(item);
        if (id && !unique.has(id)) unique.set(id, { id, label: id, animation: defaultAnimationForId(id), assetUrl: "", soundUrl: "" });
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const id = normalizeId(record.id);
      if (!id || unique.has(id)) continue;
      unique.set(id, {
        id,
        label: String(record.label || id).trim().slice(0, 48) || id,
        animation: normalizeAnimation(record.animation),
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
  const actions = normalizePresets(row.actions, desktopPetConfig.actions);
  const emotions = normalizePresets(row.emotions, desktopPetConfig.emotions);
  return { characterId, name, spriteUrl, scale, voice, autonomyEnabled, actions, emotions, assistantInstructions, description, personality, scenario, greeting, systemPrompt };
}

function desktopPetWindowSize(config: DesktopPetConfig, expanded = false) {
  return {
    width: Math.round((expanded ? 292 : 190) * config.scale),
    height: Math.round((expanded ? 372 : 190) * config.scale)
  };
}

function placeDesktopPetWindow(window: BrowserWindow, config: DesktopPetConfig, expanded = false) {
  const { width, height } = desktopPetWindowSize(config, expanded);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
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

function resolveDesktopPetUiPlacement(bounds: Rectangle, displayArea: Rectangle, compactHeight: number): DesktopPetUiPlacement {
  const isExpanded = bounds.height > compactHeight + 24;
  const petCenterY = isExpanded
    ? desktopPetUiPlacement === "below"
      ? bounds.y + compactHeight / 2
      : bounds.y + bounds.height - compactHeight / 2
    : bounds.y + bounds.height / 2;
  return petCenterY < displayArea.y + displayArea.height / 2 ? "below" : "above";
}

function resizeDesktopPetWindowForUi(expanded: boolean): DesktopPetUiPlacement {
  if (!desktopPetWindow || desktopPetWindow.isDestroyed()) return desktopPetUiPlacement;
  const { width, height } = desktopPetWindowSize(desktopPetConfig, expanded);
  const compact = desktopPetWindowSize(desktopPetConfig, false);
  const current = desktopPetWindow.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  const placement = expanded ? resolveDesktopPetUiPlacement(current, area, compact.height) : desktopPetUiPlacement;
  if (expanded) desktopPetUiPlacement = placement;
  const centerX = current.x + current.width / 2;
  const nextX = Math.max(area.x, Math.min(area.x + area.width - width, Math.round(centerX - width / 2)));
  const preferredY = placement === "below" ? current.y : current.y + current.height - height;
  const nextY = Math.max(area.y, Math.min(area.y + area.height - height, preferredY));
  desktopPetWindow.setBounds({ x: nextX, y: nextY, width, height }, false);
  return placement;
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

function syncDesktopPetConversation(config: DesktopPetConfig) {
  const key = config.characterId || `pet:${config.name || "Velli"}`;
  if (key === desktopPetConversationKey) return;
  desktopPetConversationKey = key;
  desktopPetConversation = [];
}

function stripDesktopPetToolLine(text: string): string {
  return String(text || "").replace(/<PET_TOOL>[\s\S]*?<\/PET_TOOL>/gi, "").trim();
}

function buildDesktopPetRuntimePrompt(config: DesktopPetConfig): string {
  const describe = (preset: DesktopPetStatePreset) => `${preset.id}${preset.label && preset.label !== preset.id ? ` (${preset.label})` : ""}: animation=${preset.animation}${preset.assetUrl ? ", custom_asset=true" : ""}${preset.soundUrl ? ", sound=true" : ""}`;
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
    "Reply naturally and briefly as the selected character. Be useful like a small personal assistant when the user asks for help.",
    "Choose one pet state after your text to change the visible pet asset and animation.",
    `Available states: ${states}.`,
    "Append exactly one final machine-readable line in this format:",
    '<PET_TOOL>{"state":"happy"}</PET_TOOL>',
    "Use only a state id from the available list. For example, state=happy must select the happy asset. Do not explain the tool line."
  ].filter(Boolean).join("\n");
}

async function sendDesktopPetMessageToLlm(message: string): Promise<{ ok: boolean; reply: string; chatId?: string }> {
  const text = String(message || "").trim().slice(0, 1000);
  if (!text) return { ok: false, reply: "" };
  syncDesktopPetConversation(desktopPetConfig);
  const response = await readPetApiJson<{ reply?: string }>("/api/chats/desktop-pet/reply", {
    method: "POST",
    body: JSON.stringify({
      content: text,
      history: desktopPetConversation.slice(-12),
      pet: {
        name: desktopPetConfig.name,
        description: desktopPetConfig.description || "",
        personality: desktopPetConfig.personality || "",
        scenario: desktopPetConfig.scenario || "",
        systemPrompt: desktopPetConfig.systemPrompt || ""
      },
      runtimeSystemPrompt: buildDesktopPetRuntimePrompt(desktopPetConfig)
    })
  });
  const reply = String(response.reply || "").trim() || "...";
  desktopPetConversation = [
    ...desktopPetConversation,
    { role: "user", content: text },
    { role: "assistant", content: stripDesktopPetToolLine(reply).slice(0, 1200) || "..." }
  ].slice(-16);
  return { ok: true, reply };
}

function buildDesktopPetHtml(config: DesktopPetConfig) {
  const cfg = safeScriptJson(config);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: file:; media-src data: http: https: file: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --accent: #d97757;
      --ink: #f7efe9;
      --muted: rgba(247, 239, 233, 0.68);
      --panel: #171419;
      --field: #231f26;
      --line: #343039;
      --pet-scale: ${config.scale};
      --root-pad: calc(6px * var(--pet-scale));
      --ui-side: calc(10px * var(--pet-scale));
      --ui-offset: calc(196px * var(--pet-scale));
      --stage-size: calc(178px * var(--pet-scale));
      --sprite-size: calc(164px * var(--pet-scale));
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
      background: linear-gradient(150deg, #ffcf88, #d97757 70%);
      border: 2px solid rgba(255, 255, 255, 0.34);
    }
    .ear.left { left: 18px; transform: rotate(-28deg); }
    .ear.right { right: 18px; transform: rotate(28deg) scaleX(-1); }
    .head {
      position: absolute;
      inset: 26px 8px 6px;
      border-radius: 44% 44% 38% 38%;
      background: radial-gradient(circle at 36% 28%, #fff7d7 0 18%, transparent 19%),
        linear-gradient(145deg, #ffc56d, #e38155 58%, #9f5acb);
      border: 2px solid rgba(255, 255, 255, 0.36);
      box-shadow: inset -14px -16px 24px rgba(70, 38, 76, 0.26);
    }
    .eye {
      position: absolute;
      top: 72px;
      width: 12px;
      height: 18px;
      border-radius: 999px;
      background: #20141e;
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
      border-bottom: 2px solid #2b1723;
      border-radius: 0 0 999px 999px;
    }
    .paw {
      position: absolute;
      bottom: 0;
      width: 34px;
      height: 22px;
      border-radius: 999px;
      background: #f6b463;
      border: 2px solid rgba(255, 255, 255, 0.26);
    }
    .paw.left { left: 28px; }
    .paw.right { right: 28px; }
    .stage.is-happy .css-pet,
    .stage.is-happy .sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.is-sleepy .css-pet,
    .stage.is-sleepy .sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.is-alert .css-pet,
    .stage.is-alert .sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-hop .css-pet,
    .stage.anim-hop .sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.anim-sway .css-pet,
    .stage.anim-sway .sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.anim-pop .css-pet,
    .stage.anim-pop .sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-spin .css-pet,
    .stage.anim-spin .sprite { animation: petSpin 720ms ease-in-out 1; }
    .stage.anim-shake .css-pet,
    .stage.anim-shake .sprite { animation: petShake 480ms ease-in-out 1; }
    .stage.anim-bounce .css-pet,
    .stage.anim-bounce .sprite { animation: petBounce 900ms ease-in-out 1; }
    .pet-root.emotion-happy .bubble { border-color: #6ee7b7; }
    .pet-root.emotion-excited .bubble { border-color: #fbbf24; }
    .pet-root.emotion-sleepy .bubble { border-color: #93c5fd; }
    .pet-root.emotion-curious .bubble { border-color: #c4b5fd; }
    .controls {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 6px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    }
    input {
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
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 9px;
      background: var(--field);
      color: var(--ink);
      height: 32px;
      padding: 0 9px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover {
      background: rgba(217, 119, 87, 0.28);
      border-color: rgba(217, 119, 87, 0.45);
    }
    .close {
      position: absolute;
      top: 8px;
      right: 9px;
      width: 28px;
      padding: 0;
      opacity: 0.62;
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
  </style>
</head>
<body>
  <main class="pet-root">
    <div class="stage" id="stage">
      <img class="sprite" id="imageSprite" alt="" hidden />
      <video class="sprite" id="videoSprite" muted loop playsinline autoplay hidden></video>
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
      <div class="bubble" id="bubble"></div>
      <form class="controls" id="form">
        <input id="input" maxlength="160" placeholder="Talk to pet..." autocomplete="off" />
        <button type="button" id="play">Play</button>
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
    const stateSound = document.getElementById("stateSound");
    const cssPet = document.getElementById("cssPet");
    const input = document.getElementById("input");
    const form = document.getElementById("form");
    const play = document.getElementById("play");
    const close = document.querySelector(".close");
    const lines = {
      soft: ["I'm here.", "Soft paws, sharp focus.", "I'll keep you company.", "Tiny desktop guardian online."],
      playful: ["Let's do something fun.", "Boop accepted.", "I saw that click.", "Desktop patrol mode."],
      quiet: ["...", "Still here.", "Watching the workspace.", "Quiet mode."]
    };
    const idleLines = ["I got sleepy waiting.", "Still here if you need me.", "I'll keep watch for now."];
    let moodTimer = 0;
    let hideTimer = 0;
    let autonomyTimer = 0;
    let lastInteractionAt = Date.now();
    let lastWanderAt = Date.now();
    let lastIdleMoodAt = 0;
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
    let uiRequestId = 0;
    function isVideoUrl(url) {
      return /^data:video\\//i.test(url) || /\\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);
    }
    function hideMedia() {
      imageSprite.hidden = true;
      videoSprite.hidden = true;
      videoSprite.pause();
      cssPet.hidden = false;
    }
    function setSpriteUrl(url) {
      const nextUrl = clean(url, 4000);
      if (nextUrl) {
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
      const animation = safeId(preset?.animation || actionId, "idle");
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
      setSpriteUrl(presetAsset || baseSpriteUrl);
      playStateSound(presetSound);
      if (visualStateId) root.classList.add("emotion-" + visualStateId);
    }
    function parsePetTool(raw) {
      const text = String(raw || "");
      const match = text.match(/<PET_TOOL>([\\s\\S]*?)<\\/PET_TOOL>/i);
      if (!match) return { message: text.trim(), action: "", emotion: "" };
      try {
        const tool = JSON.parse(match[1]);
        const state = tool.state || tool.emotion || tool.action || tool.animation || "alert";
        const message = text.replace(match[0], "").trim() || clean(tool.message, 180) || "...";
        return {
          message,
          action: tool.action || state,
          emotion: tool.emotion || state
        };
      } catch {
        return { message: text.replace(match[0], "").trim() || text.trim(), action: "", emotion: "" };
      }
    }
    function say(text, mood = "", emotion = "") {
      bubble.textContent = text;
      if (mood || emotion) applyPetState(mood, emotion);
      clearTimeout(moodTimer);
      moodTimer = setTimeout(() => {
        [...stage.classList].forEach((name) => {
          if (name.startsWith("anim-")) stage.classList.remove(name);
        });
      }, 1800);
    }
    function randomLine() {
      const list = lines[voice] || lines.soft;
      return list[Math.floor(Math.random() * list.length)];
    }
    setSpriteUrl(baseSpriteUrl);
    say(clean(config.greeting, 140) || ("Hi, I'm " + clean(config.name, 32) + "."));
    function runAutonomyTick() {
      if (!autonomyEnabled || dragging || root.classList.contains("ui-open") || document.activeElement === input) return;
      const now = Date.now();
      if (now - lastInteractionAt > 90000 && now - lastIdleMoodAt > 45000) {
        lastIdleMoodAt = now;
        const line = idleLines[Math.floor(Math.random() * idleLines.length)];
        say(line, "sleepy", "sleepy");
      }
      if (now - lastWanderAt > 14000 && now - lastInteractionAt > 8000) {
        lastWanderAt = now;
        const dx = Math.round((Math.random() - 0.5) * 80);
        const dy = Math.round((Math.random() - 0.5) * 36);
        void window.electronAPI?.autonomyDesktopPetStep?.({ dx, dy });
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
    stage.addEventListener("click", () => { markInteraction(); showUi(); say(randomLine()); });
    play.addEventListener("click", () => { markInteraction(); say("Wheee.", "happy", "excited"); });
    close.addEventListener("click", () => window.electronAPI?.hideDesktopPet?.());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markInteraction();
      const text = input.value.trim();
      if (!text) return say(randomLine());
      input.value = "";
      showUi();
      say("...");
      try {
        const result = await window.electronAPI?.sendDesktopPetMessage?.(text);
        const parsed = parsePetTool(result?.reply || "");
        say(parsed.message || "...", parsed.action, parsed.emotion);
      } catch (error) {
        say(clean(error?.message || error, 160) || "LLM is unavailable.");
      }
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
  desktopPetConfig = sanitizeDesktopPetConfig(config);
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    placeDesktopPetWindow(desktopPetWindow, desktopPetConfig);
    await desktopPetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(desktopPetConfig))}`);
    desktopPetWindow.showInactive();
    desktopPetWindow.setAlwaysOnTop(true, "floating");
    return desktopPetWindow;
  }

  const { width, height } = desktopPetWindowSize(desktopPetConfig);
  desktopPetWindow = new BrowserWindow({
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
  desktopPetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  desktopPetWindow.setAlwaysOnTop(true, "floating");
  desktopPetWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  desktopPetWindow.on("closed", () => {
    desktopPetWindow = null;
  });
  placeDesktopPetWindow(desktopPetWindow, desktopPetConfig);
  await desktopPetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(desktopPetConfig))}`);
  desktopPetWindow.showInactive();
  return desktopPetWindow;
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
  await ensureDesktopPetWindow(rawConfig);
  return { ok: true, visible: Boolean(desktopPetWindow && !desktopPetWindow.isDestroyed() && desktopPetWindow.isVisible()) };
});

ipcMain.handle("desktop-pet:hide", () => {
  desktopPetWindow?.hide();
  return { ok: true, visible: false };
});

ipcMain.handle("desktop-pet:toggle", async (_event, rawConfig: unknown) => {
  if (desktopPetWindow && !desktopPetWindow.isDestroyed() && desktopPetWindow.isVisible()) {
    desktopPetWindow.hide();
    return { ok: true, visible: false };
  }
  await ensureDesktopPetWindow(rawConfig);
  return { ok: true, visible: Boolean(desktopPetWindow && !desktopPetWindow.isDestroyed() && desktopPetWindow.isVisible()) };
});

ipcMain.handle("desktop-pet:configure", async (_event, rawConfig: unknown) => {
  const shouldShow = Boolean(desktopPetWindow && !desktopPetWindow.isDestroyed() && desktopPetWindow.isVisible());
  desktopPetConfig = sanitizeDesktopPetConfig(rawConfig);
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    placeDesktopPetWindow(desktopPetWindow, desktopPetConfig);
    void desktopPetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDesktopPetHtml(desktopPetConfig))}`);
    if (shouldShow) desktopPetWindow.showInactive();
  }
  return { ok: true, visible: shouldShow };
});

ipcMain.handle("desktop-pet:isVisible", () => {
  return Boolean(desktopPetWindow && !desktopPetWindow.isDestroyed() && desktopPetWindow.isVisible());
});

ipcMain.handle("desktop-pet:drag-start", (event, point: { screenX?: unknown; screenY?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== desktopPetWindow) return { ok: false };
  desktopPetDragState.set(event.sender.id, {
    startX: Number(point?.screenX) || 0,
    startY: Number(point?.screenY) || 0,
    bounds: target.getBounds()
  });
  return { ok: true };
});

ipcMain.handle("desktop-pet:drag-move", (event, point: { screenX?: unknown; screenY?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  const drag = desktopPetDragState.get(event.sender.id);
  if (!target || target !== desktopPetWindow || !drag) return { ok: false };
  const nextX = drag.bounds.x + Math.round((Number(point?.screenX) || 0) - drag.startX);
  const nextY = drag.bounds.y + Math.round((Number(point?.screenY) || 0) - drag.startY);
  target.setPosition(nextX, nextY, false);
  const bounds = target.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const compact = desktopPetWindowSize(desktopPetConfig, false);
  const placement = resolveDesktopPetUiPlacement(bounds, display.workArea, compact.height);
  if (placement !== desktopPetUiPlacement && bounds.height > compact.height + 24) {
    const current = target.getBounds();
    const delta = desktopPetWindowSize(desktopPetConfig, true).height - compact.height;
    const preferredY = placement === "below" ? current.y + delta : current.y - delta;
    const area = display.workArea;
    const adjustedY = Math.max(area.y, Math.min(area.y + area.height - current.height, preferredY));
    target.setPosition(current.x, adjustedY, false);
    drag.bounds = { ...drag.bounds, y: drag.bounds.y + (adjustedY - current.y) };
  }
  desktopPetUiPlacement = placement;
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:ui-expanded", (event, expanded: unknown) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== desktopPetWindow) return { ok: false };
  const placement = resizeDesktopPetWindowForUi(Boolean(expanded));
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:autonomy-step", (event, delta: { dx?: unknown; dy?: unknown }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== desktopPetWindow) return { ok: false };
  const bounds = target.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const dx = Math.max(-48, Math.min(48, Math.round(Number(delta?.dx) || 0)));
  const dy = Math.max(-28, Math.min(28, Math.round(Number(delta?.dy) || 0)));
  const nextX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + dx));
  const nextY = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y + dy));
  target.setPosition(nextX, nextY, false);
  const compact = desktopPetWindowSize(desktopPetConfig, false);
  const placement = resolveDesktopPetUiPlacement(target.getBounds(), area, compact.height);
  desktopPetUiPlacement = placement;
  return { ok: true, placement };
});

ipcMain.handle("desktop-pet:message", async (_event, message: unknown) => {
  try {
    return await sendDesktopPetMessageToLlm(String(message || ""));
  } catch (error) {
    return {
      ok: false,
      reply: error instanceof Error ? error.message : "Desktop pet LLM request failed"
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
