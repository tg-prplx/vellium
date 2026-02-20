export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getPlatform: () => Promise<string>;
  saveFile: (filename: string, base64Data: string) => Promise<{ ok: boolean; canceled: boolean; filePath?: string }>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
