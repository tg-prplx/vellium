import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type CipherGCM, type ScryptOptions } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, open, rm, stat, type FileHandle } from "fs/promises";
import { dirname, isAbsolute, relative, resolve } from "path";
import { Readable, Transform, Writable } from "stream";
import { pipeline } from "stream/promises";
import { createGunzip, createGzip } from "zlib";

/**
 * Vellium backup container (.vbak):
 *
 *   "VELLIUM-BACKUP 1\n" + <header JSON>\n + body [+ 16-byte GCM tag]
 *
 * body = gzip(records); with a password it is additionally AES-256-GCM encrypted
 * with a scrypt-derived key and the header bytes as AAD. A record is
 * u32be(header length) + JSON {path, size} + `size` raw bytes; a final
 * {end: true} record marks a complete archive.
 */
const MAGIC = "VELLIUM-BACKUP 1\n";
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_RECORD_HEADER_BYTES = 16 * 1024;
const MAX_SPECIAL_ENTRY_BYTES = 4096;
const MAX_TOTAL_BYTES = 64 * 1024 ** 3;
const GCM_TAG_BYTES = 16;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const VERIFIER_PLAINTEXT = Buffer.from("vellium-backup-verifier", "utf8");
export const SPECIAL_ENTRY_PREFIX = "__vellium__/";

export interface BackupMetadata {
  createdAt: string;
  appVersion: string;
  profileName: string;
  includesMasterKey: boolean;
}

export interface BackupHeader extends BackupMetadata {
  format: "vellium-backup";
  version: 1;
  encrypted: boolean;
  kdf?: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  iv?: string;
  verifier?: { iv: string; tag: string; data: string };
}

export interface BackupSourceFile { archivePath: string; sourcePath: string }
export interface BackupInlineEntry { archivePath: string; data: Buffer }

export class BackupPasswordError extends Error {
  constructor(message = "Wrong backup password") { super(message); this.name = "BackupPasswordError"; }
}
export class BackupFormatError extends Error {
  constructor(message: string) { super(message); this.name = "BackupFormatError"; }
}

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM };
  return new Promise((resolvePromise, reject) => {
    scryptCallback(password.normalize("NFC"), salt, 32, options, (error, key) => (error ? reject(error) : resolvePromise(key)));
  });
}

/** Archive paths are relative POSIX paths without traversal, drive letters or control characters. */
export function normalizeArchivePath(raw: unknown): string | null {
  const value = String(raw ?? "");
  if (!value || value.length > 1024 || value.includes("\\") || value.startsWith("/") || /[\u0000-\u001f\u007f]/.test(value) || /^[a-z]:/i.test(value)) {
    return null;
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function recordHeader(payload: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json]);
}

async function* recordStream(files: BackupSourceFile[], inline: BackupInlineEntry[]) {
  let count = 0;
  for (const entry of inline) {
    yield recordHeader({ path: entry.archivePath, size: entry.data.length });
    yield entry.data;
    count += 1;
  }
  for (const file of files) {
    const info = await stat(file.sourcePath).catch(() => null);
    if (!info?.isFile()) continue;
    yield recordHeader({ path: file.archivePath, size: info.size });
    let written = 0;
    for await (const chunk of createReadStream(file.sourcePath, { end: Math.max(0, info.size - 1) })) {
      if (info.size === 0) break;
      const buffer = chunk as Buffer;
      const remaining = info.size - written;
      // A file that grows while being archived is cut at the size recorded in its header.
      const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      written += slice.length;
      yield slice;
      if (written >= info.size) break;
    }
    if (written < info.size) throw new Error(`File changed while archiving: ${file.archivePath}`);
    count += 1;
  }
  yield recordHeader({ end: true, files: count });
}

export async function writeBackupArchive(params: {
  outputPath: string;
  metadata: BackupMetadata;
  files: BackupSourceFile[];
  inline?: BackupInlineEntry[];
  password?: string;
}): Promise<{ bytes: number }> {
  const password = params.password || "";
  const header: BackupHeader = { format: "vellium-backup", version: 1, encrypted: Boolean(password), ...params.metadata };
  let key: Buffer | null = null;
  if (password) {
    const salt = randomBytes(16);
    key = await scrypt(password, salt, SCRYPT);
    const verifierIv = randomBytes(12);
    const verifier = createCipheriv("aes-256-gcm", key, verifierIv);
    const verifierData = Buffer.concat([verifier.update(VERIFIER_PLAINTEXT), verifier.final()]);
    header.kdf = { name: "scrypt", salt: salt.toString("base64"), ...SCRYPT };
    header.iv = randomBytes(12).toString("base64");
    header.verifier = { iv: verifierIv.toString("base64"), tag: verifier.getAuthTag().toString("base64"), data: verifierData.toString("base64") };
  }
  const headerLine = `${JSON.stringify(header)}\n`;
  await mkdir(dirname(params.outputPath), { recursive: true });
  const stages: Array<NodeJS.ReadWriteStream> = [createGzip({ level: 6 })];
  let cipher: CipherGCM | null = null;
  if (key && header.iv) {
    cipher = createCipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64")) as CipherGCM;
    cipher.setAAD(Buffer.from(MAGIC + headerLine, "utf8"));
    stages.push(cipher);
  }
  // Frames the body: header first, GCM tag last (available only after the cipher has flushed).
  let started = false;
  const framing = new Transform({
    transform(chunk, _encoding, callback) {
      if (!started) { started = true; this.push(MAGIC + headerLine); }
      callback(null, chunk);
    },
    flush(callback) {
      if (!started) this.push(MAGIC + headerLine);
      if (cipher) this.push(cipher.getAuthTag());
      callback();
    }
  });
  try {
    await pipeline(
      Readable.from(recordStream(params.files, params.inline || [])),
      ...(stages as [NodeJS.ReadWriteStream]),
      framing,
      createWriteStream(params.outputPath, { flags: "wx", mode: 0o600 })
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await rm(params.outputPath, { force: true });
    throw error;
  }
  return { bytes: (await stat(params.outputPath)).size };
}

async function readHeaderBlock(path: string): Promise<{ header: BackupHeader; headerText: string; bodyStart: number; size: number }> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, MAGIC.length + MAX_HEADER_BYTES));
    await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.toString("utf8");
    if (!text.startsWith(MAGIC)) throw new BackupFormatError("Not a Vellium backup file");
    const end = text.indexOf("\n", MAGIC.length);
    if (end < 0) throw new BackupFormatError("Backup header is too large or truncated");
    const headerText = text.slice(0, end + 1);
    const header = JSON.parse(text.slice(MAGIC.length, end)) as BackupHeader;
    if (header.format !== "vellium-backup" || header.version !== 1) throw new BackupFormatError("Unsupported backup version");
    return { header, headerText, bodyStart: Buffer.byteLength(headerText, "utf8"), size };
  } catch (error) {
    if (error instanceof BackupFormatError) throw error;
    throw new BackupFormatError("Backup header is corrupt");
  } finally {
    await handle.close();
  }
}

export async function readBackupHeader(path: string): Promise<BackupHeader> {
  return (await readHeaderBlock(path)).header;
}

async function deriveRestoreKey(header: BackupHeader, password: string): Promise<Buffer> {
  if (!password) throw new BackupPasswordError("This backup is password protected");
  if (!header.kdf || !header.iv || !header.verifier || header.kdf.name !== "scrypt") throw new BackupFormatError("Backup encryption header is incomplete");
  const { N, r, p } = header.kdf;
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20 || r > 32 || p > 16) throw new BackupFormatError("Backup key derivation parameters are out of range");
  const key = await scrypt(password, Buffer.from(header.kdf.salt, "base64"), { N, r, p });
  try {
    const verifier = createDecipheriv("aes-256-gcm", key, Buffer.from(header.verifier.iv, "base64"));
    verifier.setAuthTag(Buffer.from(header.verifier.tag, "base64"));
    const plain = Buffer.concat([verifier.update(Buffer.from(header.verifier.data, "base64")), verifier.final()]);
    if (!plain.equals(VERIFIER_PLAINTEXT)) throw new Error("verifier mismatch");
  } catch {
    throw new BackupPasswordError();
  }
  return key;
}

/** Parses the record stream, writing files under `destinationDir` and capturing special entries in memory. */
class RecordExtractor extends Writable {
  private buffer: Buffer = Buffer.alloc(0);
  private current: { path: string; remaining: number; handle: FileHandle | null; special: Buffer[] | null } | null = null;
  private totalBytes = 0;
  ended = false;
  files = 0;
  readonly special = new Map<string, Buffer>();

  constructor(private readonly destinationDir: string) { super(); }

  override async _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    try {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      await this.drain();
      callback();
    } catch (error) {
      await this.current?.handle?.close().catch(() => undefined);
      callback(error as Error);
    }
  }

  override _final(callback: (error?: Error | null) => void) {
    callback(this.ended && !this.current && this.buffer.length === 0 ? null : new BackupFormatError("Backup archive is truncated"));
  }

  private async drain() {
    while (this.buffer.length > 0) {
      if (this.ended) throw new BackupFormatError("Unexpected data after the end of the backup");
      if (this.current) {
        const take = Math.min(this.current.remaining, this.buffer.length);
        const piece = this.buffer.subarray(0, take);
        this.buffer = this.buffer.subarray(take);
        if (this.current.special) this.current.special.push(Buffer.from(piece));
        else if (take > 0) await this.current.handle?.write(piece);
        this.current.remaining -= take;
        if (this.current.remaining === 0) await this.finishEntry();
        continue;
      }
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_RECORD_HEADER_BYTES) throw new BackupFormatError("Backup record header is invalid");
      if (this.buffer.length < 4 + length) return;
      let record: { path?: unknown; size?: unknown; end?: unknown; files?: unknown };
      try { record = JSON.parse(this.buffer.subarray(4, 4 + length).toString("utf8")); } catch { throw new BackupFormatError("Backup record header is corrupt"); }
      this.buffer = this.buffer.subarray(4 + length);
      if (record.end === true) {
        if (record.files !== this.files) throw new BackupFormatError("Backup file count does not match");
        this.ended = true;
        continue;
      }
      await this.startEntry(record);
    }
  }

  private async startEntry(record: { path?: unknown; size?: unknown }) {
    const archivePath = normalizeArchivePath(record.path);
    const size = Number(record.size);
    if (!archivePath || !Number.isSafeInteger(size) || size < 0) throw new BackupFormatError("Backup entry is invalid");
    this.totalBytes += size;
    if (this.totalBytes > MAX_TOTAL_BYTES) throw new BackupFormatError("Backup is larger than the supported limit");
    if (archivePath.startsWith(SPECIAL_ENTRY_PREFIX)) {
      if (size > MAX_SPECIAL_ENTRY_BYTES) throw new BackupFormatError("Backup metadata entry is too large");
      this.current = { path: archivePath, remaining: size, handle: null, special: [] };
    } else {
      const target = resolve(this.destinationDir, archivePath);
      const rel = relative(this.destinationDir, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new BackupFormatError("Backup entry escapes the destination");
      await mkdir(dirname(target), { recursive: true });
      this.current = { path: archivePath, remaining: size, handle: await open(target, "wx"), special: null };
    }
    if (size === 0) await this.finishEntry();
  }

  private async finishEntry() {
    const entry = this.current;
    this.current = null;
    if (!entry) return;
    if (entry.special) this.special.set(entry.path, Buffer.concat(entry.special));
    await entry.handle?.close();
    this.files += 1;
  }
}

/**
 * Extracts into `destinationDir` (which must be a fresh staging directory). Callers
 * must discard the directory when this throws: entries are written before the GCM
 * tag is checked at the end of the stream.
 */
export async function extractBackupArchive(params: { inputPath: string; destinationDir: string; password?: string }): Promise<{ header: BackupHeader; files: number; special: Map<string, Buffer> }> {
  const { header, headerText, bodyStart, size } = await readHeaderBlock(params.inputPath);
  await mkdir(params.destinationDir, { recursive: true });
  const extractor = new RecordExtractor(resolve(params.destinationDir));
  const stages: NodeJS.ReadWriteStream[] = [];
  let bodyEnd = size - 1;
  if (header.encrypted) {
    const key = await deriveRestoreKey(header, params.password || "");
    if (size - bodyStart < GCM_TAG_BYTES) throw new BackupFormatError("Backup archive is truncated");
    const handle = await open(params.inputPath, "r");
    const tag = Buffer.alloc(GCM_TAG_BYTES);
    try { await handle.read(tag, 0, GCM_TAG_BYTES, size - GCM_TAG_BYTES); } finally { await handle.close(); }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(header.iv), "base64"));
    decipher.setAAD(Buffer.from(headerText, "utf8"));
    decipher.setAuthTag(tag);
    stages.push(decipher);
    bodyEnd = size - GCM_TAG_BYTES - 1;
  }
  stages.push(createGunzip());
  try {
    await pipeline(createReadStream(params.inputPath, { start: bodyStart, end: bodyEnd }), ...stages as [NodeJS.ReadWriteStream], extractor);
  } catch (error) {
    if (error instanceof BackupFormatError || error instanceof BackupPasswordError) throw error;
    throw new BackupFormatError(header.encrypted ? "Backup is corrupt or was modified" : "Backup archive is corrupt");
  }
  return { header, files: extractor.files, special: extractor.special };
}
