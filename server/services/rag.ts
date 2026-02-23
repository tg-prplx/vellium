import { createHash } from "crypto";
import { db, isLocalhostUrl, newId, now, roughTokenCount } from "../db.js";

interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
  provider_type: string;
}

interface RagChunkRow {
  id: string;
  document_id: string;
  content: string;
  token_count: number;
  metadata_json: string;
  document_title: string;
  lexical_rank: number;
}

interface RagVectorRow {
  chunk_id: string;
  vector_blob: Buffer;
  norm: number;
}

export interface RagCollectionRecord {
  id: string;
  name: string;
  description: string;
  scope: "global" | "chat" | "writer";
  createdAt: string;
  updatedAt: string;
}

export interface RagDocumentRecord {
  id: string;
  collectionId: string;
  title: string;
  sourceType: string;
  sourceId: string | null;
  contentHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RagBinding {
  enabled: boolean;
  collectionIds: string[];
  updatedAt: string | null;
}

export interface RagContextSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  preview: string;
}

type RagScope = "global" | "chat" | "writer";

function normalizeScope(raw: unknown): "global" | "chat" | "writer" {
  if (raw === "chat" || raw === "writer" || raw === "global") return raw;
  return "global";
}

function parseCollectionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function chunkText(content: string, chunkSize: number, overlap: number): string[] {
  const text = String(content || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const safeSize = Math.max(300, Math.min(8000, Math.floor(chunkSize)));
  const safeOverlap = Math.max(0, Math.min(Math.floor(safeSize * 0.6), Math.floor(overlap)));
  if (text.length <= safeSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + safeSize);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const windowStart = Math.max(start + Math.floor(safeSize * 0.6), start);
      const slice = text.slice(windowStart, hardEnd);
      const breakPos = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
      if (breakPos > 20) {
        end = windowStart + breakPos + 1;
      }
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }
  return chunks;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function modelKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

function encodeVector(vector: number[]): { blob: Buffer; norm: number } {
  const arr = new Float32Array(vector.length);
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = Number(vector[i]) || 0;
    arr[i] = value;
    sum += value * value;
  }
  return { blob: Buffer.from(arr.buffer), norm: Math.sqrt(sum) };
}

function decodeVector(blob: Buffer): Float32Array {
  const byteOffset = blob.byteOffset || 0;
  const byteLength = blob.byteLength || 0;
  return new Float32Array(blob.buffer.slice(byteOffset, byteOffset + byteLength));
}

function cosineSimilarity(a: Float32Array, b: Float32Array, aNorm: number, bNorm: number): number {
  if (!aNorm || !bNorm || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot / (aNorm * bNorm);
}

function queryTerms(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

function ftsQuery(raw: string): string {
  const terms = queryTerms(raw).slice(0, 12);
  if (terms.length === 0) return "";
  const escaped = terms.map((term) => term.replace(/"/g, "\"\""));
  return escaped.map((term) => `"${term}"*`).join(" OR ");
}

function normalizeEmbeddingRow(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const out: number[] = [];
  for (const value of input) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    out.push(num);
  }
  return out.length > 0 ? out : null;
}

async function requestEmbeddings(provider: ProviderRow, model: string, input: string[]): Promise<number[][]> {
  if (!input.length) return [];
  const baseUrl = String(provider.base_url || "").replace(/\/+$/, "");
  const apiKey = String(provider.api_key_cipher || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "embedding request failed");
    throw new Error(errText.slice(0, 500));
  }
  const body = await response.json() as {
    data?: Array<{ embedding?: unknown }>;
    embeddings?: unknown;
  };
  const rows = Array.isArray(body.data)
    ? body.data.map((item) => normalizeEmbeddingRow(item?.embedding))
    : Array.isArray(body.embeddings)
      ? body.embeddings.map((item) => normalizeEmbeddingRow(item))
      : [];
  const valid = rows.filter((row): row is number[] => Array.isArray(row) && row.length > 0);
  if (valid.length !== input.length) {
    throw new Error("embedding response mismatch");
  }
  return valid;
}

async function embedTexts(provider: ProviderRow, model: string, input: string[]): Promise<number[][]> {
  const batchSize = 24;
  const out: number[][] = [];
  for (let i = 0; i < input.length; i += batchSize) {
    const batch = input.slice(i, i + batchSize);
    const embedded = await requestEmbeddings(provider, model, batch);
    out.push(...embedded);
  }
  return out;
}

function resolveEmbeddingProvider(settings: Record<string, unknown>): { provider: ProviderRow; model: string } | null {
  const providerId = String(settings.ragProviderId || settings.activeProviderId || "").trim();
  const model = String(settings.ragModel || "").trim();
  if (!providerId || !model) return null;
  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) return null;
  const fullLocalMode = settings.fullLocalMode === true;
  if (fullLocalMode && !isLocalhostUrl(provider.base_url)) return null;
  if (provider.full_local_only && !isLocalhostUrl(provider.base_url)) return null;
  return { provider, model };
}

function selectExistingCollectionIds(ids: string[], scopes?: RagScope[]): string[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const normalizedScopes = Array.isArray(scopes) ? scopes.filter(Boolean) : [];
  const rows = normalizedScopes.length > 0
    ? db.prepare(
      `SELECT id FROM rag_collections
       WHERE id IN (${placeholders})
         AND scope IN (${normalizedScopes.map(() => "?").join(",")})`
    ).all(...ids, ...normalizedScopes) as Array<{ id: string }>
    : db.prepare(`SELECT id FROM rag_collections WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string }>;
  const set = new Set(rows.map((row) => row.id));
  return ids.filter((id) => set.has(id));
}

function upsertFtsChunk(chunkId: string, content: string) {
  try {
    db.prepare("DELETE FROM rag_chunk_fts WHERE chunk_id = ?").run(chunkId);
    db.prepare("INSERT INTO rag_chunk_fts (chunk_id, content) VALUES (?, ?)").run(chunkId, content);
  } catch {
    // FTS optional fallback.
  }
}

export function listRagCollections(): RagCollectionRecord[] {
  const rows = db.prepare(
    "SELECT id, name, description, scope, created_at, updated_at FROM rag_collections ORDER BY updated_at DESC, created_at DESC"
  ).all() as Array<{ id: string; name: string; description: string; scope: string; created_at: string; updated_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || "",
    scope: normalizeScope(row.scope),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function createRagCollection(name: string, description = "", scope: unknown = "global"): RagCollectionRecord {
  const id = newId();
  const ts = now();
  const safeName = String(name || "").trim().slice(0, 120) || "Knowledge";
  const safeDescription = String(description || "").trim().slice(0, 800);
  const safeScope = normalizeScope(scope);
  db.prepare(
    "INSERT INTO rag_collections (id, name, description, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, safeName, safeDescription, safeScope, ts, ts);
  return {
    id,
    name: safeName,
    description: safeDescription,
    scope: safeScope,
    createdAt: ts,
    updatedAt: ts
  };
}

export function updateRagCollection(id: string, patch: { name?: unknown; description?: unknown; scope?: unknown }): RagCollectionRecord | null {
  const existing = db.prepare("SELECT id FROM rag_collections WHERE id = ?").get(id) as { id: string } | undefined;
  if (!existing) return null;
  const current = db.prepare("SELECT name, description, scope, created_at FROM rag_collections WHERE id = ?").get(id) as {
    name: string;
    description: string;
    scope: string;
    created_at: string;
  };
  const nextName = patch.name !== undefined ? (String(patch.name || "").trim().slice(0, 120) || current.name) : current.name;
  const nextDescription = patch.description !== undefined ? String(patch.description || "").trim().slice(0, 800) : current.description;
  const nextScope = patch.scope !== undefined ? normalizeScope(patch.scope) : normalizeScope(current.scope);
  const ts = now();
  db.prepare("UPDATE rag_collections SET name = ?, description = ?, scope = ?, updated_at = ? WHERE id = ?")
    .run(nextName, nextDescription, nextScope, ts, id);
  return {
    id,
    name: nextName,
    description: nextDescription,
    scope: nextScope,
    createdAt: current.created_at,
    updatedAt: ts
  };
}

export function deleteRagCollection(id: string) {
  const ts = now();
  const tx = db.transaction((collectionId: string) => {
    db.prepare("DELETE FROM rag_collections WHERE id = ?").run(collectionId);

    const rows = db.prepare(
      "SELECT chat_id, enabled, collection_ids FROM chat_rag_bindings"
    ).all() as Array<{ chat_id: string; enabled: number; collection_ids: string }>;

    const update = db.prepare(
      "UPDATE chat_rag_bindings SET enabled = ?, collection_ids = ?, updated_at = ? WHERE chat_id = ?"
    );
    for (const row of rows) {
      let currentIds: string[] = [];
      try {
        currentIds = parseCollectionIds(JSON.parse(row.collection_ids || "[]"));
      } catch {
        currentIds = [];
      }
      if (!currentIds.includes(collectionId)) continue;
      const nextIds = currentIds.filter((item) => item !== collectionId);
      const nextEnabled = row.enabled === 1 && nextIds.length > 0 ? 1 : 0;
      update.run(nextEnabled, JSON.stringify(nextIds), ts, row.chat_id);
    }
  });
  tx(id);
}

export function listRagDocuments(collectionId: string): RagDocumentRecord[] {
  const rows = db.prepare(
    "SELECT id, collection_id, title, source_type, source_id, content_hash, status, created_at, updated_at FROM rag_documents WHERE collection_id = ? ORDER BY updated_at DESC, created_at DESC"
  ).all(collectionId) as Array<{
    id: string;
    collection_id: string;
    title: string;
    source_type: string;
    source_id: string | null;
    content_hash: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    sourceType: row.source_type,
    sourceId: row.source_id,
    contentHash: row.content_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function deleteRagDocument(documentId: string) {
  db.prepare("DELETE FROM rag_documents WHERE id = ?").run(documentId);
}

export async function ingestRagDocument(params: {
  collectionId: string;
  title: string;
  text: string;
  sourceType?: string;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  settings: Record<string, unknown>;
  force?: boolean;
}) {
  const collection = db.prepare("SELECT id FROM rag_collections WHERE id = ?").get(params.collectionId) as { id: string } | undefined;
  if (!collection) {
    throw new Error("Collection not found");
  }

  const safeText = String(params.text || "").replace(/\r\n?/g, "\n").trim();
  if (!safeText) throw new Error("Text is empty");
  const safeTitle = String(params.title || "").trim().slice(0, 180) || "Untitled document";
  const sourceType = String(params.sourceType || "manual").trim().slice(0, 40) || "manual";
  const sourceId = params.sourceId ? String(params.sourceId).trim().slice(0, 200) : null;
  const digest = sha256(`${safeTitle}\n${safeText}`);

  const existing = db.prepare(
    "SELECT id FROM rag_documents WHERE collection_id = ? AND content_hash = ? LIMIT 1"
  ).get(params.collectionId, digest) as { id: string } | undefined;

  if (existing && !params.force) {
    const chunkCount = db.prepare("SELECT COUNT(*) as cnt FROM rag_chunks WHERE document_id = ?").get(existing.id) as { cnt: number };
    const embeddedCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM rag_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE document_id = ?)"
    ).get(existing.id) as { cnt: number };
    return {
      documentId: existing.id,
      chunks: Number(chunkCount?.cnt || 0),
      embedded: Number(embeddedCount?.cnt || 0),
      status: "already_indexed"
    };
  }

  if (existing && params.force) {
    db.prepare("DELETE FROM rag_documents WHERE id = ?").run(existing.id);
  }

  const chunkSize = Number(params.settings.ragChunkSize);
  const overlap = Number(params.settings.ragChunkOverlap);
  const chunks = chunkText(
    safeText,
    Number.isFinite(chunkSize) ? chunkSize : 1200,
    Number.isFinite(overlap) ? overlap : 220
  );
  if (!chunks.length) throw new Error("No chunks produced");

  let vectors: number[][] = [];
  let modelKeyUsed: string | null = null;
  const embeddingTarget = resolveEmbeddingProvider(params.settings);
  if (embeddingTarget) {
    try {
      vectors = await embedTexts(embeddingTarget.provider, embeddingTarget.model, chunks);
      modelKeyUsed = modelKey(embeddingTarget.provider.id, embeddingTarget.model);
    } catch {
      vectors = [];
      modelKeyUsed = null;
    }
  }

  const docId = newId();
  const ts = now();
  const metadata = params.metadata && typeof params.metadata === "object" ? params.metadata : {};
  const status = vectors.length === chunks.length && vectors.length > 0 ? "indexed_vector" : "indexed_lexical";

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO rag_documents (id, collection_id, title, source_type, source_id, content_hash, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      docId,
      params.collectionId,
      safeTitle,
      sourceType,
      sourceId,
      digest,
      status,
      JSON.stringify(metadata),
      ts,
      ts
    );

    const insertChunk = db.prepare(
      "INSERT INTO rag_chunks (id, collection_id, document_id, chunk_index, content, token_count, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertVector = db.prepare(
      "INSERT INTO rag_vectors (chunk_id, model_key, dim, vector_blob, norm, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkId = newId();
      const content = chunks[index];
      insertChunk.run(
        chunkId,
        params.collectionId,
        docId,
        index,
        content,
        roughTokenCount(content),
        JSON.stringify({ chunkIndex: index, title: safeTitle }),
        ts
      );
      upsertFtsChunk(chunkId, content);
      if (vectors[index] && modelKeyUsed) {
        const encoded = encodeVector(vectors[index]);
        insertVector.run(chunkId, modelKeyUsed, vectors[index].length, encoded.blob, encoded.norm, ts);
      }
    }
  });
  tx();

  return {
    documentId: docId,
    chunks: chunks.length,
    embedded: vectors.length,
    status
  };
}

export function getChatRagBinding(chatId: string, settings: Record<string, unknown>): RagBinding {
  const row = db.prepare(
    "SELECT enabled, collection_ids, updated_at FROM chat_rag_bindings WHERE chat_id = ?"
  ).get(chatId) as { enabled: number; collection_ids: string; updated_at: string } | undefined;
  if (!row) {
    return {
      enabled: settings.ragEnabledByDefault === true,
      collectionIds: [],
      updatedAt: null
    };
  }
  let collectionIds: string[] = [];
  try {
    collectionIds = parseCollectionIds(JSON.parse(row.collection_ids || "[]"));
  } catch {
    collectionIds = [];
  }
  const validCollectionIds = selectExistingCollectionIds(collectionIds, ["global", "chat"]);
  if (validCollectionIds.length !== collectionIds.length) {
    const ts = now();
    const nextEnabled = row.enabled === 1 && validCollectionIds.length > 0 ? 1 : 0;
    db.prepare("UPDATE chat_rag_bindings SET enabled = ?, collection_ids = ?, updated_at = ? WHERE chat_id = ?")
      .run(nextEnabled, JSON.stringify(validCollectionIds), ts, chatId);
    return {
      enabled: nextEnabled === 1,
      collectionIds: validCollectionIds,
      updatedAt: ts
    };
  }
  return {
    enabled: row.enabled === 1,
    collectionIds: validCollectionIds,
    updatedAt: row.updated_at
  };
}

export function setChatRagBinding(chatId: string, enabled: boolean, collectionIdsRaw: unknown): RagBinding {
  const ts = now();
  const normalized = parseCollectionIds(collectionIdsRaw);
  const validCollectionIds = selectExistingCollectionIds(normalized, ["global", "chat"]);
  const nextEnabled = enabled && validCollectionIds.length > 0;
  db.prepare(
    `INSERT INTO chat_rag_bindings (chat_id, enabled, collection_ids, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET enabled = excluded.enabled, collection_ids = excluded.collection_ids, updated_at = excluded.updated_at`
  ).run(chatId, nextEnabled ? 1 : 0, JSON.stringify(validCollectionIds), ts);
  return {
    enabled: nextEnabled,
    collectionIds: validCollectionIds,
    updatedAt: ts
  };
}

export async function retrieveRagContext(params: {
  chatId: string;
  queryText: string;
  settings: Record<string, unknown>;
}) {
  const binding = getChatRagBinding(params.chatId, params.settings);
  if (!binding.enabled || binding.collectionIds.length === 0) {
    return { context: "", sources: [] as RagContextSource[] };
  }
  const queryText = String(params.queryText || "").trim();
  if (!queryText) {
    return { context: "", sources: [] as RagContextSource[] };
  }

  const topKRaw = Number(params.settings.ragTopK);
  const topK = Number.isFinite(topKRaw) ? Math.max(1, Math.min(12, Math.floor(topKRaw))) : 6;
  const candidateRaw = Number(params.settings.ragCandidateCount);
  const candidateCount = Number.isFinite(candidateRaw) ? Math.max(topK, Math.min(300, Math.floor(candidateRaw))) : 80;
  const tokenRaw = Number(params.settings.ragMaxContextTokens);
  const maxContextTokens = Number.isFinite(tokenRaw) ? Math.max(200, Math.min(4000, Math.floor(tokenRaw))) : 900;
  const charBudget = maxContextTokens * 4;
  const thresholdRaw = Number(params.settings.ragSimilarityThreshold);
  const similarityThreshold = Number.isFinite(thresholdRaw) ? Math.max(-1, Math.min(1, thresholdRaw)) : 0.15;

  const placeholders = binding.collectionIds.map(() => "?").join(",");
  const lexical = ftsQuery(queryText);
  let candidates: RagChunkRow[] = [];

  if (lexical) {
    try {
      candidates = db.prepare(
        `SELECT c.id, c.document_id, c.content, c.token_count, c.metadata_json,
                d.title AS document_title, bm25(rag_chunk_fts) AS lexical_rank
         FROM rag_chunk_fts
         JOIN rag_chunks c ON c.id = rag_chunk_fts.chunk_id
         JOIN rag_documents d ON d.id = c.document_id
         WHERE rag_chunk_fts MATCH ?
           AND c.collection_id IN (${placeholders})
         ORDER BY lexical_rank ASC
         LIMIT ?`
      ).all(lexical, ...binding.collectionIds, candidateCount) as RagChunkRow[];
    } catch {
      candidates = [];
    }
  }

  if (candidates.length === 0) {
    const likeValue = `%${queryText.slice(0, 120)}%`;
    if (likeValue.length > 2) {
      candidates = db.prepare(
        `SELECT c.id, c.document_id, c.content, c.token_count, c.metadata_json,
                d.title AS document_title, 1.0 AS lexical_rank
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
         WHERE c.collection_id IN (${placeholders})
           AND c.content LIKE ?
         LIMIT ?`
      ).all(...binding.collectionIds, likeValue, candidateCount) as RagChunkRow[];
    } else {
      candidates = db.prepare(
        `SELECT c.id, c.document_id, c.content, c.token_count, c.metadata_json,
                d.title AS document_title, 1.0 AS lexical_rank
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
         WHERE c.collection_id IN (${placeholders})
         ORDER BY c.created_at DESC
         LIMIT ?`
      ).all(...binding.collectionIds, candidateCount) as RagChunkRow[];
    }
  }

  if (candidates.length === 0) {
    return { context: "", sources: [] as RagContextSource[] };
  }

  const ranked = candidates.map((row, index) => ({
    row,
    lexicalScore: 1 / (1 + Math.max(0, Number(row.lexical_rank || index + 1))),
    semanticScore: null as number | null,
    totalScore: 0
  }));

  const embeddingTarget = resolveEmbeddingProvider(params.settings);
  if (embeddingTarget) {
    try {
      const queryVectorRaw = await requestEmbeddings(embeddingTarget.provider, embeddingTarget.model, [queryText]);
      const queryVector = new Float32Array(queryVectorRaw[0]);
      let queryNorm = 0;
      for (let i = 0; i < queryVector.length; i += 1) queryNorm += queryVector[i] * queryVector[i];
      queryNorm = Math.sqrt(queryNorm);

      const ids = ranked.map((item) => item.row.id);
      const chunkPlaceholders = ids.map(() => "?").join(",");
      const vectors = db.prepare(
        `SELECT chunk_id, vector_blob, norm FROM rag_vectors
         WHERE model_key = ? AND chunk_id IN (${chunkPlaceholders})`
      ).all(modelKey(embeddingTarget.provider.id, embeddingTarget.model), ...ids) as RagVectorRow[];
      const vectorMap = new Map(vectors.map((row) => [row.chunk_id, row]));

      for (const item of ranked) {
        const vecRow = vectorMap.get(item.row.id);
        if (!vecRow) continue;
        const decoded = decodeVector(vecRow.vector_blob);
        const similarity = cosineSimilarity(queryVector, decoded, queryNorm, Number(vecRow.norm) || 0);
        item.semanticScore = similarity;
      }
    } catch {
      // Semantic pass is optional.
    }
  }

  for (const item of ranked) {
    if (item.semanticScore !== null) {
      const semanticNorm = (item.semanticScore + 1) / 2;
      item.totalScore = semanticNorm * 0.75 + item.lexicalScore * 0.25;
    } else {
      item.totalScore = item.lexicalScore;
    }
  }

  ranked.sort((a, b) => b.totalScore - a.totalScore);
  const byDoc = new Map<string, number>();
  const selected: typeof ranked = [];
  for (const item of ranked) {
    if (selected.length >= topK) break;
    if (item.semanticScore !== null && item.semanticScore < similarityThreshold) continue;
    const count = byDoc.get(item.row.document_id) ?? 0;
    if (count >= 2) continue;
    byDoc.set(item.row.document_id, count + 1);
    selected.push(item);
  }

  if (selected.length === 0) {
    return { context: "", sources: [] as RagContextSource[] };
  }

  let usedChars = 0;
  const contextParts: string[] = [];
  const sources: RagContextSource[] = [];
  for (const item of selected) {
    const metadata = (() => {
      try {
        return JSON.parse(item.row.metadata_json || "{}") as { chunkIndex?: number };
      } catch {
        return {};
      }
    })();
    const chunkIndex = Number.isFinite(Number(metadata.chunkIndex)) ? Number(metadata.chunkIndex) + 1 : 0;
    const title = item.row.document_title || "Document";
    const header = `[Source: ${title}${chunkIndex ? `#${chunkIndex}` : ""}]`;
    const body = String(item.row.content || "").trim();
    const block = `${header}\n${body}`;
    if (usedChars > 0 && usedChars + block.length > charBudget) break;
    contextParts.push(block);
    usedChars += block.length;
    sources.push({
      chunkId: item.row.id,
      documentId: item.row.document_id,
      documentTitle: title,
      score: Number(item.totalScore.toFixed(4)),
      preview: body.slice(0, 220)
    });
  }

  if (contextParts.length === 0) {
    return { context: "", sources: [] as RagContextSource[] };
  }

  return {
    context: contextParts.join("\n\n"),
    sources
  };
}
