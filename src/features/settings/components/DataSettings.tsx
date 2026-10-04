import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../../../shared/api";
import { failBackgroundTask, finishBackgroundTask, startBackgroundTask } from "../../../shared/backgroundTasks";
import { useI18n } from "../../../shared/i18n";
import type { DataBackup, DataProfilesState } from "../../../shared/types/dataProfiles";
import { StatusMessage } from "./FormControls";
import { SettingRow, SettingsGroup } from "./SettingRow";

const primaryButton = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle disabled:cursor-not-allowed disabled:opacity-60";
const badge = "rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] text-text-tertiary";
const MIN_BACKUP_PASSWORD = 8;

type Status = { text: string; variant: "info" | "success" | "error" } | null;

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** Plain controlled input: unlike the autosaving InputField it resets as soon as form state is cleared. */
function FormInput({ value, onChange, placeholder, type = "text", disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      aria-label={placeholder}
      placeholder={placeholder}
      autoComplete={type === "password" ? "new-password" : "off"}
      onChange={(event) => onChange(event.target.value)}
      className="ui-field w-full px-3 py-2 text-sm placeholder:text-text-tertiary"
    />
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function DataSettings() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<DataProfilesState | null>(null);
  const [backups, setBackups] = useState<DataBackup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [restoring, setRestoring] = useState<{ file: string; password: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  const formatDate = useCallback((value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || date.getTime() === 0 ? "—" : date.toLocaleString(locale);
  }, [locale]);

  const refresh = useCallback(async () => {
    try {
      const [profiles, list] = await Promise.all([api.dataProfilesList(), api.dataBackupsList()]);
      if (!mounted.current) return;
      setState(profiles);
      setBackups(list);
    } catch (error) {
      if (mounted.current) setStatus({ text: errorText(error), variant: "error" });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  async function run(label: string, work: () => Promise<Status | void>) {
    if (busy) return;
    setBusy(label);
    setStatus(null);
    try {
      const next = await work();
      if (mounted.current && next) setStatus(next);
      await refresh();
    } catch (error) {
      if (mounted.current) setStatus({ text: errorText(error), variant: "error" });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  const createProfile = () => run("create", async () => {
    const created = await api.dataProfileCreate(newProfileName);
    setNewProfileName("");
    return { text: t("data.profileCreated").replace("{name}", created.name), variant: "success" };
  });

  const saveRename = () => run("rename", async () => {
    if (!renaming) return;
    await api.dataProfileRename(renaming.id, renaming.name);
    setRenaming(null);
  });

  const switchProfile = (id: string, name: string) => {
    if (!window.confirm(t("data.switchConfirm").replace("{name}", name))) return;
    void run("switch", async () => {
      const selection = await api.dataProfileSelect(id);
      if (!selection.restartRequired) return { text: t("data.switchCurrent"), variant: "info" };
      if (selection.restartMode === "relaunch" && window.electronAPI?.relaunchApp) {
        await window.electronAPI.relaunchApp();
        return { text: t("data.relaunching"), variant: "info" };
      }
      return { text: t("data.restartManually").replace("{name}", name), variant: "info" };
    });
  };

  const deleteProfile = (id: string, name: string) => {
    if (!window.confirm(t("data.deleteProfileConfirm").replace("{name}", name))) return;
    void run("delete-profile", async () => {
      await api.dataProfileDelete(id);
      return { text: t("data.profileDeleted"), variant: "success" };
    });
  };

  const passwordProblem = password && password.length < MIN_BACKUP_PASSWORD
    ? t("data.passwordTooShort").replace("{count}", String(MIN_BACKUP_PASSWORD))
    : password && password !== passwordRepeat ? t("data.passwordMismatch") : "";

  const createBackup = () => run("backup", async () => {
    const taskId = startBackgroundTask({ scope: "data", type: "export", label: t("data.backupTask") });
    try {
      const backup = await api.dataBackupCreate({ password: password || undefined });
      finishBackgroundTask(taskId, backup.file);
      setPassword("");
      setPasswordRepeat("");
      return { text: t("data.backupCreated").replace("{size}", formatBytes(backup.bytes)), variant: "success" };
    } catch (error) {
      failBackgroundTask(taskId, errorText(error));
      throw error;
    }
  });

  const uploadBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void run("upload", async () => {
      const uploaded = await api.dataBackupUpload(file);
      return { text: t("data.backupUploaded").replace("{name}", uploaded.profileName), variant: "success" };
    });
  };

  const restoreBackup = () => run("restore", async () => {
    if (!restoring) return;
    const taskId = startBackgroundTask({ scope: "data", type: "export", label: t("data.restoreTask") });
    try {
      const profile = await api.dataBackupRestore(restoring.file, { password: restoring.password || undefined, name: restoring.name.trim() || undefined });
      finishBackgroundTask(taskId, profile.name);
      setRestoring(null);
      return { text: t("data.restored").replace("{name}", profile.name), variant: "success" };
    } catch (error) {
      failBackgroundTask(taskId, errorText(error));
      // The server reports password problems in English; show them in the interface language.
      if (/password/i.test(errorText(error))) throw new Error(t("data.wrongPassword"));
      throw error;
    }
  });

  const deleteBackup = (file: string) => {
    if (!window.confirm(t("data.deleteBackupConfirm"))) return;
    void run("delete-backup", async () => { await api.dataBackupDelete(file); });
  };

  const disabled = Boolean(busy);
  const pendingProfile = state && state.selected !== state.running ? state.profiles.find((profile) => profile.selected) : null;

  return (
    <>
      <SettingsGroup id="settings-data-profiles" title={t("data.profiles")} description={t("data.profilesDesc")}>
        {pendingProfile && (
          <div className="mb-3">
            <StatusMessage text={(state?.restartMode === "relaunch" ? t("data.pendingRelaunch") : t("data.restartManually")).replace("{name}", pendingProfile.name)} />
          </div>
        )}
        <div className="space-y-2">
          {(state?.profiles || []).map((profile) => (
            <div key={profile.id} className="rounded-xl border border-border bg-bg-secondary px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {renaming?.id === profile.id ? (
                    <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
                      <FormInput value={renaming.name} onChange={(value) => setRenaming({ id: profile.id, name: value })} placeholder={t("data.profileName")} />
                      <button type="submit" className={primaryButton} disabled={disabled || !renaming.name.trim()}>{t("chat.save")}</button>
                      <button type="button" className={secondaryButton} onClick={() => setRenaming(null)}>{t("chat.cancel")}</button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-text-primary">{profile.name}</span>
                      {profile.running && <span className="rounded-full border border-accent-border bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">{t("data.current")}</span>}
                      {profile.selected && !profile.running && <span className={badge}>{t("data.afterRestart")}</span>}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    {t("data.databaseSize")}: {formatBytes(profile.databaseBytes)} · {t("data.createdAt")}: {formatDate(profile.createdAt)}
                  </div>
                </div>
                {renaming?.id !== profile.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!profile.running && <button type="button" className={primaryButton} disabled={disabled} onClick={() => switchProfile(profile.id, profile.name)}>{t("data.switch")}</button>}
                    <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setRenaming({ id: profile.id, name: profile.name })}>{t("data.rename")}</button>
                    {!profile.running && !profile.selected && profile.id !== "default" && (
                      <button type="button" className={dangerButton} disabled={disabled} onClick={() => deleteProfile(profile.id, profile.name)}>{t("data.delete")}</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <SettingRow label={t("data.newProfile")} description={t("data.newProfileDesc")}>
          <form className="flex w-full items-center gap-2" onSubmit={(event) => { event.preventDefault(); void createProfile(); }}>
            <FormInput value={newProfileName} onChange={setNewProfileName} placeholder={t("data.profileName")} />
            <button type="submit" className={primaryButton} disabled={disabled || !newProfileName.trim()}>{busy === "create" ? t("data.working") : t("data.create")}</button>
          </form>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup id="settings-data-backups" title={t("data.backups")} description={t("data.backupsDesc")}>
        <SettingRow label={t("data.backupPassword")} description={t("data.backupPasswordDesc")}>
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <FormInput type="password" value={password} onChange={setPassword} placeholder={t("data.passwordOptional")} />
            <FormInput type="password" value={passwordRepeat} onChange={setPasswordRepeat} placeholder={t("data.passwordRepeat")} disabled={!password} />
          </div>
        </SettingRow>
        {passwordProblem && <div className="mb-2"><StatusMessage text={passwordProblem} variant="error" /></div>}
        <div className="flex flex-wrap items-center gap-2 py-2">
          <button type="button" className={primaryButton} disabled={disabled || Boolean(passwordProblem)} onClick={() => void createBackup()}>
            {busy === "backup" ? t("data.working") : password ? t("data.createEncryptedBackup") : t("data.createBackup")}
          </button>
          <button type="button" className={secondaryButton} disabled={disabled} onClick={() => fileInputRef.current?.click()}>
            {busy === "upload" ? t("data.working") : t("data.importBackup")}
          </button>
          <input ref={fileInputRef} type="file" accept=".vbak,application/octet-stream" className="hidden" onChange={uploadBackup} />
        </div>
        {status && <div className="mb-3"><StatusMessage text={status.text} variant={status.variant} /></div>}
        {backups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-bg-primary px-4 py-5 text-sm text-text-tertiary">{t("data.noBackups")}</div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div key={backup.file} className="rounded-xl border border-border bg-bg-secondary px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-text-primary">{backup.profileName}</span>
                      <span className={badge}>{backup.encrypted ? t("data.encrypted") : t("data.notEncrypted")}</span>
                      {!backup.includesMasterKey && <span className={badge} title={t("data.keysHint")}>{t("data.withoutKeys")}</span>}
                    </div>
                    <div className="mt-1 text-[11px] text-text-tertiary">
                      {formatDate(backup.createdAt)} · {formatBytes(backup.bytes)} · v{backup.appVersion}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a className={secondaryButton} href={api.dataBackupDownloadUrl(backup.file)} download={backup.file}>{t("data.download")}</a>
                    <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setRestoring({ file: backup.file, password: "", name: "" })}>{t("data.restore")}</button>
                    <button type="button" className={dangerButton} disabled={disabled} onClick={() => deleteBackup(backup.file)}>{t("data.delete")}</button>
                  </div>
                </div>
                {restoring?.file === backup.file && (
                  <form className="mt-3 grid gap-2 rounded-xl border border-border-subtle bg-bg-primary p-3 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={(event) => { event.preventDefault(); void restoreBackup(); }}>
                    <FormInput value={restoring.name} onChange={(value) => setRestoring({ ...restoring, name: value })} placeholder={t("data.restoreName")} />
                    {backup.encrypted
                      ? <FormInput type="password" value={restoring.password} onChange={(value) => setRestoring({ ...restoring, password: value })} placeholder={t("data.backupPassword")} />
                      : <span className="self-center text-[11px] text-text-tertiary">{t("data.restoreAsNew")}</span>}
                    <button type="submit" className={primaryButton} disabled={disabled || (backup.encrypted && !restoring.password)}>{busy === "restore" ? t("data.working") : t("data.restore")}</button>
                    <button type="button" className={secondaryButton} onClick={() => setRestoring(null)}>{t("chat.cancel")}</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>
    </>
  );
}
