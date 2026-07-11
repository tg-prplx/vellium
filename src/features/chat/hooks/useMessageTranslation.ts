import { useState } from "react";
import { api } from "../../../shared/api";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask
} from "../../../shared/backgroundTasks";
import { isAbortError } from "../../../shared/errors";
import { useI18n } from "../../../shared/i18n";

export function useMessageTranslation(onError: (message: string) => void) {
  const { t } = useI18n();
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translatedTexts, setTranslatedTexts] = useState<Record<string, string>>({});
  const [inPlaceTranslations, setInPlaceTranslations] = useState<Record<string, string>>({});

  async function translateMessage(messageId: string, inPlace = false) {
    if (translatingId) return;
    setTranslatingId(messageId);
    const controller = new AbortController();
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "translate",
      label: t("chat.translate"),
      progressLabel: t("chat.translating"),
      cancellable: true,
      cancelLabel: t("taskManager.stop"),
      onCancel: () => controller.abort()
    });

    try {
      const result = await api.chatTranslateMessage(messageId, undefined, controller.signal);
      if (inPlace) {
        setInPlaceTranslations((previous) => ({ ...previous, [messageId]: result.translation }));
        setTranslatedTexts((previous) => {
          const next = { ...previous };
          delete next[messageId];
          return next;
        });
      } else {
        setTranslatedTexts((previous) => ({ ...previous, [messageId]: result.translation }));
        setInPlaceTranslations((previous) => {
          const next = { ...previous };
          delete next[messageId];
          return next;
        });
      }
      finishBackgroundTask(taskId);
    } catch (error) {
      if (!isAbortError(error)) {
        const message = String(error);
        failBackgroundTask(taskId, message);
        onError(message);
      }
    } finally {
      setTranslatingId(null);
    }
  }

  return {
    translatingId,
    translatedTexts,
    inPlaceTranslations,
    setInPlaceTranslations,
    translateMessage
  };
}
