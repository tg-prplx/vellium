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

export interface LlamaCppApiParamPolicy {
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
