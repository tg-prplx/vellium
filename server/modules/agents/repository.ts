import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { db, newId, now } from "../../db.js";

type AgentMode = "ask" | "build" | "research";

type AgentHeroSkillSeed = {
  name: string;
  description: string;
  instructions: string;
  enabled?: boolean;
};

type AgentHeroProfile = {
  enabled: boolean;
  mode: AgentMode;
  customInstructions: string;
  skills: AgentHeroSkillSeed[];
};

const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are Vellium Agent, a first-party autonomous operator inside Vellium.",
  "Be concise, execution-focused, and explicit about uncertainty.",
  "Prefer concrete progress over generic advice.",
  "Use skills intentionally, use tools when they materially improve accuracy, and use subagents only for bounded side tasks."
].join(" ");

const DEFAULT_AGENT_SKILLS_BY_MODE: Record<AgentMode, AgentHeroSkillSeed[]> = {
  ask: [
    {
      name: "Clarifier",
      description: "Resolve ambiguity quickly and keep the answer tight.",
      instructions: "Prefer the shortest path to a useful answer. Ask for clarification only when the request is genuinely underspecified."
    },
    {
      name: "Explainer",
      description: "Translate technical detail into crisp, practical guidance.",
      instructions: "Answer in direct, utility-first language. Focus on what the user should understand or do next."
    },
    {
      name: "Reviewer",
      description: "Check for weak assumptions and missed edge cases.",
      instructions: "Before finalizing, sanity-check hidden risks, caveats, and obvious regressions."
    }
  ],
  build: [
    {
      name: "Builder",
      description: "Turn goals into concrete implementation steps and deliverables.",
      instructions: "Prefer executable plans, concrete outputs, and clear success criteria over abstract discussion."
    },
    {
      name: "Verifier",
      description: "Tighten the result with checks, validation, and follow-through.",
      instructions: "Look for the fastest credible way to validate the work and note what was or was not verified."
    },
    {
      name: "Reviewer",
      description: "Stress-test output for bugs, regressions, edge cases, and missing validation.",
      instructions: "Act like a strict reviewer: look for weak assumptions, missing tests, risky gaps, and opportunities to tighten the result."
    }
  ],
  research: [
    {
      name: "Research",
      description: "Clarify ambiguous asks, gather evidence, and surface constraints before acting.",
      instructions: "Break unclear work into questions, identify missing facts, and gather only the evidence needed to move the task forward."
    },
    {
      name: "Synthesizer",
      description: "Turn gathered evidence into a clear recommendation.",
      instructions: "Compare tradeoffs, separate facts from inference, and converge on a defensible recommendation."
    },
    {
      name: "Skeptic",
      description: "Probe missing evidence and contradictory signals.",
      instructions: "Challenge the first answer. Check whether evidence is stale, incomplete, or contradicted elsewhere."
    }
  ]
};

const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  ask: "Ask",
  build: "Build",
  research: "Research"
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON payloads from older rows.
  }
  return {};
}

function normalizeMessageMetadata(raw: string | null | undefined) {
  const metadata = parseJsonObject(raw);
  const attachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as Record<string, unknown>;
        const type = row.type === "image" ? "image" : row.type === "text" ? "text" : null;
        if (!type) return null;
        return {
          id: sanitizeText(row.id, 160),
          filename: sanitizeText(row.filename, 260),
          type,
          url: sanitizeText(row.url, 2000),
          mimeType: sanitizeText(row.mimeType, 200),
          dataUrl: type === "image" ? sanitizeText(row.dataUrl, 15 * 1024 * 1024) : undefined,
          content: type === "text" ? sanitizeText(row.content, 20000) : undefined
        };
      })
      .filter((item): item is {
        id: string;
        filename: string;
        type: "image" | "text";
        url: string;
        mimeType: string;
        dataUrl?: string;
        content?: string;
      } => item !== null)
      .slice(0, 12)
    : [];
  return { metadata, attachments };
}

function sanitizeText(raw: unknown, maxLength: number, fallback = "") {
  const value = String(raw ?? fallback).trim();
  return value.slice(0, maxLength);
}

function coercePositiveInt(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeWorkspaceRoot(raw: unknown, fallback = process.cwd()) {
  const value = String(raw ?? "").trim();
  const candidate = resolve(value || fallback);
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Fall through to the fallback root.
    }
  }
  return resolve(fallback);
}

function normalizeAgentMode(raw: unknown, fallback: AgentMode = "build"): AgentMode {
  return raw === "ask" || raw === "research" || raw === "build" ? raw : fallback;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseCardData(cardJson: string | null | undefined): Record<string, unknown> {
  if (!cardJson) return {};
  try {
    const parsed = JSON.parse(cardJson) as { data?: unknown };
    if (parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
      return parsed.data as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed character cards.
  }
  return {};
}

function parseHeroSkill(value: unknown, index: number): AgentHeroSkillSeed | null {
  const record = parseRecord(value);
  const name = sanitizeText(record.name, 120);
  const description = sanitizeText(record.description, 300);
  const instructions = sanitizeText(record.instructions, 6000);
  if (!name && !instructions) return null;
  return {
    name: name || `Skill ${index + 1}`,
    description,
    instructions,
    enabled: record.enabled !== false
  };
}

function parseAgentHeroProfile(value: unknown): AgentHeroProfile | null {
  const record = parseRecord(value);
  if (record.enabled !== true) return null;
  const skills = Array.isArray(record.skills)
    ? record.skills
      .map((item, index) => parseHeroSkill(item, index))
      .filter((item): item is AgentHeroSkillSeed => item !== null)
      .slice(0, 8)
    : [];
  return {
    enabled: true,
    mode: normalizeAgentMode(record.mode, "build"),
    customInstructions: sanitizeText(record.customInstructions, 8000),
    skills
  };
}

function buildHeroSystemPrompt(character: {
  name: string;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  system_prompt?: string | null;
}, profile: AgentHeroProfile | null, mode: AgentMode) {
  const lines = [
    DEFAULT_AGENT_SYSTEM_PROMPT,
    `Operating mode: ${AGENT_MODE_LABELS[mode]}.`
  ];
  if (character.name) lines.push(`You are operating as ${character.name} inside Vellium.`);
  if (character.description) lines.push(`Hero description: ${character.description}`);
  if (character.personality) lines.push(`Hero personality: ${character.personality}`);
  if (character.scenario) lines.push(`Hero scenario: ${character.scenario}`);
  if (character.system_prompt) lines.push(`Hero system prompt: ${character.system_prompt}`);
  if (profile?.customInstructions) lines.push(`Hero agent instructions: ${profile.customInstructions}`);
  return lines.filter(Boolean).join("\n");
}

function buildSeedSkills(mode: AgentMode, profile: AgentHeroProfile | null) {
  const modeSkills = DEFAULT_AGENT_SKILLS_BY_MODE[mode] || DEFAULT_AGENT_SKILLS_BY_MODE.build;
  const heroSkills = profile?.skills.filter((skill) => skill.enabled !== false) || [];
  return [...modeSkills, ...heroSkills].slice(0, 10);
}

function getHeroSeed(characterId: string | null | undefined) {
  if (!characterId) return null;
  const row = db.prepare(`
    SELECT id, name, description, personality, scenario, system_prompt, card_json
    FROM characters
    WHERE id = ?
  `).get(characterId) as {
    id: string;
    name: string;
    description: string | null;
    personality: string | null;
    scenario: string | null;
    system_prompt: string | null;
    card_json: string;
  } | undefined;
  if (!row) return null;
  const cardData = parseCardData(row.card_json);
  const extensions = parseRecord(cardData.extensions);
  const profile = parseAgentHeroProfile(extensions.vellium_agent);
  return {
    ...row,
    profile
  };
}

function touchThread(threadId: string, status?: "idle" | "running" | "error") {
  const ts = now();
  if (status) {
    db.prepare("UPDATE agent_threads SET updated_at = ?, status = ? WHERE id = ?").run(ts, status, threadId);
    return;
  }
  db.prepare("UPDATE agent_threads SET updated_at = ? WHERE id = ?").run(ts, threadId);
}

function nextSkillOrder(threadId: string): number {
  const row = db.prepare("SELECT MAX(ordering) as mx FROM agent_skills WHERE thread_id = ?").get(threadId) as { mx: number | null };
  return (row?.mx ?? 0) + 1;
}

function nextEventOrder(runId: string): number {
  const row = db.prepare("SELECT MAX(ordering) as mx FROM agent_events WHERE run_id = ?").get(runId) as { mx: number | null };
  return (row?.mx ?? 0) + 1;
}

function mapThread(row: {
  id: string;
  title: string;
  description: string;
  system_prompt: string;
  status: string;
  mode: string;
  hero_character_id: string | null;
  hero_character_name?: string | null;
  workspace_root: string;
  memory_summary: string;
  memory_updated_at: string | null;
  provider_id: string | null;
  model_id: string | null;
  tool_mode: string;
  max_iterations: number;
  max_subagents: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    systemPrompt: row.system_prompt || "",
    status: row.status === "running" || row.status === "error" ? row.status : "idle",
    mode: normalizeAgentMode(row.mode),
    heroCharacterId: row.hero_character_id,
    heroCharacterName: row.hero_character_name || null,
    workspaceRoot: normalizeWorkspaceRoot(row.workspace_root, process.cwd()),
    memorySummary: row.memory_summary || "",
    memoryUpdatedAt: row.memory_updated_at || null,
    providerId: row.provider_id,
    modelId: row.model_id,
    toolMode: row.tool_mode === "disabled" ? "disabled" : "enabled",
    maxIterations: coercePositiveInt(row.max_iterations, 6, 1, 12),
    maxSubagents: coercePositiveInt(row.max_subagents, 2, 0, 6),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSkill(row: {
  id: string;
  thread_id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: number;
  ordering: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    threadId: row.thread_id,
    name: row.name,
    description: row.description || "",
    instructions: row.instructions || "",
    enabled: row.enabled === 1,
    order: row.ordering,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: {
  id: string;
  thread_id: string;
  run_id: string | null;
  role: string;
  content: string;
  metadata_json: string | null;
  created_at: string;
}) {
  const { metadata, attachments } = normalizeMessageMetadata(row.metadata_json);
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    role: row.role === "system" || row.role === "assistant" ? row.role : "user",
    content: row.content,
    attachments,
    metadata,
    createdAt: row.created_at
  };
}

function mapRun(row: {
  id: string;
  thread_id: string;
  parent_run_id: string | null;
  title: string;
  status: string;
  depth: number;
  summary: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    threadId: row.thread_id,
    parentRunId: row.parent_run_id,
    title: row.title || "",
    status: row.status === "done" || row.status === "error" || row.status === "aborted" ? row.status : "running",
    depth: row.depth ?? 0,
    summary: row.summary || "",
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEvent(row: {
  id: string;
  thread_id: string;
  run_id: string;
  parent_event_id: string | null;
  event_type: string;
  title: string;
  content: string;
  payload_json: string | null;
  ordering: number;
  created_at: string;
}) {
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    parentEventId: row.parent_event_id,
    type: row.event_type,
    title: row.title || "",
    content: row.content || "",
    payload: parseJsonObject(row.payload_json),
    order: row.ordering ?? 0,
    createdAt: row.created_at
  };
}

export function listAgentThreads() {
  const rows = db.prepare(
    `SELECT agent_threads.*, characters.name AS hero_character_name
     FROM agent_threads
     LEFT JOIN characters ON characters.id = agent_threads.hero_character_id
     ORDER BY agent_threads.updated_at DESC, agent_threads.created_at DESC`
  ).all() as Array<{
    id: string;
    title: string;
    description: string;
    system_prompt: string;
    status: string;
    mode: string;
    hero_character_id: string | null;
    hero_character_name: string | null;
    workspace_root: string;
    memory_summary: string;
    memory_updated_at: string | null;
    provider_id: string | null;
    model_id: string | null;
    tool_mode: string;
    max_iterations: number;
    max_subagents: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map(mapThread);
}

export function getAgentThread(threadId: string) {
  const row = db.prepare(`
    SELECT agent_threads.*, characters.name AS hero_character_name
    FROM agent_threads
    LEFT JOIN characters ON characters.id = agent_threads.hero_character_id
    WHERE agent_threads.id = ?
  `).get(threadId) as {
    id: string;
    title: string;
    description: string;
    system_prompt: string;
    status: string;
    mode: string;
    hero_character_id: string | null;
    hero_character_name: string | null;
    workspace_root: string;
    memory_summary: string;
    memory_updated_at: string | null;
    provider_id: string | null;
    model_id: string | null;
    tool_mode: string;
    max_iterations: number;
    max_subagents: number;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? mapThread(row) : null;
}

export function createAgentThread(input?: {
  title?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
  mode?: unknown;
  heroCharacterId?: unknown;
  workspaceRoot?: unknown;
  providerId?: unknown;
  modelId?: unknown;
  toolMode?: unknown;
  maxIterations?: unknown;
  maxSubagents?: unknown;
}) {
  const ts = now();
  const id = newId();
  const heroCharacterId = sanitizeText(input?.heroCharacterId, 120, "") || null;
  const hero = getHeroSeed(heroCharacterId);
  const mode = normalizeAgentMode(input?.mode, hero?.profile?.mode || "build");
  const baseTitle = sanitizeText(input?.title, 160, hero?.name || "New Agent Thread") || hero?.name || "New Agent Thread";
  const baseDescription = sanitizeText(
    input?.description,
    500,
    hero?.profile?.customInstructions || hero?.description || ""
  );
  const baseSystemPrompt = sanitizeText(
    input?.systemPrompt,
    8000,
    hero ? buildHeroSystemPrompt(hero, hero.profile, mode) : DEFAULT_AGENT_SYSTEM_PROMPT
  ) || (hero ? buildHeroSystemPrompt(hero, hero.profile, mode) : DEFAULT_AGENT_SYSTEM_PROMPT);
  db.prepare(`
    INSERT INTO agent_threads (
      id, title, description, system_prompt, status, mode, hero_character_id, memory_summary, memory_updated_at,
      workspace_root, provider_id, model_id, tool_mode, max_iterations, max_subagents, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    baseTitle,
    baseDescription,
    baseSystemPrompt,
    "idle",
    mode,
    hero?.id || null,
    "",
    null,
    normalizeWorkspaceRoot(input?.workspaceRoot, process.cwd()),
    sanitizeText(input?.providerId, 120, "") || null,
    sanitizeText(input?.modelId, 200, "") || null,
    input?.toolMode === "disabled" ? "disabled" : "enabled",
    coercePositiveInt(input?.maxIterations, 6, 1, 12),
    coercePositiveInt(input?.maxSubagents, 2, 0, 6),
    ts,
    ts
  );

  for (const skill of buildSeedSkills(mode, hero?.profile || null)) {
    db.prepare(`
      INSERT INTO agent_skills (id, thread_id, name, description, instructions, enabled, ordering, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), id, skill.name, skill.description, skill.instructions, skill.enabled === false ? 0 : 1, nextSkillOrder(id), ts, ts);
  }

  return getAgentThread(id);
}

export function updateAgentThread(threadId: string, patch: {
  title?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
  mode?: unknown;
  heroCharacterId?: unknown;
  workspaceRoot?: unknown;
  memorySummary?: unknown;
  memoryUpdatedAt?: unknown;
  providerId?: unknown;
  modelId?: unknown;
  toolMode?: unknown;
  maxIterations?: unknown;
  maxSubagents?: unknown;
  status?: unknown;
}) {
  const existing = getAgentThread(threadId);
  if (!existing) return null;
  const ts = now();
  db.prepare(`
    UPDATE agent_threads
    SET title = ?, description = ?, system_prompt = ?, mode = ?, hero_character_id = ?, workspace_root = ?, memory_summary = ?, memory_updated_at = ?, provider_id = ?, model_id = ?, tool_mode = ?,
        max_iterations = ?, max_subagents = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.title === undefined ? existing.title : sanitizeText(patch.title, 160, existing.title) || existing.title,
    patch.description === undefined ? existing.description : sanitizeText(patch.description, 500, existing.description),
    patch.systemPrompt === undefined ? existing.systemPrompt : sanitizeText(patch.systemPrompt, 8000, existing.systemPrompt),
    patch.mode === undefined ? existing.mode : normalizeAgentMode(patch.mode, existing.mode),
    patch.heroCharacterId === undefined ? existing.heroCharacterId || null : (sanitizeText(patch.heroCharacterId, 120, "") || null),
    patch.workspaceRoot === undefined ? existing.workspaceRoot : normalizeWorkspaceRoot(patch.workspaceRoot, existing.workspaceRoot),
    patch.memorySummary === undefined ? existing.memorySummary : sanitizeText(patch.memorySummary, 4000, existing.memorySummary),
    patch.memoryUpdatedAt === undefined ? existing.memoryUpdatedAt || null : (sanitizeText(patch.memoryUpdatedAt, 80, "") || null),
    patch.providerId === undefined ? existing.providerId || null : (sanitizeText(patch.providerId, 120, "") || null),
    patch.modelId === undefined ? existing.modelId || null : (sanitizeText(patch.modelId, 200, "") || null),
    patch.toolMode === "disabled" ? "disabled" : patch.toolMode === undefined ? existing.toolMode : "enabled",
    patch.maxIterations === undefined ? existing.maxIterations : coercePositiveInt(patch.maxIterations, existing.maxIterations, 1, 12),
    patch.maxSubagents === undefined ? existing.maxSubagents : coercePositiveInt(patch.maxSubagents, existing.maxSubagents, 0, 6),
    patch.status === "running" || patch.status === "error" ? patch.status : patch.status === "idle" ? "idle" : existing.status,
    ts,
    threadId
  );
  return getAgentThread(threadId);
}

export function deleteAgentThread(threadId: string) {
  db.prepare("DELETE FROM agent_threads WHERE id = ?").run(threadId);
  return { ok: true };
}

export function listAgentSkills(threadId: string) {
  const rows = db.prepare(
    "SELECT * FROM agent_skills WHERE thread_id = ? ORDER BY ordering ASC, created_at ASC"
  ).all(threadId) as Array<{
    id: string;
    thread_id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: number;
    ordering: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map(mapSkill);
}

export function createAgentSkill(threadId: string, input?: {
  name?: unknown;
  description?: unknown;
  instructions?: unknown;
  enabled?: unknown;
}) {
  const ts = now();
  const id = newId();
  db.prepare(`
    INSERT INTO agent_skills (id, thread_id, name, description, instructions, enabled, ordering, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    threadId,
    sanitizeText(input?.name, 120, "New Skill") || "New Skill",
    sanitizeText(input?.description, 300, ""),
    sanitizeText(input?.instructions, 6000, ""),
    input?.enabled === false ? 0 : 1,
    nextSkillOrder(threadId),
    ts,
    ts
  );
  touchThread(threadId);
  return listAgentSkills(threadId).find((skill) => skill.id === id) || null;
}

export function updateAgentSkill(threadId: string, skillId: string, patch: {
  name?: unknown;
  description?: unknown;
  instructions?: unknown;
  enabled?: unknown;
  order?: unknown;
}) {
  const current = db.prepare("SELECT * FROM agent_skills WHERE id = ? AND thread_id = ?").get(skillId, threadId) as {
    id: string;
    thread_id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: number;
    ordering: number;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!current) return null;
  const ts = now();
  db.prepare(`
    UPDATE agent_skills
    SET name = ?, description = ?, instructions = ?, enabled = ?, ordering = ?, updated_at = ?
    WHERE id = ? AND thread_id = ?
  `).run(
    patch.name === undefined ? current.name : sanitizeText(patch.name, 120, current.name) || current.name,
    patch.description === undefined ? current.description : sanitizeText(patch.description, 300, current.description),
    patch.instructions === undefined ? current.instructions : sanitizeText(patch.instructions, 6000, current.instructions),
    patch.enabled === undefined ? current.enabled : (patch.enabled === false ? 0 : 1),
    patch.order === undefined ? current.ordering : coercePositiveInt(patch.order, current.ordering, 1, 99),
    ts,
    skillId,
    threadId
  );
  touchThread(threadId);
  return listAgentSkills(threadId).find((skill) => skill.id === skillId) || null;
}

export function deleteAgentSkill(threadId: string, skillId: string) {
  db.prepare("DELETE FROM agent_skills WHERE id = ? AND thread_id = ?").run(skillId, threadId);
  touchThread(threadId);
  return { ok: true };
}

export function insertAgentMessage(input: {
  threadId: string;
  runId?: string | null;
  role: "system" | "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
  attachments?: unknown[];
}) {
  const ts = now();
  const id = newId();
  const metadata = {
    ...(input.metadata || {}),
    ...(Array.isArray(input.attachments) && input.attachments.length > 0 ? { attachments: input.attachments } : {})
  };
  db.prepare(`
    INSERT INTO agent_messages (id, thread_id, run_id, role, content, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.threadId,
    input.runId || null,
    input.role,
    String(input.content || ""),
    JSON.stringify(metadata),
    ts
  );
  touchThread(input.threadId);
  return getAgentThreadState(input.threadId)?.messages.find((message) => message.id === id) || null;
}

export function assignAgentMessageRunId(threadId: string, messageId: string, runId: string) {
  db.prepare(`
    UPDATE agent_messages
    SET run_id = ?
    WHERE id = ? AND thread_id = ?
  `).run(runId, messageId, threadId);
  touchThread(threadId);
  return getAgentThreadState(threadId)?.messages.find((message) => message.id === messageId) || null;
}

export function listAgentMessages(threadId: string, limit = 120) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM agent_messages
      WHERE thread_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    )
    ORDER BY created_at ASC, id ASC
  `).all(threadId, limit) as Array<{
    id: string;
    thread_id: string;
    run_id: string | null;
    role: string;
    content: string;
    metadata_json: string | null;
    created_at: string;
  }>;
  return rows.map(mapMessage);
}

function getAgentMessageRow(messageId: string) {
  return db.prepare(`
    SELECT rowid, *
    FROM agent_messages
    WHERE id = ?
  `).get(messageId) as {
    rowid: number;
    id: string;
    thread_id: string;
    run_id: string | null;
    role: string;
    content: string;
    metadata_json: string | null;
    created_at: string;
  } | undefined;
}

export function getAgentMessageThreadId(messageId: string) {
  const row = db.prepare("SELECT thread_id FROM agent_messages WHERE id = ?").get(messageId) as { thread_id: string } | undefined;
  return row?.thread_id || null;
}

export function updateAgentMessage(messageId: string, patch: {
  content?: unknown;
  attachments?: unknown[];
}) {
  const row = getAgentMessageRow(messageId);
  if (!row || row.role !== "user") return null;
  const { metadata } = normalizeMessageMetadata(row.metadata_json);
  const nextMetadata = {
    ...metadata,
    attachments: Array.isArray(patch.attachments) ? patch.attachments : (Array.isArray(metadata.attachments) ? metadata.attachments : [])
  };
  const nextContent = patch.content === undefined
    ? row.content
    : sanitizeText(patch.content, 20000, row.content);
  const pruneRunIds = new Set<string>();
  if (row.run_id) pruneRunIds.add(row.run_id);
  const laterRows = db.prepare(`
    SELECT id, run_id
    FROM agent_messages
    WHERE thread_id = ? AND rowid > ?
  `).all(row.thread_id, row.rowid) as Array<{ id: string; run_id: string | null }>;
  for (const laterRow of laterRows) {
    if (laterRow.run_id) pruneRunIds.add(laterRow.run_id);
  }

  const mutate = db.transaction(() => {
    db.prepare(`
      UPDATE agent_messages
      SET content = ?, run_id = NULL, metadata_json = ?
      WHERE id = ?
    `).run(nextContent, JSON.stringify(nextMetadata), messageId);
    db.prepare(`
      DELETE FROM agent_messages
      WHERE thread_id = ? AND rowid > ?
    `).run(row.thread_id, row.rowid);
    for (const runId of pruneRunIds) {
      db.prepare("DELETE FROM agent_runs WHERE id = ? AND thread_id = ?").run(runId, row.thread_id);
    }
    db.prepare(`
      UPDATE agent_threads
      SET memory_summary = '', memory_updated_at = NULL, status = 'idle', updated_at = ?
      WHERE id = ?
    `).run(now(), row.thread_id);
  });
  mutate();
  return getAgentThreadState(row.thread_id);
}

export function deleteAgentMessage(messageId: string) {
  const row = getAgentMessageRow(messageId);
  if (!row || row.role === "system") return null;
  const pruneRunIds = new Set<string>();
  if (row.run_id) pruneRunIds.add(row.run_id);
  const targetAndLaterRows = db.prepare(`
    SELECT run_id
    FROM agent_messages
    WHERE thread_id = ? AND rowid >= ?
  `).all(row.thread_id, row.rowid) as Array<{ run_id: string | null }>;
  for (const item of targetAndLaterRows) {
    if (item.run_id) pruneRunIds.add(item.run_id);
  }

  const mutate = db.transaction(() => {
    db.prepare(`
      DELETE FROM agent_messages
      WHERE thread_id = ? AND rowid >= ?
    `).run(row.thread_id, row.rowid);
    for (const runId of pruneRunIds) {
      db.prepare("DELETE FROM agent_runs WHERE id = ? AND thread_id = ?").run(runId, row.thread_id);
    }
    db.prepare(`
      UPDATE agent_threads
      SET memory_summary = '', memory_updated_at = NULL, status = 'idle', updated_at = ?
      WHERE id = ?
    `).run(now(), row.thread_id);
  });
  mutate();
  return getAgentThreadState(row.thread_id);
}

export function forkAgentThreadFromMessage(messageId: string, name?: unknown) {
  const row = getAgentMessageRow(messageId);
  if (!row) return null;
  const sourceThread = getAgentThread(row.thread_id);
  if (!sourceThread) return null;
  const ts = now();
  const newThreadId = newId();
  const forkTitle = sanitizeText(name, 160, "") || `${sourceThread.title} branch`;

  const sourceSkills = db.prepare(`
    SELECT * FROM agent_skills
    WHERE thread_id = ?
    ORDER BY ordering ASC, created_at ASC
  `).all(row.thread_id) as Array<{
    id: string;
    thread_id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: number;
    ordering: number;
    created_at: string;
    updated_at: string;
  }>;
  const sourceMessages = db.prepare(`
    SELECT *
    FROM agent_messages
    WHERE thread_id = ? AND rowid <= ?
    ORDER BY rowid ASC
  `).all(row.thread_id, row.rowid) as Array<{
    id: string;
    thread_id: string;
    run_id: string | null;
    role: string;
    content: string;
    metadata_json: string | null;
    created_at: string;
  }>;

  const mutate = db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_threads (
        id, title, description, system_prompt, status, mode, hero_character_id, memory_summary, memory_updated_at,
        workspace_root, provider_id, model_id, tool_mode, max_iterations, max_subagents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'idle', ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newThreadId,
      forkTitle,
      sourceThread.description,
      sourceThread.systemPrompt,
      sourceThread.mode,
      sourceThread.heroCharacterId || null,
      sourceThread.workspaceRoot,
      sourceThread.providerId || null,
      sourceThread.modelId || null,
      sourceThread.toolMode,
      sourceThread.maxIterations,
      sourceThread.maxSubagents,
      ts,
      ts
    );

    const insertSkill = db.prepare(`
      INSERT INTO agent_skills (id, thread_id, name, description, instructions, enabled, ordering, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const skill of sourceSkills) {
      insertSkill.run(
        newId(),
        newThreadId,
        skill.name,
        skill.description,
        skill.instructions,
        skill.enabled,
        skill.ordering,
        skill.created_at,
        skill.updated_at
      );
    }

    const insertMessage = db.prepare(`
      INSERT INTO agent_messages (id, thread_id, run_id, role, content, metadata_json, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
    `);
    for (const message of sourceMessages) {
      insertMessage.run(
        newId(),
        newThreadId,
        message.role,
        message.content,
        message.metadata_json || "{}",
        message.created_at
      );
    }
  });
  mutate();
  return getAgentThread(newThreadId);
}

export function createAgentRun(input: {
  threadId: string;
  parentRunId?: string | null;
  title: string;
  depth: number;
}) {
  const ts = now();
  const id = newId();
  db.prepare(`
    INSERT INTO agent_runs (
      id, thread_id, parent_run_id, title, status, depth, summary, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'running', ?, '', ?, NULL, ?, ?)
  `).run(id, input.threadId, input.parentRunId || null, sanitizeText(input.title, 200, ""), input.depth, ts, ts, ts);
  touchThread(input.threadId, "running");
  return listAgentRuns(input.threadId).find((run) => run.id === id) || null;
}

export function completeAgentRun(runId: string, status: "done" | "error" | "aborted", summary: string) {
  const run = db.prepare("SELECT thread_id FROM agent_runs WHERE id = ?").get(runId) as { thread_id: string } | undefined;
  if (!run) return null;
  const ts = now();
  db.prepare(`
    UPDATE agent_runs
    SET status = ?, summary = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, sanitizeText(summary, 4000, ""), ts, ts, runId);
  touchThread(run.thread_id, status === "error" ? "error" : "idle");
  return run.thread_id;
}

export function listAgentRuns(threadId: string, limit = 40) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM agent_runs
      WHERE thread_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    )
    ORDER BY created_at DESC, id DESC
  `).all(threadId, limit) as Array<{
    id: string;
    thread_id: string;
    parent_run_id: string | null;
    title: string;
    status: string;
    depth: number;
    summary: string;
    started_at: string;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map(mapRun);
}

export function insertAgentEvent(input: {
  threadId: string;
  runId: string;
  parentEventId?: string | null;
  type: string;
  title: string;
  content?: string;
  payload?: Record<string, unknown>;
}) {
  const ts = now();
  const id = newId();
  db.prepare(`
    INSERT INTO agent_events (
      id, thread_id, run_id, parent_event_id, event_type, title, content, payload_json, ordering, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.threadId,
    input.runId,
    input.parentEventId || null,
    input.type,
    sanitizeText(input.title, 200, ""),
    sanitizeText(input.content, 12000, ""),
    JSON.stringify(input.payload || {}),
    nextEventOrder(input.runId),
    ts
  );
  touchThread(input.threadId, "running");
  return listAgentEvents(input.threadId, 200).find((event) => event.id === id) || null;
}

export function listAgentEvents(threadId: string, limit = 200) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM agent_events
      WHERE thread_id = ?
      ORDER BY created_at DESC, ordering DESC, id DESC
      LIMIT ?
    )
    ORDER BY created_at ASC, ordering ASC, id ASC
  `).all(threadId, limit) as Array<{
    id: string;
    thread_id: string;
    run_id: string;
    parent_event_id: string | null;
    event_type: string;
    title: string;
    content: string;
    payload_json: string | null;
    ordering: number;
    created_at: string;
  }>;
  return rows.map(mapEvent);
}

export function getAgentThreadState(threadId: string) {
  const thread = getAgentThread(threadId);
  if (!thread) return null;
  return {
    thread,
    skills: listAgentSkills(threadId),
    messages: listAgentMessages(threadId),
    runs: listAgentRuns(threadId),
    events: listAgentEvents(threadId)
  };
}

export function setAgentThreadStatus(threadId: string, status: "idle" | "running" | "error") {
  touchThread(threadId, status);
}

export function updateAgentThreadMemory(threadId: string, summary: string) {
  const ts = now();
  db.prepare(`
    UPDATE agent_threads
    SET memory_summary = ?, memory_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(sanitizeText(summary, 4000, ""), ts, ts, threadId);
  return getAgentThread(threadId);
}
