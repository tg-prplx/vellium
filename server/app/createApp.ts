import cors from "cors";
import express from "express";
import { existsSync, writeFileSync } from "fs";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR, UPLOADS_DIR, newId } from "../db.js";
import accountRoutes from "../routes/account.js";
import characterRoutes from "../routes/characters.js";
import chatRoutes from "../routes/chats.js";
import lorebookRoutes from "../routes/lorebooks.js";
import messageRoutes from "../routes/messages.js";
import personaRoutes from "../routes/personas.js";
import providerRoutes from "../routes/providers.js";
import ragRoutes from "../routes/rag.js";
import rpRoutes from "../routes/rp.js";
import settingsRoutes from "../routes/settings.js";
import writerRoutes from "../routes/writer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INLINE_ATTACHMENT_TEXT_LIMIT = 240_000;

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

    const ext = (filename.split(".").pop() || "bin").toLowerCase();
    const id = newId();
    const storedName = `${id}.${ext}`;
    const buffer = Buffer.from(base64Data, "base64");
    writeFileSync(join(UPLOADS_DIR, storedName), buffer);

    const isImage = /^(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(ext);
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
      filename,
      type: isImage ? "image" : "text",
      url: `/api/uploads/${storedName}`,
      mimeType: mimeByExtension(ext),
      content
    });
  });
}

function registerRoutes(app: express.Express) {
  app.use("/api/account", accountRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/providers", providerRoutes);
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
  if (process.env.ELECTRON_SERVE_STATIC !== "1") return;

  const distPath = process.env.ELECTRON_DIST_PATH || join(__dirname, "..", "..", "dist");
  if (!existsSync(distPath)) return;

  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(join(distPath, "index.html"));
    }
  });
}

export function createApp() {
  const app = express();

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const parsed = new URL(origin);
        const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
        callback(null, isLocalHost && isHttp);
      } catch {
        callback(null, false);
      }
    }
  }));
  app.use(express.json({ limit: "50mb" }));

  app.use("/api/avatars", express.static(join(DATA_DIR, "avatars")));
  app.use("/api/uploads", express.static(join(DATA_DIR, "uploads")));

  registerUploadRoute(app);
  registerRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerFrontendStatic(app);

  return app;
}
