import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../../shared/api";
import type { BranchNode, ChatMessage, ChatSession } from "../../../shared/types/contracts";

interface BranchManagementParams {
  activeChat: ChatSession | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setErrorText: Dispatch<SetStateAction<string>>;
}

export function useBranchManagement({ activeChat, setMessages, setErrorText }: BranchManagementParams) {
  const [branches, setBranches] = useState<BranchNode[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  const forkBranch = useCallback(async (parentMessageId: string) => {
    if (!activeChat) return;
    try {
      const branch = await api.chatFork(activeChat.id, parentMessageId, `Branch ${parentMessageId.slice(0, 6)}`);
      setBranches(await api.chatBranches(activeChat.id));
      setActiveBranchId(branch.id);
      setMessages(await api.chatTimeline(activeChat.id, branch.id));
    } catch (error) {
      setErrorText(String(error));
    }
  }, [activeChat, setErrorText, setMessages]);

  const renameBranch = useCallback(async (branchId: string, name: string) => {
    if (!activeChat) return;
    try {
      const updated = await api.chatRenameBranch(activeChat.id, branchId, name);
      setBranches((current) => current.map((branch) => branch.id === updated.id ? updated : branch));
    } catch (error) {
      setErrorText(String(error));
      throw error;
    }
  }, [activeChat, setErrorText]);

  const removeBranch = useCallback(async (branchId: string) => {
    if (!activeChat) return;
    try {
      const result = await api.chatDeleteBranch(activeChat.id, branchId);
      setBranches(result.branches);
      if (activeBranchId === branchId) {
        setActiveBranchId(result.activeBranchId);
        setMessages(await api.chatTimeline(activeChat.id, result.activeBranchId));
      }
    } catch (error) {
      setErrorText(String(error));
      throw error;
    }
  }, [activeBranchId, activeChat, setErrorText, setMessages]);

  return {
    branches,
    setBranches,
    activeBranchId,
    setActiveBranchId,
    forkBranch,
    renameBranch,
    removeBranch
  };
}
