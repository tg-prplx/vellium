import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, existsSync } from "fs";
import { newId, UPLOADS_DIR, DATA_DIR } from "./db.js";
import accountRoutes from "./routes/account.js";
import settingsRoutes from "./routes/settings.js";
import providerRoutes from "./routes/providers.js";
import chatRoutes from "./routes/chats.js";
import messageRoutes from "./routes/messages.js";
import rpRoutes from "./routes/rp.js";
import characterRoutes from "./routes/characters.js";
import writerRoutes from "./routes/writer.js";
import personaRoutes from "./routes/personas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Use DATA_DIR for avatar/upload static paths (respects SLV_DATA_DIR env)
app.use("/api/avatars", express.static(join(DATA_DIR, "avatars")));
app.use("/api/uploads", express.static(join(DATA_DIR, "uploads")));

// File upload endpoint
app.post("/api/upload", (req, res) => {
  const { base64Data, filename } = req.body;
  if (!base64Data || !filename) {
    res.status(400).json({ error: "base64Data and filename required" });
    return;
  }
  const ext = filename.split(".").pop() || "bin";
  const id = newId();
  const storedName = `${id}.${ext}`;
  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(join(UPLOADS_DIR, storedName), buffer);

  const isImage = /^(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(ext);
  const isText = /^(txt|md|json|csv|log|xml|html|js|ts|py|rb|yaml|yml|toml|ini|cfg)$/i.test(ext);

  let content: string | undefined;
  if (isText) {
    content = buffer.toString("utf-8");
  }

  res.json({
    id,
    filename,
    type: isImage ? "image" : "text",
    url: `/api/uploads/${storedName}`,
    content
  });
});

// Routes
app.use("/api/account", accountRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/rp", rpRoutes);
app.use("/api/characters", characterRoutes);
app.use("/api/writer", writerRoutes);
app.use("/api/personas", personaRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// In production Electron mode, serve the built frontend as static files
if (process.env.ELECTRON_SERVE_STATIC === "1") {
  const distPath = process.env.ELECTRON_DIST_PATH || join(__dirname, "..", "dist");
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — serve index.html for all non-API routes
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(join(distPath, "index.html"));
      }
    });
  }
}

export { app };

export function startServer(port: number = 3001): Promise<number> {
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
      resolve(port);
    });
  });
}

// Auto-start when run directly (not imported by Electron)
const isDirectRun = !process.env.ELECTRON_RUN;
if (isDirectRun) {
  startServer(3001);
}
