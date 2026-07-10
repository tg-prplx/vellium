import type { BrowserWindow } from "electron";

export type DesktopPetConfig = {
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

export type DesktopPetTheme = {
  mode: "dark" | "light";
  variables: Record<string, string>;
};

export type DesktopPetChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: DesktopPetChatAttachment[];
};

export type DesktopPetChatAttachment = {
  type: "image";
  dataUrl: string;
  mimeType: string;
  filename: string;
  createdAt: number;
};

export type DesktopPetChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: DesktopPetChatMessage[];
};

export type DesktopPetRuntimeState = {
  persistentMemory: string;
  profileMemory: string;
  defaultChatId: string;
  chats: DesktopPetChat[];
};

export type DesktopPetStore = {
  pets: Record<string, DesktopPetRuntimeState>;
};

export type DesktopPetScreenContext = {
  dataUrl: string;
  width: number;
  height: number;
};

export type DesktopPetInstance = {
  key: string;
  window: BrowserWindow;
  config: DesktopPetConfig;
  uiPlacement: DesktopPetUiPlacement;
};

export type DesktopPetAnimation = "none" | "idle" | "hop" | "pop" | "sway" | "spin" | "shake" | "bounce";
export type DesktopPetUiPlacement = "above" | "below";
export type DesktopPetCodexState = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

export type DesktopPetStatePreset = {
  id: string;
  label: string;
  animation: DesktopPetAnimation;
  codexState: DesktopPetCodexState;
  assetUrl: string;
  soundUrl: string;
};
