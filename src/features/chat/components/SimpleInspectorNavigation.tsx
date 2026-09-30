import { PanelCloseButton } from "../../../components/Panels";
import { useI18n } from "../../../shared/i18n";

export type SimpleInspectorSection = "context" | "advanced";

export function SimpleInspectorNavigation({ section, onSectionChange, onClose }: {
  section: SimpleInspectorSection; onSectionChange: (section: SimpleInspectorSection) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return <>
    <div className="chat-simple-panel-heading">
      <h2>{t("chat.contextSetup")}</h2>
      <PanelCloseButton label={t("common.close")} onClick={onClose} />
    </div>
    <div className="chat-inspector-navigation" role="group" aria-label={t("chat.contextSetup")}>
      <button type="button" aria-pressed={section === "context"} onClick={() => onSectionChange("context")}>{t("settings.general")}</button>
      <button type="button" aria-pressed={section === "advanced"} onClick={() => onSectionChange("advanced")}>{t("settings.advanced")}</button>
    </div>
  </>;
}
