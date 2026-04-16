import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, resolveApiAssetUrl } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import { buildFilenameBase, triggerBlobDownload } from "../../shared/download";
import { AvatarBadge } from "../../components/AvatarBadge";
import { Badge, EmptyState, PanelTitle, ThreePanelLayout } from "../../components/Panels";
import { ToggleSwitch } from "../settings/components/FormControls";
import type { AgentHeroProfile, AgentHeroSkill, AppSettings, CharacterDetail } from "../../shared/types/contracts";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask,
  useBackgroundTasks
} from "../../shared/backgroundTasks";

const ALT_GREETING_SEPARATOR = "\n\n---\n\n";
const HERO_AGENT_EXTENSION_KEY = "vellium_agent";
type CharacterEditorKind = "standard" | "agent";

function buildEmptyHeroSkill(index = 0): AgentHeroSkill {
  return {
    id: `hero-skill-${Date.now()}-${index}`,
    name: "",
    description: "",
    instructions: "",
    enabled: true
  };
}

function normalizeAgentMode(value: unknown): "ask" | "build" | "research" {
  return value === "ask" || value === "research" || value === "build" ? value : "build";
}

function createEmptyAgentProfile(): AgentHeroProfile {
  return {
    enabled: false,
    mode: "build",
    customInstructions: "",
    skills: []
  };
}

function editorSectionsForKind(kind: CharacterEditorKind): Record<string, boolean> {
  return kind === "agent"
    ? {
      identity: true,
      content: false,
      agent: true,
      meta: false,
      advanced: false
    }
    : {
      identity: true,
      content: true,
      agent: false,
      meta: false,
      advanced: false
    };
}

function normalizeAgentProfile(value: unknown): AgentHeroProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyAgentProfile();
  }
  const record = value as Record<string, unknown>;
  const skills = Array.isArray(record.skills)
    ? record.skills
      .map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const row = item as Record<string, unknown>;
        return {
          id: typeof row.id === "string" && row.id ? row.id : `hero-skill-${Date.now()}-${index}`,
          name: typeof row.name === "string" ? row.name : "",
          description: typeof row.description === "string" ? row.description : "",
          instructions: typeof row.instructions === "string" ? row.instructions : "",
          enabled: row.enabled !== false
        } satisfies AgentHeroSkill;
      })
      .filter((item): item is AgentHeroSkill => item !== null)
      .slice(0, 8)
    : [];
  return {
    enabled: record.enabled === true,
    mode: normalizeAgentMode(record.mode),
    customInstructions: typeof record.customInstructions === "string" ? record.customInstructions : "",
    skills
  };
}

function splitAgentProfileExtension(extensions: Record<string, unknown>) {
  const next = { ...toPlainObject(extensions) };
  const profile = normalizeAgentProfile(next[HERO_AGENT_EXTENSION_KEY]);
  delete next[HERO_AGENT_EXTENSION_KEY];
  return { extensions: next, agentProfile: profile };
}

function mergeAgentProfileExtension(extensions: Record<string, unknown>, agentProfile: AgentHeroProfile) {
  const next = { ...toPlainObject(extensions) };
  if (agentProfile.enabled) {
    next[HERO_AGENT_EXTENSION_KEY] = {
      enabled: true,
      mode: agentProfile.mode,
      customInstructions: agentProfile.customInstructions.trim(),
      skills: agentProfile.skills.map((skill) => ({
        id: skill.id,
        name: skill.name.trim(),
        description: skill.description.trim(),
        instructions: skill.instructions.trim(),
        enabled: skill.enabled
      })).filter((skill) => skill.name || skill.instructions)
    };
  } else {
    delete next[HERO_AGENT_EXTENSION_KEY];
  }
  return next;
}

function parseAlternateGreetingsInput(raw: string): string[] {
  const input = String(raw || "").trim();
  if (!input) return [];
  if (input.startsWith("[")) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      // Fallback to separator parsing below.
    }
  }
  return input
    .split(/\n\s*---+\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAlternateGreetings(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(ALT_GREETING_SEPARATOR);
}

function parseObjectJson(raw: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const input = String(raw || "").trim();
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseObjectJsonStrict(raw: string): Record<string, unknown> {
  const input = String(raw || "").trim();
  if (!input) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function formatObjectJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

export function CharactersScreen() {
  const { t } = useI18n();
  const backgroundTasks = useBackgroundTasks();
  const [appSettings, setAppSettings] = useState<Pick<AppSettings, "agentsEnabled">>({ agentsEnabled: false });
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [selected, setSelected] = useState<CharacterDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // GUI editor fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personality, setPersonality] = useState("");
  const [scenario, setScenario] = useState("");
  const [greeting, setGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [mesExample, setMesExample] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [tags, setTags] = useState("");
  const [creator, setCreator] = useState("");
  const [characterVersion, setCharacterVersion] = useState("");
  const [postHistoryInstructions, setPostHistoryInstructions] = useState("");
  const [alternateGreetingsText, setAlternateGreetingsText] = useState("");
  const [creatorNotesMultilingualJson, setCreatorNotesMultilingualJson] = useState("{}");
  const [extensionsJson, setExtensionsJson] = useState("{}");
  const [agentProfileDraft, setAgentProfileDraft] = useState<AgentHeroProfile>(createEmptyAgentProfile());

  // Raw JSON panel
  const [rawJson, setRawJson] = useState("{}");
  const [jsonSyncDirection, setJsonSyncDirection] = useState<"gui" | "json">("gui");

  // Import
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");

  // Avatar
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState<Record<string, number>>({});
  const [translateCopyLoading, setTranslateCopyLoading] = useState(false);
  const [creatingAgentThread, setCreatingAgentThread] = useState(false);

  // File import
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // Status
  // Status
  const [saveStatus, setSaveStatus] = useState("");
  const [saveStatusType, setSaveStatusType] = useState<"success" | "error" | null>(null);

  // Collapsible editor sections
  const [editorSections, setEditorSections] = useState<Record<string, boolean>>({
    identity: true,
    content: true,
    agent: true,
    meta: false,
    advanced: false
  });
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const translateCopyBusy = translateCopyLoading || backgroundTasks.some((task) => (
    task.scope === "characters" && task.type === "translate" && task.status === "running"
  ));
  const editorKind: CharacterEditorKind = agentProfileDraft.enabled ? "agent" : "standard";
  const contentSectionTitle = editorKind === "agent" ? t("chars.roleplayCard") : t("chars.content");
  const contentSectionDescription = editorKind === "agent" ? t("chars.roleplayCardDesc") : t("chars.contentSectionDesc");

  function toggleEditorSection(key: string) {
    setEditorSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const loadCharacters = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.characterList();
      setCharacters(list);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    let cancelled = false;
    api.settingsGet()
      .then((settings) => {
        if (cancelled) return;
        setAppSettings({ agentsEnabled: settings.agentsEnabled === true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (!detail || typeof detail !== "object") return;
      setAppSettings({ agentsEnabled: detail.agentsEnabled === true });
    };
    window.addEventListener("settings-change", handler);
    return () => window.removeEventListener("settings-change", handler);
  }, []);

  // When a character is selected, populate GUI fields
  useEffect(() => {
    if (!selected) {
      setName("");
      setDescription("");
      setPersonality("");
      setScenario("");
      setGreeting("");
      setSystemPrompt("");
      setMesExample("");
      setCreatorNotes("");
      setTags("");
      setCreator("");
      setCharacterVersion("");
      setPostHistoryInstructions("");
      setAlternateGreetingsText("");
      setCreatorNotesMultilingualJson("{}");
      setExtensionsJson("{}");
      setAgentProfileDraft(createEmptyAgentProfile());
      setRawJson("{}");
      setEditorSections(editorSectionsForKind("standard"));
      return;
    }
    const parsedAgentProfile = normalizeAgentProfile(selected.agentProfile);
    const { extensions } = splitAgentProfileExtension(selected.extensions);
    setName(selected.name);
    setDescription(selected.description || "");
    setPersonality(selected.personality || "");
    setScenario(selected.scenario || "");
    setGreeting(selected.greeting || "");
    setSystemPrompt(selected.systemPrompt || "");
    setMesExample(selected.mesExample || "");
    setCreatorNotes(selected.creatorNotes || "");
    setTags((selected.tags || []).join(", "));
    setCreator(selected.creator || "");
    setCharacterVersion(selected.characterVersion || "");
    setPostHistoryInstructions(selected.postHistoryInstructions || "");
    setAlternateGreetingsText(formatAlternateGreetings(selected.alternateGreetings));
    setCreatorNotesMultilingualJson(formatObjectJson(selected.creatorNotesMultilingual));
    setExtensionsJson(formatObjectJson(extensions));
    setAgentProfileDraft(parsedAgentProfile);
    setRawJson(selected.cardJson || "{}");
    setJsonSyncDirection("gui");
    setEditorSections(editorSectionsForKind(parsedAgentProfile.enabled ? "agent" : "standard"));
  }, [selected]);

  // Sync GUI → JSON
  useEffect(() => {
    if (jsonSyncDirection !== "gui" || !selected) return;
    try {
      const parsed = JSON.parse(selected.cardJson || "{}");
      const data = (parsed.data || {}) as Record<string, unknown>;
      data.name = name;
      data.description = description;
      data.personality = personality;
      data.scenario = scenario;
      data.first_mes = greeting;
      data.system_prompt = systemPrompt;
      data.mes_example = mesExample;
      data.creator_notes = creatorNotes;
      data.tags = tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      data.creator = creator;
      data.character_version = characterVersion;
      data.post_history_instructions = postHistoryInstructions;
      data.alternate_greetings = parseAlternateGreetingsInput(alternateGreetingsText);
      data.creator_notes_multilingual = parseObjectJson(creatorNotesMultilingualJson, toPlainObject(data.creator_notes_multilingual));
      data.extensions = mergeAgentProfileExtension(
        parseObjectJson(extensionsJson, splitAgentProfileExtension(toPlainObject(data.extensions)).extensions),
        agentProfileDraft
      );
      setRawJson(JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data }, null, 2));
    } catch {
      // ignore sync error
    }
  }, [
    name,
    description,
    personality,
    scenario,
    greeting,
    systemPrompt,
    mesExample,
    creatorNotes,
    tags,
    creator,
    characterVersion,
    postHistoryInstructions,
    alternateGreetingsText,
    creatorNotesMultilingualJson,
    extensionsJson,
    agentProfileDraft,
    jsonSyncDirection,
    selected
  ]);

  // Sync JSON → GUI
  function applyJsonToGui() {
    try {
      const parsed = JSON.parse(rawJson);
      const data = (parsed.data || {}) as Record<string, unknown>;
      setName(asString(data.name));
      setDescription(asString(data.description));
      setPersonality(asString(data.personality));
      setScenario(asString(data.scenario));
      setGreeting(asString(data.first_mes));
      setSystemPrompt(asString(data.system_prompt));
      setMesExample(asString(data.mes_example));
      setCreatorNotes(asString(data.creator_notes));
      const parsedTags = parsed.data?.tags;
      setTags(Array.isArray(parsedTags) ? parsedTags.join(", ") : "");
      setCreator(typeof data.creator === "string" ? data.creator : "");
      setCharacterVersion(typeof data.character_version === "string" ? data.character_version : "");
      setPostHistoryInstructions(typeof data.post_history_instructions === "string" ? data.post_history_instructions : "");
      setAlternateGreetingsText(formatAlternateGreetings(data.alternate_greetings));
      setCreatorNotesMultilingualJson(formatObjectJson(data.creator_notes_multilingual));
      const split = splitAgentProfileExtension(toPlainObject(data.extensions));
      setExtensionsJson(formatObjectJson(split.extensions));
      setAgentProfileDraft(split.agentProfile);
      setJsonSyncDirection("gui");
    } catch {
      // ignore
    }
  }

  async function saveCharacter(): Promise<CharacterDetail | null> {
    if (!selected) return null;
    setSaveStatus("");
    setSaveStatusType(null);
    try {
      const tagsArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const creatorNotesMultilingual = parseObjectJsonStrict(creatorNotesMultilingualJson);
      const extensions = mergeAgentProfileExtension(parseObjectJsonStrict(extensionsJson), agentProfileDraft);
      const updated = await api.characterUpdate(selected.id, {
        name,
        description,
        personality,
        scenario,
        greeting,
        systemPrompt,
        mesExample,
        creatorNotes,
        tags: tagsArr,
        creator,
        characterVersion,
        postHistoryInstructions,
        alternateGreetings: parseAlternateGreetingsInput(alternateGreetingsText),
        creatorNotesMultilingual,
        extensions
      });
      setSelected(updated);
      setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      return updated;
    } catch (error) {
      setSaveStatus(`${t("chars.errorPrefix")}: ${String(error)}`);
      setSaveStatusType("error");
      return null;
    }
  }

  async function handleSave() {
    const updated = await saveCharacter();
    if (!updated) return;
    setSaveStatus(t("chars.saved"));
    setSaveStatusType("success");
    setTimeout(() => {
      setSaveStatus("");
      setSaveStatusType(null);
    }, 2000);
  }

  async function handleCreateAgentThread() {
    if (!selected || !appSettings.agentsEnabled || creatingAgentThread) return;
    setCreatingAgentThread(true);
    setSaveStatus("");
    setSaveStatusType(null);
    try {
      const persisted = await saveCharacter();
      if (!persisted) return;
      const created = await api.agentThreadCreate({
        heroCharacterId: persisted.id,
        mode: agentProfileDraft.mode,
        title: persisted.name
      });
      window.dispatchEvent(new CustomEvent("open-agents-thread", {
        detail: { threadId: created.id }
      }));
      setSaveStatus(t("chars.agentWorkspaceCreated"));
      setSaveStatusType("success");
    } catch (error) {
      setSaveStatus(`${t("chars.errorPrefix")}: ${String(error)}`);
      setSaveStatusType("error");
    } finally {
      setCreatingAgentThread(false);
    }
  }

  async function handleExportJson() {
    if (!selected) return;
    try {
      const blob = await api.characterExportJson(selected.id);
      await triggerBlobDownload(blob, `${buildFilenameBase(selected.name, "character")}.json`);
      setSaveStatus(t("chars.exportJson"));
      setSaveStatusType("success");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error));
      setSaveStatusType("error");
    }
  }

  async function handleDelete() {
    if (!selected) return;
    await api.characterDelete(selected.id);
    setCharacters((prev) => prev.filter((c) => c.id !== selected.id));
    setSelected(null);
  }

  async function handleTranslateCopy() {
    if (!selected || translateCopyBusy) return;
    setSaveStatus("");
    setSaveStatusType(null);
    setTranslateCopyLoading(true);
    const taskId = startBackgroundTask({
      scope: "characters",
      type: "translate",
      label: t("chars.translateCopy")
    });
    try {
      const copied = await api.characterTranslateCopy(selected.id);
      setCharacters((prev) => [copied, ...prev]);
      setSelected(copied);
      setSaveStatus(`${t("chars.translatedCopyCreated")}: ${copied.name}`);
      setSaveStatusType("success");
      finishBackgroundTask(taskId, copied.name);
      setTimeout(() => {
        setSaveStatus("");
        setSaveStatusType(null);
      }, 2500);
    } catch (error) {
      failBackgroundTask(taskId, String(error));
      setSaveStatus(`${t("chars.errorPrefix")}: ${String(error)}`);
      setSaveStatusType("error");
    } finally {
      setTranslateCopyLoading(false);
    }
  }

  async function handleImport() {
    setImportError("");
    setImportSuccess("");
    if (!importJson.trim()) {
      setImportError(t("chars.pasteJsonRequired"));
      return;
    }
    try {
      const result = await api.characterImportV2(importJson);
      setCharacters((prev) => [result, ...prev]);
      setSelected(result);
      setImportJson("");
      setImportSuccess(`${t("chars.imported")}: ${result.name}`);
      setTimeout(() => setImportSuccess(""), 3000);
    } catch (error) {
      setImportError(String(error));
    }
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.[0]) return;
    setImportError("");
    setImportSuccess("");
    try {
      const file = e.target.files[0];
      const text = await file.text();
      const result = await api.characterImportV2(text);
      setCharacters((prev) => [result, ...prev]);
      setSelected(result);
      setImportSuccess(`${t("chars.importedFromFile")}: ${result.name}`);
      setTimeout(() => setImportSuccess(""), 3000);
    } catch (error) {
      setImportError(String(error));
    }
    if (jsonFileRef.current) jsonFileRef.current.value = "";
  }

  async function handleCreateBlank(kind: CharacterEditorKind = "standard") {
    setImportError("");
    setImportSuccess("");
    try {
      const result = await api.characterImportV2(buildBlankCard(kind));
      setCharacters((prev) => [result, ...prev]);
      setSelected(result);
      setCreatePickerOpen(false);
      setImportSuccess(kind === "agent" ? t("chars.agentBlankCreated") : t("chars.blankCreated"));
      setTimeout(() => setImportSuccess(""), 3000);
    } catch (error) {
      setImportError(String(error));
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!selected || !file) return;
    setAvatarUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await api.characterUploadAvatar(selected.id, base64, file.name);
      const updated = { ...selected, avatarUrl: result.avatarUrl };
      setSelected(updated);
      setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setAvatarVersion((prev) => ({ ...prev, [selected.id]: Date.now() }));
    } catch {
      // ignore
    }
    setAvatarUploading(false);
    e.target.value = "";
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadSample() {
    setImportJson(JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: t("chars.sampleName"),
        description: t("chars.sampleDescription"),
        personality: t("chars.samplePersonality"),
        scenario: t("chars.sampleScenario"),
        first_mes: t("chars.sampleGreeting"),
        tags: ["fantasy", "mystery"],
        system_prompt: "",
        mes_example: "",
        creator_notes: t("chars.sampleCreatorNotes"),
        alternate_greetings: [],
        post_history_instructions: "",
        creator: "",
        character_version: "main",
        creator_notes_multilingual: {},
        extensions: {}
      }
    }, null, 2));
    setImportError("");
    setImportSuccess("");
  }

  const jsonValid = useMemo(() => {
    try {
      JSON.parse(rawJson);
      return true;
    } catch {
      return false;
    }
  }, [rawJson]);

  function avatarSrc(url: string | null, characterId?: string) {
    const resolved = resolveApiAssetUrl(url);
    if (!resolved || !characterId) return resolved;
    const version = avatarVersion[characterId];
    if (!version) return resolved;
    return resolved.includes("?") ? `${resolved}&v=${version}` : `${resolved}?v=${version}`;
  }

  function updateHeroSkill(skillId: string, patch: Partial<AgentHeroSkill>) {
    setAgentProfileDraft((prev) => ({
      ...prev,
      skills: prev.skills.map((skill) => skill.id === skillId ? { ...skill, ...patch } : skill)
    }));
    setJsonSyncDirection("gui");
  }

  function addHeroSkill() {
    setAgentProfileDraft((prev) => ({
      ...prev,
      skills: [...prev.skills, buildEmptyHeroSkill(prev.skills.length)]
    }));
    setJsonSyncDirection("gui");
  }

  function removeHeroSkill(skillId: string) {
    setAgentProfileDraft((prev) => ({
      ...prev,
      skills: prev.skills.filter((skill) => skill.id !== skillId)
    }));
    setJsonSyncDirection("gui");
  }

  function setCharacterKind(kind: CharacterEditorKind) {
    setAgentProfileDraft((prev) => ({
      ...prev,
      enabled: kind === "agent"
    }));
    setEditorSections(editorSectionsForKind(kind));
    setJsonSyncDirection("gui");
  }

  function buildBlankCard(kind: CharacterEditorKind) {
    const agentProfile = kind === "agent"
      ? {
        enabled: true,
        mode: "build" as const,
        customInstructions: "",
        skills: []
      }
      : createEmptyAgentProfile();
    return JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: kind === "agent" ? t("chars.newAgentName") : t("chars.newCharacterName"),
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        tags: [],
        system_prompt: "",
        mes_example: "",
        creator_notes: "",
        alternate_greetings: [],
        post_history_instructions: "",
        creator: "",
        character_version: "main",
        creator_notes_multilingual: {},
        extensions: mergeAgentProfileExtension({}, agentProfile)
      }
    });
  }

  return (
    <ThreePanelLayout
      left={
        <>
          <PanelTitle
            action={(
              <button
                onClick={() => setCreatePickerOpen((prev) => !prev)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  createPickerOpen
                    ? "border border-border bg-bg-primary text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    : "bg-accent text-text-inverse hover:bg-accent-hover"
                }`}
              >
                {createPickerOpen ? t("chat.cancel") : `+ ${t("chat.new")}`}
              </button>
            )}
          >
            {t("chars.characters")}
          </PanelTitle>

          <div className="mb-3 flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
            <span>{characters.length} {t("chars.countSuffix")}</span>
            <span>{t("chars.createChooseHint")}</span>
          </div>

          {createPickerOpen ? (
            <div className="mb-3 rounded-[22px] border border-accent-border/45 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.16),transparent_55%),var(--color-bg-primary)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{t("chat.new")}</div>
              <div className="mt-1 text-sm font-semibold text-text-primary">{t("chars.createChooseTitle")}</div>
              <div className="mt-1 text-xs leading-5 text-text-tertiary">{t("chars.createChooseDesc")}</div>
              <div className="mt-3 grid gap-2">
                <button
                  onClick={() => { void handleCreateBlank("standard"); }}
                  className="group rounded-2xl border border-border-subtle bg-bg-secondary/80 px-3 py-3 text-left transition-colors hover:border-border hover:bg-bg-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text-primary">{t("chars.standardCharacter")}</div>
                      <div className="mt-1 text-xs leading-5 text-text-tertiary">{t("chars.standardCharacterDesc")}</div>
                    </div>
                    <div className="rounded-xl border border-border-subtle bg-bg-primary p-2 text-text-secondary transition-colors group-hover:text-text-primary">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => { void handleCreateBlank("agent"); }}
                  disabled={!appSettings.agentsEnabled}
                  className="group rounded-2xl border border-border-subtle bg-bg-secondary/80 px-3 py-3 text-left transition-colors hover:border-border hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-text-primary">{t("chars.agentCharacter")}</div>
                        {appSettings.agentsEnabled ? <Badge variant="accent">{t("tab.agents")}</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-text-tertiary">
                        {appSettings.agentsEnabled ? t("chars.agentCharacterDesc") : t("chars.agentCharacterDisabled")}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border-subtle bg-bg-primary p-2 text-text-secondary transition-colors group-hover:text-text-primary">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75A2.25 2.25 0 016.75 4.5h4.5A2.25 2.25 0 0113.5 6.75v4.5a2.25 2.25 0 01-2.25 2.25h-4.5A2.25 2.25 0 014.5 11.25v-4.5zM15 4.875a1.125 1.125 0 011.125-1.125h2.25A1.125 1.125 0 0119.5 4.875v2.25A1.125 1.125 0 0118.375 8.25h-2.25A1.125 1.125 0 0115 7.125v-2.25zM10.5 16.5h6.75A2.25 2.25 0 0119.5 18.75v.75H8.25v-.75A2.25 2.25 0 0110.5 16.5z" />
                      </svg>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : null}

          {/* Import section */}
          <div className="float-card mb-3 space-y-2 rounded-lg border border-border-subtle bg-bg-primary p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t("chars.import")}</span>
              <button onClick={loadSample} className="text-[10px] text-accent hover:underline">
                {t("chars.loadSample")}
              </button>
            </div>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={t("chars.importJsonPlaceholder")}
              className="h-20 w-full rounded-md border border-border bg-bg-secondary p-2 font-mono text-[10px] text-text-primary placeholder:text-text-tertiary"
              spellCheck={false}
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleImport}
                className="flex-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-text-inverse hover:bg-accent-hover"
              >
                {t("chars.importJSON")}
              </button>
              <button
                onClick={() => jsonFileRef.current?.click()}
                className="rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                title={t("chars.importFromFile")}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </button>
            </div>
            <input ref={jsonFileRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
            {importError && (
              <div className="rounded-md border border-danger-border bg-danger-subtle px-2 py-1 text-[10px] text-danger">{importError}</div>
            )}
            {importSuccess && (
              <div className="rounded-md border border-success-border bg-success-subtle px-2 py-1 text-[10px] text-success">{importSuccess}</div>
            )}
          </div>

          {/* Character list */}
          <div className="list-animate flex-1 space-y-1.5 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-text-tertiary">{t("chars.loading")}</div>
            ) : characters.length === 0 ? (
              <EmptyState title={t("chars.noChars")} description={t("chars.noCharsDesc")} />
            ) : (
              characters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => {
                    setCreatePickerOpen(false);
                    setSelected(char);
                  }}
                  className={`float-card flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    selected?.id === char.id
                      ? "bg-accent-subtle text-text-primary"
                      : "text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  <AvatarBadge
                    name={char.name}
                    src={avatarSrc(char.avatarUrl, char.id)}
                    className="h-8 w-8 flex-shrink-0 rounded-full"
                    fallbackClassName="bg-accent-subtle text-xs font-bold text-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{char.name}</div>
                    {(char.agentProfile?.enabled || char.tags.length > 0) && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {char.agentProfile?.enabled ? (
                          <Badge variant="accent">{t("chars.agentCharacter")}</Badge>
                        ) : null}
                        {char.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      }
      center={
        selected ? (
          <div className="flex h-full flex-col">
            {/* Header with avatar and actions */}
            <div className="char-editor-header mb-4">
              <div className="char-editor-header-top">
                <label className="group relative cursor-pointer flex-shrink-0">
                  <AvatarBadge
                    name={name || selected.name || t("chars.unnamed")}
                    src={avatarSrc(selected.avatarUrl, selected.id)}
                    className="h-14 w-14 rounded-2xl ring-2 ring-border"
                    fallbackClassName="bg-accent-subtle text-lg font-bold text-accent"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <input ref={avatarFileRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" disabled={avatarUploading} />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-base font-semibold text-text-primary">{name || t("chars.unnamed")}</div>
                    <Badge variant={editorKind === "agent" ? "accent" : "default"}>
                      {editorKind === "agent" ? t("chars.agentCharacter") : t("chars.standardCharacter")}
                    </Badge>
                    {editorKind === "agent" ? (
                      <Badge variant={agentProfileDraft.mode === "research" ? "warning" : agentProfileDraft.mode === "build" ? "accent" : "default"}>
                        {t(`agents.mode${agentProfileDraft.mode === "ask" ? "Ask" : agentProfileDraft.mode === "research" ? "Research" : "Build"}`)}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {saveStatus ? (
                      <span className={`text-[11px] ${saveStatusType === "error" ? "text-danger" : "text-success"}`}>{saveStatus}</span>
                    ) : (
                      <span className="text-[11px] text-text-tertiary">{t("chars.editor")}</span>
                    )}
                    {tags && (
                      <div className="flex flex-wrap gap-1">
                        {tags.split(",").filter(Boolean).slice(0, 3).map((tag) => (
                          <Badge key={tag.trim()}>{tag.trim()}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {appSettings.agentsEnabled ? (
                <div className="rounded-2xl border border-border-subtle bg-bg-primary/70 px-3 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{t("chars.profileType")}</div>
                      <div className="mt-1 text-xs leading-5 text-text-tertiary">
                        {editorKind === "agent" ? t("chars.profileTypeAgentDesc") : t("chars.profileTypeCharacterDesc")}
                      </div>
                    </div>
                    <div className="inline-flex rounded-2xl border border-border bg-bg-secondary p-1">
                      <button
                        onClick={() => setCharacterKind("standard")}
                        className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                          editorKind === "standard"
                            ? "bg-bg-primary text-text-primary shadow-[0_6px_20px_rgba(0,0,0,0.12)]"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {t("chars.standardCharacter")}
                      </button>
                      <button
                        onClick={() => setCharacterKind("agent")}
                        className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                          editorKind === "agent"
                            ? "bg-accent text-text-inverse shadow-[0_10px_24px_rgba(168,85,247,0.28)]"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {t("chars.agentCharacter")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="char-editor-actions">
                <button onClick={handleSave} className="char-editor-btn is-primary">{t("chat.save")}</button>
                {appSettings.agentsEnabled && (
                  <button
                    onClick={handleCreateAgentThread}
                    disabled={creatingAgentThread || !agentProfileDraft.enabled}
                    className="char-editor-btn"
                    title={!agentProfileDraft.enabled ? t("chars.enableAgentHeroFirst") : t("chars.createAgentWorkspace")}
                  >
                    {creatingAgentThread ? t("chars.creatingAgentWorkspace") : t("chars.createAgentWorkspace")}
                  </button>
                )}
                <button
                  onClick={handleTranslateCopy}
                  disabled={translateCopyBusy}
                  className="char-editor-btn"
                >
                  {translateCopyBusy ? t("chars.translatingCopy") : t("chars.translateCopy")}
                </button>
                <button
                  onClick={() => { void handleExportJson(); }}
                  className="char-editor-btn"
                  title={t("chars.exportJson")}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t("chars.exportJson")}
                </button>
                <button onClick={handleDelete} className="char-editor-btn is-danger">{t("chat.delete")}</button>
              </div>
            </div>

            {/* GUI editor fields — sectioned */}
            <div className="flex-1 space-y-2 overflow-y-auto">
              {/* Section: Identity */}
              <div className="char-editor-section">
                <button onClick={() => toggleEditorSection("identity")} className="char-editor-section-toggle">
                  <span>{t("chars.identity")}</span>
                  <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${editorSections.identity ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {editorSections.identity && (
                  <div className="char-editor-section-body">
                    <div>
                      <label className="char-editor-label">{t("chars.name")}</label>
                      <input value={name} onChange={(e) => { setName(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-input" />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.description")}</label>
                      <textarea value={description} onChange={(e) => { setDescription(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-24" />
                    </div>
                    {editorKind === "agent" ? (
                      <>
                        <div>
                          <label className="char-editor-label">{t("chars.tags")}</label>
                          <input value={tags} onChange={(e) => { setTags(e.target.value); setJsonSyncDirection("gui"); }}
                            className="char-editor-input"
                            placeholder={t("chars.tagsPlaceholder")} />
                        </div>
                        <div className="rounded-2xl border border-border-subtle bg-bg-secondary px-3 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t("chars.agentEditorHintTitle")}</div>
                          <div className="mt-1 text-sm font-medium text-text-primary">{t("chars.agentEditorHint")}</div>
                          <div className="mt-2 text-xs leading-5 text-text-tertiary">{t("chars.agentEditorHintDesc")}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="char-editor-label">{t("chars.personality")}</label>
                          <textarea value={personality} onChange={(e) => { setPersonality(e.target.value); setJsonSyncDirection("gui"); }}
                            className="char-editor-textarea h-16" />
                        </div>
                        <div>
                          <label className="char-editor-label">{t("chars.scenario")}</label>
                          <textarea value={scenario} onChange={(e) => { setScenario(e.target.value); setJsonSyncDirection("gui"); }}
                            className="char-editor-textarea h-16" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Section: Content */}
              <div className="char-editor-section">
                <button onClick={() => toggleEditorSection("content")} className="char-editor-section-toggle">
                  <span>{contentSectionTitle}</span>
                  <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${editorSections.content ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {editorSections.content && (
                  <div className="char-editor-section-body">
                    <div className="rounded-2xl border border-border-subtle bg-bg-secondary px-3 py-3 text-xs leading-5 text-text-tertiary">
                      {contentSectionDescription}
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.firstMessage")}</label>
                      <textarea value={greeting} onChange={(e) => { setGreeting(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-20" />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.alternateGreetings")}</label>
                      <textarea value={alternateGreetingsText} onChange={(e) => { setAlternateGreetingsText(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-20"
                        placeholder={t("chars.alternateGreetingsPlaceholder")} />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.systemPrompt")}</label>
                      <textarea value={systemPrompt} onChange={(e) => { setSystemPrompt(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-16" />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.exampleMessages")}</label>
                      <textarea value={mesExample} onChange={(e) => { setMesExample(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-16"
                        placeholder={t("chars.exampleMessagesPlaceholder")} />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.postHistoryInstructions")}</label>
                      <textarea value={postHistoryInstructions} onChange={(e) => { setPostHistoryInstructions(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-16" />
                    </div>
                    {editorKind === "agent" ? (
                      <>
                        <div>
                          <label className="char-editor-label">{t("chars.personality")}</label>
                          <textarea value={personality} onChange={(e) => { setPersonality(e.target.value); setJsonSyncDirection("gui"); }}
                            className="char-editor-textarea h-16" />
                        </div>
                        <div>
                          <label className="char-editor-label">{t("chars.scenario")}</label>
                          <textarea value={scenario} onChange={(e) => { setScenario(e.target.value); setJsonSyncDirection("gui"); }}
                            className="char-editor-textarea h-16" />
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Section: Metadata */}
              {appSettings.agentsEnabled && (
                <div className="char-editor-section">
                  <button onClick={() => toggleEditorSection("agent")} className="char-editor-section-toggle">
                    <span>{t("chars.agentHero")}</span>
                    <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${editorSections.agent ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {editorSections.agent && (
                    <div className="char-editor-section-body">
                      {editorKind === "agent" ? (
                        <>
                          <div className="rounded-[22px] border border-accent-border/45 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.16),transparent_60%),var(--color-bg-secondary)] px-4 py-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <div className="text-sm font-semibold text-text-primary">{t("chars.agentHeroTitle")}</div>
                                <div className="mt-1 text-xs leading-5 text-text-tertiary">{t("chars.agentWorkspaceSummaryDesc")}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="accent">{t("chars.agentReadyOn")}</Badge>
                                <Badge>{agentProfileDraft.skills.length} {t("chars.agentSkillsCount")}</Badge>
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="char-editor-label">{t("chars.agentMode")}</label>
                            <div className="grid gap-2 md:grid-cols-3">
                              {(["ask", "build", "research"] as const).map((mode) => {
                                const active = agentProfileDraft.mode === mode;
                                return (
                                  <button
                                    key={mode}
                                    onClick={() => {
                                      setAgentProfileDraft((prev) => ({ ...prev, mode }));
                                      setJsonSyncDirection("gui");
                                    }}
                                    className={`rounded-2xl border px-3 py-3 text-left transition-colors ${
                                      active
                                        ? "border-accent-border bg-accent-subtle text-text-primary"
                                        : "border-border-subtle bg-bg-secondary text-text-secondary hover:border-border hover:bg-bg-hover hover:text-text-primary"
                                    }`}
                                  >
                                    <div className="text-sm font-semibold">{t(mode === "ask" ? "agents.modeAsk" : mode === "research" ? "agents.modeResearch" : "agents.modeBuild")}</div>
                                    <div className="mt-1 text-xs leading-5 opacity-80">{t(mode === "ask" ? "agents.modeAskDesc" : mode === "research" ? "agents.modeResearchDesc" : "agents.modeBuildDesc")}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <label className="char-editor-label !mb-0">{t("chars.agentInstructions")}</label>
                              <ToggleSwitch
                                checked={agentProfileDraft.enabled}
                                onChange={(event) => {
                                  setAgentProfileDraft((prev) => ({ ...prev, enabled: event.target.checked }));
                                  setJsonSyncDirection("gui");
                                }}
                              />
                            </div>
                            <textarea
                              value={agentProfileDraft.customInstructions}
                              onChange={(event) => {
                                setAgentProfileDraft((prev) => ({ ...prev, customInstructions: event.target.value }));
                                setJsonSyncDirection("gui");
                              }}
                              className="char-editor-textarea h-28"
                              placeholder={t("chars.agentInstructionsPlaceholder")}
                            />
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <label className="char-editor-label !mb-0">{t("chars.agentSkills")}</label>
                              <button
                                onClick={addHeroSkill}
                                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                              >
                                + {t("agents.addSkill")}
                              </button>
                            </div>
                            {agentProfileDraft.skills.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-border-subtle bg-bg-secondary px-3 py-4 text-xs leading-5 text-text-tertiary">
                                {t("chars.agentSkillsEmpty")}
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {agentProfileDraft.skills.map((skill) => (
                                  <div key={skill.id} className="rounded-2xl border border-border-subtle bg-bg-secondary p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <input
                                        value={skill.name}
                                        onChange={(event) => updateHeroSkill(skill.id, { name: event.target.value })}
                                        className="char-editor-input"
                                        placeholder={t("agents.newSkillDefault")}
                                      />
                                      <label className="flex items-center gap-2 text-xs text-text-secondary">
                                        <input
                                          type="checkbox"
                                          checked={skill.enabled}
                                          onChange={(event) => updateHeroSkill(skill.id, { enabled: event.target.checked })}
                                        />
                                        {t("agents.enabled")}
                                      </label>
                                    </div>
                                    <textarea
                                      value={skill.description}
                                      onChange={(event) => updateHeroSkill(skill.id, { description: event.target.value })}
                                      className="char-editor-textarea h-16"
                                      placeholder={t("agents.skillDescription")}
                                    />
                                    <textarea
                                      value={skill.instructions}
                                      onChange={(event) => updateHeroSkill(skill.id, { instructions: event.target.value })}
                                      className="char-editor-textarea mt-2 h-20"
                                      placeholder={t("agents.skillInstructions")}
                                    />
                                    <div className="mt-2 flex justify-end">
                                      <button
                                        onClick={() => removeHeroSkill(skill.id)}
                                        className="rounded-lg border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle"
                                      >
                                        {t("chat.delete")}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="rounded-[22px] border border-border-subtle bg-bg-secondary px-4 py-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-text-primary">{t("chars.convertToAgent")}</div>
                              <div className="mt-1 text-xs leading-5 text-text-tertiary">{t("chars.convertToAgentDesc")}</div>
                            </div>
                            <button
                              onClick={() => setCharacterKind("agent")}
                              className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
                            >
                              {t("chars.agentCharacter")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="char-editor-section">
                <button onClick={() => toggleEditorSection("meta")} className="char-editor-section-toggle">
                  <span>{t("chars.meta")}</span>
                  <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${editorSections.meta ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {editorSections.meta && (
                  <div className="char-editor-section-body">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="char-editor-label">{t("chars.creator")}</label>
                        <input value={creator} onChange={(e) => { setCreator(e.target.value); setJsonSyncDirection("gui"); }}
                          className="char-editor-input" />
                      </div>
                      <div>
                        <label className="char-editor-label">{t("chars.characterVersion")}</label>
                        <input value={characterVersion} onChange={(e) => { setCharacterVersion(e.target.value); setJsonSyncDirection("gui"); }}
                          className="char-editor-input" />
                      </div>
                    </div>
                    {editorKind === "standard" ? (
                      <div>
                        <label className="char-editor-label">{t("chars.tags")}</label>
                        <input value={tags} onChange={(e) => { setTags(e.target.value); setJsonSyncDirection("gui"); }}
                          className="char-editor-input"
                          placeholder={t("chars.tagsPlaceholder")} />
                      </div>
                    ) : null}
                    <div>
                      <label className="char-editor-label">{t("chars.creatorNotes")}</label>
                      <textarea value={creatorNotes} onChange={(e) => { setCreatorNotes(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea h-14" />
                    </div>
                  </div>
                )}
              </div>

              {/* Section: Advanced */}
              <div className="char-editor-section">
                <button onClick={() => toggleEditorSection("advanced")} className="char-editor-section-toggle">
                  <span>{t("chars.advanced")}</span>
                  <svg className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${editorSections.advanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {editorSections.advanced && (
                  <div className="char-editor-section-body">
                    <div>
                      <label className="char-editor-label">{t("chars.creatorNotesMultilingual")}</label>
                      <textarea value={creatorNotesMultilingualJson} onChange={(e) => { setCreatorNotesMultilingualJson(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea char-editor-mono h-20"
                        placeholder={t("chars.creatorNotesMultilingualPlaceholder")} />
                    </div>
                    <div>
                      <label className="char-editor-label">{t("chars.extensions")}</label>
                      <textarea value={extensionsJson} onChange={(e) => { setExtensionsJson(e.target.value); setJsonSyncDirection("gui"); }}
                        className="char-editor-textarea char-editor-mono h-24"
                        placeholder={t("chars.extensionsPlaceholder")} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title={t("chars.selectCharacter")} description={t("chars.selectCharacterDesc")} />
        )
      }
      right={
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between">
            <PanelTitle>{t("chars.rawJson")}</PanelTitle>
            <div className="flex items-center gap-2">
              {!jsonValid && rawJson !== "{}" && <Badge variant="danger">{t("chars.invalid")}</Badge>}
              {jsonValid && rawJson !== "{}" && <Badge variant="success">{t("chars.valid")}</Badge>}
            </div>
          </div>

          <textarea
            value={rawJson}
            onChange={(e) => { setRawJson(e.target.value); setJsonSyncDirection("json"); }}
            className="flex-1 rounded-lg border border-border bg-bg-primary p-3 font-mono text-[10px] leading-relaxed text-text-primary placeholder:text-text-tertiary"
            placeholder={t("chars.rawJsonPlaceholder")}
            spellCheck={false}
          />

          <div className="mt-3 flex gap-2">
            <button onClick={applyJsonToGui} disabled={!jsonValid || !selected}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("chars.jsonToGui")}
            </button>
            <button onClick={() => setJsonSyncDirection("gui")} disabled={!selected}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40">
              {t("chars.guiToJson")}
            </button>
          </div>

          {selected && (
            <div className="float-card mt-3 rounded-lg border border-border-subtle bg-bg-primary p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t("chars.preview")}</div>
              <div className="flex items-center gap-2">
                <AvatarBadge
                  name={name || selected.name || t("chars.unnamed")}
                  src={avatarSrc(selected.avatarUrl, selected.id)}
                  className="h-8 w-8 rounded-full"
                  fallbackClassName="bg-accent-subtle text-xs font-bold text-accent"
                />
                <div>
                  <div className="text-sm font-medium text-text-primary">{name || t("chars.unnamed")}</div>
                  {tags && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {tags.split(",").filter(Boolean).slice(0, 5).map((t) => (
                        <Badge key={t.trim()}>{t.trim()}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {greeting && (
                <div className="mt-2 rounded-md border border-border-subtle bg-bg-secondary p-2 text-[11px] italic text-text-secondary">
                  {greeting.slice(0, 200)}{greeting.length > 200 ? "..." : ""}
                </div>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
