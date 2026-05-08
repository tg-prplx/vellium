export type Id = string;

export type CensorshipMode = "Filtered" | "Unfiltered";

export interface ProviderProfile {
  id: Id;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  proxyUrl?: string | null;
  fullLocalOnly: boolean;
  providerType?: "openai" | "koboldcpp" | "custom";
  adapterId?: string | null;
  manualModels?: string[];
}

export type ManagedBackendKind = "koboldcpp" | "ollama" | "generic";
export type ManagedBackendStatusMode = "auto" | "api" | "stdout" | "none";
export type ManagedBackendRuntimeStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ManagedBackendKoboldOptions {
  executable: string;
  modelPath: string;
  host: string;
  port: number;
  contextSize: number;
  gpuLayers: number;
  threads: number;
  blasThreads: number;
  batchSize: number;
  highPriority: boolean;
  smartContext: boolean;
  useMmap: boolean;
  flashAttention: boolean;
  noMmap: boolean;
  noKvOffload: boolean;
}

export interface ManagedBackendOllamaOptions {
  executable: string;
  host: string;
  port: number;
}

export interface ManagedBackendConfig {
  id: string;
  name: string;
  enabled: boolean;
  providerId: string;
  providerType: "openai" | "koboldcpp" | "custom";
  adapterId?: string | null;
  backendKind: ManagedBackendKind;
  baseUrl: string;
  commandOverride?: string;
  extraArgs: string;
  workingDirectory?: string;
  envText?: string;
  defaultModel?: string | null;
  autoStopOnSwitch: boolean;
  statusMode: ManagedBackendStatusMode;
  healthPath?: string;
  modelsPath?: string;
  statusPath?: string;
  statusTextPath?: string;
  statusProgressPath?: string;
  stdoutProgressRegex?: string;
  koboldcpp?: ManagedBackendKoboldOptions;
  ollama?: ManagedBackendOllamaOptions;
}

export interface ManagedBackendRuntimeState {
  backendId: string;
  status: ManagedBackendRuntimeStatus;
  pid: number | null;
  baseUrl: string;
  commandPreview: string;
  progress: number | null;
  progressLabel: string;
  models: string[];
  startedAt: string | null;
  lastError: string | null;
}

export interface ManagedBackendLogEntry {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  timestamp: string;
}

export interface ProviderModel {
  id: string;
  label?: string;
  managedBackendId?: string | null;
  managedBackendKind?: ManagedBackendKind | null;
  runtimeStatus?: ManagedBackendRuntimeStatus | null;
  placeholder?: boolean;
}

export interface SamplerConfig {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxTokens: number;
  stop: string[];
  topK?: number;
  topA?: number;
  minP?: number;
  typical?: number;
  tfs?: number;
  nSigma?: number;
  repetitionPenalty?: number;
  repetitionPenaltyRange?: number;
  repetitionPenaltySlope?: number;
  samplerOrder?: number[];
  koboldMemory?: string;
  koboldBannedPhrases?: string[];
  koboldUseDefaultBadwords?: boolean;
}

export interface OpenAiApiParamPolicy {
  sendSampler: boolean;
  temperature: boolean;
  topP: boolean;
  frequencyPenalty: boolean;
  presencePenalty: boolean;
  maxTokens: boolean;
  stop: boolean;
}

export interface KoboldApiParamPolicy {
  sendSampler: boolean;
  memory: boolean;
  maxTokens: boolean;
  temperature: boolean;
  topP: boolean;
  topK: boolean;
  topA: boolean;
  minP: boolean;
  typical: boolean;
  tfs: boolean;
  nSigma: boolean;
  repetitionPenalty: boolean;
  repetitionPenaltyRange: boolean;
  repetitionPenaltySlope: boolean;
  samplerOrder: boolean;
  stop: boolean;
  phraseBans: boolean;
  useDefaultBadwords: boolean;
}

export interface ApiParamPolicy {
  openai: OpenAiApiParamPolicy;
  kobold: KoboldApiParamPolicy;
}

export interface PromptBlock {
  id: Id;
  kind: "system" | "jailbreak" | "character" | "author_note" | "lore" | "scene" | "history";
  enabled: boolean;
  order: number;
  content: string;
}

export interface ChatMessage {
  id: Id;
  chatId: Id;
  branchId: Id;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  createdAt: string;
  generationStartedAt?: string;
  generationCompletedAt?: string;
  generationDurationMs?: number;
  parentId?: Id | null;
  characterName?: string;
  attachments?: FileAttachment[];
  ragSources?: RagSource[];
}

export interface RagSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  preview: string;
}

export interface RagCollection {
  id: Id;
  name: string;
  description: string;
  scope: "global" | "chat" | "writer";
  createdAt: string;
  updatedAt: string;
}

export interface RagDocument {
  id: Id;
  collectionId: Id;
  title: string;
  sourceType: string;
  sourceId?: string | null;
  contentHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RagBinding {
  enabled: boolean;
  collectionIds: Id[];
  updatedAt: string | null;
}

export interface RagIngestResult {
  ok: boolean;
  documentId: Id;
  chunks: number;
  embedded: number;
  status: string;
}

export interface BranchNode {
  id: Id;
  chatId: Id;
  name: string;
  parentMessageId?: Id | null;
  createdAt: string;
}

export interface ChatSession {
  id: Id;
  title: string;
  characterId?: Id | null;
  characterIds?: Id[];
  lorebookId?: Id | null;
  lorebookIds?: Id[];
  autoConversation?: boolean;
  createdAt: string;
}

export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: string;
  data: Record<string, unknown>;
}

export interface RpSceneState {
  chatId: Id;
  variables: Record<string, string>;
  mood: string;
  pacing: "slow" | "balanced" | "fast";
  intensity: number;
  chatMode?: "rp" | "light_rp" | "pure_chat";
  pureChatMode?: boolean;
}

export interface RpPreset {
  id: Id;
  name: string;
  description: string;
  styleHints: string[];
}

export interface WriterStyleProfile {
  id: Id;
  name: string;
  tone: string;
  pov: string;
  constraints: string[];
}

export interface BookProject {
  id: Id;
  name: string;
  description: string;
  characterIds: Id[];
  notes?: WriterProjectNotes;
  createdAt: string;
}

export interface WriterProjectNotes {
  premise: string;
  styleGuide: string;
  characterNotes: string;
  worldRules: string;
  contextMode: "economy" | "balanced" | "rich";
  summary: string;
}

export interface WriterDocxImportResult {
  ok: boolean;
  chaptersCreated: number;
  scenesCreated: number;
  chapterTitles: string[];
}

export type WriterDocxParseMode = "auto" | "chapter_markers" | "heading_lines" | "single_book";

export interface WriterDocxImportBookResult extends WriterDocxImportResult {
  project: BookProject;
}

export interface WriterProjectSummaryResult {
  summary: string;
  cached: boolean;
  chapterCount: number;
}

export type WriterSummaryLensScope = "project" | "chapter" | "scene";

export interface WriterSummaryLens {
  id: Id;
  projectId: Id;
  name: string;
  scope: WriterSummaryLensScope;
  targetId: Id | null;
  prompt: string;
  output: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface WriterSummaryLensRunResult {
  lens: WriterSummaryLens;
  cached: boolean;
  sourceChars: number;
}

export interface WriterGenerateNextChapterResult {
  chapter: Chapter;
  scene: Scene;
}

export interface WriterChapterSettings {
  tone: string;
  pacing: "slow" | "balanced" | "fast";
  pov: "first_person" | "third_limited" | "third_omniscient";
  creativity: number;
  tension: number;
  detail: number;
  dialogue: number;
}

export interface WriterCharacterAdvancedOptions {
  name?: string;
  role?: string;
  personality?: string;
  scenario?: string;
  greetingStyle?: string;
  systemPrompt?: string;
  tags?: string;
  notes?: string;
}

export interface WriterCharacterGenerateRequest {
  description: string;
  mode?: "basic" | "advanced";
  advanced?: WriterCharacterAdvancedOptions;
}

export type WriterCharacterEditField =
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "greeting"
  | "systemPrompt"
  | "mesExample"
  | "creatorNotes"
  | "tags";

export interface WriterCharacterEditRequest {
  instruction: string;
  fields?: WriterCharacterEditField[];
}

export interface WriterCharacterEditResponse {
  character: CharacterDetail;
  changedFields: WriterCharacterEditField[];
}

export interface Chapter {
  id: Id;
  projectId: Id;
  title: string;
  position: number;
  settings: WriterChapterSettings;
  createdAt: string;
}

export interface Scene {
  id: Id;
  chapterId: Id;
  title: string;
  content: string;
  goals: string;
  conflicts: string;
  outcomes: string;
  createdAt: string;
}

export interface BeatNode {
  id: Id;
  projectId: Id;
  label: string;
  beatType: "setup" | "inciting" | "midpoint" | "climax" | "resolution";
  sequence: number;
}

export interface ConsistencyIssue {
  id: Id;
  projectId: Id;
  severity: "low" | "medium" | "high";
  category: "names" | "facts" | "timeline" | "pov";
  message: string;
}

export interface PromptTemplates {
  jailbreak: string;
  compressSummary: string;
  writerGenerate: string;
  writerExpand: string;
  writerRewrite: string;
  writerSummarize: string;
  creativeWriting: string;
}

export interface RpPresetConfig {
  id: string;
  name: string;
  description: string;
  mood: string;
  pacing: "slow" | "balanced" | "fast";
  intensity: number;
  dialogueStyle?: "teasing" | "playful" | "dominant" | "tender" | "formal" | "chaotic";
  initiative?: number;
  descriptiveness?: number;
  unpredictability?: number;
  emotionalDepth?: number;
  jailbreakOverride?: string;
}

export interface FileAttachment {
  id: string;
  filename: string;
  type: "image" | "text" | "video" | "audio";
  url: string;
  mimeType?: string;
  dataUrl?: string;
  content?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  cwd?: string;
  env: string;
  enabled: boolean;
  timeoutMs: number;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpDiscoveredTool {
  serverId: string;
  serverName: string;
  toolName: string;
  callName: string;
  description: string;
}

export interface McpServerTestResult {
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}

export interface McpImportResult {
  ok: boolean;
  servers: McpServerConfig[];
  sourceType: "url" | "json";
  error?: string;
}

export interface McpDiscoverResult {
  ok: boolean;
  tools: McpDiscoveredTool[];
  error?: string;
}

export interface SecuritySettings {
  sanitizeMarkdown: boolean;
  allowExternalLinks: boolean;
  allowRemoteImages: boolean;
  allowUnsafeUploads: boolean;
}

export interface CustomInspectorFieldOption {
  value: string;
  label: string;
}

export interface CustomInspectorField {
  id: Id;
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "range" | "toggle";
  section: "scene" | "context";
  enabled: boolean;
  helpText?: string;
  placeholder?: string;
  options?: CustomInspectorFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  order: number;
  defaultValue?: string;
  visibleInPureChat: boolean;
}

export interface CustomEndpointAdapterEndpoint {
  enabled: boolean;
  method: "GET" | "POST" | "PATCH";
  path: string;
  resultPath?: string;
  bodyTemplate?: unknown;
  headersTemplate?: Record<string, string>;
}

export interface CustomEndpointAdapter {
  id: Id;
  name: string;
  description: string;
  enabled: boolean;
  authMode: "none" | "bearer" | "header";
  authHeader: string;
  models?: CustomEndpointAdapterEndpoint;
  voices?: CustomEndpointAdapterEndpoint;
  test?: CustomEndpointAdapterEndpoint;
  chat: CustomEndpointAdapterEndpoint;
  tts?: CustomEndpointAdapterEndpoint;
}

export type PluginSlotId =
  | "chat.sidebar.bottom"
  | "chat.inspector.bottom"
  | "chat.composer.bottom"
  | "chat.message.bottom"
  | "writing.sidebar.bottom"
  | "writing.editor.bottom"
  | "settings.bottom";

export type PluginActionLocation =
  | "app.toolbar"
  | "chat.composer"
  | "chat.message"
  | "writing.toolbar"
  | "writing.editor";

export type PluginSettingsFieldType =
  | "text"
  | "textarea"
  | "toggle"
  | "select"
  | "number"
  | "range"
  | "secret";

export interface PluginSettingsFieldOption {
  value: string;
  label: string;
}

export interface PluginSettingsFieldContribution {
  id: string;
  key: string;
  label: string;
  type: PluginSettingsFieldType;
  description?: string;
  placeholder?: string;
  options?: PluginSettingsFieldOption[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  order: number;
  required: boolean;
}

export interface PluginThemeContribution {
  id: string;
  label: string;
  description?: string;
  base: "dark" | "light";
  order: number;
  variables: Record<string, string>;
}

export interface PluginTabContribution {
  id: string;
  label: string;
  path: string;
  order: number;
  url: string;
}

export interface PluginSlotContribution {
  id: string;
  slot: PluginSlotId;
  title: string;
  path: string;
  order: number;
  height: number;
  url: string;
}

export interface PluginActionContribution {
  id: string;
  location: PluginActionLocation;
  label: string;
  title: string;
  path: string;
  order: number;
  width: number;
  height: number;
  mode: "modal" | "inline";
  request?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  };
  confirmText?: string;
  successMessage?: string;
  reloadPlugins: boolean;
  variant: "ghost" | "accent";
  url: string;
}

export interface PluginDescriptor {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  author: string;
  defaultEnabled: boolean;
  enabled: boolean;
  source: "user" | "bundled";
  assetBaseUrl: string;
  requestedPermissions: string[];
  grantedPermissions: string[];
  permissionsConfigured: boolean;
  permissions: string[];
  settingsFields: PluginSettingsFieldContribution[];
  themes: PluginThemeContribution[];
  tabs: PluginTabContribution[];
  slots: PluginSlotContribution[];
  actions: PluginActionContribution[];
}

export interface PluginCatalog {
  pluginsDir: string;
  bundledPluginsDir: string;
  sdkUrl: string;
  slotIds: PluginSlotId[];
  plugins: PluginDescriptor[];
}

export interface PluginHostContext {
  pluginId: string;
  locale: string;
  theme: "dark" | "light";
  themeVariables?: Record<string, string>;
  activeTab: string;
  grantedPermissions: string[];
  payload?: Record<string, unknown>;
}

export interface AppSettings {
  onboardingCompleted: boolean;
  agentsEnabled: boolean;
  agentWorkspaceToolsEnabled: boolean;
  agentCommandToolEnabled: boolean;
  agentDangerousFileOpsEnabled: boolean;
  agentNetworkCommandsEnabled: boolean;
  agentShellCommandsEnabled: boolean;
  agentGitWriteCommandsEnabled: boolean;
  agentAutoCompactEnabled: boolean;
  agentReplyReserveTokens: number;
  agentToolContextChars: number;
  alternateSimpleMode: boolean;
  theme: "dark" | "light" | "custom";
  pluginThemeId?: string | null;
  fontScale: number;
  density: "comfortable" | "compact";
  censorshipMode: CensorshipMode;
  fullLocalMode: boolean;
  useAlternateGreetings: boolean;
  responseLanguage: string;
  translateLanguage: string;
  translateProviderId?: string | null;
  translateModel?: string | null;
  ragProviderId?: string | null;
  ragModel?: string | null;
  ragRerankEnabled: boolean;
  ragRerankProviderId?: string | null;
  ragRerankModel?: string | null;
  ragRerankTopN: number;
  ragTopK: number;
  ragCandidateCount: number;
  ragSimilarityThreshold: number;
  ragMaxContextTokens: number;
  ragChunkSize: number;
  ragChunkOverlap: number;
  ragEnabledByDefault: boolean;
  interfaceLanguage: "en" | "ru" | "zh" | "ja";
  activeProviderId?: string | null;
  activeModel?: string | null;
  ttsBaseUrl: string;
  ttsApiKey: string;
  ttsAdapterId?: string | null;
  ttsModel: string;
  ttsVoice: string;
  compressProviderId?: string | null;
  compressModel?: string | null;
  mergeConsecutiveRoles: boolean;
  samplerConfig: SamplerConfig;
  apiParamPolicy: ApiParamPolicy;
  defaultSystemPrompt: string;
  strictGrounding: boolean;
  contextWindowSize: number;
  contextTailBudgetWithSummaryPercent: number;
  contextTailBudgetWithoutSummaryPercent: number;
  promptTemplates: PromptTemplates;
  promptStack: PromptBlock[];
  toolCallingEnabled: boolean;
  toolCallingPolicy: "conservative" | "balanced" | "aggressive";
  mcpAutoAttachTools: boolean;
  maxToolCallsPerTurn: number;
  mcpToolAllowlist: string[];
  mcpToolDenylist: string[];
  mcpDiscoveredTools: McpDiscoveredTool[];
  mcpToolStates: Record<string, boolean>;
  pluginStates: Record<string, boolean>;
  pluginStateConfigured: Record<string, boolean>;
  pluginData: Record<string, Record<string, unknown>>;
  pluginPermissionGrants: Record<string, Record<string, boolean>>;
  managedBackends: ManagedBackendConfig[];
  mcpServers: McpServerConfig[];
  security: SecuritySettings;
  sceneFieldVisibility: {
    dialogueStyle: boolean;
    initiative: boolean;
    descriptiveness: boolean;
    unpredictability: boolean;
    emotionalDepth: boolean;
  };
  customInspectorFields: CustomInspectorField[];
  customEndpointAdapters: CustomEndpointAdapter[];
}

export interface ChatCharacterLink {
  characterId: Id;
  displayName: string;
  avatarUrl: string | null;
  order: number;
}

export interface UserPersona {
  id: Id;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CharacterListItem {
  id: Id;
  name: string;
  avatarUrl: string | null;
  lorebookId?: Id | null;
  tags: string[];
  greeting: string;
  systemPrompt: string;
  createdAt: string;
}

export interface CharacterDetail extends CharacterListItem {
  description: string;
  personality: string;
  scenario: string;
  mesExample: string;
  creatorNotes: string;
  alternateGreetings: string[];
  postHistoryInstructions: string;
  creator: string;
  characterVersion: string;
  creatorNotesMultilingual: Record<string, unknown>;
  extensions: Record<string, unknown>;
  agentProfile?: AgentHeroProfile | null;
  cardJson: string;
}

export interface LoreBookEntry {
  id: string;
  name: string;
  keys: string[];
  secondaryKeys?: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective?: boolean;
  selectiveLogic?: "and" | "or";
  position: string;
  insertionOrder: number;
}

export interface LoreBook {
  id: Id;
  name: string;
  description: string;
  entries: LoreBookEntry[];
  sourceCharacterId?: Id | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentThreadStatus = "idle" | "running" | "error";
export type AgentRunStatus = "running" | "done" | "error" | "aborted";
export type AgentMessageRole = "system" | "user" | "assistant";
export type AgentMode = "ask" | "build" | "research";
export type AgentEventType =
  | "status"
  | "plan"
  | "skill"
  | "memory"
  | "tool_call"
  | "tool_result"
  | "subagent_start"
  | "subagent_done"
  | "warning"
  | "error";

export interface AgentHeroSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export interface AgentHeroProfile {
  enabled: boolean;
  mode: AgentMode;
  customInstructions: string;
  skills: AgentHeroSkill[];
}

export interface AgentThread {
  id: Id;
  title: string;
  description: string;
  systemPrompt: string;
  developerPrompt: string;
  status: AgentThreadStatus;
  mode: AgentMode;
  heroCharacterId?: Id | null;
  heroCharacterName?: string | null;
  workspaceRoot: string;
  memorySummary: string;
  memoryUpdatedAt?: string | null;
  providerId?: Id | null;
  modelId?: string | null;
  toolMode: "enabled" | "disabled";
  maxIterations: number;
  maxSubagents: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkill {
  id: Id;
  threadId: Id;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: Id;
  threadId: Id;
  runId?: Id | null;
  role: AgentMessageRole;
  content: string;
  attachments?: FileAttachment[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRun {
  id: Id;
  threadId: Id;
  parentRunId?: Id | null;
  title: string;
  status: AgentRunStatus;
  depth: number;
  summary: string;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvent {
  id: Id;
  threadId: Id;
  runId: Id;
  parentEventId?: Id | null;
  type: AgentEventType;
  title: string;
  content: string;
  payload: Record<string, unknown>;
  order: number;
  createdAt: string;
}

export interface AgentThreadState {
  thread: AgentThread;
  skills: AgentSkill[];
  messages: AgentMessage[];
  runs: AgentRun[];
  events: AgentEvent[];
}

export interface AgentWorkspaceDirectoryEntry {
  name: string;
  path: string;
  relativePath: string;
}

export interface AgentWorkspaceDirectoryState {
  projectRoot: string;
  currentPath: string;
  currentRelativePath: string;
  parentPath?: string | null;
  entries: AgentWorkspaceDirectoryEntry[];
}
