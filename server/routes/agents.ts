import { Router } from "express";
import type { Response } from "express";
import { readdirSync, statSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import { activeAgentAbortControllers, classifyAgentFollowupIntent, enqueueAgentSteeringNote, isPotentialAgentFollowupCueText, streamAgentTurn } from "../modules/agents/runtime.js";
import { sanitizeAttachments } from "../modules/chat/attachments.js";
import { getSettings } from "../modules/chat/routeHelpers.js";
import {
  createAgentSkill,
  createAgentThread,
  deleteAgentSkill,
  deleteAgentMessage,
  deleteAgentThread,
  forkAgentThreadFromMessage,
  getAgentMessageThreadId,
  getAgentThreadState,
  insertAgentMessage,
  listAgentSkills,
  listAgentThreads,
  updateAgentMessage,
  updateAgentSkill,
  updateAgentThread
} from "../modules/agents/repository.js";

const router = Router();

function sanitizeText(raw: unknown, maxLength: number) {
  return String(raw ?? "").trim().slice(0, maxLength);
}

function resolveWorkspaceRootInput(raw: unknown) {
  const value = String(raw ?? "").trim();
  const candidate = resolve(value || process.cwd());
  try {
    if (statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function ensureInsideProjectRoot(targetPath: string) {
  const projectRoot = resolve(process.cwd());
  const candidate = resolve(targetPath);
  const rel = relative(projectRoot, candidate);
  if (!rel || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel))) {
    return candidate;
  }
  return null;
}

function listWorkspaceDirectories(rawPath: unknown) {
  const projectRoot = resolve(process.cwd());
  const requested = String(rawPath ?? "").trim();
  const resolvedBase = ensureInsideProjectRoot(resolve(requested || projectRoot));
  const currentPath = resolvedBase || projectRoot;
  const entries = readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules")
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80)
    .map((entry) => {
      const path = resolve(currentPath, entry.name);
      return {
        name: entry.name,
        path,
        relativePath: relative(projectRoot, path).split("\\").join("/") || "."
      };
    });
  const parentPath = currentPath === projectRoot ? null : resolve(currentPath, "..");
  return {
    projectRoot,
    currentPath,
    currentRelativePath: relative(projectRoot, currentPath).split("\\").join("/") || ".",
    parentPath: parentPath && ensureInsideProjectRoot(parentPath) ? parentPath : null,
    entries
  };
}

function ensureThreadReady(threadId: string, res: Response) {
  const state = getAgentThreadState(threadId);
  if (!state) {
    res.status(404).json({ error: "Agent thread not found" });
    return null;
  }
  if (activeAgentAbortControllers.has(threadId)) {
    res.status(409).json({ error: "Agent thread is already running" });
    return null;
  }
  return state;
}

function getActiveTopLevelRun(state: NonNullable<ReturnType<typeof getAgentThreadState>>) {
  return [...state.runs]
    .filter((run) => run.status === "running")
    .sort((a, b) => a.depth - b.depth || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] || null;
}

function collectRunBranchIds(runs: Array<{ id: string; parentRunId?: string | null }>, runId: string) {
  const descendants = new Set<string>();
  const stack = [runId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    for (const run of runs) {
      if (run.parentRunId === current) {
        stack.push(run.id);
      }
    }
  }
  return descendants;
}

function buildFollowupContext(state: NonNullable<ReturnType<typeof getAgentThreadState>>, runId: string, mode: "resume" | "retry") {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return null;
  const branchRunIds = collectRunBranchIds(state.runs, run.id);
  const branchEvents = state.events
    .filter((event) => branchRunIds.has(event.runId))
    .slice(-18)
    .map((event) => {
      const content = sanitizeText(event.content, 400);
      return content ? `- [${event.type}] ${event.title}: ${content}` : `- [${event.type}] ${event.title}`;
    });
  const branchSummaries = state.runs
    .filter((item) => branchRunIds.has(item.id))
    .map((item) => `- ${item.title || "Run"} (${item.status})${item.summary ? `: ${sanitizeText(item.summary, 240)}` : ""}`)
    .slice(0, 8);
  const latestUserMessage = [...state.messages].reverse().find((message) => message.role === "user");

  const extraContext = [
    mode === "resume"
      ? `Resume the previous run "${run.title || "Run"}" from where it stopped.`
      : `Retry the previous run "${run.title || "Run"}" for the same user goal.`,
    `Target run status: ${run.status}.`,
    run.summary ? `Target run summary: ${sanitizeText(run.summary, 600)}` : "",
    branchSummaries.length > 0 ? `Relevant run branch:\n${branchSummaries.join("\n")}` : "",
    branchEvents.length > 0 ? `Relevant trace from the previous attempt:\n${branchEvents.join("\n")}` : "",
    latestUserMessage?.content ? `Original user goal to keep in mind:\n${sanitizeText(latestUserMessage.content, 4000)}` : "",
    mode === "resume"
      ? "Continue from the last credible checkpoint. Avoid repeating completed steps unless verification is necessary."
      : "Start a fresh attempt using what the previous run already learned. Reconsider weak steps instead of blindly repeating them."
  ].filter(Boolean);

  return {
    run,
    extraContext
  };
}

function buildContinuationCueContext(
  state: NonNullable<ReturnType<typeof getAgentThreadState>>,
  cueText: string,
  reason?: string
) {
  const previousUserGoal = [...state.messages]
    .reverse()
    .find((message) => message.role === "user"
      && message.metadata?.steering !== true
      && message.metadata?.followupIntent !== "continuation"
      && sanitizeText(message.content, 4000));
  const recentTopLevelRun = [...state.runs]
    .filter((run) => run.depth === 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] || null;
  const latestAssistantCheckpoint = [...state.messages]
    .reverse()
    .find((message) => message.role === "assistant" && sanitizeText(message.content, 4000));
  if (!previousUserGoal && !recentTopLevelRun && !latestAssistantCheckpoint) {
    return null;
  }
  const branchRunIds = recentTopLevelRun ? collectRunBranchIds(state.runs, recentTopLevelRun.id) : new Set<string>();
  const branchSummaries = recentTopLevelRun
    ? state.runs
      .filter((run) => branchRunIds.has(run.id))
      .map((run) => `- ${run.title || "Run"} (${run.status})${run.summary ? `: ${sanitizeText(run.summary, 240)}` : ""}`)
      .slice(0, 8)
    : [];
  const branchEvents = recentTopLevelRun
    ? state.events
      .filter((event) => branchRunIds.has(event.runId))
      .slice(-12)
      .map((event) => {
        const content = sanitizeText(event.content, 300);
        return content ? `- [${event.type}] ${event.title}: ${content}` : `- [${event.type}] ${event.title}`;
      })
    : [];

  const extraContext = [
    `The latest user message is a continuation cue ("${sanitizeText(cueText, 120)}"), not a brand-new task.`,
    reason ? `Intent classifier reason: ${sanitizeText(reason, 400)}` : "",
    "Continue the existing task already in progress for this thread instead of answering with a meta explanation or restating what has not been done yet.",
    "This is still an execution request. If workspace tools are available, take the next concrete tool action now instead of replying with a plan, checkpoint, or status-only message.",
    previousUserGoal?.content ? `Original user goal to keep in mind:\n${sanitizeText(previousUserGoal.content, 4000)}` : "",
    recentTopLevelRun ? `Most recent top-level run: "${recentTopLevelRun.title || "Run"}" (${recentTopLevelRun.status})${recentTopLevelRun.summary ? `.\nSummary: ${sanitizeText(recentTopLevelRun.summary, 600)}` : ""}` : "",
    branchSummaries.length > 0 ? `Relevant recent run branch:\n${branchSummaries.join("\n")}` : "",
    branchEvents.length > 0 ? `Relevant recent trace:\n${branchEvents.join("\n")}` : "",
    latestAssistantCheckpoint?.content ? `Latest assistant checkpoint:\n${sanitizeText(latestAssistantCheckpoint.content, 3000)}` : "",
    "Pick up from the latest credible checkpoint. Reuse completed work, avoid generic restarts, and take the next concrete action."
  ].filter(Boolean);

  if (extraContext.length <= 3 && !previousUserGoal && !recentTopLevelRun && !latestAssistantCheckpoint) {
    return null;
  }
  return {
    extraContext
  };
}

function buildFollowupClassificationContext(state: NonNullable<ReturnType<typeof getAgentThreadState>>) {
  const previousUserGoal = [...state.messages]
    .reverse()
    .find((message) => message.role === "user"
      && message.metadata?.steering !== true
      && message.metadata?.followupIntent !== "continuation"
      && sanitizeText(message.content, 4000));
  const recentTopLevelRun = [...state.runs]
    .filter((run) => run.depth === 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] || null;
  const latestAssistantCheckpoint = [...state.messages]
    .reverse()
    .find((message) => message.role === "assistant" && sanitizeText(message.content, 3000));
  return {
    threadMode: state.thread.mode,
    previousUserGoal: sanitizeText(previousUserGoal?.content, 4000),
    latestAssistantCheckpoint: sanitizeText(latestAssistantCheckpoint?.content, 3000),
    recentRunStatus: recentTopLevelRun?.status || "",
    recentRunSummary: sanitizeText(recentTopLevelRun?.summary, 1200)
  };
}

function hasFollowupClassificationContext(context: ReturnType<typeof buildFollowupClassificationContext>) {
  return Boolean(
    context.previousUserGoal
    || context.latestAssistantCheckpoint
    || context.recentRunStatus
    || context.recentRunSummary
  );
}

router.use((req, res, next) => {
  const settings = getSettings();
  if (settings.agentsEnabled !== true) {
    res.status(403).json({ error: "Agents feature is disabled in Settings" });
    return;
  }
  next();
});

router.get("/threads", (_req, res) => {
  res.json(listAgentThreads());
});

router.get("/workspace/directories", (req, res) => {
  res.json(listWorkspaceDirectories(req.query.path));
});

router.post("/threads", (req, res) => {
  if (req.body && "workspaceRoot" in req.body) {
    const workspaceRoot = resolveWorkspaceRootInput(req.body.workspaceRoot);
    if (!workspaceRoot) {
      res.status(400).json({ error: "Workspace root must point to an existing directory" });
      return;
    }
    req.body.workspaceRoot = workspaceRoot;
  }
  const created = createAgentThread(req.body ?? {});
  if (!created) {
    res.status(500).json({ error: "Failed to create agent thread" });
    return;
  }
  res.json(created);
});

router.get("/threads/:id/state", (req, res) => {
  const state = getAgentThreadState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Agent thread not found" });
    return;
  }
  res.json(state);
});

router.patch("/threads/:id", (req, res) => {
  if (req.body && "workspaceRoot" in req.body) {
    const workspaceRoot = resolveWorkspaceRootInput(req.body.workspaceRoot);
    if (!workspaceRoot) {
      res.status(400).json({ error: "Workspace root must point to an existing directory" });
      return;
    }
    req.body.workspaceRoot = workspaceRoot;
  }
  const updated = updateAgentThread(req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: "Agent thread not found" });
    return;
  }
  res.json(updated);
});

router.delete("/threads/:id", (req, res) => {
  if (activeAgentAbortControllers.has(req.params.id)) {
    res.status(409).json({ error: "Cannot delete a running agent thread" });
    return;
  }
  deleteAgentThread(req.params.id);
  res.json({ ok: true });
});

router.get("/threads/:id/skills", (req, res) => {
  const state = getAgentThreadState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Agent thread not found" });
    return;
  }
  res.json(listAgentSkills(req.params.id));
});

router.post("/threads/:id/skills", (req, res) => {
  const state = getAgentThreadState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Agent thread not found" });
    return;
  }
  const created = createAgentSkill(req.params.id, req.body ?? {});
  res.json(created);
});

router.patch("/threads/:id/skills/:skillId", (req, res) => {
  const updated = updateAgentSkill(req.params.id, req.params.skillId, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: "Skill not found" });
    return;
  }
  res.json(updated);
});

router.delete("/threads/:id/skills/:skillId", (req, res) => {
  deleteAgentSkill(req.params.id, req.params.skillId);
  res.json({ ok: true });
});

router.post("/threads/:id/abort", (req, res) => {
  const controller = activeAgentAbortControllers.get(req.params.id);
  if (controller) {
    controller.abort();
    res.json({ ok: true, interrupted: true });
    return;
  }
  res.json({ ok: true, interrupted: false });
});

router.post("/threads/:id/steer", (req, res) => {
  const state = getAgentThreadState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Agent thread not found" });
    return;
  }
  if (!activeAgentAbortControllers.has(req.params.id)) {
    res.status(409).json({ error: "Agent thread is not currently running" });
    return;
  }
  const activeRun = getActiveTopLevelRun(state);
  if (!activeRun) {
    res.status(409).json({ error: "No active agent run found for this thread" });
    return;
  }
  const content = String(req.body?.content || "").trim();
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!content && attachments.length === 0) {
    res.status(400).json({ error: "Steering update requires content or attachments" });
    return;
  }
  const message = insertAgentMessage({
    threadId: req.params.id,
    runId: activeRun.id,
    role: "user",
    content,
    metadata: {
      steering: true,
      steeringForRunId: activeRun.id
    },
    attachments
  });
  if (!message) {
    res.status(500).json({ error: "Failed to record steering update" });
    return;
  }
  enqueueAgentSteeringNote({
    threadId: req.params.id,
    messageId: message.id,
    runId: activeRun.id,
    content,
    attachments,
    createdAt: message.createdAt
  });
  res.json({
    ok: true,
    message,
    state: getAgentThreadState(req.params.id)
  });
});

router.post("/threads/:id/respond", async (req, res: Response) => {
  const state = ensureThreadReady(req.params.id, res);
  if (!state) return;
  const content = String(req.body?.content || "").trim();
  const attachments = sanitizeAttachments(req.body?.attachments);
  const followupClassificationContext = buildFollowupClassificationContext(state);
  const followupIntent = content
    && attachments.length === 0
    && state.thread.mode !== "ask"
    && isPotentialAgentFollowupCueText(content)
    && hasFollowupClassificationContext(followupClassificationContext)
    ? await classifyAgentFollowupIntent({
      threadId: req.params.id,
      latestUserMessage: content,
      context: followupClassificationContext
    })
    : null;
  const continuationContext = followupIntent?.intent === "continuation" && followupIntent.confidence >= 0.55
    ? buildContinuationCueContext(state, content, followupIntent.reason)
    : null;
  const pendingUserMessage = (content || attachments.length > 0)
    ? insertAgentMessage({
      threadId: req.params.id,
      role: "user",
      content,
      metadata: {
        followupIntent: followupIntent?.intent,
        followupConfidence: followupIntent?.confidence,
        followupReason: followupIntent?.reason
      },
      attachments
    })
    : null;
  await streamAgentTurn({
    threadId: req.params.id,
    pendingUserMessageId: pendingUserMessage?.id || null,
    res,
    extraContext: continuationContext?.extraContext
  });
});

router.patch("/messages/:messageId", (req, res) => {
  const threadId = getAgentMessageThreadId(req.params.messageId);
  if (!threadId) {
    res.status(404).json({ error: "Agent message not found or not editable" });
    return;
  }
  if (activeAgentAbortControllers.has(threadId)) {
    res.status(409).json({ error: "Cannot edit a message while the agent thread is running" });
    return;
  }
  const attachments = req.body && Object.prototype.hasOwnProperty.call(req.body, "attachments")
    ? sanitizeAttachments(req.body.attachments)
    : undefined;
  const targetState = updateAgentMessage(req.params.messageId, {
    content: req.body?.content,
    attachments
  });
  if (!targetState) {
    res.status(404).json({ error: "Agent message not found or not editable" });
    return;
  }
  res.json({ ok: true, state: targetState });
});

router.delete("/messages/:messageId", (req, res) => {
  const threadId = getAgentMessageThreadId(req.params.messageId);
  if (!threadId) {
    res.status(404).json({ error: "Agent message not found" });
    return;
  }
  if (activeAgentAbortControllers.has(threadId)) {
    res.status(409).json({ error: "Cannot delete a message while the agent thread is running" });
    return;
  }
  const state = deleteAgentMessage(req.params.messageId);
  if (!state) {
    res.status(404).json({ error: "Agent message not found" });
    return;
  }
  res.json({ ok: true, state });
});

router.post("/messages/:messageId/fork", (req, res) => {
  const threadId = getAgentMessageThreadId(req.params.messageId);
  if (!threadId) {
    res.status(404).json({ error: "Agent message not found" });
    return;
  }
  if (activeAgentAbortControllers.has(threadId)) {
    res.status(409).json({ error: "Cannot fork from a message while the agent thread is running" });
    return;
  }
  const created = forkAgentThreadFromMessage(req.params.messageId, req.body?.name);
  if (!created) {
    res.status(404).json({ error: "Agent message not found" });
    return;
  }
  res.json(created);
});

router.post("/threads/:id/runs/:runId/retry", async (req, res: Response) => {
  const state = ensureThreadReady(req.params.id, res);
  if (!state) return;
  const followup = buildFollowupContext(state, req.params.runId, "retry");
  if (!followup) {
    res.status(404).json({ error: "Agent run not found" });
    return;
  }
  await streamAgentTurn({
    threadId: req.params.id,
    res,
    extraContext: followup.extraContext,
    launchIntent: {
      mode: "retry",
      sourceRunId: followup.run.id,
      sourceStatus: followup.run.status,
      sourceTitle: followup.run.title
    }
  });
});

router.post("/threads/:id/runs/:runId/resume", async (req, res: Response) => {
  const state = ensureThreadReady(req.params.id, res);
  if (!state) return;
  const followup = buildFollowupContext(state, req.params.runId, "resume");
  if (!followup) {
    res.status(404).json({ error: "Agent run not found" });
    return;
  }
  if (followup.run.status !== "error" && followup.run.status !== "aborted") {
    res.status(409).json({ error: "Only aborted or failed runs can be resumed" });
    return;
  }
  await streamAgentTurn({
    threadId: req.params.id,
    res,
    extraContext: followup.extraContext,
    launchIntent: {
      mode: "resume",
      sourceRunId: followup.run.id,
      sourceStatus: followup.run.status,
      sourceTitle: followup.run.title
    }
  });
});

export default router;
