import type { DataBackup, DataProfile, DataProfileSelection, DataProfilesState } from "../types/dataProfiles";
import { del, get, patchReq, post, uploadBinary } from "./core";

const LONG_RUNNING_REQUEST_OPTIONS = { timeoutMs: 0 };
const encode = encodeURIComponent;

export const dataClient = {
  dataProfilesList: () => get<DataProfilesState>("/data/profiles"),
  dataProfileCreate: (name: string) => post<DataProfile>("/data/profiles", { name }),
  dataProfileRename: (id: string, name: string) => patchReq<DataProfile>(`/data/profiles/${encode(id)}`, { name }),
  dataProfileDelete: (id: string) => del<{ ok: boolean }>(`/data/profiles/${encode(id)}`),
  dataProfileSelect: (id: string) => post<DataProfileSelection>(`/data/profiles/${encode(id)}/select`),
  dataBackupsList: () => get<DataBackup[]>("/data/backups"),
  dataBackupCreate: (options: { profileId?: string; password?: string }) => post<DataBackup>("/data/backups", options, LONG_RUNNING_REQUEST_OPTIONS),
  dataBackupDelete: (file: string) => del<{ ok: boolean }>(`/data/backups/${encode(file)}`),
  dataBackupRestore: (file: string, options: { password?: string; name?: string }) =>
    post<DataProfile>(`/data/backups/${encode(file)}/restore`, options, LONG_RUNNING_REQUEST_OPTIONS),
  dataBackupUpload: (file: Blob) => uploadBinary<DataBackup>("/data/backups/upload", file, "application/octet-stream", LONG_RUNNING_REQUEST_OPTIONS),
  dataBackupDownloadUrl: (file: string) => `/api/data/backups/${encode(file)}/download`
};
