import { startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ThreePanelLayout, Badge, EmptyState } from "../../components/Panels";
import { api } from "../../shared/api";
import { resolveApiAssetUrl, type StreamCallbacks } from "../../shared/api/core";
import { useI18n } from "../../shared/i18n";
import type {
  AgentEvent,
  AgentMessage,
  AgentMode,
  AgentPendingConfirmation,
  AgentSkill,
  AgentThread,
  AgentThreadState,
  AgentWorkspaceDirectoryState,
  AppSettings,
  FileAttachment,
  ProviderModel,
  ProviderProfile
} from "../../shared/types/contracts";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask
} from "../../shared/backgroundTasks";
import { guessMimeType, imageSourceFromAttachment, normalizeReasoningDisplayText, parseInlineReasoning, renderMarkdown } from "../chat/utils";
import { AttachmentCard } from "../chat/components/AttachmentCard";
import { AttachmentPreviewModal, type AttachmentViewerState } from "../chat/components/AttachmentPreviewModal";

type TimelineItem =
  | { kind: "message"; id: string; createdAt: string; role: "system" | "user" | "assistant"; content: string; attachments: FileAttachment[]; runId?: string | null; metadata?: Record<string, unknown> }
  | { kind: "event"; id: string; createdAt: string; type: string; title: string; content: string; order: number; depth: number; runId: string; payload: Record<string, unknown> };

type RunTreeNode = AgentThreadState["runs"][number] & { children: RunTreeNode[] };

const AGENT_CENTER_MAX_WIDTH_CLASS = "max-w-[1000px]";

function compactPathLabel(rawPath: string) {
  const value = String(rawPath || "").trim();
  if (!value) return ".";
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return value;
  return `${parts.slice(-2).join("/")}`;
}

function buildWorkspaceTrail(state: AgentWorkspaceDirectoryState | null) {
  if (!state) return [];
  const rootPath = state.projectRoot;
  const currentPath = state.currentPath;
  const rootParts = rootPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const currentParts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const trail: Array<{ label: string; path: string }> = [{
    label: rootParts[rootParts.length - 1] || "/",
    path: rootPath
  }];
  for (let index = rootParts.length; index < currentParts.length; index += 1) {
    const slice = currentParts.slice(0, index + 1).join("/");
    const absolutePath = `${currentPath.startsWith("/") ? "/" : ""}${slice}`;
    trail.push({
      label: currentParts[index] || ".",
      path: absolutePath
    });
  }
  return trail;
}

function eventTone(type: string) {
  if (type === "error") return "danger";
  if (type === "warning") return "warning";
  if (type === "memory") return "success";
  if (type === "tool_result" || type === "subagent_done") return "success";
  if (type === "tool_call" || type === "subagent_start") return "accent";
  return "default";
}

function isCompactEvent(type: string) {
  return type === "status" || type === "plan" || type === "memory";
}

function shouldShowEventInMainTimeline(item: Extract<TimelineItem, { kind: "event" }>) {
  return item.type === "tool_call"
    || item.type === "tool_result"
    || item.type === "subagent_start"
    || item.type === "subagent_done"
    || item.type === "error";
}

function sortTimeline(a: TimelineItem, b: TimelineItem) {
  const dateCompare = a.createdAt.localeCompare(b.createdAt);
  if (dateCompare !== 0) return dateCompare;
  if (a.kind === "event" && b.kind === "event") return a.order - b.order;
  if (a.kind === b.kind) return a.id.localeCompare(b.id);
  return a.kind === "event" ? -1 : 1;
}

function modeTone(mode: AgentMode) {
  if (mode === "research") return "warning";
  if (mode === "ask") return "default";
  return "accent";
}

function modeLabelKey(mode: AgentMode) {
  if (mode === "ask") return "agents.modeAsk";
  if (mode === "research") return "agents.modeResearch";
  return "agents.modeBuild";
}

function modeDescriptionKey(mode: AgentMode) {
  if (mode === "ask") return "agents.modeAskDesc";
  if (mode === "research") return "agents.modeResearchDesc";
  return "agents.modeBuildDesc";
}

function threadStatusTone(status: AgentThread["status"]) {
  if (status === "running") return "accent";
  if (status === "error") return "danger";
  return "default";
}

function runStatusTone(status: RunTreeNode["status"]) {
  if (status === "done") return "success";
  if (status === "error") return "danger";
  if (status === "aborted") return "warning";
  return "accent";
}

function ModeGlyph({ mode }: { mode: AgentMode }) {
  if (mode === "ask") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h5.5M6.75 5.25h10.5A2.25 2.25 0 0119.5 7.5v6A2.25 2.25 0 0117.25 15.75H12l-3.75 3v-3H6.75A2.25 2.25 0 014.5 13.5v-6a2.25 2.25 0 012.25-2.25z" />
      </svg>
    );
  }
  if (mode === "research") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 4.5a6 6 0 104.243 10.243l4.507 4.507m-3.257-9.75h-6" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75A2.25 2.25 0 016.75 4.5h4.5A2.25 2.25 0 0113.5 6.75v4.5a2.25 2.25 0 01-2.25 2.25h-4.5A2.25 2.25 0 014.5 11.25v-4.5zM15 4.875a1.125 1.125 0 011.125-1.125h2.25A1.125 1.125 0 0119.5 4.875v2.25A1.125 1.125 0 0118.375 8.25h-2.25A1.125 1.125 0 0115 7.125v-2.25zM10.5 16.5h6.75A2.25 2.25 0 0119.5 18.75v.75H8.25v-.75A2.25 2.25 0 0110.5 16.5z" />
    </svg>
  );
}

function InspectorSection({
  title,
  caption,
  open,
  onToggle,
  action,
  children
}: {
  title: string;
  caption?: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-border-subtle bg-bg-secondary">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition-colors hover:text-text-primary"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{title}</div>
            {caption ? <div className="mt-1 text-[11px] leading-5 text-text-secondary">{caption}</div> : null}
          </div>
          <svg className={`h-4 w-4 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? <div className="border-t border-border-subtle px-3 py-3">{children}</div> : null}
    </div>
  );
}

function buildRunTree(runs: AgentThreadState["runs"]): RunTreeNode[] {
  const nodes = new Map<string, RunTreeNode>();
  const roots: RunTreeNode[] = [];
  const orderedRuns = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  orderedRuns.forEach((run) => {
    nodes.set(run.id, { ...run, children: [] });
  });

  orderedRuns.forEach((run) => {
    const node = nodes.get(run.id);
    if (!node) return;
    if (run.parentRunId && nodes.has(run.parentRunId)) {
      nodes.get(run.parentRunId)?.children.push(node);
      return;
    }
    roots.push(node);
  });

  return roots.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function collectRunIds(node: RunTreeNode): string[] {
  return [node.id, ...node.children.flatMap(collectRunIds)];
}

function MarkdownContent({
  content,
  className
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

function stringifyToolData(raw: unknown) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

function shouldCollapseToolBlock(text: string) {
  const lines = text.split(/\r?\n/);
  return text.length > 720 || lines.length > 12;
}

function getCollapsedToolPreview(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 12) {
    return `${lines.slice(0, 10).join("\n")}\n…`;
  }
  if (text.length > 720) {
    return `${text.slice(0, 680).trimEnd()}\n…`;
  }
  return text;
}

function getOneLineToolPreview(raw: unknown) {
  const normalized = stringifyToolData(raw)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}...` : normalized;
}

export function AgentsScreen({
  initialThreadId,
  onInitialThreadHandled
}: {
  initialThreadId?: string | null;
  onInitialThreadHandled?: () => void;
}) {
  const { t } = useI18n();
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [appSettings, setAppSettings] = useState<Pick<AppSettings, "agentWorkspaceToolsEnabled" | "agentCommandToolEnabled" | "agentDangerousFileOpsEnabled" | "agentNetworkCommandsEnabled" | "agentShellCommandsEnabled" | "agentGitWriteCommandsEnabled" | "agentAutoCompactEnabled" | "agentReplyReserveTokens" | "agentToolContextChars" | "mcpServers"> | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadState, setThreadState] = useState<AgentThreadState | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingState, setLoadingState] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<AgentPendingConfirmation | null>(null);
  const [resolvingConfirmation, setResolvingConfirmation] = useState<"approve" | "deny" | null>(null);
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [streamPreview, setStreamPreview] = useState("");
  const [streamReasoningPreview, setStreamReasoningPreview] = useState("");
  const [streamReasoningExpanded, setStreamReasoningExpanded] = useState(true);
  const [sendingSteering, setSendingSteering] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingThread, setSavingThread] = useState(false);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState<string | null>(null);
  const [quickStartExpanded, setQuickStartExpanded] = useState(true);
  const [quickStartTouched, setQuickStartTouched] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1500;
  });
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"overview" | "setup" | "skills" | "runs" | "integrations">("overview");
  const [inspectorSections, setInspectorSections] = useState({
    overview: true,
    config: true,
    skills: true,
    runs: true,
    integrations: true
  });
  const [threadDraft, setThreadDraft] = useState<{
    title: string;
    description: string;
    systemPrompt: string;
    developerPrompt: string;
    mode: AgentMode;
    heroCharacterId: string;
    heroCharacterName: string;
    workspaceRoot: string;
    providerId: string;
    modelId: string;
    toolMode: "enabled" | "disabled";
    maxIterations: number;
    maxSubagents: number;
  } | null>(null);
  const [skillDrafts, setSkillDrafts] = useState<AgentSkill[]>([]);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageValue, setEditingMessageValue] = useState("");
  const [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewerState | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [workspaceDirectories, setWorkspaceDirectories] = useState<AgentWorkspaceDirectoryState | null>(null);
  const [loadingWorkspaceDirectories, setLoadingWorkspaceDirectories] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspacePickerQuery, setWorkspacePickerQuery] = useState("");
  const [expandedToolBlocks, setExpandedToolBlocks] = useState<Record<string, boolean>>({});
  const [expandedToolEvents, setExpandedToolEvents] = useState<Record<string, boolean>>({});
  const [reasoningPanelsExpanded, setReasoningPanelsExpanded] = useState<Record<string, boolean>>({});
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamPreviewRef = useRef("");
  const streamReasoningPreviewRef = useRef("");

  const selectedThread = threadState?.thread ?? null;
  const sidebarCollapsed = !sidebarOpen;

  const filteredThreads = useMemo(() => {
    const query = threadQuery.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => (
      thread.title.toLowerCase().includes(query)
      || thread.description.toLowerCase().includes(query)
    ));
  }, [threads, threadQuery]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!threadState) return [];
    const messages = threadState.messages
      .filter((message) => message.role !== "system" || !message.metadata?.hidden)
      .map((message) => ({
        kind: "message" as const,
        id: message.id,
        createdAt: message.createdAt,
        role: message.role,
        content: message.content,
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        runId: message.runId,
        metadata: message.metadata || {}
      }));
    const events = threadState.events.map((event) => ({
      kind: "event" as const,
      id: event.id,
      createdAt: event.createdAt,
      type: event.type,
      title: event.title,
      content: event.content,
      order: event.order,
      depth: Number(event.payload.depth) || 0,
      runId: event.runId,
      payload: event.payload || {}
    }));
    return [...messages, ...events].sort(sortTimeline);
  }, [threadState]);

  const runTree = useMemo(() => buildRunTree(threadState?.runs || []), [threadState?.runs]);
  const selectedRun = useMemo(
    () => (selectedTraceRunId ? threadState?.runs.find((run) => run.id === selectedTraceRunId) ?? null : null),
    [selectedTraceRunId, threadState?.runs]
  );
  const actionRun = selectedRun ?? threadState?.runs[0] ?? null;
  const activeRun = useMemo(
    () => [...(threadState?.runs || [])]
      .filter((run) => run.status === "running")
      .sort((a, b) => a.depth - b.depth || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null,
    [threadState?.runs]
  );
  const enabledSkillCount = useMemo(
    () => skillDrafts.filter((skill) => skill.enabled).length,
    [skillDrafts]
  );
  const workspaceRootLabel = useMemo(
    () => compactPathLabel(threadDraft?.workspaceRoot || selectedThread?.workspaceRoot || ""),
    [threadDraft?.workspaceRoot, selectedThread?.workspaceRoot]
  );
  const workspaceTrail = useMemo(
    () => buildWorkspaceTrail(workspaceDirectories),
    [workspaceDirectories]
  );
  const filteredWorkspaceEntries = useMemo(() => {
    const entries = workspaceDirectories?.entries || [];
    const query = workspacePickerQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => (
      entry.name.toLowerCase().includes(query) || entry.relativePath.toLowerCase().includes(query)
    ));
  }, [workspaceDirectories?.entries, workspacePickerQuery]);
  const hasDraftPayload = composer.trim().length > 0 || attachments.length > 0;
  const composerPlaceholder = running ? t("agents.composerCorrectionPlaceholder") : t("agents.composerPlaceholder");
  const composerStatusLabel = pendingConfirmation
    ? t("agents.pendingConfirmationStatus")
    : running
      ? t("agents.runningCorrectionHint")
      : status || t("agents.workspaceReady");
  const showInspector = Boolean(workspaceOpen && selectedThread && threadDraft);
  const agentLayoutClassName = `agents-layout chat-simple-layout is-thread ${showInspector ? "is-inspector-open" : "is-inspector-closed"} ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-closed"}`;
  const enabledMcpServers = useMemo(
    () => (appSettings?.mcpServers || []).filter((server) => server.enabled !== false).length,
    [appSettings?.mcpServers]
  );

  const traceRunIds = useMemo(() => {
    if (!selectedTraceRunId) return null;
    const stack = [...runTree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.id === selectedTraceRunId) {
        return new Set(collectRunIds(node));
      }
      stack.push(...node.children);
    }
    return null;
  }, [runTree, selectedTraceRunId]);

  const filteredTimeline = useMemo(() => {
    if (!traceRunIds) {
      return timeline.filter((item) => (
        item.kind === "message" || shouldShowEventInMainTimeline(item)
      ));
    }
    return timeline.filter((item) => (
      item.kind === "message" ? (() => {
        const runId = item.runId || "";
        return Boolean(runId) && traceRunIds.has(runId);
      })() : traceRunIds.has(item.runId)
    ));
  }, [timeline, traceRunIds]);

  const eventCountByRun = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of threadState?.events || []) {
      counts.set(event.runId, (counts.get(event.runId) || 0) + 1);
    }
    return counts;
  }, [threadState?.events]);

  useEffect(() => {
    void (async () => {
      setLoadingThreads(true);
      try {
        const [threadList, providerList, settings] = await Promise.all([
          api.agentThreadList(),
          api.providerList(),
          api.settingsGet()
        ]);
        setThreads(threadList);
        setProviders(providerList);
        setAppSettings({
          agentWorkspaceToolsEnabled: settings.agentWorkspaceToolsEnabled !== false,
          agentCommandToolEnabled: settings.agentCommandToolEnabled !== false,
          agentDangerousFileOpsEnabled: settings.agentDangerousFileOpsEnabled === true,
          agentNetworkCommandsEnabled: settings.agentNetworkCommandsEnabled === true,
          agentShellCommandsEnabled: settings.agentShellCommandsEnabled === true,
          agentGitWriteCommandsEnabled: settings.agentGitWriteCommandsEnabled === true,
          agentAutoCompactEnabled: settings.agentAutoCompactEnabled !== false,
          agentReplyReserveTokens: settings.agentReplyReserveTokens,
          agentToolContextChars: settings.agentToolContextChars,
          mcpServers: Array.isArray(settings.mcpServers) ? settings.mcpServers : []
        });
        if (initialThreadId && threadList.some((thread) => thread.id === initialThreadId)) {
          setSelectedThreadId(initialThreadId);
        } else if (threadList[0]) {
          setSelectedThreadId(threadList[0].id);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setLoadingThreads(false);
      }
    })();
  }, [initialThreadId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (!detail) return;
      setAppSettings({
        agentWorkspaceToolsEnabled: detail.agentWorkspaceToolsEnabled !== false,
        agentCommandToolEnabled: detail.agentCommandToolEnabled !== false,
        agentDangerousFileOpsEnabled: detail.agentDangerousFileOpsEnabled === true,
        agentNetworkCommandsEnabled: detail.agentNetworkCommandsEnabled === true,
        agentShellCommandsEnabled: detail.agentShellCommandsEnabled === true,
        agentGitWriteCommandsEnabled: detail.agentGitWriteCommandsEnabled === true,
        agentAutoCompactEnabled: detail.agentAutoCompactEnabled !== false,
        agentReplyReserveTokens: detail.agentReplyReserveTokens,
        agentToolContextChars: detail.agentToolContextChars,
        mcpServers: Array.isArray(detail.mcpServers) ? detail.mcpServers : []
      });
    };
    window.addEventListener("settings-change", handler as EventListener);
    return () => window.removeEventListener("settings-change", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!initialThreadId || !threads.some((thread) => thread.id === initialThreadId)) return;
    setSelectedThreadId(initialThreadId);
    onInitialThreadHandled?.();
  }, [initialThreadId, threads, onInitialThreadHandled]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThreadState(null);
      setPendingConfirmation(null);
      setThreadDraft(null);
      setSkillDrafts([]);
      setSelectedTraceRunId(null);
      return;
    }
    void refreshThreadState(selectedThreadId);
  }, [selectedThreadId]);

  useEffect(() => {
    setSelectedTraceRunId(null);
  }, [threadState?.thread.id]);

  useEffect(() => {
    if (!selectedTraceRunId) return;
    if (threadState?.runs.some((run) => run.id === selectedTraceRunId)) return;
    setSelectedTraceRunId(null);
  }, [selectedTraceRunId, threadState?.runs]);

  useEffect(() => {
    setExpandedToolBlocks({});
    setExpandedToolEvents({});
    setReasoningPanelsExpanded({});
    setStreamReasoningPreview("");
    setStreamReasoningExpanded(true);
  }, [selectedThreadId]);

  useEffect(() => {
    setAttachments([]);
    setUploading(false);
    cancelEditMessage();
    setAttachmentViewer(null);
    setWorkspacePickerOpen(false);
    setWorkspacePickerQuery("");
  }, [selectedThreadId]);

  useEffect(() => {
    if (!editingMessageId) return;
    if (threadState?.messages.some((message) => message.id === editingMessageId)) return;
    cancelEditMessage();
  }, [editingMessageId, threadState?.messages]);

  useEffect(() => {
    if (!threadState) {
      setThreadDraft(null);
      setSkillDrafts([]);
      return;
    }
    setThreadDraft({
      title: threadState.thread.title,
      description: threadState.thread.description,
      systemPrompt: threadState.thread.systemPrompt,
      developerPrompt: threadState.thread.developerPrompt || "",
      mode: threadState.thread.mode,
      heroCharacterId: threadState.thread.heroCharacterId || "",
      heroCharacterName: threadState.thread.heroCharacterName || "",
      workspaceRoot: threadState.thread.workspaceRoot,
      providerId: threadState.thread.providerId || "",
      modelId: threadState.thread.modelId || "",
      toolMode: threadState.thread.toolMode,
      maxIterations: threadState.thread.maxIterations,
      maxSubagents: threadState.thread.maxSubagents
    });
    setSkillDrafts(threadState.skills);
  }, [threadState?.thread.id, threadState?.thread.updatedAt, threadState?.skills.length]);

  useEffect(() => {
    const providerId = threadDraft?.providerId || "";
    if (!providerId) {
      setModels([]);
      return;
    }
    void (async () => {
      setLoadingModels(true);
      try {
        const nextModels = await api.providerFetchModels(providerId);
        setModels(nextModels);
      } catch {
        setModels([]);
      } finally {
        setLoadingModels(false);
      }
    })();
  }, [threadDraft?.providerId]);

  useEffect(() => {
    const workspaceRoot = threadDraft?.workspaceRoot;
    if (!workspaceRoot) {
      setWorkspaceDirectories(null);
      return;
    }
    void (async () => {
      setLoadingWorkspaceDirectories(true);
      try {
        const nextDirectories = await api.agentWorkspaceDirectories(workspaceRoot);
        setWorkspaceDirectories(nextDirectories);
      } catch {
        setWorkspaceDirectories(null);
      } finally {
        setLoadingWorkspaceDirectories(false);
      }
    })();
  }, [threadDraft?.workspaceRoot]);

  useEffect(() => {
    if (quickStartTouched || loadingThreads || threads.length === 0) return;
    setQuickStartExpanded(false);
  }, [quickStartTouched, loadingThreads, threads.length]);

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: (streamPreview || streamReasoningPreview) ? "smooth" : "auto"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedThreadId, filteredTimeline.length, streamPreview, streamReasoningPreview]);

  async function refreshThreads(nextSelectedId?: string | null) {
    const threadList = await api.agentThreadList();
    setThreads(threadList);
    if (nextSelectedId !== undefined) {
      startTransition(() => setSelectedThreadId(nextSelectedId));
    } else if (selectedThreadId && !threadList.some((thread) => thread.id === selectedThreadId)) {
      startTransition(() => setSelectedThreadId(threadList[0]?.id || null));
    }
  }

  async function refreshThreadState(threadId: string) {
    setLoadingState(true);
    try {
      const [state, pending] = await Promise.all([
        api.agentThreadState(threadId),
        api.agentPendingConfirmation(threadId)
      ]);
      setThreadState(state);
      setPendingConfirmation(pending.pending);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingState(false);
    }
  }

  async function createThread(mode: AgentMode = "build") {
    try {
      const created = await api.agentThreadCreate({
        title: mode === "ask"
          ? t("agents.newAskThreadDefault")
          : mode === "research"
            ? t("agents.newResearchThreadDefault")
            : t("agents.newBuildThreadDefault"),
        description: "",
        systemPrompt: t("agents.defaultSystemPrompt"),
        mode
      });
      await refreshThreads(created.id);
      setStatus(t("agents.threadCreated"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveThread() {
    if (!selectedThreadId || !threadDraft) return;
    setSavingThread(true);
    try {
      await api.agentThreadUpdate(selectedThreadId, {
        title: threadDraft.title.trim() || t("agents.newThreadDefault"),
        description: threadDraft.description,
        systemPrompt: threadDraft.systemPrompt,
        developerPrompt: threadDraft.developerPrompt,
        mode: threadDraft.mode,
        heroCharacterId: threadDraft.heroCharacterId || null,
        workspaceRoot: threadDraft.workspaceRoot,
        providerId: threadDraft.providerId || null,
        modelId: threadDraft.modelId || null,
        toolMode: threadDraft.toolMode,
        maxIterations: threadDraft.maxIterations,
        maxSubagents: threadDraft.maxSubagents
      });
      await Promise.all([
        refreshThreads(selectedThreadId),
        refreshThreadState(selectedThreadId)
      ]);
      setStatus(t("agents.threadSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingThread(false);
    }
  }

  async function removeThread() {
    if (!selectedThreadId) return;
    if (!confirm(t("agents.confirmDeleteThread"))) return;
    try {
      await api.agentThreadDelete(selectedThreadId);
      await refreshThreads(null);
      setStatus(t("agents.threadDeleted"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function createSkill() {
    if (!selectedThreadId) return;
    try {
      await api.agentSkillCreate(selectedThreadId, {
        name: t("agents.newSkillDefault"),
        description: "",
        instructions: ""
      });
      await refreshThreadState(selectedThreadId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSkill(skill: AgentSkill) {
    if (!selectedThreadId) return;
    setSavingSkillId(skill.id);
    try {
      await api.agentSkillUpdate(selectedThreadId, skill.id, {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        enabled: skill.enabled,
        order: skill.order
      });
      await refreshThreadState(selectedThreadId);
      setStatus(t("agents.skillSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSkillId(null);
    }
  }

  async function removeSkill(skillId: string) {
    if (!selectedThreadId) return;
    try {
      await api.agentSkillDelete(selectedThreadId, skillId);
      await refreshThreadState(selectedThreadId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function abortRun() {
    if (!selectedThreadId) return;
    await api.agentAbort(selectedThreadId).catch(() => undefined);
  }

  async function executeThreadRun(params: {
    mode: "prompt" | "retry" | "resume";
    content?: string;
    runId?: string;
    attachments?: FileAttachment[];
  }) {
    if (!selectedThreadId || running) return;
    if (params.mode === "prompt" && !params.content?.trim() && (!params.attachments || params.attachments.length === 0)) return;
    if ((params.mode === "retry" || params.mode === "resume") && !params.runId) return;

    const input = params.content?.trim() || "";
    if (params.mode === "prompt") {
      setComposer("");
      setAttachments([]);
      setThreadState((prev) => prev ? {
        ...prev,
        messages: [...prev.messages, {
          id: `draft-user-${Date.now()}`,
          threadId: selectedThreadId,
          role: "user",
          content: input,
          attachments: [...(params.attachments || [])],
          metadata: {
            attachments: [...(params.attachments || [])]
          },
          createdAt: new Date().toISOString()
        }]
      } : prev);
    }
    setRunning(true);
    setStreamPreview("");
    setStreamReasoningPreview("");
    streamPreviewRef.current = "";
    streamReasoningPreviewRef.current = "";
    setStreamReasoningExpanded(true);
    const taskId = startBackgroundTask({
      scope: "agents",
      type: "agent",
      label: params.mode === "resume" ? t("agents.resumingTask") : params.mode === "retry" ? t("agents.retryingTask") : t("agents.runningTask"),
      cancellable: true,
      cancelLabel: t("agents.abortRun"),
      onCancel: async () => {
        await abortRun();
      }
    });
    try {
      const callbacks: StreamCallbacks & {
        onAgentEvent?: (event: AgentEvent) => void;
        onAgentMessage?: (message: AgentMessage) => void;
      } = {
        onDelta: (delta: string) => {
          streamPreviewRef.current += delta;
          setStreamPreview((prev) => prev + delta);
        },
        onReasoningDelta: (delta: string) => {
          streamReasoningPreviewRef.current += delta;
          setStreamReasoningPreview((prev) => prev + delta);
          setStreamReasoningExpanded(true);
        },
        onAgentEvent: (event: AgentEvent) => {
          const payload = event.payload || {};
          if (payload.confirmationRequired === true) {
            setPendingConfirmation({
              id: String(payload.confirmationId || ""),
              threadId: event.threadId,
              runId: String(payload.runId || event.runId || ""),
              tool: String(payload.tool || ""),
              argumentsJson: typeof payload.arguments === "string"
                ? payload.arguments
                : JSON.stringify(payload.arguments || {}),
              arguments: payload.arguments && typeof payload.arguments === "object" && !Array.isArray(payload.arguments)
                ? payload.arguments as Record<string, unknown>
                : {},
              category: String(payload.category || ""),
              reason: String(event.content || payload.reason || "").trim(),
              createdAt: event.createdAt
            });
          }
          setThreadState((prev) => {
            if (!prev) return prev;
            const nextEvents = [...prev.events.filter((item) => item.id !== event.id), event].sort((a, b) => (
              a.createdAt.localeCompare(b.createdAt) || a.order - b.order
            ));
            return {
              ...prev,
              thread: {
                ...prev.thread,
                status: "running"
              },
              events: nextEvents
            };
          });
        },
        onAgentMessage: (message: AgentMessage) => {
          setThreadState((prev) => {
            if (!prev) return prev;
            const nextMessages = [...prev.messages.filter((item) => item.id !== message.id), message].sort((a, b) => (
              a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
            ));
            return {
              ...prev,
              messages: nextMessages
            };
          });
          setStreamPreview("");
          setStreamReasoningPreview("");
          streamPreviewRef.current = "";
          streamReasoningPreviewRef.current = "";
        }
      };
      const nextState = params.mode === "resume"
        ? await api.agentResumeRun(selectedThreadId, params.runId!, callbacks)
        : params.mode === "retry"
          ? await api.agentRetryRun(selectedThreadId, params.runId!, callbacks)
          : await api.agentRespond(selectedThreadId, input, params.attachments, callbacks);
      setThreadState(nextState);
      await refreshThreads(selectedThreadId);
      finishBackgroundTask(
        taskId,
        params.mode === "resume"
          ? t("agents.runResumed")
          : params.mode === "retry"
            ? t("agents.runRetried")
            : t("agents.runFinished")
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const partialContent = streamPreviewRef.current.trim();
      const partialReasoning = streamReasoningPreviewRef.current.trim();
      if (partialContent || partialReasoning) {
        const interruptedId = `draft-agent-interrupted-${Date.now()}`;
        setThreadState((prev) => prev ? {
          ...prev,
          messages: [...prev.messages, {
            id: interruptedId,
            threadId: selectedThreadId,
            runId: activeRun?.id || null,
            role: "assistant",
            content: partialContent || t("agents.partialResponseInterrupted"),
            attachments: [],
            metadata: {
              interrupted: true,
              interruptedReason: text,
              reasoning: partialReasoning || undefined
            },
            createdAt: new Date().toISOString()
          }]
        } : prev);
      }
      setStatus(text);
      failBackgroundTask(taskId, text);
    } finally {
      setRunning(false);
      setStreamPreview("");
      setStreamReasoningPreview("");
      streamPreviewRef.current = "";
      streamReasoningPreviewRef.current = "";
    }
  }

  async function sendPrompt() {
    await executeThreadRun({
      mode: "prompt",
      content: composer,
      attachments
    });
  }

  async function resolveDangerousAction(action: "approve" | "deny") {
    if (!selectedThreadId || !pendingConfirmation || resolvingConfirmation) return;
    setResolvingConfirmation(action);
    try {
      const result = await api.agentConfirmAction(selectedThreadId, {
        confirmationId: pendingConfirmation.id,
        action
      });
      setPendingConfirmation(result.pending);
      setThreadState(result.state);
      await refreshThreads(selectedThreadId);
      if (action === "approve") {
        setStatus(t("agents.pendingConfirmationApproved"));
        if (result.resolved?.runId) {
          await executeThreadRun({
            mode: "resume",
            runId: result.resolved.runId
          });
        }
      } else {
        setStatus(t("agents.pendingConfirmationDenied"));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingConfirmation(null);
    }
  }

  async function sendSteering() {
    if (!selectedThreadId || !running || (!composer.trim() && attachments.length === 0)) return;
    const content = composer.trim();
    const pendingAttachments = [...attachments];
    const optimisticId = `draft-steer-${Date.now()}`;
    setSendingSteering(true);
    setComposer("");
    setAttachments([]);
    setThreadState((prev) => prev ? {
      ...prev,
      messages: [...prev.messages, {
        id: optimisticId,
        threadId: selectedThreadId,
        runId: activeRun?.id || null,
        role: "user",
        content,
        attachments: pendingAttachments,
        metadata: {
          attachments: pendingAttachments,
          steering: true,
          steeringPending: true
        },
        createdAt: new Date().toISOString()
      }]
    } : prev);
    try {
      const result = await api.agentSteer(selectedThreadId, content, pendingAttachments);
      setThreadState(result.state);
      setStatus(t("agents.correctionQueued"));
    } catch (error) {
      setThreadState((prev) => prev ? {
        ...prev,
        messages: prev.messages.filter((message) => message.id !== optimisticId)
      } : prev);
      setComposer(content);
      setAttachments(pendingAttachments);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSendingSteering(false);
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!composer.trim() && attachments.length === 0) return;
    if (running) {
      if (!sendingSteering) {
        void sendSteering();
      }
      return;
    }
    void sendPrompt();
  }

  function buildClipboardFilename(file: File, index: number) {
    const original = String(file.name || "").trim();
    if (original) return original;
    const type = String(file.type || "").toLowerCase();
    const ext = type.startsWith("image/")
      ? type.slice("image/".length).replace(/[^a-z0-9]+/gi, "") || "png"
      : "bin";
    return `agent-attachment-${Date.now()}-${index + 1}.${ext}`;
  }

  async function readFileAsBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadComposerFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const [index, file] of files.entries()) {
        const uploadFile = file.name
          ? file
          : new File([file], buildClipboardFilename(file, index), { type: file.type || "image/png" });
        const base64 = await readFileAsBase64(uploadFile);
        const attachment = await api.uploadFile(base64, uploadFile.name);
        const mimeType = attachment.mimeType || file.type || guessMimeType(file.name);
        const normalizedAttachment: FileAttachment = {
          ...attachment,
          mimeType
        };
        if (attachment.type === "image") {
          normalizedAttachment.dataUrl = `data:${mimeType};base64,${base64}`;
        }
        setAttachments((prev) => [...prev, normalizedAttachment]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    await uploadComposerFiles(files);
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && String(item.type || "").startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void uploadComposerFiles(imageFiles);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  }

  function resolveAttachmentHref(attachment: FileAttachment) {
    return imageSourceFromAttachment(attachment) || resolveApiAssetUrl(attachment.url);
  }

  async function openAttachmentRaw(attachment: FileAttachment) {
    const href = resolveAttachmentHref(attachment);
    if (!href) return;
    if (window.electronAPI) {
      await window.electronAPI.openExternal(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function previewAttachment(attachment: FileAttachment) {
    const imageSrc = imageSourceFromAttachment(attachment);
    if (imageSrc) {
      setAttachmentViewer({ attachment, mode: "image", previewUrl: imageSrc });
      return;
    }
    if (attachment.type === "text" && String(attachment.content || "").trim()) {
      setAttachmentViewer({ attachment, mode: "text" });
      return;
    }
    void openAttachmentRaw(attachment);
  }

  async function quickRenameThread(thread: AgentThread) {
    const nextTitle = window.prompt(t("agents.threadRenamePrompt"), thread.title)?.trim();
    if (!nextTitle || nextTitle === thread.title) return;
    try {
      await api.agentThreadUpdate(thread.id, { title: nextTitle });
      await refreshThreads(thread.id);
      if (selectedThreadId === thread.id) {
        await refreshThreadState(thread.id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function forkFromMessage(messageId: string) {
    try {
      const created = await api.agentForkFromMessage(messageId);
      await refreshThreads(created.id);
      setSelectedThreadId(created.id);
      setWorkspaceOpen(true);
      setStatus(t("agents.threadForked"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function beginEditMessage(item: Extract<TimelineItem, { kind: "message" }>) {
    setEditingMessageId(item.id);
    setEditingMessageValue(item.content);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setEditingMessageValue("");
  }

  async function saveEditedMessage(messageId: string) {
    try {
      const result = await api.agentEditMessage(messageId, {
        content: editingMessageValue
      });
      setThreadState(result.state);
      await refreshThreads(result.state.thread.id);
      cancelEditMessage();
      setStatus(t("agents.messageEdited"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeMessage(messageId: string) {
    if (deletingMessageId === messageId) return;
    setDeletingMessageId(messageId);
    try {
      const result = await api.agentDeleteMessage(messageId);
      setThreadState(result.state);
      await refreshThreads(result.state.thread.id);
      setStatus(t("agents.messageDeleted"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingMessageId((current) => current === messageId ? null : current);
    }
  }

  async function regenerateMessage(item: Extract<TimelineItem, { kind: "message" }>) {
    if (item.runId) {
      await retryRun(item.runId);
      return;
    }
    if (item.role !== "user") return;
    await executeThreadRun({
      mode: "prompt",
      content: item.content,
      attachments: item.attachments
    });
  }

  async function retryRun(runId: string) {
    await executeThreadRun({
      mode: "retry",
      runId
    });
  }

  async function resumeRun(runId: string) {
    await executeThreadRun({
      mode: "resume",
      runId
    });
  }

  function openSettingsView(category: "agents" | "tools", sectionId?: string) {
    window.dispatchEvent(new CustomEvent("open-settings-view", {
      detail: {
        category,
        sectionId
      }
    }));
  }

  function renderToolBlock(blockId: string, label: string, rawContent: unknown) {
    const normalized = stringifyToolData(rawContent);
    if (!normalized) return null;
    const expanded = expandedToolBlocks[blockId] === true;
    const collapsible = shouldCollapseToolBlock(normalized);
    const visibleContent = collapsible && !expanded ? getCollapsedToolPreview(normalized) : normalized;

    return (
      <div className="agents-tool-block">
        <div className="agents-tool-block-head">
          <span className="agents-tool-block-label">{label}</span>
          {collapsible ? (
            <button
              onClick={() => setExpandedToolBlocks((prev) => ({ ...prev, [blockId]: !expanded }))}
              className="agents-tool-block-toggle"
            >
              {expanded ? t("agents.showLess") : t("agents.showMore")}
            </button>
          ) : null}
        </div>
        <pre className="agents-tool-block-pre">{visibleContent}</pre>
      </div>
    );
  }

  function renderEventCard(item: Extract<TimelineItem, { kind: "event" }>) {
    const isToolEvent = item.type === "tool_call" || item.type === "tool_result";
    if (!isToolEvent) {
      return (
        <div
          key={item.id}
          className={`agents-simple-event ${isCompactEvent(item.type) ? "is-compact" : ""}`}
          style={{ marginLeft: `${item.depth * 14}px` }}
        >
          <div className="flex items-center gap-2">
            <Badge variant={eventTone(item.type) as "default" | "accent" | "warning" | "danger" | "success"}>
              {item.type}
            </Badge>
            <div className={`${isCompactEvent(item.type) ? "text-[11px]" : "text-xs"} font-semibold text-text-primary`}>
              {item.title}
            </div>
          </div>
          {item.content ? (
            <MarkdownContent
              content={item.content}
              className={`prose-chat break-words text-text-secondary ${
                isCompactEvent(item.type)
                  ? "mt-1 text-[11px] leading-5"
                  : "mt-2 text-xs leading-5"
              }`}
            />
          ) : null}
        </div>
      );
    }

    const reasonText = item.type === "tool_call" ? String(item.content || "").trim() : "";
    const inputText = item.type === "tool_call" ? item.payload.arguments : "";
    const outputText = item.type === "tool_result" ? item.content : "";
    const expanded = expandedToolEvents[item.id] === true;
    const preview = getOneLineToolPreview(item.type === "tool_call" ? (inputText || reasonText) : outputText);

    return (
      <div
        key={item.id}
        className={`agents-simple-event agents-simple-event-tool ${expanded ? "is-expanded" : "is-collapsed"}`}
        style={{ marginLeft: `${item.depth * 14}px` }}
      >
        <button
          type="button"
          onClick={() => setExpandedToolEvents((prev) => ({ ...prev, [item.id]: !expanded }))}
          className="agents-tool-event-head"
        >
          <div className="agents-tool-event-main">
            <Badge variant={eventTone(item.type) as "default" | "accent" | "warning" | "danger" | "success"}>
              {item.type}
            </Badge>
            <span className="agents-tool-event-title">{item.title}</span>
            {preview ? <span className="agents-tool-event-preview">{preview}</span> : null}
          </div>
          <span className="agents-tool-event-toggle">
            {expanded ? t("agents.showLess") : t("agents.showMore")}
            <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
        {expanded ? (
          <div className="agents-tool-event-details">
            {reasonText ? (
              <div>
                <div className="agents-tool-block-label">{t("agents.toolReason")}</div>
                <MarkdownContent
                  content={reasonText}
                  className="prose-chat mt-1 break-words text-[12px] leading-5 text-text-secondary"
                />
              </div>
            ) : null}
            {item.type === "tool_call" ? renderToolBlock(`${item.id}:input`, t("agents.toolInput"), inputText) : null}
            {item.type === "tool_result" ? renderToolBlock(`${item.id}:output`, t("agents.toolOutput"), outputText) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderRunBranch(node: RunTreeNode, depth = 0): JSX.Element {
    const isSelected = selectedTraceRunId === node.id;
    return (
      <div key={node.id} className="space-y-1.5">
        <button
          onClick={() => setSelectedTraceRunId((current) => current === node.id ? null : node.id)}
          className={`w-full rounded-[18px] border px-3 py-2.5 text-left transition-colors ${
            isSelected
              ? "border-accent-border bg-accent-subtle"
              : "border-border-subtle bg-bg-secondary hover:border-border hover:bg-bg-hover"
          }`}
          style={{ marginLeft: `${depth * 12}px` }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-text-primary">{node.title || t("agents.runLabel")}</div>
              <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                {node.summary || t("agents.noRunSummary")}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
                <span>{t("agents.runStarted")}: {new Date(node.startedAt).toLocaleString()}</span>
                {node.completedAt ? <span>{t("agents.runCompleted")}: {new Date(node.completedAt).toLocaleString()}</span> : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={runStatusTone(node.status) as "default" | "accent" | "warning" | "danger" | "success"}>
                {node.status}
              </Badge>
              <span className="text-[10px] text-text-tertiary">
                {eventCountByRun.get(node.id) || 0} {t("agents.traceEvents")}
              </span>
            </div>
          </div>
        </button>
        {node.children.map((child) => renderRunBranch(child, depth + 1))}
      </div>
    );
  }

  function renderMessageActions(item: Extract<TimelineItem, { kind: "message" }>) {
    if (item.role === "system") return null;
    const canRegenerate = Boolean(item.runId) || item.role === "user";
    return (
      <div className={`message-actions ${item.role === "user" ? "justify-end" : ""}`}>
        <button
          type="button"
          onClick={() => { void forkFromMessage(item.id); }}
          className="rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
        >
          {t("chat.branch")}
        </button>
        {canRegenerate ? (
          <button
            type="button"
            disabled={running}
            onClick={() => { void regenerateMessage(item); }}
            className="rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
          >
            {t("chat.regenerate")}
          </button>
        ) : null}
        {item.role === "user" ? (
          <button
            type="button"
            onClick={() => beginEditMessage(item)}
            className="rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            {t("chat.edit")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={deletingMessageId === item.id || running}
          onClick={() => {
            if (!window.confirm(`${t("chat.delete")}?`)) return;
            void removeMessage(item.id);
          }}
          className="rounded-md text-text-tertiary hover:bg-bg-hover hover:text-danger disabled:opacity-50"
        >
          {t("chat.delete")}
        </button>
      </div>
    );
  }

  function renderMessageAttachments(item: Extract<TimelineItem, { kind: "message" }>, compact = false) {
    if (!item.attachments.length) return null;
    return (
      <div className={`mt-2 flex flex-wrap gap-1.5 ${compact ? "agents-simple-message-attachments" : ""}`}>
        {item.attachments.map((attachment) => (
          <AttachmentCard
            key={`${item.id}:${attachment.id}`}
            cardKey={`${item.id}:${attachment.id}`}
            attachment={attachment}
            compact={compact}
            onPreview={previewAttachment}
            t={t}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <ThreePanelLayout
      className={agentLayoutClassName}
      hideRight={!showInspector}
      threeColumnLayoutClassName="xl:grid-cols-[252px_minmax(0,1.55fr)_312px]"
      twoColumnLayoutClassName="xl:grid-cols-[252px_minmax(0,1fr)]"
      leftClassName="agents-simple-sidebar-panel"
      centerClassName="agents-simple-center-panel"
      rightClassName="chat-simple-right-panel agents-simple-right-panel"
      left={
        <div className="agents-simple-sidebar flex h-full min-h-0 flex-col">
          <div className={`chat-simple-sidebar-header ${sidebarCollapsed ? "is-collapsed" : "is-open"}`}>
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="chat-simple-sidebar-toggle"
              title={sidebarCollapsed ? t("agents.expandSidebar") : t("agents.collapseSidebar")}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.75h16M4 12h16M4 17.25h16" />
              </svg>
            </button>
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-text-primary">{t("agents.title")}</div>
                <div className="text-[10px] text-text-tertiary">{threads.length} {t("agents.workspacesCount")}</div>
              </div>
            ) : null}
          </div>

          <div className={`chat-simple-actions ${sidebarCollapsed ? "is-collapsed" : "is-open"}`}>
            <button
              onClick={() => { void createThread("build"); }}
              className="chat-simple-action-button agents-simple-new-thread"
              title={t("chat.new")}
            >
              <span className="chat-simple-action-icon">+</span>
              {!sidebarCollapsed ? <span>{t("chat.new")}</span> : null}
            </button>
          </div>

          {!sidebarCollapsed ? (
            <>
              <div className="agents-simple-quickstart">
                <button
                  onClick={() => {
                    setQuickStartTouched(true);
                    setQuickStartExpanded((prev) => !prev);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                >
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{t("agents.quickStart")}</div>
                    <div className="mt-1 text-[13px] font-semibold text-text-primary">{t("agents.quickStartTitle")}</div>
                    <div className="mt-1 text-[11px] leading-5 text-text-tertiary">{t("agents.quickStartDesc")}</div>
                  </div>
                  <svg className={`h-4 w-4 flex-shrink-0 text-text-tertiary transition-transform ${quickStartExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {quickStartExpanded ? (
                  <div className="grid gap-2 px-3 pb-3">
                    {(["ask", "build", "research"] as AgentMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => { void createThread(mode); }}
                        className="agents-simple-quickmode group"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`rounded-2xl border p-1.5 ${
                            mode === "research"
                              ? "border-warning/20 bg-warning-subtle text-warning"
                              : mode === "build"
                                ? "border-accent-border bg-accent-subtle text-accent"
                                : "border-border-subtle bg-bg-primary text-text-secondary"
                          }`}>
                            <ModeGlyph mode={mode} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-text-primary">{t(modeLabelKey(mode))}</div>
                            <div className="mt-1 text-[11px] leading-5 text-text-tertiary">{t(modeDescriptionKey(mode))}</div>
                            <div className="mt-1.5 text-[11px] font-semibold text-accent">{t("agents.quickCreateThread")}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="agents-simple-search">
                <input
                  value={threadQuery}
                  onChange={(e) => setThreadQuery(e.target.value)}
                  placeholder={t("agents.searchThreads")}
                  className="w-full border-0 bg-transparent p-0 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </div>
            </>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingThreads ? (
              <div className="px-1 text-xs text-text-tertiary">{sidebarCollapsed ? "…" : t("agents.loading")}</div>
            ) : filteredThreads.length === 0 ? (
              <EmptyState title={t("agents.emptyTitle")} description={t("agents.emptyDesc")} />
            ) : (
              <div className="space-y-1.5">
                {filteredThreads.map((thread) => (
                  <div
                    key={thread.id}
                    className={`agents-simple-thread-item group ${sidebarCollapsed ? "is-collapsed" : ""} ${
                      selectedThreadId === thread.id
                        ? "is-active"
                        : ""
                    }`}
                    title={thread.title}
                  >
                    {sidebarCollapsed ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedThreadId(thread.id);
                          if (window.innerWidth < 1280) {
                            setSidebarOpen(false);
                          }
                        }}
                        className="agents-simple-thread-collapsed"
                      >
                        <div className="agents-simple-thread-glyph">
                          <ModeGlyph mode={thread.mode} />
                        </div>
                        <span className={`agents-simple-thread-dot is-${thread.status}`} />
                      </button>
                    ) : (
                      <div className="agents-simple-thread-item-row">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedThreadId(thread.id);
                            if (window.innerWidth < 1280) {
                              setSidebarOpen(false);
                            }
                          }}
                          className="agents-simple-thread-item-main"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-[13px] font-semibold text-text-primary">{thread.title}</div>
                            <Badge variant={modeTone(thread.mode) as "default" | "accent" | "warning" | "danger" | "success"}>
                              {t(modeLabelKey(thread.mode))}
                            </Badge>
                          </div>
                          <div className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-text-tertiary">
                            {thread.description || t("agents.noDescription")}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {thread.heroCharacterName ? <Badge>{thread.heroCharacterName}</Badge> : null}
                            <span className="text-[11px] text-text-tertiary">{thread.modelId || t("agents.usingActiveModel")}</span>
                          </div>
                        </button>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant={threadStatusTone(thread.status) as "default" | "accent" | "warning" | "danger" | "success"}>
                            {thread.status}
                          </Badge>
                          <span className="text-[10px] text-text-tertiary">{new Date(thread.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="agents-simple-thread-item-actions">
                          <button
                            type="button"
                            onClick={() => { void quickRenameThread(thread); }}
                            className="agents-simple-thread-item-action"
                            title={t("chat.rename")}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.121 2.121 0 10-3-3L5.5 17v3z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      }
      center={selectedThread ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="agents-simple-thread-header chat-simple-thread-header">
            <div className="chat-simple-thread-bar agents-simple-thread-bar">
              <button
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="chat-simple-thread-sidebar"
                title={sidebarCollapsed ? t("agents.expandSidebar") : t("agents.collapseSidebar")}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.75h16M4 12h16M4 17.25h16" />
                </svg>
              </button>
              <div className="min-w-0">
                <h2 className="chat-simple-thread-title truncate">{selectedThread.title}</h2>
                <div className="agents-simple-meta">
                  <span className="chat-simple-thread-model-badge">{t(modeLabelKey(selectedThread.mode))}</span>
                  <span className="chat-simple-thread-model-badge">{selectedThread.status}</span>
                  {selectedThread.heroCharacterName ? (
                    <span className="chat-simple-thread-model-badge">{selectedThread.heroCharacterName}</span>
                  ) : null}
                  <span className="chat-simple-thread-model-badge">
                    {selectedThread.modelId || t("agents.usingActiveModel")}
                  </span>
                  <span className="chat-simple-thread-model-badge agents-simple-cwd-pill">
                    cwd · {workspaceRootLabel}
                  </span>
                  <span className="chat-simple-thread-model-badge">
                    {enabledSkillCount} {t("agents.skills")}
                  </span>
                </div>
              </div>
              <div className="flex-1" />
              <div className="chat-simple-thread-actions">
                <button
                  onClick={() => {
                    if (!selectedThread) return;
                    void quickRenameThread(selectedThread);
                  }}
                  className="chat-simple-thread-action-btn"
                  title={t("chat.rename")}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.121 2.121 0 10-3-3L5.5 17v3z" />
                  </svg>
                </button>
                <button
                  onClick={() => { void removeThread(); }}
                  className="chat-simple-thread-action-btn"
                  title={t("chat.delete")}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-3h4m-6 3h8M9 11v6m6-6v6" />
                  </svg>
                </button>
                <button
                  onClick={() => setWorkspaceOpen((prev) => !prev)}
                  className={`chat-simple-thread-action-btn ${workspaceOpen ? "is-active" : ""}`}
                  title={workspaceOpen ? t("agents.hideWorkspace") : t("agents.showWorkspace")}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75h18M3 12h18M3 17.25h18" />
                  </svg>
                </button>
                {running ? (
                  <button
                    onClick={() => { void abortRun(); }}
                    className="chat-simple-thread-action-btn is-danger"
                    title={t("agents.abortRun")}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div
            ref={timelineViewportRef}
            className="chat-scroll agents-simple-scroll min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-subtle bg-bg-primary p-3 chat-simple-scroll chat-simple-surface"
          >
            <div className={`mx-auto flex w-full ${AGENT_CENTER_MAX_WIDTH_CLASS} flex-col gap-3`}>
              {selectedTraceRunId ? (
                <div className="agents-simple-inline-banner">
                  <div className="text-[11px] text-text-secondary">{t("agents.traceFiltered")}</div>
                  <button
                    onClick={() => setSelectedTraceRunId(null)}
                    className="chat-simple-thread-action-btn"
                  >
                    {t("agents.showFullTrace")}
                  </button>
                </div>
              ) : null}

              {loadingState ? (
                <div className="text-xs text-text-tertiary">{t("agents.loadingState")}</div>
              ) : filteredTimeline.length === 0 ? (
                <div className="agents-simple-empty">
                  <EmptyState title={t("agents.emptyTimeline")} description={t("agents.emptyTimelineDesc")} />
                  <div className="mt-4 agents-simple-quick-row">
                    {[t("agents.promptPlan"), t("agents.promptReview"), t("agents.promptResearch")].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => setComposer(prompt)}
                        className="agents-simple-quick-chip"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                filteredTimeline.map((item) => (
                  item.kind === "message" ? (() => {
                    const inlineReasoning = item.role === "assistant"
                      ? parseInlineReasoning(item.content)
                      : { content: item.content, reasoning: "" };
                    const metadataReasoning = item.role === "assistant"
                      ? String(item.metadata?.reasoning || "").trim()
                      : "";
                    const reasoningText = [inlineReasoning.reasoning, metadataReasoning]
                      .filter(Boolean)
                      .join("\n\n")
                      .trim();
                    const displayReasoningText = normalizeReasoningDisplayText(reasoningText);
                    const reasoningPanelOpen = reasoningPanelsExpanded[item.id] === true;
                    return (
                      <div
                        key={item.id}
                        className={`agents-simple-message-wrap group ${item.role === "user" ? "is-user" : "is-assistant"}`}
                      >
                        <div className={`agents-simple-message ${item.role === "user" ? "is-user" : "is-assistant"}`}>
                          <div className="agents-simple-message-head">
                            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.08em] opacity-80">
                              <span>{item.role === "user" ? t("agents.user") : t("agents.agent")}</span>
                              {item.role === "user" && item.metadata?.steering ? (
                                <span className="rounded-full border border-current/20 px-1.5 py-0.5 text-[8px] tracking-[0.04em] opacity-90">
                                  {t("agents.correction")}
                                </span>
                              ) : null}
                            </div>
                            <div className={`agents-simple-message-time ${item.role === "user" ? "is-user" : ""}`}>
                              {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          {editingMessageId === item.id ? (
                            <div className="agents-simple-message-edit">
                              <textarea
                                value={editingMessageValue}
                                onChange={(e) => setEditingMessageValue(e.target.value)}
                                className="w-full resize-none rounded-xl border border-border bg-bg-primary px-3 py-2 text-[13px] leading-6 text-text-primary outline-none"
                                rows={Math.min(10, Math.max(3, editingMessageValue.split(/\r?\n/).length))}
                              />
                              {renderMessageAttachments(item, true)}
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={cancelEditMessage}
                                  className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                                >
                                  {t("chat.cancel")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { void saveEditedMessage(item.id); }}
                                  className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover"
                                >
                                  {t("chat.save")}
                                </button>
                              </div>
                            </div>
                          ) : item.role === "user" ? (
                            <div className="whitespace-pre-wrap break-words text-[13px] leading-6">{item.content}</div>
                          ) : (
                            <>
                              {displayReasoningText ? (
                                <div className="mb-2 rounded-xl border border-border-subtle bg-bg-secondary/70">
                                  <button
                                    onClick={() => {
                                      setReasoningPanelsExpanded((prev) => ({ ...prev, [item.id]: !reasoningPanelOpen }));
                                    }}
                                    className="flex w-full items-center justify-between px-2.5 py-2 text-left"
                                  >
                                    <span className="text-[11px] font-semibold text-text-secondary">{t("chat.reasoning")}</span>
                                    <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${reasoningPanelOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                  {reasoningPanelOpen ? (
                                    <div className="border-t border-border-subtle px-2.5 py-2">
                                      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary">{displayReasoningText}</div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              <MarkdownContent
                                content={inlineReasoning.content}
                                className="prose-chat break-words text-[13px] leading-6 text-text-primary"
                              />
                            </>
                          )}
                          {editingMessageId !== item.id ? renderMessageAttachments(item, true) : null}
                        </div>
                        {editingMessageId !== item.id ? renderMessageActions(item) : null}
                      </div>
                    );
                  })() : renderEventCard(item)
                ))
              )}

              {running && (streamPreview || streamReasoningPreview) ? (
                <div className="agents-simple-streaming">
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-accent">
                    {t("agents.agent")} · {t("chat.streaming")}
                  </div>
                  {streamReasoningPreview ? (
                    <div className="mb-2 rounded-md border border-border-subtle bg-bg-tertiary/70">
                      <button
                        type="button"
                        onClick={() => setStreamReasoningExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                          {t("chat.reasoning")}
                        </span>
                        <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${streamReasoningExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {streamReasoningExpanded ? (
                        <div className="border-t border-border-subtle px-2 py-2">
                          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary">{streamReasoningPreview}</div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <MarkdownContent
                    content={streamPreview}
                    className="prose-chat break-words text-[13px] leading-6 text-text-primary"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="agents-simple-composer-wrap">
            <div className={`mx-auto w-full ${AGENT_CENTER_MAX_WIDTH_CLASS}`}>
              {pendingConfirmation ? (
                <div className="mb-2 rounded-lg border border-warning/35 bg-warning-subtle/35 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">{t("agents.pendingConfirmationTitle")}</div>
                      <div className="mt-1 text-[12px] leading-5 text-text-primary">
                        {pendingConfirmation.reason || t("agents.pendingConfirmationPrompt")}
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-text-secondary">
                        {pendingConfirmation.tool}
                        {getOneLineToolPreview(pendingConfirmation.arguments)
                          ? ` · ${getOneLineToolPreview(pendingConfirmation.arguments)}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void resolveDangerousAction("deny"); }}
                        disabled={Boolean(resolvingConfirmation)}
                        className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                      >
                        {t("agents.pendingConfirmationDeny")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void resolveDangerousAction("approve"); }}
                        disabled={Boolean(resolvingConfirmation)}
                        className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                      >
                        {resolvingConfirmation === "approve" ? t("agents.pendingConfirmationApproving") : t("agents.pendingConfirmationApprove")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {attachments.length > 0 ? (
                <div className="chat-simple-attachments is-docked agents-simple-composer-attachments">
                  {attachments.map((attachment) => (
                    <AttachmentCard
                      key={attachment.id}
                      cardKey={attachment.id}
                      attachment={attachment}
                      compact
                      onPreview={previewAttachment}
                      onRemove={removeAttachment}
                      t={t}
                    />
                  ))}
                </div>
              ) : null}
              <div className="chat-simple-composer is-docked agents-simple-composer">
                <div className="chat-simple-composer-shell">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handleComposerPaste}
                    placeholder={composerPlaceholder}
                    className="chat-simple-textarea agents-simple-textarea"
                  />
                  <div className="chat-simple-composer-bar">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="chat-simple-bar-btn"
                      title={t("chat.attachFile")}
                    >
                      {uploading ? (
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}
                    </button>
                    <span className="chat-simple-bar-mode agents-simple-composer-status">
                      {composerStatusLabel}
                    </span>
                    <span className="chat-simple-bar-model" title={selectedThread.workspaceRoot}>
                      {workspaceRootLabel}
                    </span>
                    <span className="chat-simple-bar-mode">
                      {selectedThread.toolMode === "enabled" ? t("agents.toolsEnabled") : t("agents.toolsDisabled")}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => {
                        if (running) {
                          if (hasDraftPayload) {
                            void sendSteering();
                            return;
                          }
                          void abortRun();
                          return;
                        }
                        void sendPrompt();
                      }}
                      disabled={running ? sendingSteering : !hasDraftPayload}
                      className={`chat-simple-send-btn ${running && !hasDraftPayload ? "is-stop" : ""}`}
                      title={
                        running
                          ? (hasDraftPayload ? t("agents.sendCorrection") : t("agents.abortRun"))
                          : t("agents.runAgent")
                      }
                    >
                      {running && !hasDraftPayload ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                accept="image/*,.txt,.md,.json,.csv,.log,.xml,.html,.js,.ts,.tsx,.py,.rb,.yaml,.yml,.pdf,.docx"
              />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title={t("agents.emptyTitle")} description={t("agents.emptyDesc")} />
      )}
      right={
        selectedThread && threadDraft ? (
          <div className="agents-simple-right-shell flex h-full flex-col gap-2.5 overflow-y-auto">
            <div className="agents-simple-right-head">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{t("agents.workspacePanel")}</div>
                <div className="mt-1 text-[13px] font-semibold text-text-primary">{threadDraft.title}</div>
              </div>
              <button
                onClick={() => setWorkspaceOpen(false)}
                className="chat-simple-top-button"
              >
                {t("agents.hideWorkspace")}
              </button>
            </div>
            <div className="agents-simple-tabbar">
              {([
                ["overview", t("agents.workspaceTabOverview")],
                ["setup", t("agents.workspaceTabSetup")],
                ["skills", t("agents.workspaceTabSkills")],
                ["runs", t("agents.workspaceTabRuns")],
                ["integrations", t("agents.workspaceTabIntegrations")]
              ] as const).map(([tabId, label]) => (
                <button
                  key={tabId}
                  onClick={() => setInspectorTab(tabId)}
                  className={`agents-simple-tab ${inspectorTab === tabId ? "is-active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {inspectorTab === "overview" ? (
              <InspectorSection
                title={t("agents.threadMemory")}
                caption={threadDraft.heroCharacterName ? t("agents.linkedHeroDesc") : t("agents.workspacePanelDesc")}
                open={inspectorSections.overview}
                onToggle={() => setInspectorSections((prev) => ({ ...prev, overview: !prev.overview }))}
              >
                <div className="space-y-2.5">
                  {threadDraft.heroCharacterName ? (
                    <div className="rounded-[18px] border border-border-subtle bg-bg-primary px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.linkedHero")}</div>
                      <div className="mt-1 text-[13px] font-semibold text-text-primary">{threadDraft.heroCharacterName}</div>
                    </div>
                  ) : null}
                  {selectedThread.memorySummary ? (
                    <div className="rounded-[18px] border border-border-subtle bg-bg-primary px-3 py-2.5">
                      <MarkdownContent
                        content={selectedThread.memorySummary}
                        className="prose-chat break-words text-xs leading-5 text-text-secondary"
                      />
                      {selectedThread.memoryUpdatedAt ? (
                        <div className="mt-2 text-[11px] text-text-tertiary">
                          {t("agents.memoryUpdated")} {new Date(selectedThread.memoryUpdatedAt).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs leading-5 text-text-tertiary">{t("agents.memoryEmpty")}</div>
                  )}
                </div>
              </InspectorSection>
            ) : null}

            {inspectorTab === "setup" ? (
              <InspectorSection
                title={t("agents.config")}
                caption={t("agents.workspaceSettingsDesc")}
                open={inspectorSections.config}
                onToggle={() => setInspectorSections((prev) => ({ ...prev, config: !prev.config }))}
              >
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.threadName")}</label>
                    <input
                      value={threadDraft.title}
                      onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                      className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.threadDescription")}</label>
                    <textarea
                      value={threadDraft.description}
                      onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                      className="h-16 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.systemPrompt")}</label>
                    <textarea
                      value={threadDraft.systemPrompt}
                      onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, systemPrompt: e.target.value } : prev)}
                      className="h-24 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.developerPrompt")}</label>
                    <div className="mb-1.5 text-[11px] leading-5 text-text-tertiary">{t("agents.developerPromptDesc")}</div>
                    <textarea
                      value={threadDraft.developerPrompt}
                      onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, developerPrompt: e.target.value } : prev)}
                      className="h-20 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.workspaceRoot")}</label>
                    <div className="mb-2 text-[11px] leading-5 text-text-tertiary">{t("agents.workspaceRootDesc")}</div>
                    <div className="space-y-2">
                      <div className="rounded-[18px] border border-border-subtle bg-bg-primary px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.selectedFolder")}</div>
                            <div className="mt-1 break-all text-sm font-medium text-text-primary">
                              {threadDraft.workspaceRoot || workspaceDirectories?.currentPath || "."}
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                              {loadingWorkspaceDirectories
                                ? t("agents.loadingWorkspaceDirectories")
                                : workspaceDirectories?.currentRelativePath
                                  ? `${t("agents.currentWorkspaceDirectory")} ${workspaceDirectories.currentRelativePath}`
                                  : t("agents.workspaceDirectoryHelp")}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setWorkspacePickerOpen((prev) => !prev);
                              if (workspacePickerOpen) {
                                setWorkspacePickerQuery("");
                              }
                            }}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                          >
                            {workspacePickerOpen ? t("agents.hideFolderPicker") : t("agents.browseFolders")}
                          </button>
                        </div>

                        {workspaceTrail.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {workspaceTrail.map((segment) => (
                              <button
                                key={segment.path}
                                onClick={() => {
                                  setThreadDraft((prev) => prev ? { ...prev, workspaceRoot: segment.path } : prev);
                                  setWorkspacePickerQuery("");
                                }}
                                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                  threadDraft.workspaceRoot === segment.path
                                    ? "border-accent/40 bg-accent-subtle text-text-primary"
                                    : "border-border-subtle text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                                }`}
                              >
                                {segment.label}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {workspacePickerOpen ? (
                          <div className="mt-3 space-y-2.5 border-t border-border-subtle pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => {
                                  setThreadDraft((prev) => prev ? { ...prev, workspaceRoot: workspaceDirectories?.projectRoot || prev.workspaceRoot } : prev);
                                  setWorkspacePickerQuery("");
                                }}
                                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                              >
                                {t("agents.useProjectRoot")}
                              </button>
                              {workspaceDirectories?.parentPath ? (
                                <button
                                  onClick={() => {
                                    setThreadDraft((prev) => prev ? { ...prev, workspaceRoot: workspaceDirectories.parentPath || prev.workspaceRoot } : prev);
                                    setWorkspacePickerQuery("");
                                  }}
                                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                                >
                                  {t("agents.goUpDirectory")}
                                </button>
                              ) : null}
                            </div>
                            <input
                              value={workspacePickerQuery}
                              onChange={(e) => setWorkspacePickerQuery(e.target.value)}
                              placeholder={t("agents.folderSearchPlaceholder")}
                              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                            />
                            <div className="max-h-44 space-y-1 overflow-y-auto rounded-[16px] border border-border-subtle bg-bg-secondary/80 p-1.5">
                              {filteredWorkspaceEntries.length > 0 ? filteredWorkspaceEntries.map((entry) => (
                                <button
                                  key={entry.path}
                                  onClick={() => {
                                    setThreadDraft((prev) => prev ? { ...prev, workspaceRoot: entry.path } : prev);
                                    setWorkspacePickerQuery("");
                                  }}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[11px] transition-colors ${
                                    threadDraft.workspaceRoot === entry.path
                                      ? "bg-accent-subtle text-text-primary"
                                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                                  }`}
                                >
                                  <span className="truncate font-medium">{entry.name}</span>
                                  <span className="truncate text-[10px] text-text-tertiary">{entry.relativePath}</span>
                                </button>
                              )) : (
                                <div className="px-2.5 py-2 text-[11px] leading-5 text-text-tertiary">
                                  {t("agents.workspaceDirectoryHelp")}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.manualPath")}</label>
                        <input
                          value={threadDraft.workspaceRoot}
                          onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, workspaceRoot: e.target.value } : prev)}
                          className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.mode")}</label>
                      <select
                        value={threadDraft.mode}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, mode: e.target.value as AgentMode } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="ask">{t("agents.modeAsk")}</option>
                        <option value="build">{t("agents.modeBuild")}</option>
                        <option value="research">{t("agents.modeResearch")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.providerOverride")}</label>
                      <select
                        value={threadDraft.providerId}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, providerId: e.target.value, modelId: "" } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="">{t("agents.usingActiveProvider")}</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>{provider.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.modelOverride")}</label>
                      <select
                        value={threadDraft.modelId}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, modelId: e.target.value } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="">{loadingModels ? t("agents.loadingModels") : t("agents.usingActiveModel")}</option>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label || model.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.toolMode")}</label>
                      <select
                        value={threadDraft.toolMode}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, toolMode: e.target.value as "enabled" | "disabled" } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="enabled">{t("agents.toolsEnabled")}</option>
                        <option value="disabled">{t("agents.toolsDisabled")}</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.maxIterations")}</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={threadDraft.maxIterations}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, maxIterations: Number(e.target.value) || 1 } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("agents.maxSubagents")}</label>
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={threadDraft.maxSubagents}
                        onChange={(e) => setThreadDraft((prev) => prev ? { ...prev, maxSubagents: Number(e.target.value) || 0 } : prev)}
                        className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { void saveThread(); }}
                      disabled={savingThread}
                      className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                    >
                      {t("chat.save")}
                    </button>
                    <button
                      onClick={() => { void removeThread(); }}
                      className="rounded-xl border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle"
                    >
                      {t("chat.delete")}
                    </button>
                  </div>
                </div>
              </InspectorSection>
            ) : null}

            {inspectorTab === "skills" ? (
              <InspectorSection
                title={t("agents.skills")}
                caption={t("agents.skillsPanelDesc")}
                open={inspectorSections.skills}
                onToggle={() => setInspectorSections((prev) => ({ ...prev, skills: !prev.skills }))}
                action={(
                  <button
                    onClick={() => { void createSkill(); }}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  >
                    + {t("agents.addSkill")}
                  </button>
                )}
              >
                <div className="space-y-2.5">
                  {skillDrafts.length === 0 ? (
                    <div className="text-xs leading-5 text-text-tertiary">{t("agents.skillsEmpty")}</div>
                  ) : skillDrafts.map((skill) => (
                    <div key={skill.id} className="rounded-[18px] border border-border-subtle bg-bg-primary p-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <input
                          value={skill.name}
                          onChange={(e) => setSkillDrafts((prev) => prev.map((item) => item.id === skill.id ? { ...item, name: e.target.value } : item))}
                          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                        />
                        <label className="flex items-center gap-2 text-xs text-text-secondary">
                          <input
                            type="checkbox"
                            checked={skill.enabled}
                            onChange={(e) => setSkillDrafts((prev) => prev.map((item) => item.id === skill.id ? { ...item, enabled: e.target.checked } : item))}
                          />
                          {t("agents.enabled")}
                        </label>
                      </div>
                      <textarea
                        value={skill.description}
                        onChange={(e) => setSkillDrafts((prev) => prev.map((item) => item.id === skill.id ? { ...item, description: e.target.value } : item))}
                        placeholder={t("agents.skillDescription")}
                        className="mb-2 h-14 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                      />
                      <textarea
                        value={skill.instructions}
                        onChange={(e) => setSkillDrafts((prev) => prev.map((item) => item.id === skill.id ? { ...item, instructions: e.target.value } : item))}
                        placeholder={t("agents.skillInstructions")}
                        className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => { void saveSkill(skill); }}
                          disabled={savingSkillId === skill.id}
                          className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                        >
                          {t("chat.save")}
                        </button>
                        <button
                          onClick={() => { void removeSkill(skill.id); }}
                          className="rounded-xl border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle"
                        >
                          {t("chat.delete")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </InspectorSection>
            ) : null}

            {inspectorTab === "runs" ? (
              <InspectorSection
                title={t("agents.runTree")}
                caption={t("agents.runTreeDesc")}
                open={inspectorSections.runs}
                onToggle={() => setInspectorSections((prev) => ({ ...prev, runs: !prev.runs }))}
                action={(
                  <div className="flex items-center gap-2">
                    {actionRun ? (
                      <>
                        <button
                          onClick={() => { void retryRun(actionRun.id); }}
                          disabled={running}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                        >
                          {t("agents.retryRun")}
                        </button>
                        <button
                          onClick={() => { void resumeRun(actionRun.id); }}
                          disabled={running || (actionRun.status !== "error" && actionRun.status !== "aborted")}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                        >
                          {t("agents.resumeRun")}
                        </button>
                      </>
                    ) : null}
                    {selectedTraceRunId ? (
                      <button
                        onClick={() => setSelectedTraceRunId(null)}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      >
                        {t("agents.showAllRuns")}
                      </button>
                    ) : null}
                  </div>
                )}
              >
                <div className="space-y-2">
                  {actionRun ? (
                    <div className="rounded-[18px] border border-border-subtle bg-bg-primary px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                          {selectedRun ? t("agents.selectedRun") : t("agents.latestRun")}
                        </div>
                        <Badge variant={runStatusTone(actionRun.status) as "default" | "accent" | "warning" | "danger" | "success"}>
                          {actionRun.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-semibold text-text-primary">{actionRun.title || t("agents.runLabel")}</div>
                      <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                        {actionRun.summary || t("agents.noRunSummary")}
                      </div>
                      <div className="mt-2 text-[11px] text-text-tertiary">{t("agents.runSelectionHint")}</div>
                      {actionRun.status !== "error" && actionRun.status !== "aborted" ? (
                        <div className="mt-2 text-[11px] text-text-tertiary">{t("agents.onlyFailedRunsResume")}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {runTree.length > 0 ? runTree.map((node) => renderRunBranch(node)) : (
                    <div className="text-xs text-text-tertiary">{t("agents.noRunsYet")}</div>
                  )}
                </div>
              </InspectorSection>
            ) : null}

            {inspectorTab === "integrations" ? (
              <InspectorSection
                title={t("agents.integrations")}
                caption={t("agents.integrationsDesc")}
                open={inspectorSections.integrations}
                onToggle={() => setInspectorSections((prev) => ({ ...prev, integrations: !prev.integrations }))}
              >
                <div className="space-y-2.5">
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.integrationShortcuts")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => openSettingsView("agents", "settings-agents-core")}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      >
                        {t("agents.openAgentSettings")}
                      </button>
                      <button
                        onClick={() => openSettingsView("tools", "settings-tools-mcp")}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      >
                        {t("agents.openMcpSettings")}
                      </button>
                    </div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("agents.integrationShortcutsDesc")}</div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.integrationFirstParty")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={appSettings?.agentWorkspaceToolsEnabled !== false ? "success" : "default"}>
                        Files · {appSettings?.agentWorkspaceToolsEnabled !== false ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                      <Badge variant={appSettings?.agentCommandToolEnabled !== false ? "success" : "default"}>
                        Command · {appSettings?.agentCommandToolEnabled !== false ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                    </div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.integrationSecurity")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={appSettings?.agentDangerousFileOpsEnabled === true ? "warning" : "success"}>
                        {t("agents.securityDangerFiles")} · {appSettings?.agentDangerousFileOpsEnabled === true ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                      <Badge variant={appSettings?.agentNetworkCommandsEnabled === true ? "warning" : "success"}>
                        {t("agents.securityNetwork")} · {appSettings?.agentNetworkCommandsEnabled === true ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                      <Badge variant={appSettings?.agentShellCommandsEnabled === true ? "warning" : "success"}>
                        {t("agents.securityShell")} · {appSettings?.agentShellCommandsEnabled === true ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                      <Badge variant={appSettings?.agentGitWriteCommandsEnabled === true ? "warning" : "success"}>
                        {t("agents.securityGitWrite")} · {appSettings?.agentGitWriteCommandsEnabled === true ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                      </Badge>
                    </div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("settings.agentsSecurityDesc")}</div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.integrationThreadTools")}</div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">
                      {threadDraft.toolMode === "enabled" ? t("agents.toolsEnabled") : t("agents.toolsDisabled")}
                    </div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.integrationMcpServers")}</div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">{enabledMcpServers}</div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("agents.manageMcpInSettings")}</div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.contextCompaction")}</div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">
                      {appSettings?.agentAutoCompactEnabled !== false ? t("agents.globalToggleOn") : t("agents.globalToggleOff")}
                    </div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("agents.contextCompactionDesc")}</div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.replyReserveTokens")}</div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">{appSettings?.agentReplyReserveTokens || 1400}</div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("agents.replyReserveTokensDesc")}</div>
                  </div>
                  <div className="agents-simple-metric-card">
                    <div className="agents-simple-metric-label">{t("agents.toolContextBudget")}</div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">{appSettings?.agentToolContextChars || 2600}</div>
                    <div className="mt-2 text-[11px] leading-5 text-text-tertiary">{t("agents.toolContextBudgetDesc")}</div>
                  </div>
                </div>
              </InspectorSection>
            ) : null}
          </div>
        ) : (
          <EmptyState title={t("agents.config")} description={t("agents.emptyDesc")} />
        )
      }
      />
      <AttachmentPreviewModal
        viewer={attachmentViewer}
        onClose={() => setAttachmentViewer(null)}
        onOpenRaw={openAttachmentRaw}
        t={t}
      />
    </>
  );
}
