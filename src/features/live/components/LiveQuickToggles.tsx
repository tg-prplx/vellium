import { useI18n } from "../../../shared/i18n";
import { LiveIcon, type LiveIconName } from "./LiveIcon";

interface Toggle {
  id: string;
  icon: LiveIconName;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}

/** The four switches that change how a live turn behaves, as one segmented group. */
export function LiveQuickToggles({ handsFree, voiceReplies, vision, screen }: {
  handsFree: { on: boolean; onToggle: () => void };
  voiceReplies: { on: boolean; onToggle: () => void };
  vision: { on: boolean; onToggle: () => void };
  screen: { on: boolean; onToggle: () => void };
}) {
  const { t } = useI18n();
  const toggles: Toggle[] = [
    { id: "hands-free", icon: "handsFree", label: t("live.handsFree"), hint: t("live.handsFreeTitle"), ...handsFree },
    { id: "voice", icon: "voice", label: t("live.voiceReplies"), hint: t("live.voiceRepliesTitle"), ...voiceReplies },
    { id: "vision", icon: "vision", label: t("live.vision"), hint: t("live.visionTitle"), ...vision },
    { id: "screen", icon: "screen", label: t("live.shareScreen"), hint: t("live.shareScreenTitle"), ...screen }
  ];
  return (
    <div className="live-controls" role="group" aria-label={t("live.controls")}>
      {toggles.map((toggle) => (
        <button key={toggle.id} type="button" className={toggle.on ? "is-on" : ""} onClick={toggle.onToggle}
          aria-pressed={toggle.on} title={toggle.hint}>
          <LiveIcon name={toggle.icon} />
          <span>{toggle.label}</span>
        </button>
      ))}
    </div>
  );
}
