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
  sendDesktopPetMessage: (message: string) => Promise<{ ok: boolean; reply: string; chatId?: string }>;
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
