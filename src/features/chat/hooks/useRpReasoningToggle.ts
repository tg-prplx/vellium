import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../../shared/api";

export function useRpReasoningToggle(setErrorText: Dispatch<SetStateAction<string>>) {
  const [rpReasoningEnabled, setRpReasoningEnabled] = useState(false);
  const [savingRpReasoning, setSavingRpReasoning] = useState(false);

  const toggleRpReasoning = useCallback(async () => {
    if (savingRpReasoning) return;
    const next = !rpReasoningEnabled;
    setRpReasoningEnabled(next);
    setSavingRpReasoning(true);
    try {
      const updated = await api.settingsUpdate({ rpReasoningEnabled: next });
      setRpReasoningEnabled(updated.rpReasoningEnabled === true);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    } catch (error) {
      setRpReasoningEnabled(!next);
      setErrorText(String(error));
    } finally {
      setSavingRpReasoning(false);
    }
  }, [rpReasoningEnabled, savingRpReasoning, setErrorText]);

  return { rpReasoningEnabled, setRpReasoningEnabled, savingRpReasoning, toggleRpReasoning };
}
