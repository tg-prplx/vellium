import type { ApiParamPolicy, AppSettings, PromptBlock } from "../../shared/types/contracts";

export type SettingsCategory = "connection" | "backends" | "interface" | "generation" | "context" | "prompts" | "tools";

export interface SettingsSectionLink {
  id: string;
  label: string;
}

export interface SettingsCategoryNavItem {
  id: SettingsCategory;
  label: string;
  icon: string;
}

export const DEFAULT_API_PARAM_POLICY: ApiParamPolicy = {
  openai: {
    sendSampler: true,
    temperature: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
    maxTokens: true,
    stop: true
  },
  kobold: {
    sendSampler: true,
    memory: true,
    maxTokens: true,
    temperature: true,
    topP: true,
    topK: true,
    topA: true,
    minP: true,
    typical: true,
    tfs: true,
    nSigma: true,
    repetitionPenalty: true,
    repetitionPenaltyRange: true,
    repetitionPenaltySlope: true,
    samplerOrder: true,
    stop: true,
    phraseBans: true,
    useDefaultBadwords: true
  }
};

export const DEFAULT_SCENE_FIELD_VISIBILITY: AppSettings["sceneFieldVisibility"] = {
  dialogueStyle: true,
  initiative: true,
  descriptiveness: true,
  unpredictability: true,
  emotionalDepth: true
};

export const DEFAULT_PROMPT_STACK: PromptBlock[] = [
  { id: "default-1", kind: "system", enabled: true, order: 1, content: "" },
  { id: "default-2", kind: "jailbreak", enabled: true, order: 2, content: "Never break character. Write as the character would, staying true to their personality." },
  { id: "default-3", kind: "character", enabled: true, order: 3, content: "" },
  { id: "default-4", kind: "author_note", enabled: true, order: 4, content: "" },
  { id: "default-5", kind: "lore", enabled: false, order: 5, content: "" },
  { id: "default-6", kind: "scene", enabled: true, order: 6, content: "" },
  { id: "default-7", kind: "history", enabled: true, order: 7, content: "" }
];

export const PROMPT_STACK_COLORS: Record<PromptBlock["kind"], string> = {
  system: "border-blue-500/30 bg-blue-500/8",
  jailbreak: "border-red-500/30 bg-red-500/8",
  character: "border-purple-500/30 bg-purple-500/8",
  author_note: "border-amber-500/30 bg-amber-500/8",
  lore: "border-emerald-500/30 bg-emerald-500/8",
  scene: "border-cyan-500/30 bg-cyan-500/8",
  history: "border-slate-500/30 bg-slate-500/8"
};

export function buildSettingsNavigation(t: (key: any) => string) {
  const categoryNav: SettingsCategoryNavItem[] = [
    { id: "connection", label: t("settings.categoryConnection"), icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
    { id: "backends", label: t("settings.categoryBackends"), icon: "M4 7h16M4 12h16M4 17h16M8 4v16m8-16v16" },
    { id: "interface", label: t("settings.categoryInterface"), icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "generation", label: t("settings.categoryGeneration"), icon: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" },
    { id: "context", label: t("settings.categoryContext"), icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
    { id: "prompts", label: t("settings.categoryPrompts"), icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { id: "tools", label: t("settings.categoryTools"), icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }
  ];

  const categorySections: Record<SettingsCategory, SettingsSectionLink[]> = {
    connection: [
      { id: "settings-quick-presets", label: t("settings.quickPresets") },
      { id: "settings-manual-provider", label: t("settings.manualConfig") },
      { id: "settings-runtime-mode", label: t("settings.runtimeMode") },
      { id: "settings-active-model", label: t("settings.activeModel") },
      { id: "settings-translation-model", label: t("settings.translateModel") },
      { id: "settings-compress-model", label: t("settings.compressModel") },
      { id: "settings-tts", label: t("settings.tts") }
    ],
    backends: [
      { id: "settings-managed-backends", label: t("settings.managedBackends") }
    ],
    interface: [
      { id: "settings-general", label: t("settings.general") },
      { id: "settings-workspace-mode", label: t("settings.workspaceMode") }
    ],
    generation: [
      { id: "settings-output-behaviour", label: t("settings.outputBehaviour") },
      { id: "settings-sampler-defaults", label: t("settings.samplerDefaults") },
      { id: "settings-api-param-forwarding", label: t("settings.apiParamForwarding") }
    ],
    context: [
      { id: "settings-context-window", label: t("settings.contextWindow") },
      { id: "settings-chat-behaviour", label: t("settings.conversationBehaviour") },
      { id: "settings-scene-fields", label: t("settings.sceneFields") },
      { id: "settings-rag-model", label: t("settings.ragModel") },
      { id: "settings-rag-reranker", label: t("settings.ragReranker") },
      { id: "settings-rag-retrieval", label: t("settings.ragRetrieval") }
    ],
    prompts: [
      { id: "settings-prompt-templates", label: t("settings.promptTemplates") },
      { id: "settings-prompt-stack", label: t("inspector.promptStack") },
      { id: "settings-default-system-prompts", label: t("settings.defaultSysPrompt") }
    ],
    tools: [
      { id: "settings-tools-core", label: t("settings.tools") },
      { id: "settings-security", label: t("settings.security") },
      { id: "settings-plugins", label: t("settings.plugins") },
      { id: "settings-tools-mcp-functions", label: t("settings.mcpFunctions") },
      { id: "settings-tools-mcp", label: t("settings.mcpServers") },
      { id: "settings-danger-zone", label: t("settings.dangerZone") }
    ]
  };

  return { categoryNav, categorySections };
}
