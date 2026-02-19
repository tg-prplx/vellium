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

export interface ApiParamPolicy {
  openai: OpenAiApiParamPolicy;
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

