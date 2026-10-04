import { isAbsolute, relative, resolve } from "path";

const STORED_AVATAR_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Resolves a stored avatar filename to a file inside the avatars directory, or
 * null when the stored value is remote, malformed, or would escape the directory.
 */
export function resolveStoredAvatarFile(avatarsDir: string, storedPath: unknown): string | null {
  const value = typeof storedPath === "string" ? storedPath.trim() : "";
  if (!value || !STORED_AVATAR_FILENAME.test(value)) return null;
  const root = resolve(avatarsDir);
  const candidate = resolve(root, value);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}
