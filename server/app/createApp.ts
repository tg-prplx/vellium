import cors from "cors";
import { timingSafeEqual } from "crypto";
import express from "express";
import { existsSync, writeFileSync } from "fs";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR, DEFAULT_SETTINGS, UPLOADS_DIR, db, newId } from "../db.js";
import accountRoutes from "../routes/account.js";
import agentRoutes from "../routes/agents.js";
import characterRoutes from "../routes/characters.js";
import chatRoutes from "../routes/chats.js";
import lorebookRoutes from "../routes/lorebooks.js";
import messageRoutes from "../routes/messages.js";
import personaRoutes from "../routes/personas.js";
import pluginRoutes from "../routes/plugins.js";
import pluginRuntimeRoutes from "../routes/pluginRuntime.js";
import providerRoutes from "../routes/providers.js";
import extensionRoutes from "../routes/extensions.js";
import ragRoutes from "../routes/rag.js";
import rpRoutes from "../routes/rp.js";
import settingsRoutes from "../routes/settings.js";
import writerRoutes from "../routes/writer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INLINE_ATTACHMENT_TEXT_LIMIT = 240_000;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const SAFE_UPLOAD_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp",
  "txt", "md", "json", "csv", "log",
  "yaml", "yml", "toml", "ini", "cfg",
  "pdf", "docx", "py", "rb", "ts"
]);
const UNSAFE_UPLOAD_EXTENSIONS = new Set(["svg", "html", "htm", "xml", "js", "mjs", "css", "xhtml"]);

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    return isLocalHost && isHttp;
  } catch {
    return false;
  }
}

function isHeadlessPublicModeEnabled() {
  return process.env.SLV_SERVER_PUBLIC === "1";
}

function resolveRequestOrigin(req: express.Request): string | null {
  const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
    ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
    : null;
  const forwardedHost = typeof req.headers["x-forwarded-host"] === "string"
    ? req.headers["x-forwarded-host"].split(",")[0]?.trim()
    : null;
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.headers.host;
  if (!host) return null;
  return `${protocol}://${host}`;
}

function isAllowedRequestOrigin(req: express.Request, origin: string | undefined): boolean {
  if (!origin) return true;
  if (isAllowedLocalOrigin(origin)) return true;
  if (!isHeadlessPublicModeEnabled()) return false;
  try {
    const requestOrigin = resolveRequestOrigin(req);
    if (!requestOrigin) return false;
    return new URL(origin).origin === new URL(requestOrigin).origin;
  } catch {
    return false;
  }
}

function buildContentSecurityPolicy() {
  const connectSrc = isHeadlessPublicModeEnabled()
    ? "'self'"
    : "'self' http://127.0.0.1:3001 http://localhost:3001";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; ");
}

function resolveBasicAuthSecret() {
  const raw = String(process.env.SLV_BASIC_AUTH || "").trim();
  if (!raw || !raw.includes(":")) return null;
  return raw;
}

function isAuthorizedByBasicAuth(req: express.Request): boolean {
  const secret = resolveBasicAuthSecret();
  if (!secret) return true;
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;
  try {
    const provided = Buffer.from(header.slice(6), "base64").toString("utf8");
    const expectedBuffer = Buffer.from(secret, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

function sanitizeFilename(name: string, fallback = "file.bin"): string {
  const trimmed = String(name || "").trim();
  const normalized = trimmed.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function decodeBase64Payload(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) {
    throw new Error("Missing base64 payload");
  }
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(normalized)) {
    throw new Error("Invalid base64 payload");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length) {
    throw new Error("Decoded file is empty");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit`);
  }
  return buffer;
}

function getSecuritySettings() {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const payload = row ? JSON.parse(row.payload) as { security?: Record<string, unknown> } : {};
    return {
      ...DEFAULT_SETTINGS.security,
      ...(payload.security ?? {})
    };
  } catch {
    return { ...DEFAULT_SETTINGS.security };
  }
}

function assertUploadExtensionAllowed(ext: string) {
  const security = getSecuritySettings();
  if (SAFE_UPLOAD_EXTENSIONS.has(ext)) return;
  if (UNSAFE_UPLOAD_EXTENSIONS.has(ext) && security.allowUnsafeUploads === true) return;
  throw new Error(`Uploads for .${ext} are blocked by security policy`);
}

function setUploadResponseHeaders(res: express.Response, filePath: string) {
  const ext = extname(filePath).replace(/^\./, "").toLowerCase();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  if (UNSAFE_UPLOAD_EXTENSIONS.has(ext)) {
    const safeName = sanitizeFilename(filePath.split("/").pop() || filePath, "download.bin");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.type("application/octet-stream");
  }
}

function mimeByExtension(extRaw: string): string {
  const ext = extRaw.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    log: "text/plain",
    xml: "application/xml",
    html: "text/html",
    js: "text/javascript",
    ts: "text/plain",
    py: "text/plain",
    rb: "text/plain",
    yaml: "text/yaml",
    yml: "text/yaml",
    toml: "application/toml",
    ini: "text/plain",
    cfg: "text/plain",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  return map[ext] || "application/octet-stream";
}

function isPluginFrameRoute(pathname: string): boolean {
  return pathname === "/api/plugins/sdk.js" || /^\/api\/plugins\/[^/]+\/assets\//.test(pathname);
}

function normalizeExtractedText(raw: string): string {
  return String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractAttachmentText(buffer: Buffer, ext: string): Promise<string> {
  if (/^(txt|md|json|csv|log|xml|html|js|ts|py|rb|yaml|yml|toml|ini|cfg)$/i.test(ext)) {
    return normalizeExtractedText(buffer.toString("utf-8")).slice(0, INLINE_ATTACHMENT_TEXT_LIMIT);
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeExtractedText(String(result.value || "")).slice(0, INLINE_ATTACHMENT_TEXT_LIMIT);
  }
  if (ext === "pdf") {
    const parsed = await pdfParse(buffer);
    return normalizeExtractedText(String(parsed.text || "")).slice(0, INLINE_ATTACHMENT_TEXT_LIMIT);
  }
  return "";
}

function registerUploadRoute(app: express.Express) {
  app.post("/api/upload", async (req, res) => {
    const { base64Data, filename } = req.body;
    if (!base64Data || !filename) {
      res.status(400).json({ error: "base64Data and filename required" });
      return;
    }
    const safeFilename = sanitizeFilename(String(filename || "upload.bin"), "upload.bin");
    const ext = (safeFilename.split(".").pop() || "bin").toLowerCase();
    try {
      assertUploadExtensionAllowed(ext);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Upload blocked" });
      return;
    }
    const id = newId();
    const storedName = `${id}.${ext}`;
    let buffer: Buffer;
    try {
      buffer = decodeBase64Payload(base64Data);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid upload payload" });
      return;
    }
    writeFileSync(join(UPLOADS_DIR, storedName), buffer);

    const isImage = /^(jpg|jpeg|png|gif|webp|bmp)$/i.test(ext);
    const isTextLike = /^(txt|md|json|csv|log|xml|html|js|ts|py|rb|yaml|yml|toml|ini|cfg|pdf|docx)$/i.test(ext);

    let content: string | undefined;
    if (isTextLike) {
      try {
        const extracted = await extractAttachmentText(buffer, ext);
        if (extracted) {
          content = extracted;
        }
      } catch (error) {
        console.warn(`[upload] Failed to extract text from .${ext} attachment:`, error);
      }
    }

    res.json({
      id,
      filename: safeFilename,
      type: isImage ? "image" : "text",
      url: `/api/uploads/${storedName}`,
      mimeType: mimeByExtension(ext),
      content
    });
  });
}

function registerRoutes(app: express.Express) {
  app.use("/api/agents", agentRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/plugins", pluginRoutes);
  app.use("/api/plugin-runtime", pluginRuntimeRoutes);
  app.use("/api/providers", providerRoutes);
  app.use("/api/extensions", extensionRoutes);
  app.use("/api/chats", chatRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/rp", rpRoutes);
  app.use("/api/characters", characterRoutes);
  app.use("/api/lorebooks", lorebookRoutes);
  app.use("/api/rag", ragRoutes);
  app.use("/api/writer", writerRoutes);
  app.use("/api/personas", personaRoutes);
}

function registerFrontendStatic(app: express.Express) {
  if (process.env.SLV_SERVE_STATIC !== "1" && process.env.ELECTRON_SERVE_STATIC !== "1") return;

  const distPathCandidates = [
    process.env.SLV_DIST_PATH,
    process.env.ELECTRON_DIST_PATH,
    join(process.cwd(), "dist"),
    join(__dirname, "..", "..", "dist")
  ].filter((value): value is string => Boolean(value));
  const distPath = distPathCandidates.find((candidate) => existsSync(candidate));
  if (!distPath) return;

  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(join(distPath, "index.html"));
    }
  });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", isHeadlessPublicModeEnabled());

  app.use(cors((req, callback) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    callback(null, {
      origin: origin && isAllowedRequestOrigin(req, origin) ? origin : false
    });
  }));
  app.use((req, res, next) => {
    if (!isAuthorizedByBasicAuth(req)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Vellium"');
      res.status(401).send("Authentication required");
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (req.path.startsWith("/api") && !isAllowedRequestOrigin(req, origin)) {
      res.status(403).json({ error: "Origin blocked by security policy" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!isPluginFrameRoute(req.path)) {
      res.setHeader("X-Frame-Options", "DENY");
    }
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()");
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
    }
    if (!req.path.startsWith("/api")) {
      res.setHeader("Content-Security-Policy", buildContentSecurityPolicy());
    }
    next();
  });
  app.use(express.json({ limit: "32mb" }));

  app.use("/api/avatars", express.static(join(DATA_DIR, "avatars"), {
    setHeaders: setUploadResponseHeaders
  }));
  app.use("/api/uploads", express.static(join(DATA_DIR, "uploads"), {
    setHeaders: setUploadResponseHeaders
  }));

  registerUploadRoute(app);
  registerRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerFrontendStatic(app);

  return app;
}
