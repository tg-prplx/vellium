export type DataRestartMode = "relaunch" | "manual";

export interface DataProfile {
  id: string;
  name: string;
  createdAt: string;
  /** The profile the current process runs on. */
  running: boolean;
  /** The profile that will be used on the next start. */
  selected: boolean;
  databaseBytes: number | null;
}

export interface DataProfilesState {
  profiles: DataProfile[];
  running: string;
  selected: string;
  restartMode: DataRestartMode;
}

export interface DataProfileSelection {
  selected: string;
  restartRequired: boolean;
  restartMode: DataRestartMode;
}

export interface DataBackup {
  file: string;
  bytes: number;
  createdAt: string;
  profileName: string;
  appVersion: string;
  encrypted: boolean;
  includesMasterKey: boolean;
}
