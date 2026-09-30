import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import { Badge, EmptyState, PanelTitle, ThreePanelLayout } from "../../components/Panels";
import { api } from "../../shared/api";
import { buildFilenameBase, triggerBlobDownload } from "../../shared/download";
import { useI18n } from "../../shared/i18n";
import { PetAppearancePanel } from "./components/PetAppearancePanel";
import { PetAssetPreview } from "./components/PetAssetPreview";
import { PetDesktopPanel } from "./components/PetDesktopPanel";
import { PetStateEditor } from "./components/PetStateEditor";
import type { CharacterDetail } from "../../shared/types/contracts";
import {
  buildDesktopPetConfigFromCharacter,
  CODEX_PET_STATES,
  getDesktopPetExtension,
  mergeDesktopPetExtension,
  readDesktopPetThemeSnapshot,
  normalizeDesktopPetCodexState,
  normalizeDesktopPetAnimation,
  readStoredDesktopPetConfig,
  storeDesktopPetConfig,
  type DesktopPetCodexState,
  type DesktopPetConfig,
  type DesktopPetStatePreset,
  type DesktopPetVoice
} from "./desktopPet";

type PetDraft = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  systemPrompt: string;
  spriteUrl: string;
  spriteSheetUrl: string;
  scale: number;
  voice: DesktopPetVoice;
  ttsEnabled: boolean;
  autonomyEnabled: boolean;
  actions: DesktopPetStatePreset[];
  emotions: DesktopPetStatePreset[];
  assistantInstructions: string;
  persistentMemory: string;
  chatContextTokenLimit: number;
};

type PresetUploadTarget = {
  kind: "action" | "emotion";
  index: number;
  field: "assetUrl" | "soundUrl";
} | null;

type PetPanelView = "asset" | "profile" | "states" | "assistant" | "chats";
const PET_TAB_LABELS = {
  asset: "pets.tabAppearance",
  profile: "pets.tabProfile",
  states: "pets.tabStates",
  assistant: "pets.tabAssistant",
  chats: "pets.tabChats"
} as const;
type PetChatMessage = { role: "user" | "assistant"; content: string; createdAt: number };
type PetChatAttachment = { type: "image"; dataUrl: string; mimeType: string; filename: string; createdAt: number };
type PetChatHistory = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  count: number;
  messages: Array<PetChatMessage & { attachments?: PetChatAttachment[] }>;
};
type CodexPetManifest = {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  spritesheetPath?: string;
};

const FALLBACK_ACTIONS: DesktopPetStatePreset[] = [
  { id: "idle", label: "Idle", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
  { id: "happy", label: "Happy", animation: "hop", codexState: "jumping", assetUrl: "", soundUrl: "" },
  { id: "alert", label: "Alert", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
  { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
  { id: "spin", label: "Spin", animation: "spin", codexState: "idle", assetUrl: "", soundUrl: "" },
  { id: "shake", label: "Shake", animation: "shake", codexState: "failed", assetUrl: "", soundUrl: "" }
];

const FALLBACK_EMOTIONS: DesktopPetStatePreset[] = [
  { id: "calm", label: "Calm", animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" },
  { id: "happy", label: "Happy", animation: "hop", codexState: "waving", assetUrl: "", soundUrl: "" },
  { id: "curious", label: "Curious", animation: "pop", codexState: "review", assetUrl: "", soundUrl: "" },
  { id: "sleepy", label: "Sleepy", animation: "sway", codexState: "failed", assetUrl: "", soundUrl: "" },
  { id: "excited", label: "Excited", animation: "bounce", codexState: "jumping", assetUrl: "", soundUrl: "" }
];

const PET_ANIMATIONS = ["none", "idle", "hop", "pop", "sway", "spin", "shake", "bounce"] as const;
const PET_ASSET_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp,video/mp4,video/webm,video/quicktime,video/x-m4v";
const PET_CODEX_SPRITESHEET_ACCEPT = "image/webp,image/png,.webp,.png";
const PET_SOUND_ACCEPT = "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac";

const PET_TAG = "pet";

function normalizeCodexPetId(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
}

function parseCodexPetManifest(rawJson: string): CodexPetManifest | null {
  try {
    const parsed = JSON.parse(rawJson) as CodexPetManifest;
    const id = normalizeCodexPetId(parsed?.id);
    const displayName = String(parsed?.displayName || parsed?.name || "").trim();
    const spritesheetPath = String(parsed?.spritesheetPath || "").trim();
    if (!id || !displayName || !spritesheetPath) return null;
    return { ...parsed, id, displayName, spritesheetPath };
  } catch {
    return null;
  }
}

function resolveCodexPetSpritesheetUrl(manifest: CodexPetManifest) {
  const rawPath = String(manifest.spritesheetPath || "").trim();
  if (/^(https?:|data:|blob:|file:|\/)/i.test(rawPath)) return rawPath;
  const id = normalizeCodexPetId(manifest.id);
  return id ? `/pets/${id}/${rawPath.replace(/^\.?\//, "")}` : rawPath;
}

function isExternalCodexSpritesheetPath(manifest: CodexPetManifest) {
  return /^(https?:|data:|blob:|file:|\/)/i.test(String(manifest.spritesheetPath || "").trim());
}

function codexStateForPreset(id: string, animation?: string): DesktopPetCodexState {
  if (/running-right|right/.test(id)) return "running-right";
  if (/running-left|left/.test(id)) return "running-left";
  if (/running|working|progress|busy|task/.test(id)) return "running";
  if (/review|alert|curious|think|focus|inspect/.test(id)) return "review";
  if (/wait|waiting|idle2|patient/.test(id)) return "waiting";
  if (/sleep|sad|failed|fail|tired|shake|angry/.test(id)) return "failed";
  if (/jump|excited|bounce/.test(id) || animation === "bounce") return "jumping";
  if (/happy|joy|play|wave|hello|hi/.test(id)) return animation === "hop" ? "jumping" : "waving";
  if (animation === "hop") return "jumping";
  if (animation === "pop") return "review";
  if (animation === "sway") return "waiting";
  return normalizeDesktopPetCodexState(id, "idle");
}

function codexPreset(preset: Omit<DesktopPetStatePreset, "codexState"> & { codexState?: DesktopPetCodexState }): DesktopPetStatePreset {
  return {
    ...preset,
    codexState: normalizeDesktopPetCodexState(preset.codexState, codexStateForPreset(preset.id, preset.animation))
  };
}

function createBlankPetCard(name: string) {
  return JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: "",
      personality: "A small desktop companion: attentive, warm, curious, and quick to react to clicks and short messages.",
      scenario: "Lives on the user's desktop as a Vellium Pet and keeps them company while they work.",
      first_mes: "I'm here.",
      tags: [PET_TAG],
      system_prompt: "Stay in character as a desktop companion. Keep replies short, reactive, and emotionally present.",
      mes_example: "",
      creator_notes: "Created from Vellium Pets.",
      alternate_greetings: [],
      post_history_instructions: "",
      creator: "Vellium",
      character_version: "pet",
      creator_notes_multilingual: {},
      extensions: {
        velliumPet: {
          spriteUrl: "",
          spriteSheetUrl: "",
          scale: 1,
          voice: "soft",
          ttsEnabled: false,
          autonomyEnabled: false,
          actions: FALLBACK_ACTIONS.map(codexPreset),
          emotions: FALLBACK_EMOTIONS.map(codexPreset),
          assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help.",
          persistentMemory: "",
          chatContextTokenLimit: 2400
        }
      }
    }
  }, null, 2);
}

function createCodexPetCard(manifest: CodexPetManifest, spriteSheetUrl: string) {
  const name = String(manifest.displayName || manifest.id || "Codex Pet").trim() || "Codex Pet";
  const description = String(manifest.description || "").trim();
  return JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description,
      personality: description || "A compact Codex-style desktop pet adapted for Vellium.",
      scenario: "Lives on the user's desktop as a Vellium Pet and reacts through a Codex pet spritesheet.",
      first_mes: "I'm here.",
      tags: [PET_TAG],
      system_prompt: "Stay in character as a desktop companion. Keep replies short, reactive, and emotionally present.",
      mes_example: "",
      creator_notes: "Imported from a Codex pet manifest.",
      alternate_greetings: [],
      post_history_instructions: "",
      creator: "Vellium",
      character_version: "codex-pet",
      creator_notes_multilingual: {},
      extensions: {
        velliumPet: {
          spriteUrl: "",
          spriteSheetUrl,
          scale: 1,
          voice: "soft",
          ttsEnabled: false,
          autonomyEnabled: false,
          actions: FALLBACK_ACTIONS.map(codexPreset),
          emotions: FALLBACK_EMOTIONS.map(codexPreset),
          assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help.",
          persistentMemory: "",
          chatContextTokenLimit: 2400
        }
      }
    }
  }, null, 2);
}

function draftFromCharacter(character: CharacterDetail, fallback?: DesktopPetConfig): PetDraft {
  const config = buildDesktopPetConfigFromCharacter(character, fallback);
  return {
    name: config.name,
    description: config.description || "",
    personality: config.personality || "",
    scenario: config.scenario || "",
    greeting: config.greeting || "",
    systemPrompt: config.systemPrompt || "",
    spriteUrl: config.spriteUrl,
    spriteSheetUrl: config.spriteSheetUrl,
    scale: config.scale,
    voice: config.voice,
    ttsEnabled: config.ttsEnabled,
    autonomyEnabled: config.autonomyEnabled,
    actions: config.actions,
    emotions: config.emotions,
    assistantInstructions: config.assistantInstructions,
    persistentMemory: config.persistentMemory,
    chatContextTokenLimit: config.chatContextTokenLimit
  };
}

function normalizePresetId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

function normalizePresetDraft(presets: DesktopPetStatePreset[], fallback: DesktopPetStatePreset[]) {
  const unique = new Map<string, DesktopPetStatePreset>();
  for (const preset of presets) {
    const id = normalizePresetId(preset.id);
    if (!id) continue;
    if (!unique.has(id)) {
      unique.set(id, {
        id,
        label: preset.label.trim().slice(0, 48) || id,
        animation: normalizeDesktopPetAnimation(preset.animation),
        codexState: normalizeDesktopPetCodexState(preset.codexState, codexStateForPreset(id, preset.animation)),
        assetUrl: preset.assetUrl.trim().slice(0, 4000),
        soundUrl: (preset.soundUrl || "").trim().slice(0, 4000)
      });
    }
  }
  return unique.size ? [...unique.values()].slice(0, 12) : fallback;
}

function petConfigFromDraft(character: CharacterDetail, draft: PetDraft): DesktopPetConfig {
  return {
    characterId: character.id,
    name: draft.name,
    spriteUrl: draft.spriteUrl,
    spriteSheetUrl: draft.spriteSheetUrl,
    scale: draft.scale,
    voice: draft.voice,
    ttsEnabled: draft.ttsEnabled,
    autonomyEnabled: draft.autonomyEnabled,
    actions: normalizePresetDraft(draft.actions, FALLBACK_ACTIONS),
    emotions: normalizePresetDraft(draft.emotions, FALLBACK_EMOTIONS),
    assistantInstructions: draft.assistantInstructions,
    persistentMemory: draft.persistentMemory,
    chatContextTokenLimit: draft.chatContextTokenLimit,
    theme: readDesktopPetThemeSnapshot(),
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    greeting: draft.greeting,
    systemPrompt: draft.systemPrompt
  };
}

function hasPetTag(character: CharacterDetail) {
  return character.tags.some((tag) => tag.toLowerCase() === PET_TAG);
}

export function PetsScreen() {
  const { t, locale } = useI18n();
  const assetFileRef = useRef<HTMLInputElement | null>(null);
  const spriteSheetFileRef = useRef<HTMLInputElement | null>(null);
  const presetAssetFileRef = useRef<HTMLInputElement | null>(null);
  const importPetFileRef = useRef<HTMLInputElement | null>(null);
  const importPetFolderRef = useRef<HTMLInputElement | null>(null);
  const presetUploadTargetRef = useRef<PresetUploadTarget>(null);
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<DesktopPetConfig>(() => readStoredDesktopPetConfig());
  const [draft, setDraft] = useState<PetDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [visible, setVisible] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [rightView, setRightView] = useState<PetPanelView>("profile");
  const [petChats, setPetChats] = useState<PetChatHistory[]>([]);
  const [activePetChatId, setActivePetChatId] = useState("");
  const [petChatsLoading, setPetChatsLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const isElectron = Boolean(window.electronAPI?.showDesktopPet);
  const petOnDesktop = visible && Boolean(selectedId) && activeConfig.characterId === selectedId;

  const selected = useMemo(
    () => characters.find((character) => character.id === selectedId) || null,
    [characters, selectedId]
  );

  const sortedCharacters = useMemo(() => {
    return [...characters].sort((a, b) => {
      const petDelta = Number(hasPetTag(b)) - Number(hasPetTag(a));
      if (petDelta !== 0) return petDelta;
      return a.name.localeCompare(b.name);
    });
  }, [characters]);

  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeConfig.characterId) || null,
    [characters, activeConfig.characterId]
  );

  const loadCharacters = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.characterList();
      setCharacters(list);
      setSelectedId((current) => {
        if (current && list.some((character) => character.id === current)) return current;
        if (activeConfig.characterId && list.some((character) => character.id === activeConfig.characterId)) return activeConfig.characterId;
        return list.find(hasPetTag)?.id || list[0]?.id || null;
      });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.loadFailed")}: ${String(error)}` });
    } finally {
      setLoading(false);
    }
  }, [activeConfig.characterId]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    const input = importPetFolderRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void window.electronAPI?.isDesktopPetVisible?.().then(setVisible).catch(() => setVisible(false));
  }, [isElectron]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      setPetChats([]);
      setActivePetChatId("");
      return;
    }
    setDraft(draftFromCharacter(selected, activeConfig.characterId === selected.id ? activeConfig : undefined));
  }, [activeConfig, selected]);

  const refreshPetChats = useCallback(async () => {
    if (!selected || !draft || !isElectron) {
      setPetChats([]);
      setActivePetChatId("");
      return;
    }
    setPetChatsLoading(true);
    try {
      const payload = await window.electronAPI!.listDesktopPetChats(petConfigFromDraft(selected, draft));
      const history = Array.isArray(payload.history) ? payload.history : [];
      setPetChats(history);
      setActivePetChatId(payload.activeChatId || history[0]?.id || "");
      if (typeof payload.persistentMemory === "string") {
        setDraft((current) => {
          if (!current || current.persistentMemory === payload.persistentMemory) return current;
          return { ...current, persistentMemory: payload.persistentMemory || "" };
        });
      }
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.chatsLoadFailed")}: ${String(error)}` });
    } finally {
      setPetChatsLoading(false);
    }
  }, [draft, isElectron, selected, t]);

  useEffect(() => {
    if (rightView !== "chats") return;
    void refreshPetChats();
  }, [refreshPetChats, rightView]);

  async function createPet() {
    setCreating(true);
    setStatus(null);
    try {
      const created = await api.characterImportV2(createBlankPetCard(t("pets.newPetName")));
      setCharacters((prev) => [created, ...prev]);
      setSelectedId(created.id);
      const nextConfig = buildDesktopPetConfigFromCharacter(created);
      setActiveConfig(nextConfig);
      storeDesktopPetConfig(nextConfig);
      setStatus({ kind: "success", text: t("pets.created") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.createFailed")}: ${String(error)}` });
    } finally {
      setCreating(false);
    }
  }

  function findCodexSpritesheetFile(files: File[], manifest: CodexPetManifest) {
    const expectedPath = String(manifest.spritesheetPath || "").replace(/^\.?\//, "");
    const expectedName = expectedPath.split(/[\\/]/).pop() || expectedPath;
    return files.find((file) => {
      const filePath = String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
      return file.name === expectedName || filePath.endsWith(expectedPath);
    }) || null;
  }

  async function uploadCodexManifestSpriteSheet(file: File | null) {
    if (!file) return "";
    const base64 = await readFileAsBase64(file);
    const attachment = await api.uploadFile(base64, file.name || "codex-pet-spritesheet.webp");
    if (attachment.type !== "image") {
      throw new Error(t("pets.spriteSheetUploadImageOnly"));
    }
    return attachment.url;
  }

  async function importPetFromFiles(fileList: FileList | null | undefined) {
    const files = Array.from(fileList || []);
    const file = files.find((item) => item.name.toLowerCase() === "pet.json")
      || files.find((item) => item.name.toLowerCase().endsWith(".json"));
    if (!file) return;
    setCreating(true);
    setStatus(null);
    try {
      const rawJson = await file.text();
      const codexManifest = parseCodexPetManifest(rawJson);
      const codexSpriteSheetUrl = codexManifest && isExternalCodexSpritesheetPath(codexManifest)
        ? resolveCodexPetSpritesheetUrl(codexManifest)
        : codexManifest
          ? await uploadCodexManifestSpriteSheet(findCodexSpritesheetFile(files, codexManifest))
          : "";
      if (codexManifest && !codexSpriteSheetUrl) {
        throw new Error(t("pets.codexMissingSpritesheet"));
      }
      const imported = await api.characterImportV2(codexManifest ? createCodexPetCard(codexManifest, codexSpriteSheetUrl) : rawJson);
      const tags = Array.from(new Set([...imported.tags, PET_TAG]));
      const updated = tags.length === imported.tags.length && tags.every((tag) => imported.tags.includes(tag))
        ? imported
        : await api.characterUpdate(imported.id, { tags });
      setCharacters((prev) => [updated, ...prev.filter((character) => character.id !== updated.id)]);
      setSelectedId(updated.id);
      const nextConfig = buildDesktopPetConfigFromCharacter(updated);
      setActiveConfig(nextConfig);
      storeDesktopPetConfig(nextConfig);
      setStatus({ kind: "success", text: codexManifest ? t("pets.codexImported") : t("pets.imported") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.importFailed")}: ${String(error)}` });
    } finally {
      setCreating(false);
      if (importPetFileRef.current) importPetFileRef.current.value = "";
      if (importPetFolderRef.current) importPetFolderRef.current.value = "";
    }
  }

  async function exportPet() {
    if (!selected || !draft) return;
    setStatus(null);
    const updated = await savePet();
    if (!updated) return;
    try {
      const blob = await api.characterExportJson(updated.id);
      await triggerBlobDownload(blob, `${buildFilenameBase(updated.name, "pet")}.json`);
      setStatus({ kind: "success", text: t("pets.exported") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.exportFailed")}: ${String(error)}` });
    }
  }

  async function savePet(): Promise<CharacterDetail | null> {
    if (!selected || !draft) return null;
    setSaving(true);
    setStatus(null);
    try {
      const tags = Array.from(new Set([...selected.tags, PET_TAG]));
      const updated = await api.characterUpdate(selected.id, {
        name: draft.name,
        description: draft.description,
        personality: draft.personality,
        scenario: draft.scenario,
        greeting: draft.greeting,
        systemPrompt: draft.systemPrompt,
        tags,
        extensions: mergeDesktopPetExtension(selected.extensions, {
          spriteUrl: draft.spriteUrl,
          spriteSheetUrl: draft.spriteSheetUrl,
          scale: draft.scale,
          voice: draft.voice,
          ttsEnabled: draft.ttsEnabled,
          autonomyEnabled: draft.autonomyEnabled,
          actions: normalizePresetDraft(draft.actions, FALLBACK_ACTIONS),
          emotions: normalizePresetDraft(draft.emotions, FALLBACK_EMOTIONS),
          assistantInstructions: draft.assistantInstructions,
          persistentMemory: draft.persistentMemory,
          chatContextTokenLimit: draft.chatContextTokenLimit
        })
      });
      setCharacters((prev) => prev.map((character) => character.id === updated.id ? updated : character));
      setSelectedId(updated.id);
      const nextConfig = petConfigFromDraft(updated, draft);
      setActiveConfig(nextConfig);
      storeDesktopPetConfig(nextConfig);
      setStatus({ kind: "success", text: t("pets.saved") });
      return updated;
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.saveFailed")}: ${String(error)}` });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function showPet() {
    if (!selected || !draft || !isElectron || visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      const updated = await savePet();
      if (!updated) return;
      const nextConfig = petConfigFromDraft(updated, draft);
      const result = await window.electronAPI!.showDesktopPet({ ...nextConfig, locale });
      setVisible(result.visible);
    } catch (error) {
      setStatus({ kind: "error", text: String(error) });
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function hidePet() {
    if (!isElectron || visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      const result = await window.electronAPI!.hideDesktopPet();
      setVisible(result.visible);
    } catch (error) {
      setStatus({ kind: "error", text: String(error) });
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function selectPetChat(chatId: string) {
    if (!selected || !draft || !isElectron) return;
    const previousChatId = activePetChatId;
    setActivePetChatId(chatId);
    try {
      const payload = await window.electronAPI!.selectDesktopPetChat(chatId, petConfigFromDraft(selected, draft));
      const history = Array.isArray(payload.history) ? payload.history : [];
      setPetChats(history);
      setActivePetChatId(payload.activeChatId || chatId);
    } catch (error) {
      setActivePetChatId(previousChatId);
      setStatus({ kind: "error", text: `${t("pets.chatsLoadFailed")}: ${String(error)}` });
    }
  }

  async function createPetChat() {
    if (!selected || !draft || !isElectron) return;
    try {
      const payload = await window.electronAPI!.createDesktopPetChat(t("pets.newChatTitle"), petConfigFromDraft(selected, draft));
      const history = Array.isArray(payload.history) ? payload.history : [];
      setPetChats(history);
      setActivePetChatId(payload.activeChatId || history[0]?.id || "");
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.chatsLoadFailed")}: ${String(error)}` });
    }
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadPetAsset(file: File | null | undefined) {
    if (!file || !draft) return;
    setUploadingAsset(true);
    setStatus(null);
    try {
      const base64 = await readFileAsBase64(file);
      const attachment = await api.uploadFile(base64, file.name || "pet.png");
      if (attachment.type !== "image" && attachment.type !== "video") {
        setStatus({ kind: "error", text: t("pets.assetUploadImageOnly") });
        return;
      }
      setDraft({ ...draft, spriteUrl: attachment.url, spriteSheetUrl: "" });
      setStatus({ kind: "success", text: t("pets.assetUploaded") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.assetUploadFailed")}: ${String(error)}` });
    } finally {
      setUploadingAsset(false);
      if (assetFileRef.current) assetFileRef.current.value = "";
    }
  }

  async function uploadCodexSpriteSheet(file: File | null | undefined) {
    if (!file || !draft) return;
    setUploadingAsset(true);
    setStatus(null);
    try {
      const base64 = await readFileAsBase64(file);
      const attachment = await api.uploadFile(base64, file.name || "codex-pet-spritesheet.webp");
      if (attachment.type !== "image") {
        setStatus({ kind: "error", text: t("pets.spriteSheetUploadImageOnly") });
        return;
      }
      setDraft({ ...draft, spriteUrl: "", spriteSheetUrl: attachment.url });
      setStatus({ kind: "success", text: t("pets.spriteSheetUploaded") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.assetUploadFailed")}: ${String(error)}` });
    } finally {
      setUploadingAsset(false);
      if (spriteSheetFileRef.current) spriteSheetFileRef.current.value = "";
    }
  }

  function updatePreset(kind: "action" | "emotion", index: number, patch: Partial<DesktopPetStatePreset>) {
    if (!draft) return;
    const key = kind === "action" ? "actions" : "emotions";
    const next = draft[key].map((preset, itemIndex) => itemIndex === index ? { ...preset, ...patch } : preset);
    setDraft({ ...draft, [key]: next });
  }

  function addPreset(kind: "action" | "emotion") {
    if (!draft) return;
    const key = kind === "action" ? "actions" : "emotions";
    const nextId = kind === "action" ? `action${draft.actions.length + 1}` : `emotion${draft.emotions.length + 1}`;
    setDraft({
      ...draft,
      [key]: [
        ...draft[key],
        { id: nextId, label: nextId, animation: "idle", codexState: "idle", assetUrl: "", soundUrl: "" }
      ]
    });
  }

  function removePreset(kind: "action" | "emotion", index: number) {
    if (!draft) return;
    const key = kind === "action" ? "actions" : "emotions";
    const fallback = kind === "action" ? FALLBACK_ACTIONS : FALLBACK_EMOTIONS;
    const next = draft[key].filter((_, itemIndex) => itemIndex !== index);
    setDraft({ ...draft, [key]: next.length ? next : fallback });
  }

  function requestPresetUpload(kind: "action" | "emotion", index: number, field: "assetUrl" | "soundUrl") {
    presetUploadTargetRef.current = { kind, index, field };
    if (presetAssetFileRef.current) {
      presetAssetFileRef.current.accept = field === "assetUrl" ? PET_ASSET_ACCEPT : PET_SOUND_ACCEPT;
    }
    presetAssetFileRef.current?.click();
  }

  async function uploadPresetFile(file: File | null | undefined) {
    const target = presetUploadTargetRef.current;
    if (!file || !target || !draft) return;
    setUploadingAsset(true);
    setStatus(null);
    try {
      const base64 = await readFileAsBase64(file);
      const attachment = await api.uploadFile(base64, file.name || "pet-state.png");
      const isAsset = target.field === "assetUrl";
      if (isAsset && attachment.type !== "image" && attachment.type !== "video") {
        setStatus({ kind: "error", text: t("pets.assetUploadImageOnly") });
        return;
      }
      if (!isAsset && attachment.type !== "audio") {
        setStatus({ kind: "error", text: t("pets.soundUploadAudioOnly") });
        return;
      }
      updatePreset(target.kind, target.index, { [target.field]: attachment.url });
      setStatus({ kind: "success", text: t("pets.assetUploaded") });
    } catch (error) {
      setStatus({ kind: "error", text: `${t("pets.assetUploadFailed")}: ${String(error)}` });
    } finally {
      setUploadingAsset(false);
      presetUploadTargetRef.current = null;
      if (presetAssetFileRef.current) presetAssetFileRef.current.value = "";
    }
  }

  function selectCharacter(character: CharacterDetail) {
    setSelectedId(character.id);
    setStatus(null);
  }

  const selectedPetMeta = selected ? getDesktopPetExtension(selected) : {};

  function renderRightPanelContent() {
    if (!draft) {
      return <EmptyState title={t("pets.noSelection")} description={t("pets.noSelectionDesc")} />;
    }

    if (rightView === "chats") {
      const activeChat = petChats.find((chat) => chat.id === activePetChatId) || petChats[0] || null;
      return (
        <div className="pet-editor-body flex min-h-0 flex-col gap-3">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void refreshPetChats()}
              disabled={!isElectron || petChatsLoading}
              className="char-editor-btn justify-center"
            >
              {petChatsLoading ? t("pets.loading") : t("pets.refreshChats")}
            </button>
            <button
              type="button"
              onClick={() => void createPetChat()}
              disabled={!isElectron}
              className="char-editor-btn is-primary justify-center"
            >
              + {t("pets.newChat")}
            </button>
          </div>
          {!isElectron ? (
            <EmptyState title={t("pets.desktopOnly")} description={t("pets.desktopUnavailable")} />
          ) : petChats.length === 0 ? (
            <EmptyState title={t("pets.noChats")} description={t("pets.noChatsDesc")} />
          ) : (
            <div className="grid min-h-0 gap-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {petChats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => void selectPetChat(chat.id)}
                    className={`max-w-[180px] flex-shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      activeChat?.id === chat.id
                        ? "border-accent bg-accent-subtle text-text-primary"
                        : "border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`}
                  >
                    <div className="truncate font-semibold">{chat.title || t("pets.newChatTitle")}</div>
                    <div className="mt-0.5 text-[10px] text-text-tertiary">
                      {chat.count} {t("pets.messagesCount")}
                      {activeChat?.id === chat.id ? ` · ${t("pets.mainChat")}` : ""}
                    </div>
                  </button>
                ))}
              </div>
              <div className="min-h-[320px] overflow-y-auto rounded-xl border border-border-subtle bg-bg-primary p-3">
                {activeChat?.messages.length ? (
                  <div className="grid gap-2">
                    {activeChat.messages.map((message, index) => (
                      <div
                        key={`${activeChat.id}-${message.createdAt}-${index}`}
                        className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
                          message.role === "assistant"
                            ? "border-accent-border bg-accent-subtle text-text-primary"
                            : "border-border-subtle bg-bg-secondary text-text-secondary"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                          <span>{message.role === "assistant" ? draft.name || t("chat.assistant") : t("chat.user")}</span>
                          <span>{new Date(message.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        {message.attachments?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.attachments.map((attachment, attachmentIndex) => (
                              <img
                                key={`${attachment.createdAt}-${attachmentIndex}`}
                                src={attachment.dataUrl}
                                alt={attachment.filename || t("chat.imageAttachment")}
                                className="h-20 w-28 rounded-md border border-border object-cover"
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={t("pets.emptyChat")} description={t("pets.emptyChatDesc")} />
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (rightView === "states") {
      return (
        <div className="pet-editor-body">
          {(["action", "emotion"] as const).map((kind) => (
            <PetStateEditor
              key={kind}
              title={kind === "action" ? t("pets.actions") : t("pets.emotions")}
              presets={kind === "action" ? draft.actions : draft.emotions}
              animations={PET_ANIMATIONS}
              uploading={uploadingAsset}
              codexStateFor={(preset) => codexStateForPreset(preset.id, preset.animation)}
              onAdd={() => addPreset(kind)}
              onUpdate={(index, patch) => updatePreset(kind, index, patch)}
              onRemove={(index) => removePreset(kind, index)}
              onUpload={(index, field) => requestPresetUpload(kind, index, field)}
            />
          ))}
          <input ref={presetAssetFileRef} type="file" accept={PET_ASSET_ACCEPT} className="hidden"
            onChange={(event) => void uploadPresetFile(event.target.files?.[0])} />
        </div>
      );
    }

    if (rightView === "assistant") {
      return (
        <div className="pet-editor-body">
          <section className="char-editor-section">
            <div className="pet-section-heading">{t("pets.tabAssistant")}</div>
            <div className="char-editor-section-body">
              <label>
                <span className="char-editor-label">{t("pets.assistantInstructions")}</span>
                <textarea className="char-editor-textarea" rows={7} value={draft.assistantInstructions}
                  placeholder={t("pets.assistantInstructionsPlaceholder")}
                  onChange={(event) => setDraft({ ...draft, assistantInstructions: event.target.value })} />
              </label>
              <label>
                <span className="char-editor-label">{t("pets.persistentMemory")}</span>
                <textarea className="char-editor-textarea" rows={7} value={draft.persistentMemory}
                  placeholder={t("pets.persistentMemoryPlaceholder")}
                  onChange={(event) => setDraft({ ...draft, persistentMemory: event.target.value.slice(0, 6000) })} />
              </label>
              <label className="pet-inline-field">
                <span className="char-editor-label">{t("pets.contextTokenLimit")}</span>
                <input className="char-editor-input" type="number" min={800} max={16000} step={200} value={draft.chatContextTokenLimit}
                  onChange={(event) => setDraft({ ...draft, chatContextTokenLimit: Math.max(800, Math.min(16000, Math.round(Number(event.target.value) || 2400))) })} />
                <small>{t("pets.contextTokenLimitDesc")}</small>
              </label>
            </div>
          </section>
          <section className="char-editor-section">
            <div className="pet-section-heading">{t("pets.behavior")}</div>
            <div className="char-editor-section-body">
              {([["autonomyEnabled", "pets.autonomy", "pets.autonomyDesc"], ["ttsEnabled", "pets.tts", "pets.ttsDesc"]] as const).map(([field, label, desc]) => (
                <label key={field} className="pet-toggle-row">
                  <input type="checkbox" checked={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.checked })} />
                  <span><strong>{t(label)}</strong><small>{t(desc)}</small></span>
                </label>
              ))}
            </div>
          </section>
        </div>
      );
    }

    if (rightView === "profile") {
      const field = (key: "name" | "description" | "greeting" | "personality" | "scenario" | "systemPrompt", rows?: number) => (
        <label key={key}>
          <span className="char-editor-label">{t(`pets.${key}` as const)}</span>
          {rows ? (
            <textarea className="char-editor-textarea" rows={rows} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
          ) : (
            <input className="char-editor-input" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value.slice(0, 80) })} />
          )}
        </label>
      );
      return (
        <div className="pet-editor-body">
          <section className="char-editor-section">
            <div className="pet-section-heading">{t("pets.identity")}</div>
            <div className="char-editor-section-body">{field("name")}{field("description", 3)}{field("greeting", 3)}</div>
          </section>
          <section className="char-editor-section">
            <div className="pet-section-heading">{t("pets.behavior")}</div>
            <div className="char-editor-section-body">{field("personality", 5)}{field("scenario", 4)}{field("systemPrompt", 4)}</div>
          </section>
          <p className="characters-preview-description">{t("pets.editorHint")}</p>
        </div>
      );
    }

    return (
      <>
        <PetAppearancePanel
          name={draft.name}
          spriteUrl={draft.spriteUrl}
          spriteSheetUrl={draft.spriteSheetUrl}
          uploading={uploadingAsset}
          onUploadAsset={() => assetFileRef.current?.click()}
          onUploadSheet={() => spriteSheetFileRef.current?.click()}
          onClearAsset={() => setDraft({ ...draft, spriteUrl: "" })}
          onClearSheet={() => setDraft({ ...draft, spriteSheetUrl: "" })}
          onSpriteUrl={(value) => setDraft({ ...draft, spriteUrl: value, spriteSheetUrl: "" })}
          onSpriteSheetUrl={(value) => setDraft({ ...draft, spriteSheetUrl: value })}
        />
        <input ref={assetFileRef} type="file" accept={PET_ASSET_ACCEPT} className="hidden"
          onChange={(event) => void uploadPetAsset(event.target.files?.[0])} />
        <input ref={spriteSheetFileRef} type="file" accept={PET_CODEX_SPRITESHEET_ACCEPT} className="hidden"
          onChange={(event) => void uploadCodexSpriteSheet(event.target.files?.[0])} />
      </>
    );
  }

  return (
    <ThreePanelLayout
      className="pets-workspace"
      leftClassName="pets-library-panel"
      centerClassName="pets-editor-panel characters-editor-panel"
            rightClassName="characters-inspector-panel"
      mobileTabs={{ left: t("pets.library"), center: t("mobilePane.editor"), right: t("pets.desktop"), ariaLabel: t("pets.title") }}
      mobileSelectionKey={selectedId}
      left={(
        <>
          <PanelTitle
            action={(
              <div className="pets-library-actions">
                <button
                  type="button"
                  onClick={() => importPetFileRef.current?.click()}
                  disabled={creating}
                  className="pets-toolbar-button"
                  aria-label={t("pets.importPet")}
                  title={t("pets.importPet")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2h14v-2" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => importPetFolderRef.current?.click()}
                  disabled={creating}
                  className="pets-toolbar-button"
                  aria-label={t("pets.importFolder")}
                  title={t("pets.importFolder")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 12v5m0 0 2-2m-2 2-2-2" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => void createPet()}
                  disabled={creating}
                  className="pets-toolbar-button is-primary"
                >
                  + {t("pets.newPet")}
                </button>
                <input
                  ref={importPetFileRef}
                  type="file"
                  accept="application/json,.json,image/webp,image/png,.webp,.png"
                  multiple
                  className="hidden"
                  onChange={(event) => void importPetFromFiles(event.target.files)}
                />
                <input
                  ref={importPetFolderRef}
                  type="file"
                  accept="application/json,.json,image/webp,image/png,.webp,.png"
                  multiple
                  className="hidden"
                  onChange={(event) => void importPetFromFiles(event.target.files)}
                />
              </div>
            )}
          >
            {t("pets.library")}
          </PanelTitle>

          <div className="mb-3 flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
            <span>{characters.length} {t("pets.countSuffix")}</span>
            <span>{t("pets.allCharacters")}</span>
          </div>

          <div className="list-animate flex-1 space-y-1.5 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-text-tertiary">{t("pets.loading")}</div>
            ) : sortedCharacters.length === 0 ? (
              <EmptyState
                title={t("pets.noPets")}
                description={t("pets.noPetsDesc")}
                action={(
                  <button
                    type="button"
                    onClick={() => void createPet()}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
                  >
                    {t("pets.newPet")}
                  </button>
                )}
              />
            ) : (
              sortedCharacters.map((character) => {
                const isActive = activeConfig.characterId === character.id;
                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() => selectCharacter(character)}
                    className={`pets-library-item float-card ${
                      selectedId === character.id
                        ? "is-active"
                        : ""
                    }`}
                  >
                    <AvatarBadge
                      name={character.name}
                      src={character.avatarUrl}
                      className="h-9 w-9 flex-shrink-0 rounded-full"
                      fallbackClassName="bg-accent-subtle text-xs font-bold text-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{character.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {hasPetTag(character) ? <Badge variant="accent">{t("pets.petTag")}</Badge> : null}
                        {isActive ? <Badge variant="success">{t("pets.active")}</Badge> : null}
                        {character.tags.filter((tag) => tag.toLowerCase() !== PET_TAG).slice(0, 2).map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
      center={(
        selected && draft ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="char-editor-header mb-4">
              <div className="char-editor-header-top">
                <PetAssetPreview name={draft.name || selected.name} src={draft.spriteUrl || selected.avatarUrl}
                  spriteSheetUrl={draft.spriteSheetUrl} className="h-14 w-14 flex-shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-base font-semibold text-text-primary">{draft.name || t("pets.unnamed")}</div>
                    {hasPetTag(selected) ? <Badge variant="accent">{t("pets.petTag")}</Badge> : null}
                    {petOnDesktop ? <Badge variant="success">{t("pets.onDesktopNow")}</Badge> : null}
                  </div>
                  {status ? (
                    <div className={`mt-0.5 text-[11px] ${status.kind === "error" ? "text-danger" : "text-success"}`}>{status.text}</div>
                  ) : (
                    <div className="mt-0.5 truncate text-[11px] text-text-tertiary">{draft.description || t("pets.editorHint")}</div>
                  )}
                </div>
              </div>
              <div className="char-editor-actions">
                <button type="button" onClick={() => void savePet()} disabled={saving} className="char-editor-btn is-primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h12l2 2v14H5V4zm3 0v6h8V4M8 20v-6h8v6" /></svg>
                  {saving ? t("welcome.saving") : t("chat.save")}
                </button>
                <button type="button" onClick={() => void exportPet()} disabled={saving} className="char-editor-btn">{t("pets.exportPet")}</button>
              </div>
            </div>
            <div className="char-editor-tabs" role="tablist" aria-label={t("pets.title")}>
              {(["profile", "asset", "states", "assistant", "chats"] as const).map((view) => (
                <button key={view} type="button" role="tab" aria-selected={rightView === view}
                  className={rightView === view ? "is-active" : ""} onClick={() => setRightView(view)}>
                  {t(PET_TAB_LABELS[view])}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1" role="tabpanel">
              {renderRightPanelContent()}
            </div>
          </div>
        ) : (
          <EmptyState title={t("pets.noSelection")} description={t("pets.noSelectionDesc")} />
        )
      )}
      right={selected && draft ? (
        <PetDesktopPanel
          name={draft.name || selected.name}
          src={draft.spriteUrl || selected.avatarUrl}
          spriteSheetUrl={draft.spriteSheetUrl}
          bubble={draft.greeting || t("pets.previewLine")}
          scale={draft.scale || 1}
          voice={draft.voice}
          onDesktop={petOnDesktop}
          isElectron={isElectron}
          busy={saving || visibilityBusy}
          onScale={(scale) => setDraft({ ...draft, scale })}
          onVoice={(voice) => setDraft({ ...draft, voice })}
          onShow={() => void showPet()}
          onHide={() => void hidePet()}
        />
      ) : <EmptyState title={t("pets.noSelection")} description={t("pets.noSelectionDesc")} />}
    />
  );
}
