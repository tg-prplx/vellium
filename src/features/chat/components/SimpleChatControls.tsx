import type { ReactNode, RefObject } from "react";
import { useI18n } from "../../../shared/i18n";
import { RpReasoningToggle } from "./RpReasoningToggle";

export function SimpleChatControls({ modelLabel, modelTriggerRef, modelOpen, onModel, reasoning, reasoningDisabled, onReasoning, contextOpen, onContext, sceneOpen, onScene, contextPreview }: {
  contextPreview?: ReactNode;
  modelLabel: string;
  modelTriggerRef: RefObject<HTMLButtonElement>;
  modelOpen: boolean;
  onModel: () => void;
  reasoning: boolean;
  reasoningDisabled: boolean;
  onReasoning: () => void;
  contextOpen: boolean;
  onContext: () => void;
  sceneOpen: boolean;
  onScene: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="chat-simple-controls" role="group" aria-label={t("chat.contextSetup")}>
      <button ref={modelTriggerRef} type="button" onClick={onModel} className="chat-simple-bar-model chat-simple-controls-model" title={t("chat.selectModel")} aria-expanded={modelOpen}>
        <span className="truncate">{modelLabel || t("chat.selectModel")}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {contextPreview}
      <RpReasoningToggle enabled={reasoning} disabled={reasoningDisabled} onToggle={onReasoning} />
      <button type="button" onClick={onContext} className={`chat-simple-bar-model ${contextOpen ? "is-active" : ""}`} aria-expanded={contextOpen} aria-controls="chat-simple-inspector-sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6" /></svg>
        <span>{t("chat.contextSetup")}</span>
      </button>
      <button type="button" data-modal-trigger="scene-state" onClick={onScene} className={`chat-simple-bar-model ${sceneOpen ? "is-active" : ""}`} aria-expanded={sceneOpen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 3v8m10-8v8M5 15h14M9 12v6m6-6v6" /></svg>
        <span>{t("inspector.sceneState")}</span>
      </button>
    </div>
  );
}
