import { useState } from "react";
import { api } from "../../../shared/api";
import {
  failBackgroundTask,
  finishBackgroundTask,
  startBackgroundTask
} from "../../../shared/backgroundTasks";
import { buildFilenameBase, triggerBlobDownload } from "../../../shared/download";
import { useI18n } from "../../../shared/i18n";

export function useChatJsonExport(onError: (message: string) => void) {
  const { t } = useI18n();
  const [exportingChat, setExportingChat] = useState(false);

  async function exportChat(chatId: string, title: string, branchId?: string) {
    if (exportingChat) return;
    setExportingChat(true);
    const taskId = startBackgroundTask({
      scope: "chat",
      type: "export",
      label: t("chat.exportJson"),
      progressLabel: t("chat.exporting")
    });
    try {
      const blob = await api.chatExportJson(chatId, branchId);
      const filename = `${buildFilenameBase(title, "vellium-chat")}.vellium-chat.json`;
      await triggerBlobDownload(blob, filename);
      finishBackgroundTask(taskId, filename);
    } catch (error) {
      const message = String(error);
      failBackgroundTask(taskId, message);
      onError(message);
    } finally {
      setExportingChat(false);
    }
  }

  return { exportingChat, exportChat };
}
