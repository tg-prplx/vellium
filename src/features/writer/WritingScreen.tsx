import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ThreePanelLayout, Badge, EmptyState } from "../../components/Panels";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type {
  BookProject,
  Chapter,
  CharacterDetail,
  ConsistencyIssue,
  ProviderModel,
  ProviderProfile,
  Scene,
  WriterChapterSettings,
  WriterCharacterAdvancedOptions,
  WriterCharacterEditField,
  WriterDocxParseMode,
  WriterProjectNotes,
  WriterSummaryLens,
  WriterSummaryLensScope
} from "../../shared/types/contracts";

const SEVERITY_STYLES: Record<string, { badge: "warning" | "danger" | "default"; border: string }> = {
  low: { badge: "default", border: "border-border-subtle" },
  medium: { badge: "warning", border: "border-warning-border" },
  high: { badge: "danger", border: "border-danger-border" }
};

const DEFAULT_CHAPTER_SETTINGS: WriterChapterSettings = {
  tone: "cinematic",
  pacing: "balanced",
  pov: "third_limited",
  creativity: 0.7,
  tension: 0.55,
  detail: 0.65,
  dialogue: 0.5
};

const DEFAULT_WRITER_CHARACTER_ADVANCED: WriterCharacterAdvancedOptions = {
  name: "",
  role: "",
  personality: "",
  scenario: "",
  greetingStyle: "",
  systemPrompt: "",
  tags: "",
  notes: ""
};

const DEFAULT_PROJECT_NOTES: WriterProjectNotes = {
  premise: "",
  styleGuide: "",
  characterNotes: "",
  worldRules: "",
  contextMode: "balanced",
  summary: ""
};

const LENS_PRESET_IDS = [
  "characterArc",
  "objectTracker",
  "settingEvolution",
  "timelineProgression",
  "themeDevelopment"
] as const;

type LensPresetId = typeof LENS_PRESET_IDS[number];

interface CollapsibleSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  action?: ReactNode;
}

function CollapsibleSection({ title, collapsed, onToggle, children, action }: CollapsibleSectionProps) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-primary">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <svg
            className={`h-3 w-3 text-text-tertiary transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{title}</span>
        </button>
        {action}
      </div>
      {!collapsed && (
        <div className="border-t border-border-subtle px-2.5 py-2">
          {children}
        </div>
      )}
    </section>
  );
}

type WritingWorkspaceMode = "books" | "characters";

interface CharacterEditDraft {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  systemPrompt: string;
  mesExample: string;
  creatorNotes: string;
  tagsText: string;
}

interface CharacterEditStatus {
  tone: "success" | "error";
  text: string;
}

const CHARACTER_AI_EDIT_FIELDS: WriterCharacterEditField[] = [
  "name",
  "description",
  "personality",
  "scenario",
  "greeting",
  "systemPrompt",
  "mesExample",
  "creatorNotes",
  "tags"
];

const EMPTY_CHARACTER_EDIT_DRAFT: CharacterEditDraft = {
  name: "",
  description: "",
  personality: "",
  scenario: "",
  greeting: "",
  systemPrompt: "",
  mesExample: "",
  creatorNotes: "",
  tagsText: ""
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read export blob"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.readAsDataURL(blob);
  });
}

async function triggerBlobDownload(blob: Blob, filename: string) {
  if (window.electronAPI?.saveFile) {
    const base64Data = await blobToBase64(blob);
    const saved = await window.electronAPI.saveFile(filename, base64Data);
    if (!saved.canceled && saved.ok) return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Background task tracking — persists across mounts
interface BackgroundTask {
  id: string;
  type: "generate" | "expand" | "rewrite" | "summarize" | "consistency" | "character";
  label: string;
  startedAt: number;
  status: "running" | "done" | "error";
  result?: string;
}

const _backgroundTasks: BackgroundTask[] = [];

function getBackgroundTasks(): BackgroundTask[] {
  return _backgroundTasks;
}

function addBackgroundTask(task: BackgroundTask) {
  _backgroundTasks.unshift(task);
  if (_backgroundTasks.length > 20) _backgroundTasks.pop();
}

function updateBackgroundTask(id: string, update: Partial<BackgroundTask>) {
  const task = _backgroundTasks.find((t) => t.id === id);
  if (task) Object.assign(task, update);
}

export function WritingScreen() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [activeProject, setActiveProject] = useState<BookProject | null>(null);
  const [projectNotes, setProjectNotes] = useState<WriterProjectNotes>({ ...DEFAULT_PROJECT_NOTES });
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [chapterPrompt, setChapterPrompt] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [generationLog, setGenerationLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editingSceneContent, setEditingSceneContent] = useState("");
  const [sceneEditBusyId, setSceneEditBusyId] = useState<string | null>(null);
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingProjectTitle, setRenamingProjectTitle] = useState("");
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null);
  const [renamingChapterTitle, setRenamingChapterTitle] = useState("");
  const [chapterDynamicsCollapsed, setChapterDynamicsCollapsed] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<"planning" | "lenses" | "diagnostics">("planning");
  const [bookBibleCollapsed, setBookBibleCollapsed] = useState(false);
  const [lensesCollapsed, setLensesCollapsed] = useState(false);
  const [consistencyCollapsed, setConsistencyCollapsed] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(true);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [bgTasks, setBgTasks] = useState<BackgroundTask[]>(getBackgroundTasks());
  const [chapterSettings, setChapterSettings] = useState<WriterChapterSettings>({ ...DEFAULT_CHAPTER_SETTINGS });
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [writerProviderId, setWriterProviderId] = useState("");
  const [writerModelId, setWriterModelId] = useState("");
  const [activeModelLabel, setActiveModelLabel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [summaryLenses, setSummaryLenses] = useState<WriterSummaryLens[]>([]);
  const [lensNameDraft, setLensNameDraft] = useState("");
  const [lensPromptDraft, setLensPromptDraft] = useState("");
  const [lensScopeDraft, setLensScopeDraft] = useState<WriterSummaryLensScope>("project");
  const [lensTargetDraft, setLensTargetDraft] = useState("");
  const [lensBusyId, setLensBusyId] = useState<string | null>(null);
  const [lensOutputExpanded, setLensOutputExpanded] = useState<Record<string, boolean>>({});
  const [docxParseMode, setDocxParseMode] = useState<WriterDocxParseMode>("auto");
  const [docxImportAsBook, setDocxImportAsBook] = useState(false);
  const [docxBookNameDraft, setDocxBookNameDraft] = useState("");
  const [characterPrompt, setCharacterPrompt] = useState("");
  const [characterAdvancedMode, setCharacterAdvancedMode] = useState(false);
  const [characterAdvanced, setCharacterAdvanced] = useState<WriterCharacterAdvancedOptions>({ ...DEFAULT_WRITER_CHARACTER_ADVANCED });
  const [characterBusy, setCharacterBusy] = useState(false);
  const [characterError, setCharacterError] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WritingWorkspaceMode>("books");
  const [characterEditorId, setCharacterEditorId] = useState<string | null>(null);
  const [characterEditDraft, setCharacterEditDraft] = useState<CharacterEditDraft>({ ...EMPTY_CHARACTER_EDIT_DRAFT });
  const [characterEditBusy, setCharacterEditBusy] = useState(false);
  const [characterEditStatus, setCharacterEditStatus] = useState<CharacterEditStatus | null>(null);
  const [characterAiInstruction, setCharacterAiInstruction] = useState("");
  const [characterAiFields, setCharacterAiFields] = useState<WriterCharacterEditField[]>([]);
  const [characterAiBusy, setCharacterAiBusy] = useState(false);
  const [alternateSimpleMode, setAlternateSimpleMode] = useState(false);
  const [simpleWritingLibraryOpen, setSimpleWritingLibraryOpen] = useState(false);
  const [simpleWritingInspectorOpen, setSimpleWritingInspectorOpen] = useState(false);
  const chapterSettingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docxImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.writerProjectList().then(setProjects);
    api.characterList().then(setCharacters).catch(() => {});
    api.providerList().then(setProviders).catch(() => {});
    api.settingsGet().then((settings) => {
      setAlternateSimpleMode(settings.alternateSimpleMode === true);
      setSimpleWritingLibraryOpen(settings.alternateSimpleMode !== true);
      setSimpleWritingInspectorOpen(false);
      if (settings.activeProviderId) setWriterProviderId(settings.activeProviderId);
      if (settings.activeModel) {
        setWriterModelId(settings.activeModel);
        setActiveModelLabel(settings.activeModel);
      }
    }).catch(() => {});
    // Show any running/completed background tasks from previous visits
    setBgTasks([...getBackgroundTasks()]);
  }, []);

  const writingSimpleModeActive = alternateSimpleMode;

  useEffect(() => {
    if (!writingSimpleModeActive) {
      setSimpleWritingLibraryOpen(false);
      setSimpleWritingInspectorOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (simpleWritingInspectorOpen) {
        setSimpleWritingInspectorOpen(false);
        return;
      }
      if (simpleWritingLibraryOpen) {
        setSimpleWritingLibraryOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [writingSimpleModeActive, simpleWritingLibraryOpen, simpleWritingInspectorOpen]);

  useEffect(() => {
    if (!writerProviderId) {
      setModels([]);
      setWriterModelId("");
      return;
    }
    setLoadingModels(true);
    api.providerFetchModels(writerProviderId)
      .then((list) => {
        setModels(list);
        setWriterModelId((prev) => {
          if (list.length === 0) return "";
          return list.some((m) => m.id === prev) ? prev : list[0].id;
        });
      })
      .catch(() => {
        setModels([]);
        setWriterModelId("");
      })
      .finally(() => setLoadingModels(false));
  }, [writerProviderId]);

  function log(msg: string) {
    setGenerationLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  }

  function startBgTask(type: BackgroundTask["type"], label: string): string {
    const id = `task-${Date.now()}`;
    const task: BackgroundTask = { id, type, label, startedAt: Date.now(), status: "running" };
    addBackgroundTask(task);
    setBgTasks([...getBackgroundTasks()]);
    return id;
  }

  function finishBgTask(id: string, status: "done" | "error", result?: string) {
    updateBackgroundTask(id, { status, result });
    setBgTasks([...getBackgroundTasks()]);
  }

  async function createProject() {
    const defaultName = `${t("writing.defaultBookPrefix")} ${projects.length + 1}`;
    const project = await api.writerProjectCreate(defaultName, t("writing.defaultProjectDescription"), []);
    setProjects((prev) => [project, ...prev]);
    setActiveProject(project);
    setProjectNotes(project.notes || { ...DEFAULT_PROJECT_NOTES });
    setRenamingProjectId(null);
    setRenamingProjectTitle("");
    setRenamingChapterId(null);
    setRenamingChapterTitle("");
    setChapters([]);
    setScenes([]);
    setSelectedChapterId(null);
    setSelectedSceneId(null);
    setChapterSettings({ ...DEFAULT_CHAPTER_SETTINGS });
    setSummaryLenses([]);
    setLensOutputExpanded({});
    setLensNameDraft("");
    setLensPromptDraft("");
    setLensScopeDraft("project");
    setLensTargetDraft("");
  }

  function startRenameProject(project: BookProject) {
    setRenamingProjectId(project.id);
    setRenamingProjectTitle(project.name || "");
  }

  function cancelRenameProject() {
    setRenamingProjectId(null);
    setRenamingProjectTitle("");
  }

  async function submitRenameProject(project: BookProject) {
    const nextName = renamingProjectTitle.trim();
    if (!nextName || nextName === project.name) {
      cancelRenameProject();
      return;
    }
    try {
      const updated = await api.writerProjectUpdate(project.id, { name: nextName });
      if (activeProject?.id === updated.id) setActiveProject(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      log(`${t("writing.logBookRenamed")}: ${updated.name}`);
      cancelRenameProject();
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function deleteProject(project: BookProject) {
    if (!confirm(t("writing.confirmDeleteBook"))) return;
    const deletingId = project.id;
    const deletingName = project.name;
    try {
      await api.writerProjectDelete(deletingId);
      const remaining = projects.filter((project) => project.id !== deletingId);
      setProjects(remaining);
      cancelRenameProject();
      if (remaining.length > 0 && activeProject?.id === deletingId) {
        await openProject(remaining[0]);
      } else if (remaining.length === 0) {
        setActiveProject(null);
        setProjectNotes({ ...DEFAULT_PROJECT_NOTES });
        setChapters([]);
        setScenes([]);
        setSelectedChapterId(null);
        setSelectedSceneId(null);
        setChapterSettings({ ...DEFAULT_CHAPTER_SETTINGS });
        setSummaryLenses([]);
        setLensOutputExpanded({});
      }
      log(`${t("writing.logBookDeleted")}: ${deletingName}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  function startRenameChapter(chapter: Chapter) {
    setRenamingChapterId(chapter.id);
    setRenamingChapterTitle(chapter.title || "");
  }

  function cancelRenameChapter() {
    setRenamingChapterId(null);
    setRenamingChapterTitle("");
  }

  async function submitRenameChapter(chapter: Chapter) {
    const nextTitle = renamingChapterTitle.trim();
    if (!nextTitle || nextTitle === chapter.title) {
      cancelRenameChapter();
      return;
    }
    try {
      const updated = await api.writerChapterUpdate(chapter.id, { title: nextTitle });
      setChapters((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedChapterId === updated.id) {
        setChapterSettings(updated.settings ?? { ...DEFAULT_CHAPTER_SETTINGS });
      }
      log(`${t("writing.logChapterRenamed")}: ${updated.title}`);
      cancelRenameChapter();
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function deleteChapter(chapter: Chapter) {
    if (!confirm(t("writing.confirmDeleteChapter"))) return;
    const deletingId = chapter.id;
    const deletingTitle = chapter.title;
    const removedSceneIds = new Set(
      scenes.filter((scene) => scene.chapterId === deletingId).map((scene) => scene.id)
    );

    try {
      await api.writerChapterDelete(deletingId);
      const remainingChapters = chapters
        .filter((item) => item.id !== deletingId)
        .map((item, index) => ({ ...item, position: index + 1 }));
      const remainingScenes = scenes.filter((scene) => scene.chapterId !== deletingId);

      const nextSelectedChapterId =
        selectedChapterId === deletingId
          ? (remainingChapters[0]?.id ?? null)
          : selectedChapterId;

      let nextSelectedSceneId = selectedSceneId;
      if (!nextSelectedSceneId || removedSceneIds.has(nextSelectedSceneId)) {
        if (nextSelectedChapterId) {
          nextSelectedSceneId =
            remainingScenes.find((scene) => scene.chapterId === nextSelectedChapterId)?.id
            ?? null;
        } else {
          nextSelectedSceneId = null;
        }
      }

      setChapters(remainingChapters);
      setScenes(remainingScenes);
      setSelectedChapterId(nextSelectedChapterId);
      setSelectedSceneId(nextSelectedSceneId);
      if (renamingChapterId === deletingId) {
        cancelRenameChapter();
      }
      log(`${t("writing.logChapterDeleted")}: ${deletingTitle}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function applyWriterModel() {
    if (!writerProviderId || !writerModelId) return;
    try {
      const updated = await api.providerSetActive(writerProviderId, writerModelId);
      if (updated.activeProviderId) setWriterProviderId(updated.activeProviderId);
      if (updated.activeModel) {
        setWriterModelId(updated.activeModel);
        setActiveModelLabel(updated.activeModel);
      } else {
        setActiveModelLabel(writerModelId);
      }
      log(`${t("writing.modelSet")}: ${updated.activeModel || writerModelId}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function openProject(project: BookProject) {
    const [loaded, lenses] = await Promise.all([
      api.writerProjectOpen(project.id),
      api.writerSummaryLensList(project.id).catch(() => [])
    ]);
    cancelRenameProject();
    setRenamingChapterId(null);
    setRenamingChapterTitle("");
    setActiveProject(loaded.project);
    setProjectNotes(loaded.project.notes || { ...DEFAULT_PROJECT_NOTES });
    setChapters(loaded.chapters);
    setScenes(loaded.scenes);
    setSelectedChapterId(loaded.chapters[0]?.id ?? null);
    setSelectedSceneId(loaded.scenes[0]?.id ?? null);
    setChapterSettings(loaded.chapters[0]?.settings ?? { ...DEFAULT_CHAPTER_SETTINGS });
    setSummaryLenses(lenses);
    setLensOutputExpanded(Object.fromEntries(lenses.map((lens) => [lens.id, false])));
  }

  async function createChapter() {
    if (!activeProject) return;
    const chapter = await api.writerChapterCreate(activeProject.id, `${t("writing.defaultChapterPrefix")} ${chapters.length + 1}`);
    setRenamingChapterId(null);
    setRenamingChapterTitle("");
    setChapters((prev) => [...prev, chapter]);
    setSelectedChapterId(chapter.id);
    setChapterSettings(chapter.settings ?? { ...DEFAULT_CHAPTER_SETTINGS });
    log(`${t("writing.logChapterCreated")}: ${chapter.title}`);
  }

  async function generateNextChapter() {
    if (!activeProject || busy) return;
    setBusy(true);
    const taskLabel = chapterPrompt.trim()
      ? `${t("writing.taskGenerateNextChapter")}: "${chapterPrompt.trim().slice(0, 30)}..."`
      : t("writing.taskGenerateNextChapter");
    const taskId = startBgTask("generate", taskLabel);
    log(t("writing.working"));
    try {
      const result = await api.writerGenerateNextChapter(activeProject.id, chapterPrompt.trim() || undefined);
      const { chapter, scene } = result;
      setRenamingChapterId(null);
      setRenamingChapterTitle("");
      setChapters((prev) => [...prev, chapter].sort((a, b) => a.position - b.position));
      setScenes((prev) => [...prev, scene]);
      setSelectedChapterId(chapter.id);
      setSelectedSceneId(scene.id);
      setChapterSettings(chapter.settings ?? { ...DEFAULT_CHAPTER_SETTINGS });
      setChapterPrompt("");
      log(`${t("writing.logNextChapterGenerated")}: ${chapter.title}`);
      finishBgTask(taskId, "done", chapter.title);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function generateDraft() {
    if (!selectedChapterId || busy) return;
    setBusy(true);
    const taskId = startBgTask("generate", `${t("writing.taskGenerate")}: "${chapterPrompt.slice(0, 30)}..."`);
    log(t("writing.working"));
    try {
      const scene = await api.writerGenerateDraft(selectedChapterId, chapterPrompt);
      setScenes((prev) => [...prev, scene]);
      setSelectedSceneId(scene.id);
      log(`${t("writing.logDraftGenerated")}: ${scene.title}`);
      finishBgTask(taskId, "done", scene.title);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    }
    setBusy(false);
  }

  async function runConsistency() {
    if (!activeProject) return;
    const taskId = startBgTask("consistency", t("writing.taskConsistency"));
    const report = await api.writerConsistencyRun(activeProject.id);
    setIssues(report);
    log(`${t("writing.logConsistencyFound")}: ${report.length}`);
    finishBgTask(taskId, "done", `${report.length} ${t("writing.issuesCount")}`);
  }

  async function expandScene() {
    if (!selectedSceneId || busy) return;
    setBusy(true);
    const taskId = startBgTask("expand", t("writing.taskExpand"));
    log(t("writing.working"));
    try {
      const scene = await api.writerSceneExpand(selectedSceneId);
      setScenes((prev) => prev.map((s) => (s.id === scene.id ? scene : s)));
      log(t("writing.logSceneExpanded"));
      finishBgTask(taskId, "done");
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    }
    setBusy(false);
  }

  async function rewriteScene() {
    if (!selectedSceneId || busy) return;
    setBusy(true);
    const tone = (chapterSettings.tone || DEFAULT_CHAPTER_SETTINGS.tone).trim();
    const taskId = startBgTask("rewrite", `${t("writing.taskRewrite")} (${tone})`);
    log(`${t("writing.rewrite")} (${tone})...`);
    try {
      const scene = await api.writerSceneRewrite(selectedSceneId);
      setScenes((prev) => prev.map((s) => (s.id === scene.id ? scene : s)));
      log(t("writing.logSceneRewritten"));
      finishBgTask(taskId, "done");
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    }
    setBusy(false);
  }

  async function summarizeScene() {
    if (!selectedSceneId || busy) return;
    setBusy(true);
    const taskId = startBgTask("summarize", t("writing.taskSummarize"));
    log(t("writing.working"));
    try {
      const summary = await api.writerSceneSummarize(selectedSceneId);
      log(`${t("writing.logSummary")}: ${summary}`);
      finishBgTask(taskId, "done", String(summary).slice(0, 100));
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    }
    setBusy(false);
  }

  function startInlineSceneEdit(scene: Scene) {
    setSelectedSceneId(scene.id);
    setEditingSceneId(scene.id);
    setEditingSceneContent(scene.content);
  }

  function cancelInlineSceneEdit() {
    setEditingSceneId(null);
    setEditingSceneContent("");
  }

  async function saveInlineSceneContent(scene: Scene) {
    const nextContent = editingSceneContent;
    if (editingSceneId !== scene.id) return;
    if (nextContent === scene.content) {
      cancelInlineSceneEdit();
      return;
    }
    setSceneEditBusyId(scene.id);
    try {
      const updated = await api.writerSceneUpdate(scene.id, { content: nextContent });
      setScenes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      cancelInlineSceneEdit();
      log(t("writing.logSceneSaved"));
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    } finally {
      setSceneEditBusyId(null);
    }
  }

  async function deleteScene(scene: Scene) {
    if (!confirm(t("writing.confirmDeleteScene"))) return;
    const deletingId = scene.id;
    const deletingTitle = scene.title;

    try {
      await api.writerSceneDelete(deletingId);
      const remainingScenes = scenes.filter((item) => item.id !== deletingId);
      const nextSelectedSceneId =
        selectedSceneId === deletingId
          ? (remainingScenes.find((item) => item.chapterId === scene.chapterId)?.id
            ?? remainingScenes[0]?.id
            ?? null)
          : selectedSceneId;

      setScenes(remainingScenes);
      setSelectedSceneId(nextSelectedSceneId);
      if (editingSceneId === deletingId) {
        cancelInlineSceneEdit();
      }
      log(`${t("writing.logSceneDeleted")}: ${deletingTitle}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function exportMarkdown() {
    if (!activeProject) return;
    try {
      const blob = await api.writerExportMarkdownDownload(activeProject.id);
      const filename = `${(activeProject.name || "book").replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ").trim() || "book"}.md`;
      await triggerBlobDownload(blob, filename);
      log(`${t("writing.logMarkdownExported")}: ${filename}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function exportDocx() {
    if (!activeProject) return;
    try {
      const blob = await api.writerExportDocxDownload(activeProject.id);
      const filename = `${(activeProject.name || "book").replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ").trim() || "book"}.docx`;
      await triggerBlobDownload(blob, filename);
      log(`${t("writing.logDocxExported")}: ${filename}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  function updateProjectNotes(patch: Partial<WriterProjectNotes>) {
    if (!activeProject) return;
    const next: WriterProjectNotes = { ...projectNotes, ...patch };
    setProjectNotes(next);
    setActiveProject((prev) => (prev ? { ...prev, notes: next } : prev));
    setProjects((prev) => prev.map((project) => (
      project.id === activeProject.id ? { ...project, notes: next } : project
    )));
    if (projectNotesTimerRef.current) clearTimeout(projectNotesTimerRef.current);
    projectNotesTimerRef.current = setTimeout(() => {
      void api.writerProjectUpdateNotes(activeProject.id, next).catch((err) => {
        log(`${t("writing.logError")}: ${String(err)}`);
      });
    }, 350);
  }

  async function summarizeBook(force = false) {
    if (!activeProject || busy) return;
    setBusy(true);
    const taskId = startBgTask("summarize", t("writing.summarizeBook"));
    try {
      const result = await api.writerProjectSummarize(activeProject.id, force);
      updateProjectNotes({ summary: result.summary });
      log(`${t("writing.logSummary")}: ${result.cached ? t("writing.summaryCached") : t("writing.summaryRefreshed")}`);
      finishBgTask(taskId, "done", `${result.chapterCount} ${t("writing.chShort")}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    } finally {
      setBusy(false);
    }
  }

  function openDocxPicker() {
    docxImportInputRef.current?.click();
  }

  async function handleDocxImport(file: File | null) {
    if (!file) return;
    if (!docxImportAsBook && !activeProject) return;
    if (busy) return;
    setBusy(true);
    const taskLabel = docxImportAsBook ? t("writing.importDocxAsBook") : t("writing.importDocx");
    const taskId = startBgTask("generate", `${taskLabel}: ${file.name}`);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read DOCX file"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
      if (docxImportAsBook) {
        const payload = await api.writerImportDocxAsBook(
          base64Data,
          file.name,
          docxParseMode,
          docxBookNameDraft.trim() || undefined
        );
        setProjects((prev) => [payload.project, ...prev.filter((project) => project.id !== payload.project.id)]);
        await openProject(payload.project);
        setDocxBookNameDraft("");
        log(`${t("writing.logBookImported")}: ${payload.project.name} (${payload.chaptersCreated} ${t("writing.chShort")})`);
        finishBgTask(taskId, "done", `${payload.chaptersCreated}/${payload.scenesCreated}`);
      } else if (activeProject) {
        const payload = await api.writerProjectImportDocx(activeProject.id, base64Data, file.name, docxParseMode);
        await openProject(activeProject);
        log(`${t("writing.logDocxImported")}: ${payload.chaptersCreated} ${t("writing.chShort")}, ${payload.scenesCreated} ${t("writing.scenesShort")}`);
        finishBgTask(taskId, "done", `${payload.chaptersCreated}/${payload.scenesCreated}`);
      }
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    } finally {
      setBusy(false);
      if (docxImportInputRef.current) {
        docxImportInputRef.current.value = "";
      }
    }
  }

  function docxParseModeLabel(mode: WriterDocxParseMode): string {
    switch (mode) {
      case "chapter_markers":
        return t("writing.docxModeChapterMarkers");
      case "heading_lines":
        return t("writing.docxModeHeadingLines");
      case "single_book":
        return t("writing.docxModeSingleBook");
      default:
        return t("writing.docxModeAuto");
    }
  }

  function applyLensPreset(presetId: LensPresetId) {
    switch (presetId) {
      case "characterArc":
        setLensNameDraft(t("writing.lensPresetCharacterArc"));
        setLensPromptDraft(t("writing.lensPresetCharacterArcPrompt"));
        setLensScopeDraft("project");
        setLensTargetDraft("");
        break;
      case "objectTracker":
        setLensNameDraft(t("writing.lensPresetObjectTracker"));
        setLensPromptDraft(t("writing.lensPresetObjectTrackerPrompt"));
        setLensScopeDraft("project");
        setLensTargetDraft("");
        break;
      case "settingEvolution":
        setLensNameDraft(t("writing.lensPresetSettingEvolution"));
        setLensPromptDraft(t("writing.lensPresetSettingEvolutionPrompt"));
        setLensScopeDraft("project");
        setLensTargetDraft("");
        break;
      case "timelineProgression":
        setLensNameDraft(t("writing.lensPresetTimeline"));
        setLensPromptDraft(t("writing.lensPresetTimelinePrompt"));
        setLensScopeDraft("project");
        setLensTargetDraft("");
        break;
      case "themeDevelopment":
        setLensNameDraft(t("writing.lensPresetTheme"));
        setLensPromptDraft(t("writing.lensPresetThemePrompt"));
        setLensScopeDraft("project");
        setLensTargetDraft("");
        break;
      default:
        break;
    }
  }

  async function createSummaryLens() {
    if (!activeProject) return;
    const prompt = lensPromptDraft.trim();
    if (!prompt) {
      log(`${t("writing.logError")}: ${t("writing.lensPromptRequired")}`);
      return;
    }
    const targetId = lensScopeDraft === "project"
      ? null
      : (lensTargetDraft || (lensScopeDraft === "chapter" ? selectedChapterId : selectedSceneId) || null);
    try {
      const created = await api.writerSummaryLensCreate(activeProject.id, {
        name: lensNameDraft.trim() || t("writing.lensDefaultName"),
        prompt,
        scope: lensScopeDraft,
        targetId
      });
      setSummaryLenses((prev) => [created, ...prev]);
      setLensOutputExpanded((prev) => ({ ...prev, [created.id]: false }));
      setLensNameDraft("");
      setLensPromptDraft("");
      log(`${t("writing.logLensCreated")}: ${created.name}`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  async function runSummaryLens(lensId: string, force = false) {
    if (!activeProject || lensBusyId) return;
    const lens = summaryLenses.find((item) => item.id === lensId);
    if (!lens) return;
    const taskId = startBgTask("summarize", `${t("writing.taskLensRun")}: ${lens.name}`);
    setLensBusyId(lensId);
    try {
      const result = await api.writerSummaryLensRun(activeProject.id, lensId, force);
      setSummaryLenses((prev) => prev.map((item) => (item.id === lensId ? result.lens : item)));
      setLensOutputExpanded((prev) => ({ ...prev, [lensId]: true }));
      log(`${t("writing.logLensReady")}: ${result.lens.name}${result.cached ? ` (${t("writing.summaryCached")})` : ""}`);
      finishBgTask(taskId, "done", `${Math.round(result.sourceChars / 1000)}k`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
      finishBgTask(taskId, "error", String(err));
    } finally {
      setLensBusyId(null);
    }
  }

  async function removeSummaryLens(lensId: string) {
    if (!activeProject) return;
    if (!confirm(t("writing.confirmDeleteLens"))) return;
    try {
      await api.writerSummaryLensDelete(activeProject.id, lensId);
      setSummaryLenses((prev) => prev.filter((item) => item.id !== lensId));
      setLensOutputExpanded((prev) => {
        const next = { ...prev };
        delete next[lensId];
        return next;
      });
      log(t("writing.logLensDeleted"));
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  function loadLensToDraft(lens: WriterSummaryLens) {
    setLensNameDraft(lens.name);
    setLensPromptDraft(lens.prompt);
    setLensScopeDraft(lens.scope);
    setLensTargetDraft(lens.targetId || "");
    setRightSidebarTab("lenses");
  }

  function lensPresetLabel(presetId: LensPresetId): string {
    switch (presetId) {
      case "characterArc":
        return t("writing.lensPresetCharacterArc");
      case "objectTracker":
        return t("writing.lensPresetObjectTracker");
      case "settingEvolution":
        return t("writing.lensPresetSettingEvolution");
      case "timelineProgression":
        return t("writing.lensPresetTimeline");
      case "themeDevelopment":
        return t("writing.lensPresetTheme");
      default:
        return presetId;
    }
  }

  async function toggleProjectCharacter(characterId: string) {
    if (!activeProject) return;
    const currentIds = activeProject.characterIds || [];
    const nextIds = currentIds.includes(characterId)
      ? currentIds.filter((id) => id !== characterId)
      : [...currentIds, characterId];
    try {
      const updated = await api.writerProjectSetCharacters(activeProject.id, nextIds);
      setActiveProject(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      log(`${t("writing.logCastUpdated")} (${updated.characterIds.length} ${t("writing.charactersCountSuffix")})`);
    } catch (err) {
      log(`${t("writing.logError")}: ${String(err)}`);
    }
  }

  function updateCharacterAdvanced<K extends keyof WriterCharacterAdvancedOptions>(key: K, value: string) {
    setCharacterAdvanced((prev) => ({ ...prev, [key]: value }));
  }

  async function generateCharacterFromDescription() {
    const description = characterPrompt.trim();
    if (!description || characterBusy) {
      if (!description) setCharacterError(t("writing.characterRequired"));
      return;
    }
    setCharacterBusy(true);
    setCharacterError("");
    const taskId = startBgTask("character", t("writing.taskCharacterGenerate"));
    try {
      const created = await api.writerGenerateCharacter({
        description,
        mode: characterAdvancedMode ? "advanced" : "basic",
        advanced: characterAdvancedMode ? characterAdvanced : undefined
      });
      setCharacters((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setCharacterEditorId(created.id);
      log(`${t("writing.logCharacterGenerated")}: ${created.name}`);
      finishBgTask(taskId, "done", created.name);
      setCharacterPrompt("");

      if (activeProject && !(activeProject.characterIds || []).includes(created.id)) {
        const updated = await api.writerProjectSetCharacters(activeProject.id, [...(activeProject.characterIds || []), created.id]);
        setActiveProject(updated);
        setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
        log(`${t("writing.logCharacterAddedToCast")}: ${created.name}`);
      }
    } catch (err) {
      const errorText = String(err);
      setCharacterError(errorText);
      log(`${t("writing.logError")}: ${errorText}`);
      finishBgTask(taskId, "error", errorText);
    } finally {
      setCharacterBusy(false);
    }
  }

  function parseCharacterTags(raw: string): string[] {
    return raw
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function toggleCharacterAiField(field: WriterCharacterEditField) {
    setCharacterAiFields((prev) => (
      prev.includes(field)
        ? prev.filter((item) => item !== field)
        : [...prev, field]
    ));
  }

  function characterFieldLabel(field: WriterCharacterEditField): string {
    switch (field) {
      case "name": return t("chars.name");
      case "description": return t("chars.description");
      case "personality": return t("chars.personality");
      case "scenario": return t("chars.scenario");
      case "greeting": return t("chars.firstMessage");
      case "systemPrompt": return t("chars.systemPrompt");
      case "mesExample": return t("chars.exampleMessages");
      case "creatorNotes": return t("chars.creatorNotes");
      case "tags": return t("chars.tags");
      default: return field;
    }
  }

  const selectedCharacterToEdit = useMemo(
    () => characters.find((character) => character.id === characterEditorId) ?? null,
    [characters, characterEditorId]
  );

  useEffect(() => {
    if (characters.length === 0) {
      setCharacterEditorId(null);
      setCharacterEditDraft({ ...EMPTY_CHARACTER_EDIT_DRAFT });
      return;
    }
    if (!characterEditorId || !characters.some((character) => character.id === characterEditorId)) {
      setCharacterEditorId(characters[0].id);
    }
  }, [characters, characterEditorId]);

  useEffect(() => {
    if (!selectedCharacterToEdit) {
      setCharacterEditDraft({ ...EMPTY_CHARACTER_EDIT_DRAFT });
      setCharacterEditStatus(null);
      return;
    }
    setCharacterEditDraft({
      name: selectedCharacterToEdit.name || "",
      description: selectedCharacterToEdit.description || "",
      personality: selectedCharacterToEdit.personality || "",
      scenario: selectedCharacterToEdit.scenario || "",
      greeting: selectedCharacterToEdit.greeting || "",
      systemPrompt: selectedCharacterToEdit.systemPrompt || "",
      mesExample: selectedCharacterToEdit.mesExample || "",
      creatorNotes: selectedCharacterToEdit.creatorNotes || "",
      tagsText: (selectedCharacterToEdit.tags || []).join(", ")
    });
    setCharacterEditStatus(null);
    setCharacterAiInstruction("");
    setCharacterAiFields([]);
  }, [selectedCharacterToEdit?.id, selectedCharacterToEdit]);

  async function saveCharacterEditor() {
    if (!selectedCharacterToEdit || characterEditBusy || characterAiBusy) return;
    setCharacterEditBusy(true);
    setCharacterEditStatus(null);
    try {
      const updated = await api.characterUpdate(selectedCharacterToEdit.id, {
        name: characterEditDraft.name,
        description: characterEditDraft.description,
        personality: characterEditDraft.personality,
        scenario: characterEditDraft.scenario,
        greeting: characterEditDraft.greeting,
        systemPrompt: characterEditDraft.systemPrompt,
        mesExample: characterEditDraft.mesExample,
        creatorNotes: characterEditDraft.creatorNotes,
        tags: parseCharacterTags(characterEditDraft.tagsText)
      });
      setCharacters((prev) => prev.map((character) => (character.id === updated.id ? updated : character)));
      setCharacterEditStatus({ tone: "success", text: t("chars.saved") });
      log(`${t("chars.saved")}: ${updated.name}`);
    } catch (err) {
      const text = String(err);
      setCharacterEditStatus({ tone: "error", text });
      log(`${t("writing.logError")}: ${text}`);
    } finally {
      setCharacterEditBusy(false);
    }
  }

  async function applyCharacterAiEdit() {
    if (!selectedCharacterToEdit || characterEditBusy || characterAiBusy) return;
    const instruction = characterAiInstruction.trim();
    if (!instruction) {
      setCharacterEditStatus({ tone: "error", text: t("writing.characterAiInstructionRequired") });
      return;
    }
    setCharacterAiBusy(true);
    setCharacterEditStatus(null);
    try {
      const result = await api.writerEditCharacter(selectedCharacterToEdit.id, {
        instruction,
        fields: characterAiFields.length > 0 ? characterAiFields : undefined
      });
      const updated = result.character;
      setCharacters((prev) => prev.map((character) => (character.id === updated.id ? updated : character)));
      if (result.changedFields.length === 0) {
        setCharacterEditStatus({ tone: "success", text: t("writing.characterAiNoChanges") });
        log(`${t("writing.characterAiNoChanges")}: ${updated.name}`);
      } else {
        const labels = result.changedFields.map((field) => characterFieldLabel(field)).join(", ");
        const status = `${t("writing.characterAiChanged")}: ${labels}`;
        setCharacterEditStatus({ tone: "success", text: status });
        log(`${status} (${updated.name})`);
      }
    } catch (err) {
      const text = String(err);
      setCharacterEditStatus({ tone: "error", text });
      log(`${t("writing.logError")}: ${text}`);
    } finally {
      setCharacterAiBusy(false);
    }
  }

  const selectedChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [chapters, selectedChapterId]
  );

  useEffect(() => {
    setChapterSettings(selectedChapter?.settings ?? { ...DEFAULT_CHAPTER_SETTINGS });
  }, [selectedChapterId, selectedChapter]);

  useEffect(() => {
    setProjectNotes(activeProject?.notes || { ...DEFAULT_PROJECT_NOTES });
  }, [activeProject?.id]);

  useEffect(() => {
    if (lensScopeDraft === "project") {
      if (lensTargetDraft) setLensTargetDraft("");
      return;
    }
    if (lensScopeDraft === "chapter" && !lensTargetDraft && selectedChapterId) {
      setLensTargetDraft(selectedChapterId);
      return;
    }
    if (lensScopeDraft === "scene" && !lensTargetDraft && selectedSceneId) {
      setLensTargetDraft(selectedSceneId);
    }
  }, [lensScopeDraft, lensTargetDraft, selectedChapterId, selectedSceneId]);

  useEffect(() => {
    return () => {
      if (chapterSettingsTimerRef.current) clearTimeout(chapterSettingsTimerRef.current);
      if (projectNotesTimerRef.current) clearTimeout(projectNotesTimerRef.current);
    };
  }, []);

  function updateSelectedChapterSettings(patch: Partial<WriterChapterSettings>) {
    if (!selectedChapterId) return;
    const merged: WriterChapterSettings = {
      ...chapterSettings,
      ...patch,
      creativity: clamp01(Number((patch.creativity ?? chapterSettings.creativity))),
      tension: clamp01(Number((patch.tension ?? chapterSettings.tension))),
      detail: clamp01(Number((patch.detail ?? chapterSettings.detail))),
      dialogue: clamp01(Number((patch.dialogue ?? chapterSettings.dialogue)))
    };
    setChapterSettings(merged);
    setChapters((prev) => prev.map((chapter) => (
      chapter.id === selectedChapterId ? { ...chapter, settings: merged } : chapter
    )));

    if (chapterSettingsTimerRef.current) clearTimeout(chapterSettingsTimerRef.current);
    chapterSettingsTimerRef.current = setTimeout(() => {
      api.writerChapterUpdateSettings(selectedChapterId, merged)
        .then((updatedChapter) => {
          setChapters((prev) => prev.map((chapter) => (
            chapter.id === updatedChapter.id ? updatedChapter : chapter
          )));
        })
        .catch((err) => log(`Error: ${String(err)}`));
    }, 250);
  }

  const selectedScene = useMemo(() => scenes.find((s) => s.id === selectedSceneId) ?? null, [scenes, selectedSceneId]);
  const filteredProjects = useMemo(() => {
    const q = bookSearchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      const haystack = `${project.name || ""} ${project.description || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, bookSearchQuery]);
  const lensSceneOptions = useMemo(() => {
    if (lensScopeDraft === "chapter" && lensTargetDraft) {
      return scenes.filter((scene) => scene.chapterId === lensTargetDraft);
    }
    if (selectedChapterId) {
      return scenes.filter((scene) => scene.chapterId === selectedChapterId);
    }
    return scenes;
  }, [scenes, lensScopeDraft, lensTargetDraft, selectedChapterId]);

  useEffect(() => {
    if (editingSceneId && !scenes.some((scene) => scene.id === editingSceneId)) {
      cancelInlineSceneEdit();
    }
  }, [editingSceneId, scenes]);

  const runningTasks = bgTasks.filter((t) => t.status === "running");

  function renderWorkspaceModeSwitch() {
    return (
      <div className="inline-flex items-center rounded-md border border-border-subtle bg-bg-primary p-[2px]">
        <button
          onClick={() => setWorkspaceMode("books")}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 transition-colors ${
            workspaceMode === "books"
              ? "bg-accent text-text-inverse"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          {t("writing.modeBooks")}
        </button>
        <button
          onClick={() => setWorkspaceMode("characters")}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 transition-colors ${
            workspaceMode === "characters"
              ? "bg-accent text-text-inverse"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          {t("writing.modeCharacters")}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col gap-3 px-1 pb-1 ${writingSimpleModeActive ? "writing-simple-root" : ""}`}>
      {writingSimpleModeActive && workspaceMode === "books" && (simpleWritingLibraryOpen || simpleWritingInspectorOpen) && (
        <button
          type="button"
          aria-label="Close writing panels"
          className="writing-simple-overlay xl:hidden"
          onClick={() => {
            setSimpleWritingLibraryOpen(false);
            setSimpleWritingInspectorOpen(false);
          }}
        />
      )}
      {workspaceMode === "books" ? (
        <ThreePanelLayout
      className={writingSimpleModeActive ? `writing-simple-layout ${simpleWritingLibraryOpen ? "is-library-open" : "is-library-closed"} ${simpleWritingInspectorOpen ? "is-outline-open" : "is-outline-closed"}` : ""}
      leftClassName={writingSimpleModeActive ? "writing-simple-left-panel" : ""}
      centerClassName={writingSimpleModeActive ? "writing-simple-center-panel" : ""}
      rightClassName={writingSimpleModeActive ? "writing-simple-right-panel" : ""}
      left={
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("writing.projects")}</h2>
              {writingSimpleModeActive && (
                <button
                  type="button"
                  onClick={() => setSimpleWritingLibraryOpen(false)}
                  className="rounded-md border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-hover"
                  title={t("chat.cancel")}
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={() => { void createProject(); }}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t("chat.new")}
            </button>
          </div>

          <div>
            <input
              value={bookSearchQuery}
              onChange={(e) => setBookSearchQuery(e.target.value)}
              placeholder={t("writing.searchBooks")}
              className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          <div className="rounded-lg border border-border-subtle bg-bg-primary p-2.5">
            <button
              onClick={openDocxPicker}
              disabled={busy || (!docxImportAsBook && !activeProject)}
              className="w-full rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover disabled:opacity-40"
            >
              {docxImportAsBook ? t("writing.importDocxAsBook") : t("writing.importDocx")}
            </button>
            <input
              ref={docxImportInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                void handleDocxImport(file);
              }}
            />
            <div className="mt-1.5 grid grid-cols-1 gap-1">
              <label className="text-[10px] text-text-tertiary">
                {t("writing.docxParseMode")}
                <select
                  value={docxParseMode}
                  onChange={(e) => setDocxParseMode(e.target.value as WriterDocxParseMode)}
                  className="mt-1 w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
                >
                  {(["auto", "chapter_markers", "heading_lines", "single_book"] as WriterDocxParseMode[]).map((mode) => (
                    <option key={mode} value={mode}>{docxParseModeLabel(mode)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={docxImportAsBook}
                  onChange={(e) => setDocxImportAsBook(e.target.checked)}
                />
                {t("writing.docxImportAsBook")}
              </label>
              {docxImportAsBook && (
                <input
                  value={docxBookNameDraft}
                  onChange={(e) => setDocxBookNameDraft(e.target.value)}
                  placeholder={t("writing.docxBookName")}
                  className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary"
                />
              )}
            </div>
          </div>

          <div className="list-animate min-h-0 flex-1 space-y-1 overflow-y-auto">
            {projects.length === 0 ? (
              <EmptyState title={t("writing.noProjects")} description={t("writing.noProjectsDesc")} />
            ) : filteredProjects.length === 0 ? (
              <EmptyState title={t("writing.noBookSearchResults")} description={t("writing.noBookSearchResultsDesc")} />
            ) : (
              filteredProjects.map((project) => {
                const isRenaming = renamingProjectId === project.id;
                return (
                  <div
                    key={project.id}
                    className={`group relative flex items-start gap-2 rounded-lg px-3 py-2 transition-colors ${
                      activeProject?.id === project.id
                        ? "bg-accent-subtle text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    {isRenaming ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          value={renamingProjectTitle}
                          onChange={(e) => setRenamingProjectTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitRenameProject(project);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRenameProject();
                            }
                          }}
                          className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
                          autoFocus
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void submitRenameProject(project);
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                          title={t("chat.save")}
                        >
                          {t("chat.save")}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRenameProject();
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                          title={t("chat.cancel")}
                        >
                          {t("chat.cancel")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => openProject(project)} className="flex min-w-0 flex-1 text-left">
                          <div className="min-w-0 flex-1">
                            <div className="break-words whitespace-normal text-sm font-medium leading-snug">{project.name || t("writing.untitledBook")}</div>
                            <div className="mt-0.5 break-words text-[11px] text-text-tertiary">{project.description}</div>
                          </div>
                        </button>
                        <div className={`flex flex-shrink-0 items-center gap-0.5 ${
                          activeProject?.id === project.id ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRenameProject(project);
                            }}
                            className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                            title={t("writing.rename")}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteProject(project);
                            }}
                            className="rounded-md p-1 text-text-tertiary hover:bg-danger-subtle hover:text-danger"
                            title={t("chat.delete")}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t("writing.chapters")}</div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {chapters.map((ch) => {
                const isRenaming = renamingChapterId === ch.id;
                return (
                  <div
                    key={ch.id}
                    className={`group flex items-start gap-1 rounded-md px-1.5 py-1 ${
                      selectedChapterId === ch.id ? "bg-accent-subtle" : "hover:bg-bg-hover"
                    }`}
                  >
                    {isRenaming ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          value={renamingChapterTitle}
                          onChange={(e) => setRenamingChapterTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitRenameChapter(ch);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRenameChapter();
                            }
                          }}
                          className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
                          autoFocus
                        />
                        <button
                          onClick={() => void submitRenameChapter(ch)}
                          className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                          title={t("chat.save")}
                        >
                          {t("chat.save")}
                        </button>
                        <button
                          onClick={cancelRenameChapter}
                          className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                          title={t("chat.cancel")}
                        >
                          {t("chat.cancel")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setSelectedChapterId(ch.id)}
                          className={`min-w-0 flex-1 text-left text-xs ${
                            selectedChapterId === ch.id ? "font-medium text-text-primary" : "text-text-secondary"
                          }`}
                        >
                          <span className="break-words whitespace-normal">{ch.title}</span>
                        </button>
                        <div className={`flex items-center gap-0.5 ${
                          selectedChapterId === ch.id ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}>
                          <button
                            onClick={() => startRenameChapter(ch)}
                            className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                            title={t("writing.rename")}
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => void deleteChapter(ch)}
                            className="rounded-md p-1 text-text-tertiary hover:bg-danger-subtle hover:text-danger"
                            title={t("chat.delete")}
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
              <span><span className="font-medium text-text-secondary">{chapters.length}</span> {t("writing.chShort")}</span>
              <span className="text-border">|</span>
              <span><span className="font-medium text-text-secondary">{scenes.length}</span> {t("writing.scenesShort")}</span>
            </div>
          </div>

          <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t("writing.cast")}</div>
              <Badge>{activeProject?.characterIds?.length ?? 0}</Badge>
            </div>
            {characters.length === 0 ? (
              <div className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-2 text-[11px] text-text-tertiary">
                {t("writing.castImportHint")}
              </div>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {characters.map((character) => {
                  const selected = Boolean(activeProject?.characterIds?.includes(character.id));
                  return (
                    <button
                      key={character.id}
                      onClick={() => toggleProjectCharacter(character.id)}
                      disabled={!activeProject}
                      className={`flex w-full items-center gap-2 overflow-hidden rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                        selected
                          ? "border-accent-border bg-accent-subtle text-text-primary"
                          : "border-border-subtle text-text-secondary hover:bg-bg-hover"
                      } disabled:opacity-40`}
                    >
                      <span className="min-w-0 flex-1 truncate">{character.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Background tasks indicator */}
          {runningTasks.length > 0 && (
            <div className="float-card rounded-lg border border-accent-border bg-accent-subtle p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-[11px] font-semibold text-accent">{t("writing.working")}</span>
              </div>
              {runningTasks.map((task) => (
                <div key={task.id} className="text-[10px] text-text-secondary">{task.label}</div>
              ))}
            </div>
          )}
        </div>
      }
      center={
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
          {writingSimpleModeActive && (
            <div className="writing-simple-top-controls">
              <button
                type="button"
                onClick={() => setSimpleWritingLibraryOpen((prev) => !prev)}
                className={`writing-simple-top-button ${simpleWritingLibraryOpen ? "is-active" : ""}`}
              >
                {t("writing.projects")}
              </button>
              <button
                type="button"
                onClick={() => setSimpleWritingInspectorOpen((prev) => !prev)}
                className={`writing-simple-top-button ${simpleWritingInspectorOpen ? "is-active" : ""}`}
              >
                {t("writing.outline")}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              <span className="block truncate">{activeProject ? activeProject.name : t("writing.creativeWriting")}</span>
            </h2>
            <div className="flex items-center gap-2">
              {renderWorkspaceModeSwitch()}
              {busy && (
                <div className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[11px] text-accent">{t("writing.working")}</span>
                </div>
              )}
            </div>
          </div>

          <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chat.model")}</span>
              <span className="truncate text-xs text-text-secondary">{activeModelLabel || t("chat.noModel")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={writerProviderId}
                onChange={(e) => setWriterProviderId(e.target.value)}
                className="min-w-[170px] flex-1 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
              >
                <option value="">({t("settings.selectProvider")})</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
                ))}
              </select>
              <select
                value={writerModelId}
                onChange={(e) => setWriterModelId(e.target.value)}
                disabled={!writerProviderId || loadingModels}
                className="min-w-[170px] flex-1 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary disabled:opacity-40"
              >
                <option value="">
                  {loadingModels ? `${t("settings.loadModels")}...` : `(${t("settings.selectModel")})`}
                </option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.id}</option>
                ))}
              </select>
              <button
                onClick={applyWriterModel}
                disabled={!writerProviderId || !writerModelId}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40"
              >
                {t("writing.useModel")}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button onClick={createChapter} disabled={!activeProject}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.chapter")}
            </button>
            <button onClick={generateNextChapter} disabled={!activeProject || busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.generateNextChapter")}
            </button>
            <button onClick={runConsistency} disabled={!activeProject}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.consistency")}
            </button>
            <button onClick={() => void summarizeBook(false)} disabled={!activeProject || busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.summarizeBook")}
            </button>
            <button onClick={expandScene} disabled={!selectedSceneId || busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.expand")}
            </button>
            <button onClick={rewriteScene} disabled={!selectedSceneId || busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.rewrite")}
            </button>
            <button onClick={summarizeScene} disabled={!selectedSceneId || busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("writing.summarize")}
            </button>
          </div>

          <div className="flex gap-1.5">
            <textarea
              value={chapterPrompt}
              onChange={(e) => setChapterPrompt(e.target.value)}
              className="h-16 flex-1 resize-none rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
              placeholder={t("writing.prompt")}
            />
            <button
              onClick={generateDraft}
              disabled={!selectedChapterId || busy}
              className="flex-shrink-0 rounded-lg bg-accent px-3 py-2 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
            >
              {t("writing.generate")}
            </button>
          </div>
 
          <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => setChapterDynamicsCollapsed((prev) => !prev)}
                className="flex items-center gap-1.5 text-left"
                title={chapterDynamicsCollapsed ? t("writing.expandSection") : t("writing.collapseSection")}
              >
                <svg
                  className={`h-3 w-3 text-text-tertiary transition-transform ${chapterDynamicsCollapsed ? "-rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {t("writing.chapterDynamics")}
                </div>
              </button>
              <span className="text-[11px] text-text-secondary">
                {selectedChapter ? selectedChapter.title : t("writing.selectChapter")}
              </span>
            </div>
            {!chapterDynamicsCollapsed && (
              selectedChapter ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <label className="text-[10px] text-text-tertiary">
                      {t("writing.tone")}
                      <input
                        value={chapterSettings.tone}
                        onChange={(e) => updateSelectedChapterSettings({ tone: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                      />
                    </label>
                    <label className="text-[10px] text-text-tertiary">
                      {t("inspector.pacing")}
                      <select
                        value={chapterSettings.pacing}
                        onChange={(e) => updateSelectedChapterSettings({ pacing: e.target.value as WriterChapterSettings["pacing"] })}
                        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                      >
                        <option value="slow">{t("inspector.slow")}</option>
                        <option value="balanced">{t("inspector.balanced")}</option>
                        <option value="fast">{t("inspector.fast")}</option>
                      </select>
                    </label>
                    <label className="text-[10px] text-text-tertiary">
                      {t("writing.pov")}
                      <select
                        value={chapterSettings.pov}
                        onChange={(e) => updateSelectedChapterSettings({ pov: e.target.value as WriterChapterSettings["pov"] })}
                        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                      >
                        <option value="first_person">{t("writing.povFirstPerson")}</option>
                        <option value="third_limited">{t("writing.povThirdLimited")}</option>
                        <option value="third_omniscient">{t("writing.povThirdOmniscient")}</option>
                      </select>
                    </label>
                  </div>
                  {[
                    { key: "creativity", label: t("writing.creativity") },
                    { key: "tension", label: t("writing.tension") },
                    { key: "detail", label: t("writing.detail") },
                    { key: "dialogue", label: t("writing.dialogueShare") }
                  ].map((item) => {
                    const key = item.key as "creativity" | "tension" | "detail" | "dialogue";
                    const value = chapterSettings[key];
                    return (
                      <div key={item.key}>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-text-tertiary">
                          <span>{item.label}</span>
                          <span className="font-medium text-text-secondary">{Math.round(value * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={value}
                          onChange={(e) => updateSelectedChapterSettings({ [key]: Number(e.target.value) } as Partial<WriterChapterSettings>)}
                          className="w-full"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-2 text-[11px] text-text-tertiary">
                  {t("writing.dynamicSettingsHint")}
                </div>
              )
            )}
          </div>

          <div>
            {chapters.length === 0 ? (
              <EmptyState
                title={t("writing.noChapters")}
                description={activeProject ? t("writing.noChaptersDesc") : t("writing.selectProject")}
              />
            ) : (
              <div className="list-animate space-y-3">
                {chapters.map((chapter) => {
                  const isRenaming = renamingChapterId === chapter.id;
                  return (
                    <div
                      key={chapter.id}
                      className={`group float-card rounded-lg border p-2.5 transition-colors ${
                        selectedChapterId === chapter.id
                          ? "border-accent-border bg-accent-subtle/50"
                          : "border-border bg-bg-primary"
                      }`}
                    >
                      {isRenaming ? (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <input
                            value={renamingChapterTitle}
                            onChange={(e) => setRenamingChapterTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void submitRenameChapter(chapter);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRenameChapter();
                              }
                            }}
                            className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
                            autoFocus
                          />
                          <button
                            onClick={() => void submitRenameChapter(chapter)}
                            className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                          >
                            {t("chat.save")}
                          </button>
                          <button
                            onClick={cancelRenameChapter}
                            className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                          >
                            {t("chat.cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="mb-1.5 flex items-start gap-1.5">
                          <button
                            className="min-w-0 flex-1 break-words text-left text-xs font-semibold text-text-primary hover:text-accent"
                            onClick={() => setSelectedChapterId(chapter.id)}
                          >
                            {chapter.title}
                          </button>
                          <div className={`flex items-center gap-0.5 ${
                            selectedChapterId === chapter.id ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
                          }`}>
                            <button
                              onClick={() => startRenameChapter(chapter)}
                              className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                              title={t("writing.rename")}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L12 15l-4 1 1-4 8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => void deleteChapter(chapter)}
                              className="rounded-md p-1 text-text-tertiary hover:bg-danger-subtle hover:text-danger"
                              title={t("chat.delete")}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    <div className="mb-1.5 flex flex-wrap gap-1 text-[10px] text-text-tertiary">
                      <Badge>{chapter.settings.tone}</Badge>
                      <Badge>{chapter.settings.pacing}</Badge>
                      <Badge>{chapter.settings.pov.replace("_", " ")}</Badge>
                    </div>
                    {scenes
                      .filter((scene) => scene.chapterId === chapter.id)
                      .map((scene) => {
                        const isInlineEditing = editingSceneId === scene.id;
                        const isSavingInline = sceneEditBusyId === scene.id;
                        return (
                          <article
                            key={scene.id}
                            onClick={() => {
                              if (!isInlineEditing) setSelectedSceneId(scene.id);
                            }}
                            className={`group float-card mb-1 rounded-md border p-2 text-xs transition-colors ${
                              selectedSceneId === scene.id
                                ? "border-accent-border bg-accent-subtle"
                                : "border-border-subtle hover:bg-bg-hover"
                            } ${isInlineEditing ? "" : "cursor-pointer"}`}
                          >
                            <div className="mb-0.5 flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate font-semibold text-text-primary">{scene.title}</div>
                              {!isInlineEditing && (
                                <div className={`flex items-center gap-1 ${
                                  selectedSceneId === scene.id ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
                                }`}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startInlineSceneEdit(scene);
                                    }}
                                    className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                                  >
                                    {t("chat.edit")}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void deleteScene(scene);
                                    }}
                                    className="rounded-md border border-danger-border px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger-subtle"
                                  >
                                    {t("chat.delete")}
                                  </button>
                                </div>
                              )}
                            </div>
                            {isInlineEditing ? (
                              <div className="space-y-1">
                                <textarea
                                  value={editingSceneContent}
                                  onChange={(e) => setEditingSceneContent(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-28 w-full resize-y rounded-md border border-border bg-bg-secondary p-2 text-xs leading-relaxed text-text-primary"
                                />
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void saveInlineSceneContent(scene);
                                    }}
                                    disabled={isSavingInline}
                                    className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
                                  >
                                    {isSavingInline ? t("writing.working") : t("chat.save")}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelInlineSceneEdit();
                                    }}
                                    disabled={isSavingInline}
                                    className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                                  >
                                    {t("chat.cancel")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="mt-0.5 line-clamp-2 text-text-tertiary">{scene.content}</p>
                            )}
                          </article>
                        );
                      })}
                  </div>
                );
              })}
              </div>
            )}
          </div>

          {selectedScene && (
            <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">{selectedScene.title}</span>
              </div>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                {selectedScene.content}
              </p>
            </div>
          )}
        </div>
      }
      right={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("writing.outline")}</h2>
            {writingSimpleModeActive && (
              <button
                type="button"
                onClick={() => setSimpleWritingInspectorOpen(false)}
                className="rounded-md border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-hover"
                title={t("chat.cancel")}
              >
                ×
              </button>
            )}
          </div>
          <div className="inline-flex w-full items-center rounded-md border border-border-subtle bg-bg-primary p-[2px]">
            {([
              ["planning", t("writing.sidebarPlanning")],
              ["lenses", t("writing.sidebarLenses")],
              ["diagnostics", t("writing.sidebarDiagnostics")]
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRightSidebarTab(key)}
                className={`flex-1 rounded px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                  rightSidebarTab === key
                    ? "bg-accent text-text-inverse"
                    : "text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            {rightSidebarTab === "planning" && (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <button onClick={exportMarkdown} className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover">
                    {t("writing.exportMD")}
                  </button>
                  <button onClick={exportDocx} className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover">
                    {t("writing.exportDOCX")}
                  </button>
                </div>

                <CollapsibleSection
                  title={t("writing.bookBible")}
                  collapsed={bookBibleCollapsed}
                  onToggle={() => setBookBibleCollapsed((prev) => !prev)}
                  action={(
                    <button
                      onClick={() => void summarizeBook(true)}
                      disabled={!activeProject || busy}
                      className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                    >
                      {t("writing.refreshSummary")}
                    </button>
                  )}
                >
                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-text-tertiary">
                      {t("writing.contextMode")}
                      <select
                        value={projectNotes.contextMode}
                        onChange={(e) => updateProjectNotes({ contextMode: e.target.value as WriterProjectNotes["contextMode"] })}
                        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                      >
                        <option value="economy">{t("writing.contextModeEconomy")}</option>
                        <option value="balanced">{t("writing.contextModeBalanced")}</option>
                        <option value="rich">{t("writing.contextModeRich")}</option>
                      </select>
                    </label>
                    <textarea
                      value={projectNotes.premise}
                      onChange={(e) => updateProjectNotes({ premise: e.target.value })}
                      placeholder={t("writing.bookPremise")}
                      className="h-12 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <textarea
                      value={projectNotes.styleGuide}
                      onChange={(e) => updateProjectNotes({ styleGuide: e.target.value })}
                      placeholder={t("writing.styleGuide")}
                      className="h-12 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <textarea
                      value={projectNotes.worldRules}
                      onChange={(e) => updateProjectNotes({ worldRules: e.target.value })}
                      placeholder={t("writing.worldRules")}
                      className="h-12 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <textarea
                      value={projectNotes.characterNotes}
                      onChange={(e) => updateProjectNotes({ characterNotes: e.target.value })}
                      placeholder={t("writing.characterLedger")}
                      className="h-12 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <textarea
                      value={projectNotes.summary}
                      onChange={(e) => updateProjectNotes({ summary: e.target.value })}
                      placeholder={t("writing.bookSummary")}
                      className="h-16 w-full rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {rightSidebarTab === "lenses" && (
              <CollapsibleSection
                title={t("writing.summaryLenses")}
                collapsed={lensesCollapsed}
                onToggle={() => setLensesCollapsed((prev) => !prev)}
              >
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-1">
                    <input
                      value={lensNameDraft}
                      onChange={(e) => setLensNameDraft(e.target.value)}
                      placeholder={t("writing.lensName")}
                      className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <textarea
                      value={lensPromptDraft}
                      onChange={(e) => setLensPromptDraft(e.target.value)}
                      placeholder={t("writing.lensPrompt")}
                      className="h-20 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                    />
                    <div className="grid grid-cols-2 gap-1">
                      <select
                        value={lensScopeDraft}
                        onChange={(e) => setLensScopeDraft(e.target.value as WriterSummaryLensScope)}
                        className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                      >
                        <option value="project">{t("writing.lensScopeProject")}</option>
                        <option value="chapter">{t("writing.lensScopeChapter")}</option>
                        <option value="scene">{t("writing.lensScopeScene")}</option>
                      </select>
                      {lensScopeDraft === "project" ? (
                        <div className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[10px] text-text-tertiary">
                          {t("writing.lensScopeAll")}
                        </div>
                      ) : (
                        <select
                          value={lensTargetDraft}
                          onChange={(e) => setLensTargetDraft(e.target.value)}
                          className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                        >
                          <option value="">
                            ({lensScopeDraft === "chapter" ? t("writing.selectChapter") : t("writing.selectScene")})
                          </option>
                          {(lensScopeDraft === "chapter" ? chapters : lensSceneOptions).map((item) => (
                            <option key={item.id} value={item.id}>{item.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <button
                      onClick={createSummaryLens}
                      disabled={!activeProject || !lensPromptDraft.trim()}
                      className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
                    >
                      {t("writing.createLens")}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {LENS_PRESET_IDS.map((presetId) => (
                      <button
                        key={presetId}
                        type="button"
                        onClick={() => applyLensPreset(presetId)}
                        className="rounded-md border border-border-subtle px-2 py-0.5 text-[10px] text-text-tertiary hover:bg-bg-hover"
                      >
                        {lensPresetLabel(presetId)}
                      </button>
                    ))}
                  </div>

                  {summaryLenses.length === 0 ? (
                    <div className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-2 text-[11px] text-text-tertiary">
                      {t("writing.noLenses")}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {summaryLenses.map((lens) => {
                        const scopeLabel = lens.scope === "chapter"
                          ? t("writing.lensScopeChapter")
                          : lens.scope === "scene"
                            ? t("writing.lensScopeScene")
                            : t("writing.lensScopeProject");
                        const targetLabel = lens.scope === "chapter"
                          ? chapters.find((chapter) => chapter.id === lens.targetId)?.title
                          : lens.scope === "scene"
                            ? scenes.find((scene) => scene.id === lens.targetId)?.title
                            : t("writing.lensScopeAll");
                        const expanded = Boolean(lensOutputExpanded[lens.id]);
                        return (
                          <article key={lens.id} className="rounded-md border border-border-subtle bg-bg-secondary p-2">
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-text-primary">{lens.name}</div>
                                <div className="text-[10px] text-text-tertiary">{scopeLabel}{targetLabel ? ` · ${targetLabel}` : ""}</div>
                              </div>
                              <div className="flex max-w-[180px] flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => loadLensToDraft(lens)}
                                  className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                                >
                                  {t("writing.loadLens")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void runSummaryLens(lens.id, false)}
                                  disabled={lensBusyId === lens.id}
                                  className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                                >
                                  {lensBusyId === lens.id ? t("writing.working") : t("writing.runLens")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void runSummaryLens(lens.id, true)}
                                  disabled={lensBusyId === lens.id}
                                  className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                                  title={t("writing.refreshSummary")}
                                >
                                  ↻
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeSummaryLens(lens.id)}
                                  className="rounded-md border border-danger-border px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger-subtle"
                                  title={t("chat.delete")}
                                >
                                  {t("chat.delete")}
                                </button>
                              </div>
                            </div>
                            <p className="mb-1 whitespace-pre-wrap text-[10px] text-text-tertiary">
                              {lens.prompt}
                            </p>
                            {lens.output && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setLensOutputExpanded((prev) => ({ ...prev, [lens.id]: !expanded }))}
                                  className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                                >
                                  {expanded ? t("writing.hideOutput") : t("writing.showOutput")}
                                </button>
                                {expanded && (
                                  <div className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-secondary">
                                    {lens.output}
                                  </div>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {rightSidebarTab === "diagnostics" && (
              <div className="space-y-2">
                <CollapsibleSection
                  title={t("writing.tasks")}
                  collapsed={tasksCollapsed}
                  onToggle={() => setTasksCollapsed((prev) => !prev)}
                >
                  {bgTasks.length === 0 ? (
                    <div className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-2 text-[11px] text-text-tertiary">
                      {t("writing.noActivity")}
                    </div>
                  ) : (
                    <div className="list-animate max-h-40 space-y-1 overflow-y-auto">
                      {bgTasks.slice(0, 12).map((task) => (
                        <div key={task.id} className={`float-card flex items-center gap-2 rounded-md border px-2 py-1 text-[10px] ${
                          task.status === "running" ? "border-accent-border bg-accent-subtle" :
                          task.status === "error" ? "border-danger-border bg-danger-subtle" :
                          "border-border-subtle bg-bg-primary"
                        }`}>
                          {task.status === "running" ? (
                            <svg className="h-2.5 w-2.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : task.status === "error" ? (
                            <div className="h-2 w-2 rounded-full bg-danger" />
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-success" />
                          )}
                          <span className={`flex-1 truncate ${task.status === "error" ? "text-danger" : "text-text-secondary"}`}>
                            {task.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  title={t("writing.consistencyIssues")}
                  collapsed={consistencyCollapsed}
                  onToggle={() => setConsistencyCollapsed((prev) => !prev)}
                >
                  {issues.length === 0 ? (
                    <div className="rounded-lg border border-border-subtle bg-bg-secondary px-2 py-2 text-center text-xs text-text-tertiary">
                      {t("writing.noIssues")}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {issues.map((issue) => {
                        const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.low;
                        return (
                          <article key={issue.id} className={`rounded-lg border ${style.border} bg-bg-secondary p-2`}>
                            <div className="mb-0.5 flex items-center gap-2">
                              <Badge variant={style.badge}>{issue.severity}</Badge>
                              <span className="text-[10px] font-semibold uppercase text-text-tertiary">{issue.category}</span>
                            </div>
                            <p className="text-xs text-text-secondary">{issue.message}</p>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  title={t("writing.generationLog")}
                  collapsed={logCollapsed}
                  onToggle={() => setLogCollapsed((prev) => !prev)}
                >
                  <div className="max-h-48 overflow-auto rounded-lg border border-border-subtle bg-bg-secondary p-2">
                    {generationLog.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-text-tertiary">{t("writing.noActivity")}</div>
                    ) : (
                      <div className="space-y-0.5 font-mono text-[10px] text-text-tertiary">
                        {generationLog.map((line, idx) => (
                          <div key={`${line}-${idx}`}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}
          </div>
        </div>
      }
    />
      ) : (
        <section className={`mx-auto flex h-full w-full max-w-[1500px] flex-col rounded-xl border border-border bg-bg-secondary p-4 ${writingSimpleModeActive ? "writing-simple-character-shell" : ""}`}>
          <div className="flex w-full flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("writing.characterForge")}</h2>
              {renderWorkspaceModeSwitch()}
            </div>
            <div className="float-card rounded-lg border border-border-subtle bg-bg-primary p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-text-primary">{t("writing.characterGenerate")}</div>
                <button
                  onClick={() => setCharacterAdvancedMode((prev) => !prev)}
                  className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover"
                >
                  {characterAdvancedMode ? t("writing.characterBasic") : t("writing.characterAdvanced")}
                </button>
              </div>
              <textarea
                value={characterPrompt}
                onChange={(e) => {
                  setCharacterPrompt(e.target.value);
                  if (characterError) setCharacterError("");
                }}
                placeholder={t("writing.characterPromptPlaceholder")}
                className="h-20 w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary"
              />
              {characterAdvancedMode && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <input value={characterAdvanced.name || ""} onChange={(e) => updateCharacterAdvanced("name", e.target.value)}
                    placeholder={t("writing.characterNameHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.role || ""} onChange={(e) => updateCharacterAdvanced("role", e.target.value)}
                    placeholder={t("writing.characterRoleHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.personality || ""} onChange={(e) => updateCharacterAdvanced("personality", e.target.value)}
                    placeholder={t("writing.characterPersonalityHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.scenario || ""} onChange={(e) => updateCharacterAdvanced("scenario", e.target.value)}
                    placeholder={t("writing.characterScenarioHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.greetingStyle || ""} onChange={(e) => updateCharacterAdvanced("greetingStyle", e.target.value)}
                    placeholder={t("writing.characterGreetingHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.systemPrompt || ""} onChange={(e) => updateCharacterAdvanced("systemPrompt", e.target.value)}
                    placeholder={t("writing.characterSystemHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                  <input value={characterAdvanced.tags || ""} onChange={(e) => updateCharacterAdvanced("tags", e.target.value)}
                    placeholder={t("writing.characterTagsHint")}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary sm:col-span-2" />
                  <textarea value={characterAdvanced.notes || ""} onChange={(e) => updateCharacterAdvanced("notes", e.target.value)}
                    placeholder={t("writing.characterNotesHint")}
                    className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary sm:col-span-2" />
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={generateCharacterFromDescription} disabled={characterBusy}
                  className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40">
                  {characterBusy ? t("writing.characterGenerating") : t("writing.characterGenerate")}
                </button>
                <button onClick={() => setCharacterAdvanced({ ...DEFAULT_WRITER_CHARACTER_ADVANCED })}
                  className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover">
                  {t("writing.characterReset")}
                </button>
              </div>
              {characterError && (
                <div className="mt-2 rounded-md border border-danger-border bg-danger-subtle px-2 py-1 text-[10px] text-danger">
                  {characterError}
                </div>
              )}
            </div>

            <div className="grid flex-1 min-h-0 grid-cols-1 gap-3 md:grid-cols-[340px_minmax(0,1fr)]">
              <div className="float-card min-h-0 rounded-lg border border-border-subtle bg-bg-primary p-2">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chars.characters")}</div>
                {characters.length === 0 ? (
                  <EmptyState title={t("chars.noChars")} description={t("chars.noCharsDesc")} />
                ) : (
                  <div className="max-h-full space-y-1 overflow-y-auto">
                    {characters.map((character) => (
                      <button
                        key={character.id}
                        onClick={() => setCharacterEditorId(character.id)}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                          characterEditorId === character.id
                            ? "border-accent-border bg-accent-subtle text-text-primary"
                            : "border-border-subtle text-text-secondary hover:bg-bg-hover"
                        }`}
                      >
                        <div className="truncate font-medium">{character.name}</div>
                        <div className="truncate text-[10px] text-text-tertiary">{(character.tags || []).join(", ")}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="float-card min-h-0 rounded-lg border border-border-subtle bg-bg-primary p-3">
                {selectedCharacterToEdit ? (
                  <div className="flex h-full flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-text-primary">{selectedCharacterToEdit.name}</div>
                      <button onClick={saveCharacterEditor} disabled={characterEditBusy || characterAiBusy}
                        className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40">
                        {characterEditBusy ? t("writing.working") : t("chat.save")}
                      </button>
                    </div>
                    <div className="rounded-md border border-border-subtle bg-bg-secondary p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("writing.characterAiEdit")}</div>
                        <div className="text-[10px] text-text-tertiary">
                          {characterAiFields.length > 0
                            ? `${t("writing.characterAiScope")}: ${characterAiFields.length}`
                            : t("writing.characterAiScopeAuto")}
                        </div>
                      </div>
                      <textarea
                        value={characterAiInstruction}
                        onChange={(e) => setCharacterAiInstruction(e.target.value)}
                        placeholder={t("writing.characterAiInstructionPlaceholder")}
                        className="h-16 w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                      />
                      <div className="mt-1 flex flex-wrap gap-1">
                        {CHARACTER_AI_EDIT_FIELDS.map((field) => {
                          const active = characterAiFields.includes(field);
                          return (
                            <button
                              key={field}
                              type="button"
                              onClick={() => toggleCharacterAiField(field)}
                              className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors ${
                                active
                                  ? "border-accent-border bg-accent-subtle text-text-primary"
                                  : "border-border-subtle text-text-tertiary hover:bg-bg-hover"
                              }`}
                            >
                              {characterFieldLabel(field)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          onClick={applyCharacterAiEdit}
                          disabled={characterAiBusy || characterEditBusy}
                          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-40"
                        >
                          {characterAiBusy ? t("writing.characterAiEditing") : t("writing.characterAiApply")}
                        </button>
                        <button
                          onClick={() => {
                            setCharacterAiInstruction("");
                            setCharacterAiFields([]);
                          }}
                          className="rounded-md border border-border-subtle px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover"
                        >
                          {t("writing.characterAiClear")}
                        </button>
                      </div>
                    </div>
                    <div className="grid flex-1 min-h-0 grid-cols-1 gap-2 overflow-y-auto pr-1">
                      <input value={characterEditDraft.name} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder={t("chars.name")}
                        className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.description} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder={t("chars.description")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.personality} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, personality: e.target.value }))}
                        placeholder={t("chars.personality")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.scenario} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, scenario: e.target.value }))}
                        placeholder={t("chars.scenario")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.greeting} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, greeting: e.target.value }))}
                        placeholder={t("chars.firstMessage")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.systemPrompt} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                        placeholder={t("chars.systemPrompt")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.mesExample} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, mesExample: e.target.value }))}
                        placeholder={t("chars.exampleMessages")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <textarea value={characterEditDraft.creatorNotes} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, creatorNotes: e.target.value }))}
                        placeholder={t("chars.creatorNotes")}
                        className="h-16 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                      <input value={characterEditDraft.tagsText} onChange={(e) => setCharacterEditDraft((prev) => ({ ...prev, tagsText: e.target.value }))}
                        placeholder={t("chars.tagsPlaceholder")}
                        className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary" />
                    </div>
                    {characterEditStatus && (
                      <div className={`rounded-md border px-2 py-1 text-[10px] ${
                        characterEditStatus.tone === "success"
                          ? "border-success-border bg-success-subtle text-success"
                          : "border-danger-border bg-danger-subtle text-danger"
                      }`}>
                        {characterEditStatus.text}
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState title={t("chars.selectCharacter")} description={t("chars.selectCharacterDesc")} />
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
