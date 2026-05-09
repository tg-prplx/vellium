import type { ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState } from "./shared/types/contracts";

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getPlatform: () => Promise<string>;
  saveFile: (filename: string, base64Data: string) => Promise<{ ok: boolean; canceled: boolean; filePath?: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  showDesktopPet: (config?: unknown) => Promise<{ ok: boolean; visible: boolean }>;
  hideDesktopPet: () => Promise<{ ok: boolean; visible: boolean }>;
  toggleDesktopPet: (config?: unknown) => Promise<{ ok: boolean; visible: boolean }>;
  configureDesktopPet: (config?: unknown) => Promise<{ ok: boolean; visible: boolean }>;
  isDesktopPetVisible: () => Promise<boolean>;
  startDesktopPetDrag: (point: { screenX: number; screenY: number }) => Promise<{ ok: boolean }>;
  moveDesktopPetDrag: (point: { screenX: number; screenY: number }) => Promise<{ ok: boolean; placement?: "above" | "below" }>;
  resizeDesktopPetUi: (expanded: boolean) => Promise<{ ok: boolean; placement?: "above" | "below" }>;
  autonomyDesktopPetStep: (delta: { dx: number; dy: number }) => Promise<{ ok: boolean; placement?: "above" | "below" }>;
  listDesktopPetChats: () => Promise<{ ok: boolean; activeChatId: string; persistentMemory: string; chats: Array<{ id: string; title: string; updatedAt: number; count: number }> }>;
  createDesktopPetChat: (title?: string) => Promise<{ ok: boolean; activeChatId: string; chats: Array<{ id: string; title: string; updatedAt: number; count: number }> }>;
  selectDesktopPetChat: (chatId: string) => Promise<{ ok: boolean; activeChatId: string; chats: Array<{ id: string; title: string; updatedAt: number; count: number }> }>;
  sendDesktopPetMessage: (message: string, screenContext?: { dataUrl: string; width?: number; height?: number }) => Promise<{ ok: boolean; reply: string; chatId?: string }>;
  captureDesktopPetScreenContext: () => Promise<{ ok: boolean; dataUrl?: string; width?: number; height?: number; error?: string }>;
  speakDesktopPetText: (text: string) => Promise<{ ok: boolean; contentType?: string; base64?: string; error?: string }>;
  onDesktopPetPeerNear: (callback: (payload: { name?: string }) => void) => () => void;
  listManagedBackends: () => Promise<ManagedBackendRuntimeState[]>;
  startManagedBackend: (config: ManagedBackendConfig) => Promise<ManagedBackendRuntimeState>;
  stopManagedBackend: (backendId: string) => Promise<ManagedBackendRuntimeState | null>;
  stopActiveManagedBackend: () => Promise<{ ok: boolean }>;
  getManagedBackendLogs: (backendId: string) => Promise<ManagedBackendLogEntry[]>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => void;
  onManagedBackendsUpdate: (callback: (states: ManagedBackendRuntimeState[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
