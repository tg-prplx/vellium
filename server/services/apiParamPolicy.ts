type UnknownRecord = Record<string, unknown>;

interface OpenAiApiParamPolicy {
  sendSampler: boolean;
  temperature: boolean;
  topP: boolean;
  frequencyPenalty: boolean;
  presencePenalty: boolean;
  maxTokens: boolean;
  stop: boolean;
}

interface KoboldApiParamPolicy {
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

interface LlamaCppApiParamPolicy {
  sendSampler: boolean;
  temperature: boolean;
  dynatempRange: boolean;
  dynatempExponent: boolean;
  topP: boolean;
  topK: boolean;
  minP: boolean;
  topNSigma: boolean;
  xtcProbability: boolean;
  xtcThreshold: boolean;
  typical: boolean;
  repeatPenalty: boolean;
  repeatLastN: boolean;
  presencePenalty: boolean;
  frequencyPenalty: boolean;
  dryMultiplier: boolean;
  dryBase: boolean;
  dryAllowedLength: boolean;
  dryPenaltyLastN: boolean;
  drySequenceBreakers: boolean;
  mirostat: boolean;
  mirostatTau: boolean;
  mirostatEta: boolean;
  seed: boolean;
  ignoreEos: boolean;
  minKeep: boolean;
  maxTokens: boolean;
  stop: boolean;
  reasoningEffort: boolean;
  reasoningFormat: boolean;
  thinkingMode: boolean;
  reasoningControl: boolean;
}

export interface ApiParamPolicy {
  openai: OpenAiApiParamPolicy;
  llamaCpp: LlamaCppApiParamPolicy;
  kobold: KoboldApiParamPolicy;
}

const DEFAULT_API_PARAM_POLICY: ApiParamPolicy = {
  openai: {
    sendSampler: true,
    temperature: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
    maxTokens: true,
    stop: true
  },
  llamaCpp: {
    sendSampler: true,
    temperature: true,
    dynatempRange: true,
    dynatempExponent: true,
    topP: true,
    topK: true,
    minP: true,
    topNSigma: true,
    xtcProbability: true,
    xtcThreshold: true,
    typical: true,
    repeatPenalty: true,
    repeatLastN: true,
    presencePenalty: true,
    frequencyPenalty: true,
    dryMultiplier: true,
    dryBase: true,
    dryAllowedLength: true,
    dryPenaltyLastN: true,
    drySequenceBreakers: true,
    mirostat: true,
    mirostatTau: true,
    mirostatEta: true,
    seed: true,
    ignoreEos: true,
    minKeep: true,
    maxTokens: true,
    stop: true,
    reasoningEffort: true,
    reasoningFormat: true,
    thinkingMode: true,
    reasoningControl: true
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

function asObject(raw: unknown): UnknownRecord {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as UnknownRecord
    : {};
}

function asBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function asNumber(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function asStop(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 32);
}

function asPhraseBans(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 128);
  }
  if (typeof raw !== "string") return [];
  return raw.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 128);
}

function asSamplerOrder(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0).slice(0, 16);
}

export function normalizeApiParamPolicy(raw: unknown): ApiParamPolicy {
  const root = asObject(raw);
  const openaiRaw = asObject(root.openai);
  const llamaCppRaw = asObject(root.llamaCpp);
  const koboldRaw = asObject(root.kobold);
  return {
    openai: {
      sendSampler: asBoolean(openaiRaw.sendSampler, DEFAULT_API_PARAM_POLICY.openai.sendSampler),
      temperature: asBoolean(openaiRaw.temperature, DEFAULT_API_PARAM_POLICY.openai.temperature),
      topP: asBoolean(openaiRaw.topP, DEFAULT_API_PARAM_POLICY.openai.topP),
      frequencyPenalty: asBoolean(openaiRaw.frequencyPenalty, DEFAULT_API_PARAM_POLICY.openai.frequencyPenalty),
      presencePenalty: asBoolean(openaiRaw.presencePenalty, DEFAULT_API_PARAM_POLICY.openai.presencePenalty),
      maxTokens: asBoolean(openaiRaw.maxTokens, DEFAULT_API_PARAM_POLICY.openai.maxTokens),
      stop: asBoolean(openaiRaw.stop, DEFAULT_API_PARAM_POLICY.openai.stop)
    },
    llamaCpp: Object.fromEntries(
      Object.entries(DEFAULT_API_PARAM_POLICY.llamaCpp).map(([key, fallback]) => [
        key,
        asBoolean(llamaCppRaw[key], fallback)
      ])
    ) as unknown as LlamaCppApiParamPolicy,
    kobold: {
      sendSampler: asBoolean(koboldRaw.sendSampler, DEFAULT_API_PARAM_POLICY.kobold.sendSampler),
      memory: asBoolean(koboldRaw.memory, DEFAULT_API_PARAM_POLICY.kobold.memory),
      maxTokens: asBoolean(koboldRaw.maxTokens, DEFAULT_API_PARAM_POLICY.kobold.maxTokens),
      temperature: asBoolean(koboldRaw.temperature, DEFAULT_API_PARAM_POLICY.kobold.temperature),
      topP: asBoolean(koboldRaw.topP, DEFAULT_API_PARAM_POLICY.kobold.topP),
      topK: asBoolean(koboldRaw.topK, DEFAULT_API_PARAM_POLICY.kobold.topK),
      topA: asBoolean(koboldRaw.topA, DEFAULT_API_PARAM_POLICY.kobold.topA),
      minP: asBoolean(koboldRaw.minP, DEFAULT_API_PARAM_POLICY.kobold.minP),
      typical: asBoolean(koboldRaw.typical, DEFAULT_API_PARAM_POLICY.kobold.typical),
      tfs: asBoolean(koboldRaw.tfs, DEFAULT_API_PARAM_POLICY.kobold.tfs),
      nSigma: asBoolean(koboldRaw.nSigma, DEFAULT_API_PARAM_POLICY.kobold.nSigma),
      repetitionPenalty: asBoolean(koboldRaw.repetitionPenalty, DEFAULT_API_PARAM_POLICY.kobold.repetitionPenalty),
      repetitionPenaltyRange: asBoolean(koboldRaw.repetitionPenaltyRange, DEFAULT_API_PARAM_POLICY.kobold.repetitionPenaltyRange),
      repetitionPenaltySlope: asBoolean(koboldRaw.repetitionPenaltySlope, DEFAULT_API_PARAM_POLICY.kobold.repetitionPenaltySlope),
      samplerOrder: asBoolean(koboldRaw.samplerOrder, DEFAULT_API_PARAM_POLICY.kobold.samplerOrder),
      stop: asBoolean(koboldRaw.stop, DEFAULT_API_PARAM_POLICY.kobold.stop),
      phraseBans: asBoolean(koboldRaw.phraseBans, DEFAULT_API_PARAM_POLICY.kobold.phraseBans),
      useDefaultBadwords: asBoolean(koboldRaw.useDefaultBadwords, DEFAULT_API_PARAM_POLICY.kobold.useDefaultBadwords)
    }
  };
}

export type OpenAiSamplerField =
  | "temperature"
  | "topP"
  | "frequencyPenalty"
  | "presencePenalty"
  | "maxTokens"
  | "stop";

interface OpenAiSamplerOptions {
  samplerConfig: UnknownRecord;
  apiParamPolicy?: unknown;
  fields?: OpenAiSamplerField[];
  defaults?: Partial<Record<Exclude<OpenAiSamplerField, "stop">, number>>;
}

export function buildOpenAiSamplingPayload(options: OpenAiSamplerOptions): UnknownRecord {
  const policy = normalizeApiParamPolicy(options.apiParamPolicy).openai;
  if (!policy.sendSampler) return {};

  const fields = options.fields ?? ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"];
  const defaults = {
    temperature: options.defaults?.temperature ?? 0.9,
    topP: options.defaults?.topP ?? 1,
    frequencyPenalty: options.defaults?.frequencyPenalty ?? 0,
    presencePenalty: options.defaults?.presencePenalty ?? 0,
    maxTokens: options.defaults?.maxTokens ?? 2048
  };

  const sc = options.samplerConfig || {};
  const out: UnknownRecord = {};

  if (fields.includes("temperature") && policy.temperature) {
    out.temperature = asNumber(sc.temperature, defaults.temperature);
  }
  if (fields.includes("topP") && policy.topP) {
    out.top_p = asNumber(sc.topP, defaults.topP);
  }
  if (fields.includes("frequencyPenalty") && policy.frequencyPenalty) {
    out.frequency_penalty = asNumber(sc.frequencyPenalty, defaults.frequencyPenalty);
  }
  if (fields.includes("presencePenalty") && policy.presencePenalty) {
    out.presence_penalty = asNumber(sc.presencePenalty, defaults.presencePenalty);
  }
  if (fields.includes("maxTokens") && policy.maxTokens) {
    out.max_tokens = Math.max(1, Math.floor(asNumber(sc.maxTokens, defaults.maxTokens)));
  }
  if (fields.includes("stop") && policy.stop) {
    const stop = asStop(sc.stop);
    if (stop.length > 0) out.stop = stop;
  }
  return out;
}

export function buildLlamaCppSamplingPayload(options: {
  samplerConfig: UnknownRecord;
  apiParamPolicy?: unknown;
}): UnknownRecord {
  const policy = normalizeApiParamPolicy(options.apiParamPolicy).llamaCpp;
  if (!policy.sendSampler) return {};
  const sc = options.samplerConfig || {};
  const out: UnknownRecord = {};
  const set = (enabled: boolean, key: string, value: unknown) => {
    if (enabled) out[key] = value;
  };

  set(policy.temperature, "temperature", asNumber(sc.temperature, 0.9));
  set(policy.dynatempRange, "dynatemp_range", Math.max(0, asNumber(sc.llamaCppDynatempRange, 0)));
  set(policy.dynatempExponent, "dynatemp_exponent", Math.max(0, asNumber(sc.llamaCppDynatempExponent, 1)));
  set(policy.topP, "top_p", Math.max(0, Math.min(1, asNumber(sc.topP, 1))));
  set(policy.topK, "top_k", Math.max(0, Math.floor(asNumber(sc.topK, 40))));
  set(policy.minP, "min_p", Math.max(0, Math.min(1, asNumber(sc.minP, 0.05))));
  set(policy.topNSigma, "top_n_sigma", asNumber(sc.llamaCppTopNSigma, -1));
  set(policy.xtcProbability, "xtc_probability", Math.max(0, Math.min(1, asNumber(sc.llamaCppXtcProbability, 0))));
  set(policy.xtcThreshold, "xtc_threshold", Math.max(0, Math.min(1, asNumber(sc.llamaCppXtcThreshold, 0.1))));
  set(policy.typical, "typical_p", Math.max(0, Math.min(1, asNumber(sc.typical, 1))));
  set(policy.repeatPenalty, "repeat_penalty", Math.max(0, asNumber(sc.repetitionPenalty, 1.1)));
  set(policy.repeatLastN, "repeat_last_n", Math.floor(asNumber(sc.llamaCppRepeatLastN, 64)));
  set(policy.presencePenalty, "presence_penalty", asNumber(sc.presencePenalty, 0));
  set(policy.frequencyPenalty, "frequency_penalty", asNumber(sc.frequencyPenalty, 0));
  set(policy.dryMultiplier, "dry_multiplier", Math.max(0, asNumber(sc.llamaCppDryMultiplier, 0)));
  set(policy.dryBase, "dry_base", Math.max(0, asNumber(sc.llamaCppDryBase, 1.75)));
  set(policy.dryAllowedLength, "dry_allowed_length", Math.max(0, Math.floor(asNumber(sc.llamaCppDryAllowedLength, 2))));
  set(policy.dryPenaltyLastN, "dry_penalty_last_n", Math.floor(asNumber(sc.llamaCppDryPenaltyLastN, 64)));
  if (policy.drySequenceBreakers) {
    out.dry_sequence_breakers = asStop(sc.llamaCppDrySequenceBreakers).slice(0, 16);
  }
  set(policy.mirostat, "mirostat", Math.max(0, Math.min(2, Math.floor(asNumber(sc.llamaCppMirostat, 0)))));
  set(policy.mirostatTau, "mirostat_tau", Math.max(0, asNumber(sc.llamaCppMirostatTau, 5)));
  set(policy.mirostatEta, "mirostat_eta", Math.max(0, asNumber(sc.llamaCppMirostatEta, 0.1)));
  set(policy.seed, "seed", Math.floor(asNumber(sc.llamaCppSeed, -1)));
  set(policy.ignoreEos, "ignore_eos", sc.llamaCppIgnoreEos === true);
  set(policy.minKeep, "min_keep", Math.max(0, Math.floor(asNumber(sc.llamaCppMinKeep, 0))));
  set(policy.maxTokens, "max_tokens", Math.max(1, Math.floor(asNumber(sc.maxTokens, 2048))));
  if (policy.stop) {
    const stop = asStop(sc.stop);
    if (stop.length > 0) out.stop = stop;
  }

  const reasoningEffort = String(sc.llamaCppReasoningEffort || "default");
  if (policy.reasoningEffort && reasoningEffort !== "default") out.reasoning_effort = reasoningEffort;
  const reasoningFormat = String(sc.llamaCppReasoningFormat || "auto");
  if (policy.reasoningFormat && reasoningFormat !== "auto") out.reasoning_format = reasoningFormat;
  const thinkingMode = String(sc.llamaCppThinkingMode || "auto");
  if (policy.thinkingMode && thinkingMode !== "auto") {
    out.chat_template_kwargs = { enable_thinking: thinkingMode === "on" };
  }
  set(policy.reasoningControl, "reasoning_control", sc.llamaCppReasoningControl === true);
  return out;
}

export type KoboldSamplerField =
  | "koboldMemory"
  | "maxTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "topA"
  | "minP"
  | "typical"
  | "tfs"
  | "nSigma"
  | "repetitionPenalty"
  | "repetitionPenaltyRange"
  | "repetitionPenaltySlope"
  | "samplerOrder"
  | "stop"
  | "koboldBannedPhrases"
  | "koboldUseDefaultBadwords";

interface KoboldSamplerOptions {
  samplerConfig: UnknownRecord;
  apiParamPolicy?: unknown;
  fields?: KoboldSamplerField[];
  defaults?: Partial<Record<Exclude<KoboldSamplerField, "koboldMemory" | "stop" | "samplerOrder" | "koboldBannedPhrases" | "koboldUseDefaultBadwords">, number>>;
}

export function buildKoboldSamplerConfig(options: KoboldSamplerOptions): UnknownRecord {
  const policy = normalizeApiParamPolicy(options.apiParamPolicy).kobold;
  const fields = options.fields ?? [
    "koboldMemory",
    "maxTokens",
    "temperature",
    "topP",
    "topK",
    "topA",
    "minP",
    "typical",
    "tfs",
    "nSigma",
    "repetitionPenalty",
    "repetitionPenaltyRange",
    "repetitionPenaltySlope",
    "samplerOrder",
    "stop",
    "koboldBannedPhrases",
    "koboldUseDefaultBadwords"
  ];
  const defaults = {
    maxTokens: options.defaults?.maxTokens ?? 2048,
    temperature: options.defaults?.temperature ?? 0.9,
    topP: options.defaults?.topP ?? 1,
    topK: options.defaults?.topK ?? 100,
    topA: options.defaults?.topA ?? 0,
    minP: options.defaults?.minP ?? 0,
    typical: options.defaults?.typical ?? 1,
    tfs: options.defaults?.tfs ?? 1,
    nSigma: options.defaults?.nSigma ?? 0,
    repetitionPenalty: options.defaults?.repetitionPenalty ?? 1.1,
    repetitionPenaltyRange: options.defaults?.repetitionPenaltyRange ?? 0,
    repetitionPenaltySlope: options.defaults?.repetitionPenaltySlope ?? 1
  };

  const sc = options.samplerConfig || {};
  const out: UnknownRecord = {};

  if (fields.includes("koboldMemory") && policy.memory) {
    out.koboldMemory = String(sc.koboldMemory || "");
  }

  if (!policy.sendSampler) return out;

  if (fields.includes("maxTokens") && policy.maxTokens) {
    out.maxTokens = Math.max(1, Math.floor(asNumber(sc.maxTokens, defaults.maxTokens)));
  }
  if (fields.includes("temperature") && policy.temperature) {
    out.temperature = asNumber(sc.temperature, defaults.temperature);
  }
  if (fields.includes("topP") && policy.topP) {
    out.topP = asNumber(sc.topP, defaults.topP);
  }
  if (fields.includes("topK") && policy.topK) {
    out.topK = Math.floor(asNumber(sc.topK, defaults.topK));
  }
  if (fields.includes("topA") && policy.topA) {
    out.topA = asNumber(sc.topA, defaults.topA);
  }
  if (fields.includes("minP") && policy.minP) {
    out.minP = asNumber(sc.minP, defaults.minP);
  }
  if (fields.includes("typical") && policy.typical) {
    out.typical = asNumber(sc.typical, defaults.typical);
  }
  if (fields.includes("tfs") && policy.tfs) {
    out.tfs = asNumber(sc.tfs, defaults.tfs);
  }
  if (fields.includes("nSigma") && policy.nSigma) {
    out.nSigma = asNumber(sc.nSigma, defaults.nSigma);
  }
  if (fields.includes("repetitionPenalty") && policy.repetitionPenalty) {
    out.repetitionPenalty = asNumber(sc.repetitionPenalty, defaults.repetitionPenalty);
  }
  if (fields.includes("repetitionPenaltyRange") && policy.repetitionPenaltyRange) {
    out.repetitionPenaltyRange = Math.floor(asNumber(sc.repetitionPenaltyRange, defaults.repetitionPenaltyRange));
  }
  if (fields.includes("repetitionPenaltySlope") && policy.repetitionPenaltySlope) {
    out.repetitionPenaltySlope = asNumber(sc.repetitionPenaltySlope, defaults.repetitionPenaltySlope);
  }
  if (fields.includes("samplerOrder") && policy.samplerOrder) {
    const samplerOrder = asSamplerOrder(sc.samplerOrder);
    if (samplerOrder.length > 0) out.samplerOrder = samplerOrder;
  }
  if (fields.includes("stop") && policy.stop) {
    const stop = asStop(sc.stop);
    if (stop.length > 0) out.stop = stop;
  }
  if (fields.includes("koboldBannedPhrases") && policy.phraseBans) {
    const bans = asPhraseBans(sc.koboldBannedPhrases);
    if (bans.length > 0) out.koboldBannedPhrases = bans;
  }
  if (fields.includes("koboldUseDefaultBadwords") && policy.useDefaultBadwords) {
    out.koboldUseDefaultBadwords = sc.koboldUseDefaultBadwords === true;
  }

  return out;
}
