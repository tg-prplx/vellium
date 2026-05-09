import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import { Badge, EmptyState, PanelTitle, ThreePanelLayout } from "../../components/Panels";
import { api } from "../../shared/api";
import { buildFilenameBase, triggerBlobDownload } from "../../shared/download";
import { useI18n } from "../../shared/i18n";
import type { CharacterDetail } from "../../shared/types/contracts";
import {
  buildDesktopPetConfigFromCharacter,
  CODEX_PET_STATES,
  getDesktopPetExtension,
  mergeDesktopPetExtension,
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
  autonomyEnabled: boolean;
  actions: DesktopPetStatePreset[];
  emotions: DesktopPetStatePreset[];
  assistantInstructions: string;
};

type PresetUploadTarget = {
  kind: "action" | "emotion";
  index: number;
  field: "assetUrl" | "soundUrl";
} | null;

type PetPanelView = "asset" | "states" | "assistant";
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

function isPetVideoAsset(url: string | null | undefined) {
  const value = String(url || "").trim();
  return /^data:video\//i.test(value) || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
}

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
          autonomyEnabled: false,
          actions: FALLBACK_ACTIONS.map(codexPreset),
          emotions: FALLBACK_EMOTIONS.map(codexPreset),
          assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help."
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
          autonomyEnabled: false,
          actions: FALLBACK_ACTIONS.map(codexPreset),
          emotions: FALLBACK_EMOTIONS.map(codexPreset),
          assistantInstructions: "Act like a compact personal desktop assistant: be warm, practical, brief, and proactive when the user asks for help."
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
    autonomyEnabled: config.autonomyEnabled,
    actions: config.actions,
    emotions: config.emotions,
    assistantInstructions: config.assistantInstructions
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
    autonomyEnabled: draft.autonomyEnabled,
    actions: normalizePresetDraft(draft.actions, FALLBACK_ACTIONS),
    emotions: normalizePresetDraft(draft.emotions, FALLBACK_EMOTIONS),
    assistantInstructions: draft.assistantInstructions,
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

function PetAssetPreview({
  name,
  src,
  spriteSheetUrl,
  className,
  fallbackClassName
}: {
  name: string;
  src?: string | null;
  spriteSheetUrl?: string | null;
  className: string;
  fallbackClassName: string;
}) {
  if (spriteSheetUrl) {
    return (
      <div
        aria-label={name}
        className={`${className} bg-contain bg-no-repeat`}
        style={{
          backgroundImage: `url("${spriteSheetUrl}")`,
          backgroundSize: "800% 900%",
          backgroundPosition: "0 0"
        }}
      />
    );
  }

  if (isPetVideoAsset(src)) {
    return (
      <video
        src={src || undefined}
        className={`${className} object-cover`}
        muted
        loop
        autoPlay
        playsInline
      />
    );
  }

  return (
    <AvatarBadge
      name={name}
      src={src}
      className={className}
      fallbackClassName={fallbackClassName}
    />
  );
}

export function PetsScreen() {
  const { t } = useI18n();
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
  const [rightView, setRightView] = useState<PetPanelView>("asset");
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const isElectron = Boolean(window.electronAPI?.showDesktopPet);

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
      return;
    }
    setDraft(draftFromCharacter(selected, activeConfig.characterId === selected.id ? activeConfig : undefined));
  }, [activeConfig, selected]);

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
          autonomyEnabled: draft.autonomyEnabled,
          actions: normalizePresetDraft(draft.actions, FALLBACK_ACTIONS),
          emotions: normalizePresetDraft(draft.emotions, FALLBACK_EMOTIONS),
          assistantInstructions: draft.assistantInstructions
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
    if (!selected || !draft || !isElectron) return;
    const updated = await savePet();
    if (!updated) return;
    const nextConfig = petConfigFromDraft(updated, draft);
    const result = await window.electronAPI!.showDesktopPet(nextConfig);
    setVisible(result.visible);
  }

  async function hidePet() {
    if (!isElectron) return;
    const result = await window.electronAPI!.hideDesktopPet();
    setVisible(result.visible);
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

  function renderPresetEditor(kind: "action" | "emotion", presets: DesktopPetStatePreset[]) {
    return (
      <div className="pets-state-editor">
        <div className="pets-state-editor-head">
          <div className="pets-section-title">{kind === "action" ? t("pets.actions") : t("pets.emotions")}</div>
          <button
            type="button"
            onClick={() => addPreset(kind)}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            + {t("pets.addState")}
          </button>
        </div>
        <div className="grid gap-2">
          {presets.map((preset, index) => (
            <div key={`${kind}-${index}`} className="pets-state-row">
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <label className="pets-field">
                  <span>{t("pets.stateId")}</span>
                  <input value={preset.id} onChange={(event) => updatePreset(kind, index, { id: event.target.value })} />
                </label>
                <label className="pets-field">
                  <span>{t("pets.stateLabel")}</span>
                  <input value={preset.label} onChange={(event) => updatePreset(kind, index, { label: event.target.value })} />
                </label>
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <label className="pets-field">
                  <span>{t("pets.animation")}</span>
                  <select
                    value={preset.animation}
                    onChange={(event) => updatePreset(kind, index, { animation: normalizeDesktopPetAnimation(event.target.value) })}
                  >
                    {PET_ANIMATIONS.map((animation) => (
                      <option key={animation} value={animation}>{animation === "none" ? t("pets.animationNone") : animation}</option>
                    ))}
                  </select>
                </label>
                <label className="pets-field">
                  <span>{t("pets.codexState")}</span>
                  <select
                    value={preset.codexState || codexStateForPreset(preset.id, preset.animation)}
                    onChange={(event) => updatePreset(kind, index, { codexState: normalizeDesktopPetCodexState(event.target.value) })}
                  >
                    {CODEX_PET_STATES.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removePreset(kind, index)}
                  className="self-end rounded-lg border border-border px-2 py-2 text-xs font-semibold text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                >
                  {t("common.delete")}
                </button>
              </div>
              <label className="pets-field">
                <span>{t("pets.stateAsset")}</span>
                <input
                  value={preset.assetUrl}
                  placeholder={t("pets.stateAssetPlaceholder")}
                  onChange={(event) => updatePreset(kind, index, { assetUrl: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => requestPresetUpload(kind, index, "assetUrl")}
                  disabled={uploadingAsset}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingAsset ? t("pets.assetUploading") : t("pets.uploadAsset")}
                </button>
                <button
                  type="button"
                  onClick={() => updatePreset(kind, index, { assetUrl: "" })}
                  disabled={!preset.assetUrl}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("pets.clearAsset")}
                </button>
              </div>
              <label className="pets-field">
                <span>{t("pets.stateSound")}</span>
                <input
                  value={preset.soundUrl || ""}
                  placeholder={t("pets.stateSoundPlaceholder")}
                  onChange={(event) => updatePreset(kind, index, { soundUrl: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => requestPresetUpload(kind, index, "soundUrl")}
                  disabled={uploadingAsset}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingAsset ? t("pets.assetUploading") : t("pets.uploadSound")}
                </button>
                <button
                  type="button"
                  onClick={() => updatePreset(kind, index, { soundUrl: "" })}
                  disabled={!preset.soundUrl}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("pets.clearSound")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderRightPanelContent() {
    if (!draft) {
      return <EmptyState title={t("pets.noSelection")} description={t("pets.noSelectionDesc")} />;
    }

    if (rightView === "states") {
      return (
        <div className="grid gap-4">
          {renderPresetEditor("action", draft.actions)}
          {renderPresetEditor("emotion", draft.emotions)}
          <input
            ref={presetAssetFileRef}
            type="file"
            accept={PET_ASSET_ACCEPT}
            className="hidden"
            onChange={(event) => void uploadPresetFile(event.target.files?.[0])}
          />
        </div>
      );
    }

    if (rightView === "assistant") {
      return (
        <div className="grid gap-3">
          <label className="pets-field">
            <span>{t("pets.assistantInstructions")}</span>
            <textarea
              rows={8}
              value={draft.assistantInstructions}
              placeholder={t("pets.assistantInstructionsPlaceholder")}
              onChange={(event) => setDraft({ ...draft, assistantInstructions: event.target.value })}
            />
          </label>
          <label className="pets-toggle-row">
            <input
              type="checkbox"
              checked={draft.autonomyEnabled}
              onChange={(event) => setDraft({ ...draft, autonomyEnabled: event.target.checked })}
            />
            <span>
              <strong>{t("pets.autonomy")}</strong>
              <small>{t("pets.autonomyDesc")}</small>
            </span>
          </label>
          <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs leading-5 text-text-tertiary">
            {isElectron ? t("pets.desktopHint") : t("pets.desktopUnavailable")}
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        <label className="pets-field">
          <span>{t("pets.petAsset")}</span>
          <input
            value={draft.spriteUrl}
            placeholder={t("pets.petAssetPlaceholder")}
            onChange={(event) => setDraft({ ...draft, spriteUrl: event.target.value.slice(0, 4000), spriteSheetUrl: "" })}
          />
        </label>
        <label className="pets-field">
          <span>{t("pets.spriteSheet")}</span>
          <input
            value={draft.spriteSheetUrl}
            placeholder={t("pets.spriteSheetPlaceholder")}
            onChange={(event) => setDraft({ ...draft, spriteSheetUrl: event.target.value.slice(0, 4000) })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => assetFileRef.current?.click()}
            disabled={uploadingAsset}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadingAsset ? t("pets.assetUploading") : t("pets.uploadAsset")}
          </button>
          <button
            type="button"
            onClick={() => spriteSheetFileRef.current?.click()}
            disabled={uploadingAsset}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadingAsset ? t("pets.assetUploading") : t("pets.uploadSpriteSheet")}
          </button>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, spriteUrl: "", spriteSheetUrl: "" })}
            disabled={!draft.spriteUrl && !draft.spriteSheetUrl}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("pets.clearAsset")}
          </button>
          <input
            ref={assetFileRef}
            type="file"
            accept={PET_ASSET_ACCEPT}
            className="hidden"
            onChange={(event) => void uploadPetAsset(event.target.files?.[0])}
          />
          <input
            ref={spriteSheetFileRef}
            type="file"
            accept={PET_CODEX_SPRITESHEET_ACCEPT}
            className="hidden"
            onChange={(event) => void uploadCodexSpriteSheet(event.target.files?.[0])}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="pets-field">
            <span>{t("pets.voice")}</span>
            <select
              value={draft.voice}
              onChange={(event) => setDraft({ ...draft, voice: event.target.value as DesktopPetVoice })}
            >
              <option value="soft">{t("pets.voiceSoft")}</option>
              <option value="playful">{t("pets.voicePlayful")}</option>
              <option value="quiet">{t("pets.voiceQuiet")}</option>
            </select>
          </label>
          <label className="pets-field">
            <span>{t("pets.size")}</span>
            <input
              type="range"
              min={0.75}
              max={1.35}
              step={0.05}
              value={draft.scale || selectedPetMeta.scale || 1}
              onChange={(event) => setDraft({ ...draft, scale: Number(event.target.value) })}
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <ThreePanelLayout
      threeColumnLayoutClassName="xl:grid-cols-[300px_minmax(520px,1fr)_340px]"
      left={(
        <>
          <PanelTitle
            action={(
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => importPetFileRef.current?.click()}
                  disabled={creating}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("pets.importPet")}
                </button>
                <button
                  type="button"
                  onClick={() => importPetFolderRef.current?.click()}
                  disabled={creating}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("pets.importFolder")}
                </button>
                <button
                  type="button"
                  onClick={() => void createPet()}
                  disabled={creating}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
                    className={`float-card flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                      selectedId === character.id
                        ? "bg-accent-subtle text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover"
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
            <div className="mb-4 flex items-start gap-4 border-b border-border-subtle pb-4">
              <PetAssetPreview
                name={draft.name || selected.name}
                src={draft.spriteUrl || selected.avatarUrl}
                spriteSheetUrl={draft.spriteSheetUrl}
                className="h-16 w-16 flex-shrink-0 rounded-2xl ring-1 ring-border"
                fallbackClassName="bg-accent-subtle text-xl font-bold text-accent"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-text-primary">{draft.name || t("pets.unnamed")}</h2>
                  <Badge variant={hasPetTag(selected) ? "accent" : "default"}>{hasPetTag(selected) ? t("pets.petTag") : t("pets.useCharacter")}</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-text-tertiary">{t("pets.editorHint")}</p>
                {status ? (
                  <div className={`mt-2 text-xs ${status.kind === "error" ? "text-danger" : "text-success"}`}>
                    {status.text}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-4">
                <section className="pets-editor-section">
                  <div className="pets-section-title">{t("pets.identity")}</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="pets-field md:col-span-2">
                      <span>{t("pets.name")}</span>
                      <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 80) })} />
                    </label>
                    <label className="pets-field md:col-span-2">
                      <span>{t("pets.description")}</span>
                      <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} />
                    </label>
                    <label className="pets-field md:col-span-2">
                      <span>{t("pets.greeting")}</span>
                      <textarea value={draft.greeting} onChange={(event) => setDraft({ ...draft, greeting: event.target.value })} rows={3} />
                    </label>
                  </div>
                </section>

                <section className="pets-editor-section">
                  <div className="pets-section-title">{t("pets.behavior")}</div>
                  <div className="grid gap-3">
                    <label className="pets-field">
                      <span>{t("pets.personality")}</span>
                      <textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} rows={5} />
                    </label>
                    <label className="pets-field">
                      <span>{t("pets.scenario")}</span>
                      <textarea value={draft.scenario} onChange={(event) => setDraft({ ...draft, scenario: event.target.value })} rows={4} />
                    </label>
                    <label className="pets-field">
                      <span>{t("pets.systemPrompt")}</span>
                      <textarea value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} rows={4} />
                    </label>
                  </div>
                </section>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => void savePet()}
                disabled={saving}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t("welcome.saving") : t("pets.saveProfile")}
              </button>
              <button
                type="button"
                onClick={() => void exportPet()}
                disabled={saving}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("pets.exportPet")}
              </button>
              <button
                type="button"
                onClick={() => void showPet()}
                disabled={!isElectron || saving}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("pets.showOnDesktop")}
              </button>
            </div>
          </div>
        ) : (
          <EmptyState title={t("pets.noSelection")} description={t("pets.noSelectionDesc")} />
        )
      )}
      right={(
        <div className="flex h-full min-h-0 flex-col">
          <PanelTitle>{t("pets.desktop")}</PanelTitle>
          <div className="pets-preview pets-preview-compact">
            <div className="pets-preview-bubble">
              {draft?.greeting || activeConfig.greeting || t("pets.previewLine")}
            </div>
            <div className="pets-preview-stage">
              <PetAssetPreview
                name={draft?.name || activeConfig.name}
                src={draft?.spriteUrl || activeCharacter?.avatarUrl}
                spriteSheetUrl={draft?.spriteSheetUrl || activeConfig.spriteSheetUrl}
                className="pets-preview-avatar"
                fallbackClassName="pets-preview-fallback"
              />
            </div>
          </div>

          <div className="pets-config-tabs" role="tablist" aria-label={t("pets.desktop")}>
            {(["asset", "states", "assistant"] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={rightView === view}
                className={rightView === view ? "is-active" : ""}
                onClick={() => setRightView(view)}
              >
                {view === "asset" ? t("pets.tabAsset") : view === "states" ? t("pets.tabStates") : t("pets.tabAssistant")}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {renderRightPanelContent()}
          </div>

          <div className="mt-3 grid gap-2 border-t border-border-subtle pt-3">
            <button
              type="button"
              onClick={() => void showPet()}
              disabled={!selected || !draft || !isElectron}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {visible ? t("pets.applyToDesktop") : t("pets.showOnDesktop")}
            </button>
            <button
              type="button"
              onClick={() => void hidePet()}
              disabled={!isElectron || !visible}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("pets.hideFromDesktop")}
            </button>
          </div>
        </div>
      )}
    />
  );
}
