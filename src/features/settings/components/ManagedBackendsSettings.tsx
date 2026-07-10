import type { Dispatch, SetStateAction } from "react";
import { buildManagedBackendCommand, defaultManagedBackendConfig, resolveManagedBackendBaseUrl } from "../../../shared/managedBackends";
import type { TranslationKey } from "../../../shared/i18n";
import type { ManagedBackendConfig, ManagedBackendRuntimeState, ProviderProfile } from "../../../shared/types/contracts";
import { FieldLabel, InputField, SelectField, TextareaField, ToggleSwitch } from "./FormControls";
import { IconButton } from "../../../components/IconButton";

interface ManagedBackendsSettingsProps {
  backends: ManagedBackendConfig[];
  runtimeStateById: Map<string, ManagedBackendRuntimeState>;
  providers: ProviderProfile[];
  importCommands: Record<string, string>;
  onImportCommandsChange: Dispatch<SetStateAction<Record<string, string>>>;
  onAdd: () => void;
  onUpdate: (backendId: string, patch: Partial<ManagedBackendConfig>) => void;
  onRemove: (backendId: string) => void;
  onStart: (backend: ManagedBackendConfig) => Promise<void>;
  onStop: (backendId: string) => Promise<void>;
  onOpenLogs: (backend: ManagedBackendConfig) => Promise<void>;
  onApplyCommand: (backend: ManagedBackendConfig) => void;
  autosaveProps: { commitMode: "debounced"; debounceMs: number };
  t: (key: TranslationKey) => string;
}

export function ManagedBackendsSettings({
  backends: managedBackends,
  runtimeStateById: managedBackendStateMap,
  providers,
  importCommands: managedBackendImportCommands,
  onImportCommandsChange: setManagedBackendImportCommands,
  onAdd: addManagedBackend,
  onUpdate: updateManagedBackend,
  onRemove: removeManagedBackend,
  onStart: startManagedBackend,
  onStop: stopManagedBackend,
  onOpenLogs: openManagedBackendLogs,
  onApplyCommand: applyManagedBackendCommand,
  autosaveProps,
  t
}: ManagedBackendsSettingsProps) {
  return (
            <div className="space-y-4">
              <div id="settings-managed-backends" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.managedBackends")}</div>
                <p className="mb-4 text-xs text-text-tertiary">{t("settings.managedBackendsDesc")}</p>

                {managedBackends.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-bg-primary px-4 py-5 text-sm text-text-tertiary">
                    {t("settings.managedBackendsEmpty")}
                  </div>
                ) : null}

                <div className="space-y-4">
                  {managedBackends.map((backend) => {
                    const runtime = managedBackendStateMap.get(backend.id);
                    const koboldOptions = backend.koboldcpp || defaultManagedBackendConfig().koboldcpp!;
                    const ollamaOptions = backend.ollama || defaultManagedBackendConfig().ollama!;
                    const isStarting = runtime?.status === "starting";
                    const isRunning = runtime?.status === "running" || isStarting;
                    const commandPreview = runtime?.commandPreview || buildManagedBackendCommand(backend).command;
                    const envText = backend.envText || "";
                    const runtimeStatus = runtime?.status || "idle";

                    return (
                      <div key={backend.id} className="rounded-2xl border border-border bg-bg-secondary p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-text-primary">{backend.name}</div>
                              <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                                {backend.backendKind}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                runtimeStatus === "running"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                  : isStarting
                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                    : runtimeStatus === "error"
                                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                                      : "border-border-subtle bg-bg-primary text-text-tertiary"
                              }`}>
                                {runtimeStatus}
                              </span>
                              {runtime?.pid ? (
                                <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] text-text-tertiary">
                                  PID {runtime.pid}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-text-tertiary">
                              {resolveManagedBackendBaseUrl(backend)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => void startManagedBackend(backend)}
                              disabled={isRunning}
                              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("settings.startBackend")}
                            </button>
                            <button
                              onClick={() => void stopManagedBackend(backend.id)}
                              disabled={!isRunning}
                              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("settings.stopBackend")}
                            </button>
                            <IconButton
                              data-modal-trigger="backend-logs"
                              onClick={() => void openManagedBackendLogs(backend)}
                              label={t("settings.viewLogs")}
                              icon={(
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 8 4 4-4 4m6 0h6M4 4h16v16H4z" />
                                </svg>
                              )}
                            />
                            <IconButton
                              onClick={() => removeManagedBackend(backend.id)}
                              label={t("common.delete")}
                              tone="danger"
                              icon={(
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
                                </svg>
                              )}
                            />
                          </div>
                        </div>

                        {typeof runtime?.progress === "number" || runtime?.progressLabel ? (
                          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-text-secondary">
                              <span>{runtime?.progressLabel || runtimeStatus}</span>
                              <span>{typeof runtime?.progress === "number" ? `${runtime.progress}%` : runtimeStatus}</span>
                            </div>
                            <div className="h-2 rounded-full bg-bg-hover">
                              <div
                                className="h-2 rounded-full bg-accent transition-all"
                                style={{ width: `${Math.max(0, Math.min(100, runtime?.progress ?? 0))}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {runtime?.lastError ? (
                          <div className="mt-4 rounded-xl border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger">
                            {runtime.lastError}
                          </div>
                        ) : null}

                        {Array.isArray(runtime?.models) && runtime.models.length > 0 ? (
                          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                            <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.modelsLoaded")}</div>
                            <div className="flex flex-wrap gap-2">
                              {runtime.models.map((model) => (
                                <span key={model} className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary">
                                  {model}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>{t("settings.backendName")}</FieldLabel>
                            <InputField
                              value={backend.name}
                              onChange={(value) => updateManagedBackend(backend.id, { name: value })}
                              placeholder={t("settings.backendNamePlaceholder")}
                            />
                          </div>
                          <div>
                            <FieldLabel>{t("settings.backendKind")}</FieldLabel>
                            <SelectField
                              value={backend.backendKind}
                              onChange={(value) => updateManagedBackend(backend.id, { backendKind: value as ManagedBackendConfig["backendKind"] })}
                            >
                              <option value="koboldcpp">KoboldCpp</option>
                              <option value="ollama">Ollama</option>
                              <option value="generic">Generic</option>
                            </SelectField>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div>
                            <FieldLabel>{t("settings.provider")}</FieldLabel>
                            <SelectField value={backend.providerId} onChange={(value) => updateManagedBackend(backend.id, { providerId: value })}>
                              {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.name}</option>
                              ))}
                            </SelectField>
                          </div>
                          <div>
                            <FieldLabel>{t("settings.providerType")}</FieldLabel>
                            <SelectField
                              value={backend.providerType}
                              onChange={(value) => updateManagedBackend(backend.id, { providerType: value as ManagedBackendConfig["providerType"] })}
                            >
                              <option value="openai">{t("settings.providerTypeOpenAi")}</option>
                              <option value="koboldcpp">{t("settings.providerTypeKobold")}</option>
                              <option value="custom">{t("settings.providerTypeCustom")}</option>
                            </SelectField>
                          </div>
                          <div>
                            <FieldLabel>{t("settings.baseUrl")}</FieldLabel>
                            <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-text-secondary">
                              {resolveManagedBackendBaseUrl(backend)}
                            </div>
                          </div>
                        </div>

                        {backend.providerType === "custom" && (
                          <div className="mt-4">
                            <FieldLabel>{t("settings.adapterId")}</FieldLabel>
                            <InputField
                              value={backend.adapterId || ""}
                              onChange={(value) => updateManagedBackend(backend.id, { adapterId: value.trim() || null })}
                              placeholder={t("settings.adapterIdPlaceholder")}
                            />
                          </div>
                        )}

                        <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                          <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.importCommand")}</div>
                          <div className="flex flex-col gap-3 md:flex-row">
                            <textarea
                              value={managedBackendImportCommands[backend.id] || ""}
                              onChange={(e) => setManagedBackendImportCommands((current) => ({ ...current, [backend.id]: e.target.value }))}
                              placeholder={t("settings.importCommandPlaceholder")}
                              className="h-24 min-h-[96px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
                            />
                            <button
                              onClick={() => applyManagedBackendCommand(backend)}
                              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
                            >
                              {t("settings.applyCommand")}
                            </button>
                          </div>
                        </div>

                        {backend.backendKind === "koboldcpp" && (
                          <>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.executable")}</FieldLabel>
                                <InputField value={koboldOptions.executable} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, executable: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.modelPath")}</FieldLabel>
                                <InputField value={koboldOptions.modelPath || ""} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, modelPath: value } })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                              <div>
                                <FieldLabel>{t("settings.host")}</FieldLabel>
                                <InputField value={koboldOptions.host} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, host: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.port")}</FieldLabel>
                                <InputField type="number" value={String(koboldOptions.port)} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, port: Number(value || 0) || koboldOptions.port } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.contextWindow")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.contextSize || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, contextSize: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.gpuLayers")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.gpuLayers || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, gpuLayers: Number(value || 0) || 0 } })}
                                />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div>
                                <FieldLabel>{t("settings.threads")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.threads || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, threads: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.blasThreads")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.blasThreads || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, blasThreads: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.batchSize")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.batchSize || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, batchSize: Number(value || 0) || 0 } })}
                                />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {([
                                ["highPriority", t("settings.highPriority")],
                                ["smartContext", t("settings.smartContext")],
                                ["useMmap", t("settings.useMmap")],
                                ["flashAttention", t("settings.flashAttention")],
                                ["noMmap", t("settings.noMmap")],
                                ["noKvOffload", t("settings.noKvOffload")]
                              ] as const).map(([key, label]) => (
                                <label key={key} className="settings-toggle-row rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                                  <span className="text-xs font-medium text-text-secondary">{label}</span>
                                  <ToggleSwitch
                                    checked={Boolean(koboldOptions[key])}
                                    onChange={(e) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, [key]: e.target.checked } })}
                                  />
                                </label>
                              ))}
                            </div>
                          </>
                        )}

                        {backend.backendKind === "ollama" && (
                          <>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.executable")}</FieldLabel>
                                <InputField value={ollamaOptions.executable} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, executable: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.defaultModel")}</FieldLabel>
                                <InputField value={backend.defaultModel || ""} onChange={(value) => updateManagedBackend(backend.id, { defaultModel: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.host")}</FieldLabel>
                                <InputField value={ollamaOptions.host} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, host: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.port")}</FieldLabel>
                                <InputField type="number" value={String(ollamaOptions.port)} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, port: Number(value || 0) || ollamaOptions.port } })} />
                              </div>
                            </div>
                          </>
                        )}

                        {backend.backendKind === "generic" && (
                          <>
                            <div className="mt-4">
                              <FieldLabel>{t("settings.commandOverride")}</FieldLabel>
                              <InputField
                                value={backend.commandOverride || ""}
                                onChange={(value) => updateManagedBackend(backend.id, { commandOverride: value })}
                                placeholder="python server.py --host 127.0.0.1 --port 8000"
                              />
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.defaultModel")}</FieldLabel>
                                <InputField value={backend.defaultModel || ""} onChange={(value) => updateManagedBackend(backend.id, { defaultModel: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.healthPath")}</FieldLabel>
                                <InputField value={backend.healthPath || ""} onChange={(value) => updateManagedBackend(backend.id, { healthPath: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.modelsPath")}</FieldLabel>
                                <InputField value={backend.modelsPath || ""} onChange={(value) => updateManagedBackend(backend.id, { modelsPath: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusPath")}</FieldLabel>
                                <InputField value={backend.statusPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusPath: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div>
                                <FieldLabel>{t("settings.statusMode")}</FieldLabel>
                                <SelectField
                                  value={backend.statusMode || "auto"}
                                  onChange={(value) => updateManagedBackend(backend.id, { statusMode: value as ManagedBackendConfig["statusMode"] })}
                                >
                                  <option value="auto">auto</option>
                                  <option value="api">api</option>
                                  <option value="stdout">stdout</option>
                                  <option value="none">none</option>
                                </SelectField>
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusTextPath")}</FieldLabel>
                                <InputField value={backend.statusTextPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusTextPath: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusProgressPath")}</FieldLabel>
                                <InputField value={backend.statusProgressPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusProgressPath: value })} />
                              </div>
                            </div>
                          </>
                        )}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>{t("settings.workingDirectory")}</FieldLabel>
                            <InputField value={backend.workingDirectory || ""} onChange={(value) => updateManagedBackend(backend.id, { workingDirectory: value })} />
                          </div>
                          <div>
                            <FieldLabel>{t("settings.extraArgs")}</FieldLabel>
                            <InputField value={backend.extraArgs || ""} onChange={(value) => updateManagedBackend(backend.id, { extraArgs: value })} />
                          </div>
                        </div>

                        <div className="mt-4">
                          <FieldLabel>{t("settings.envVars")}</FieldLabel>
                          <TextareaField
                            value={envText}
                            onChange={(value) => updateManagedBackend(backend.id, { envText: value })}
                            placeholder={"KEY=value\nANOTHER=value"}
                            className="h-24 min-h-[96px] text-xs"
                            {...autosaveProps}
                          />
                        </div>

                        <label className="mt-4 settings-toggle-row rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                          <span className="text-xs font-medium text-text-secondary">{t("settings.autoStopOnSwitch")}</span>
                          <ToggleSwitch
                            checked={backend.autoStopOnSwitch !== false}
                            onChange={(e) => updateManagedBackend(backend.id, { autoStopOnSwitch: e.target.checked })}
                          />
                        </label>

                        <div className="mt-4">
                          <FieldLabel>{t("settings.commandPreview")}</FieldLabel>
                          <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-[11px] text-text-secondary">
                            {commandPreview}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={addManagedBackend}
                  className="mt-4 w-full rounded-lg border border-border border-dashed px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover"
                >
                  {t("settings.addManagedBackend")}
                </button>
              </div>
            </div>
  );
}
