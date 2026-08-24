import type { InochiAvatarStatus } from "../types/inochiAvatar";
import { del, get, post, uploadBinary } from "./core";

export const liveClient = {
  liveTranscribe: (
    audioBase64: string,
    mimeType: string,
    filename: string,
    signal?: AbortSignal
  ) => post<{ text: string }>(
    "/live/transcribe",
    { audioBase64, mimeType, filename },
    { signal }
  ),
  getInochiAvatar: (characterId: string) =>
    get<InochiAvatarStatus>(`/inochi-avatars/character/${encodeURIComponent(characterId)}`),
  uploadInochiModel: (characterId: string, file: File, signal?: AbortSignal) =>
    uploadBinary<InochiAvatarStatus>(
      `/inochi-avatars/character/${encodeURIComponent(characterId)}/model?filename=${encodeURIComponent(file.name)}`,
      file,
      "application/octet-stream",
      { signal }
    ),
  deleteInochiAvatar: (characterId: string) =>
    del<InochiAvatarStatus>(`/inochi-avatars/character/${encodeURIComponent(characterId)}`)
};
