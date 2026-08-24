import { copyFile, chmod, mkdir } from "fs/promises";
import path from "path";
import { t as listTar, x as extractTar } from "tar";

export interface TarLinkEntry {
  path: string;
  linkpath: string;
  kind?: "symbolic" | "hard";
  mode?: number;
}

function normalizeArchivePath(value: string) {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""));
  if (!normalized || normalized === "." || path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe archive path: ${value}`);
  }
  return normalized;
}

function destinationPath(root: string, archivePath: string) {
  const normalized = normalizeArchivePath(archivePath);
  const destination = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(path.resolve(root), destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe archive path: ${archivePath}`);
  return destination;
}

export function resolveMaterializedTarLinks(links: TarLinkEntry[]) {
  const byPath = new Map(links.map((entry) => [normalizeArchivePath(entry.path), entry]));
  return links.map((entry) => {
    const alias = normalizeArchivePath(entry.path);
    let target = entry.kind === "hard"
      ? normalizeArchivePath(entry.linkpath)
      : normalizeArchivePath(path.posix.join(path.posix.dirname(alias), entry.linkpath));
    const visited = new Set([alias]);
    while (byPath.has(target)) {
      if (visited.has(target)) throw new Error(`Cyclic archive link: ${alias}`);
      visited.add(target);
      const next = byPath.get(target)!;
      target = next.kind === "hard"
        ? normalizeArchivePath(next.linkpath)
        : normalizeArchivePath(path.posix.join(path.posix.dirname(target), next.linkpath));
    }
    return { alias, target, mode: entry.mode };
  });
}

/**
 * Extract a tarball without creating links on the user's filesystem.
 * Upstream inference archives commonly contain SONAME symlink chains. They
 * fail on filesystems without symlink support and can trip archive path guards,
 * so Vellium materializes each safe in-archive link as a regular file instead.
 */
export async function extractTarPortable(file: string, cwd: string) {
  const links: TarLinkEntry[] = [];
  await listTar({
    file,
    strict: true,
    onentry: (entry) => {
      if (entry.type === "SymbolicLink" || entry.type === "Link") {
        if (!entry.linkpath) throw new Error(`Archive link has no target: ${entry.path}`);
        links.push({
          path: entry.path,
          linkpath: entry.linkpath,
          kind: entry.type === "Link" ? "hard" : "symbolic",
          mode: entry.mode
        });
      }
    }
  });

  await mkdir(cwd, { recursive: true });
  await extractTar({
    file,
    cwd,
    strict: true,
    preservePaths: false,
    filter: (_entryPath, entry) => !("type" in entry)
      || (entry.type !== "SymbolicLink" && entry.type !== "Link")
  });

  for (const link of resolveMaterializedTarLinks(links)) {
    const source = destinationPath(cwd, link.target);
    const destination = destinationPath(cwd, link.alias);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    if (process.platform !== "win32" && typeof link.mode === "number") {
      await chmod(destination, link.mode & 0o777);
    }
  }
}
