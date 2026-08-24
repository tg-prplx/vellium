import { useCallback, useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { InochiAvatarStatus } from "../../shared/types/inochiAvatar";

const EMPTY_STATUS: InochiAvatarStatus = {
  runtime: {
    available: true,
    version: "Inochi2D SDK WebAssembly",
    wasmUrl: "/api/inochi-avatars/runtime.wasm?v=inochi2d-sdk-f4b4917a"
  },
  avatar: null
};

export function useInochiAvatar(characterId: string, onError: (message: string) => void) {
  const [status, setStatus] = useState<InochiAvatarStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    if (!characterId) {
      setStatus(EMPTY_STATUS);
      return;
    }
    setLoading(true);
    try {
      setStatus(await api.getInochiAvatar(characterId));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [characterId, onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const uploadModel = async (file: File) => {
    if (!characterId || uploading) return;
    if (!/\.(inp|inx)$/i.test(file.name)) {
      onError("Choose an Inochi2D .inp or .inx model");
      return;
    }
    setUploading(true);
    onError("");
    try {
      setStatus(await api.uploadInochiModel(characterId, file));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const removeModel = async () => {
    if (!characterId || uploading) return;
    setUploading(true);
    onError("");
    try {
      setStatus(await api.deleteInochiAvatar(characterId));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  return { status, loading, uploading, uploadModel, removeModel, refresh };
}
