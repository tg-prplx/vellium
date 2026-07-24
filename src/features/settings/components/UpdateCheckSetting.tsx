import { useI18n } from "../../../shared/i18n";
import { ToggleSwitch } from "./FormControls";

interface UpdateCheckSettingProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}
export function UpdateCheckSetting({ checked, onChange }: UpdateCheckSettingProps) {
  const { t } = useI18n();
  return (
    <div className="settings-toggle-row">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{t("settings.checkForUpdates")}</div>
        <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.checkForUpdatesDesc")}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  );
}
