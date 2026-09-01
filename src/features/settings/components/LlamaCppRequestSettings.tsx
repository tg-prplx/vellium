import type { TranslationKey } from "../../../shared/i18n";
import type { LlamaCppApiParamPolicy, SamplerConfig } from "../../../shared/types/contracts";
import { FieldLabel, InputField, SelectField, ToggleSwitch } from "./FormControls";

interface LlamaCppRequestSettingsProps {
  samplerConfig: SamplerConfig;
  policy: LlamaCppApiParamPolicy;
  onSamplerChange: (patch: Partial<SamplerConfig>) => void;
  onPolicyChange: (patch: Partial<LlamaCppApiParamPolicy>) => void;
  t: (key: TranslationKey) => string;
}

type LlamaNumberKey =
  | "llamaCppDynatempRange"
  | "llamaCppDynatempExponent"
  | "llamaCppTopNSigma"
  | "llamaCppXtcProbability"
  | "llamaCppXtcThreshold"
  | "llamaCppRepeatLastN"
  | "llamaCppDryMultiplier"
  | "llamaCppDryBase"
  | "llamaCppDryAllowedLength"
  | "llamaCppDryPenaltyLastN"
  | "llamaCppMirostatTau"
  | "llamaCppMirostatEta"
  | "llamaCppSeed"
  | "llamaCppMinKeep";

type LlamaPolicyKey = Exclude<keyof LlamaCppApiParamPolicy, "sendSampler">;

interface NumberParameter {
  valueKey: LlamaNumberKey;
  policyKey: LlamaPolicyKey;
  label: string;
  fallback: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

function ParameterToggle({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`llama-request-toggle ${disabled ? "opacity-60" : ""}`}>
      <span>{label}</span>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function NumberParameterRow({
  item,
  samplerConfig,
  policy,
  disabled,
  onSamplerChange,
  onPolicyChange
}: {
  item: NumberParameter;
  samplerConfig: SamplerConfig;
  policy: LlamaCppApiParamPolicy;
  disabled: boolean;
  onSamplerChange: (patch: Partial<SamplerConfig>) => void;
  onPolicyChange: (patch: Partial<LlamaCppApiParamPolicy>) => void;
}) {
  const rawValue = samplerConfig[item.valueKey];
  const value = typeof rawValue === "number" ? rawValue : item.fallback;
  return (
    <div className={`llama-request-parameter ${disabled ? "opacity-60" : ""}`}>
      <div className="llama-request-parameter-head">
        <FieldLabel>{item.label}</FieldLabel>
        <ToggleSwitch
          checked={policy[item.policyKey]}
          disabled={disabled}
          onChange={(event) => onPolicyChange({ [item.policyKey]: event.target.checked })}
        />
      </div>
      <InputField
        type="number"
        value={String(value)}
        disabled={disabled || !policy[item.policyKey]}
        min={item.min}
        max={item.max}
        step={item.step}
        onChange={(next) => {
          const parsed = Number(next);
          if (!Number.isFinite(parsed)) return;
          const clamped = Math.max(item.min, Math.min(item.max, item.integer ? Math.floor(parsed) : parsed));
          onSamplerChange({ [item.valueKey]: clamped });
        }}
      />
    </div>
  );
}

export function LlamaCppRequestSettings({
  samplerConfig,
  policy,
  onSamplerChange,
  onPolicyChange,
  t
}: LlamaCppRequestSettingsProps) {
  const disabled = !policy.sendSampler;
  const commonFields: Array<{ key: LlamaPolicyKey; label: string }> = [
    { key: "temperature", label: t("inspector.temperature") },
    { key: "topP", label: t("inspector.topP") },
    { key: "topK", label: "Top-K" },
    { key: "minP", label: "Min-P" },
    { key: "typical", label: "Typical-P" },
    { key: "repeatPenalty", label: t("settings.llamaApiRepeatPenalty") },
    { key: "presencePenalty", label: t("inspector.presPenalty") },
    { key: "frequencyPenalty", label: t("inspector.freqPenalty") },
    { key: "maxTokens", label: t("inspector.maxTokens") },
    { key: "stop", label: t("settings.stopSequences") }
  ];
  const samplingFields: NumberParameter[] = [
    { valueKey: "llamaCppDynatempRange", policyKey: "dynatempRange", label: "Dynamic temperature range", fallback: 0, min: 0, max: 5, step: 0.01 },
    { valueKey: "llamaCppDynatempExponent", policyKey: "dynatempExponent", label: "Dynamic temperature exponent", fallback: 1, min: 0, max: 10, step: 0.01 },
    { valueKey: "llamaCppTopNSigma", policyKey: "topNSigma", label: "Top-N-Sigma", fallback: -1, min: -1, max: 10, step: 0.01 },
    { valueKey: "llamaCppXtcProbability", policyKey: "xtcProbability", label: "XTC probability", fallback: 0, min: 0, max: 1, step: 0.01 },
    { valueKey: "llamaCppXtcThreshold", policyKey: "xtcThreshold", label: "XTC threshold", fallback: 0.1, min: 0, max: 1, step: 0.01 },
    { valueKey: "llamaCppRepeatLastN", policyKey: "repeatLastN", label: "Repeat last N", fallback: 64, min: -1, max: 1048576, step: 1, integer: true }
  ];
  const dryFields: NumberParameter[] = [
    { valueKey: "llamaCppDryMultiplier", policyKey: "dryMultiplier", label: "DRY multiplier", fallback: 0, min: 0, max: 10, step: 0.01 },
    { valueKey: "llamaCppDryBase", policyKey: "dryBase", label: "DRY base", fallback: 1.75, min: 0, max: 10, step: 0.01 },
    { valueKey: "llamaCppDryAllowedLength", policyKey: "dryAllowedLength", label: "DRY allowed length", fallback: 2, min: 0, max: 1024, step: 1, integer: true },
    { valueKey: "llamaCppDryPenaltyLastN", policyKey: "dryPenaltyLastN", label: "DRY penalty last N", fallback: 64, min: -1, max: 1048576, step: 1, integer: true }
  ];
  const advancedFields: NumberParameter[] = [
    { valueKey: "llamaCppMirostatTau", policyKey: "mirostatTau", label: "Mirostat tau", fallback: 5, min: 0, max: 20, step: 0.01 },
    { valueKey: "llamaCppMirostatEta", policyKey: "mirostatEta", label: "Mirostat eta", fallback: 0.1, min: 0, max: 1, step: 0.01 },
    { valueKey: "llamaCppSeed", policyKey: "seed", label: "Seed (-1 = random)", fallback: -1, min: -1, max: 2147483647, step: 1, integer: true },
    { valueKey: "llamaCppMinKeep", policyKey: "minKeep", label: "Minimum candidates", fallback: 0, min: 0, max: 100000, step: 1, integer: true }
  ];

  return (
    <div className="settings-field-group llama-request-settings">
      <div className="llama-request-title">
        <div>
          <div className="text-xs font-semibold text-text-secondary">{t("settings.apiParamsLlamaCpp")}</div>
          <p>{t("settings.llamaRequestParamsDesc")}</p>
        </div>
        <ToggleSwitch checked={policy.sendSampler} onChange={(event) => onPolicyChange({ sendSampler: event.target.checked })} />
      </div>

      <details className="llama-request-section" open>
        <summary>{t("settings.llamaReasoningParams")}</summary>
        <div className="llama-request-grid">
          <div className={`llama-request-parameter ${disabled ? "opacity-60" : ""}`}>
            <div className="llama-request-parameter-head"><FieldLabel>{t("settings.llamaReasoningEffort")}</FieldLabel><ToggleSwitch checked={policy.reasoningEffort} disabled={disabled} onChange={(event) => onPolicyChange({ reasoningEffort: event.target.checked })} /></div>
            <SelectField value={samplerConfig.llamaCppReasoningEffort || "default"} disabled={disabled || !policy.reasoningEffort} onChange={(value) => onSamplerChange({ llamaCppReasoningEffort: value as SamplerConfig["llamaCppReasoningEffort"] })}>
              {["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
          </div>
          <div className={`llama-request-parameter ${disabled ? "opacity-60" : ""}`}>
            <div className="llama-request-parameter-head"><FieldLabel>{t("settings.llamaReasoningFormat")}</FieldLabel><ToggleSwitch checked={policy.reasoningFormat} disabled={disabled} onChange={(event) => onPolicyChange({ reasoningFormat: event.target.checked })} /></div>
            <SelectField value={samplerConfig.llamaCppReasoningFormat || "auto"} disabled={disabled || !policy.reasoningFormat} onChange={(value) => onSamplerChange({ llamaCppReasoningFormat: value as SamplerConfig["llamaCppReasoningFormat"] })}>
              {["auto", "none", "deepseek", "deepseek-legacy"].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
          </div>
          <div className={`llama-request-parameter ${disabled ? "opacity-60" : ""}`}>
            <div className="llama-request-parameter-head"><FieldLabel>{t("settings.llamaThinkingMode")}</FieldLabel><ToggleSwitch checked={policy.thinkingMode} disabled={disabled} onChange={(event) => onPolicyChange({ thinkingMode: event.target.checked })} /></div>
            <SelectField value={samplerConfig.llamaCppThinkingMode || "auto"} disabled={disabled || !policy.thinkingMode} onChange={(value) => onSamplerChange({ llamaCppThinkingMode: value as SamplerConfig["llamaCppThinkingMode"] })}>
              <option value="auto">auto</option><option value="on">on</option><option value="off">off</option>
            </SelectField>
          </div>
          <div className="llama-request-boolean-stack">
            <ParameterToggle label={t("settings.llamaReasoningControl")} checked={policy.reasoningControl} disabled={disabled} onChange={(checked) => onPolicyChange({ reasoningControl: checked })} />
            <ParameterToggle label={t("settings.llamaReasoningControlRequest")} checked={samplerConfig.llamaCppReasoningControl === true} disabled={disabled || !policy.reasoningControl} onChange={(checked) => onSamplerChange({ llamaCppReasoningControl: checked })} />
          </div>
        </div>
        <p className="llama-request-help">{t("settings.llamaReasoningNativeHint")}</p>
      </details>

      <details className="llama-request-section" open>
        <summary>{t("settings.llamaCommonParams")}</summary>
        <p className="llama-request-help">{t("settings.llamaCommonParamsHint")}</p>
        <div className="llama-request-toggle-grid">
          {commonFields.map((item) => <ParameterToggle key={item.key} label={item.label} checked={policy[item.key]} disabled={disabled} onChange={(checked) => onPolicyChange({ [item.key]: checked })} />)}
        </div>
      </details>

      <details className="llama-request-section">
        <summary>{t("settings.llamaSamplingParams")}</summary>
        <div className="llama-request-grid">
          {samplingFields.map((item) => <NumberParameterRow key={item.valueKey} item={item} samplerConfig={samplerConfig} policy={policy} disabled={disabled} onSamplerChange={onSamplerChange} onPolicyChange={onPolicyChange} />)}
        </div>
      </details>

      <details className="llama-request-section">
        <summary>{t("settings.llamaDryParams")}</summary>
        <div className="llama-request-grid">
          {dryFields.map((item) => <NumberParameterRow key={item.valueKey} item={item} samplerConfig={samplerConfig} policy={policy} disabled={disabled} onSamplerChange={onSamplerChange} onPolicyChange={onPolicyChange} />)}
          <div className={`llama-request-parameter md:col-span-2 ${disabled ? "opacity-60" : ""}`}>
            <div className="llama-request-parameter-head"><FieldLabel>DRY sequence breakers</FieldLabel><ToggleSwitch checked={policy.drySequenceBreakers} disabled={disabled} onChange={(event) => onPolicyChange({ drySequenceBreakers: event.target.checked })} /></div>
            <InputField value={(samplerConfig.llamaCppDrySequenceBreakers || ["\\n", ":", "\"", "*"]).join(", ")} disabled={disabled || !policy.drySequenceBreakers} onChange={(value) => onSamplerChange({ llamaCppDrySequenceBreakers: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
          </div>
        </div>
      </details>

      <details className="llama-request-section">
        <summary>{t("settings.llamaAdvancedParams")}</summary>
        <div className="llama-request-grid">
          <div className={`llama-request-parameter ${disabled ? "opacity-60" : ""}`}>
            <div className="llama-request-parameter-head"><FieldLabel>Mirostat</FieldLabel><ToggleSwitch checked={policy.mirostat} disabled={disabled} onChange={(event) => onPolicyChange({ mirostat: event.target.checked })} /></div>
            <SelectField value={String(samplerConfig.llamaCppMirostat ?? 0)} disabled={disabled || !policy.mirostat} onChange={(value) => onSamplerChange({ llamaCppMirostat: Number(value) as 0 | 1 | 2 })}><option value="0">Off</option><option value="1">Mirostat 1</option><option value="2">Mirostat 2</option></SelectField>
          </div>
          {advancedFields.map((item) => <NumberParameterRow key={item.valueKey} item={item} samplerConfig={samplerConfig} policy={policy} disabled={disabled} onSamplerChange={onSamplerChange} onPolicyChange={onPolicyChange} />)}
          <div className="llama-request-boolean-stack">
            <ParameterToggle label="ignore_eos" checked={policy.ignoreEos} disabled={disabled} onChange={(checked) => onPolicyChange({ ignoreEos: checked })} />
            <ParameterToggle label={t("settings.llamaIgnoreEosRequest")} checked={samplerConfig.llamaCppIgnoreEos === true} disabled={disabled || !policy.ignoreEos} onChange={(checked) => onSamplerChange({ llamaCppIgnoreEos: checked })} />
          </div>
        </div>
      </details>
    </div>
  );
}
