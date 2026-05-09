import type {
  AgentEvent,
  AgentMessage,
  AgentPendingConfirmation,
  AgentSkill,
  AgentThread,
  AgentThreadState,
  AgentWorkspaceDirectoryState,
  FileAttachment
} from "../types/contracts";
import { del, get, patchReq, post, streamPost, type StreamCallbacks } from "./core";

const THREAD_STATE_TIMEOUT_MS = 15_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadThreadStateAfterStream(threadId: string): Promise<AgentThreadState> {
  let lastError: unknown = null;
  for (const delayMs of [0, 120, 320, 700]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      return await get<AgentThreadState>(`/agents/threads/${threadId}/state`, { timeoutMs: THREAD_STATE_TIMEOUT_MS });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to load agent thread state after stream");
}

export const agentClient = {
  agentThreadList: () => get<AgentThread[]>("/agents/threads"),
  agentWorkspaceDirectories: (path?: string) => get<AgentWorkspaceDirectoryState>(`/agents/workspace/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  agentThreadCreate: (payload?: Partial<AgentThread>) => post<AgentThread>("/agents/threads", payload),
  agentThreadState: (threadId: string) => get<AgentThreadState>(`/agents/threads/${threadId}/state`),
  agentThreadUpdate: (threadId: string, payload: Partial<AgentThread>) => patchReq<AgentThread>(`/agents/threads/${threadId}`, payload),
  agentThreadDelete: (threadId: string) => del<{ ok: boolean }>(`/agents/threads/${threadId}`),
  agentForkFromMessage: (messageId: string, name?: string) => post<AgentThread>(`/agents/messages/${messageId}/fork`, { name }),
  agentEditMessage: (messageId: string, payload: { content?: string; attachments?: FileAttachment[] }) =>
    patchReq<{ ok: boolean; state: AgentThreadState }>(`/agents/messages/${messageId}`, payload),
  agentDeleteMessage: (messageId: string) => del<{ ok: boolean; state: AgentThreadState }>(`/agents/messages/${messageId}`),
  agentSkillList: (threadId: string) => get<AgentSkill[]>(`/agents/threads/${threadId}/skills`),
  agentSkillCreate: (threadId: string, payload?: Partial<AgentSkill>) => post<AgentSkill | null>(`/agents/threads/${threadId}/skills`, payload),
  agentSkillUpdate: (threadId: string, skillId: string, payload: Partial<AgentSkill>) =>
    patchReq<AgentSkill>(`/agents/threads/${threadId}/skills/${skillId}`, payload),
  agentSkillDelete: (threadId: string, skillId: string) => del<{ ok: boolean }>(`/agents/threads/${threadId}/skills/${skillId}`),
  agentAbort: (threadId: string) => post<{ ok: boolean; interrupted: boolean }>(`/agents/threads/${threadId}/abort`),
  agentPendingConfirmation: (threadId: string) => get<{ pending: AgentPendingConfirmation | null }>(`/agents/threads/${threadId}/pending-confirmation`),
  agentConfirmAction: (
    threadId: string,
    payload: { confirmationId: string; action: "approve" | "deny" }
  ) => post<{
    ok: boolean;
    action: "approved" | "denied";
    resolved: AgentPendingConfirmation;
    pending: AgentPendingConfirmation | null;
    state: AgentThreadState;
  }>(`/agents/threads/${threadId}/confirm-action`, payload),
  agentSteer: (threadId: string, content: string, attachments?: FileAttachment[]) =>
    post<{ ok: boolean; state: AgentThreadState }>(`/agents/threads/${threadId}/steer`, { content, attachments }),
  agentRetryRun: async (
    threadId: string,
    runId: string,
    callbacks?: StreamCallbacks & {
      onAgentEvent?: (event: AgentEvent) => void;
      onAgentMessage?: (message: AgentMessage) => void;
    }
  ) => {
    await streamPost(`/agents/threads/${threadId}/runs/${runId}/retry`, {}, {
      onDelta: callbacks?.onDelta,
      onReasoningDelta: callbacks?.onReasoningDelta,
      onToolEvent: callbacks?.onToolEvent,
      onDone: callbacks?.onDone,
      onEvent: (event) => {
        callbacks?.onEvent?.(event);
        if (event.type === "agent_event" && event.event && typeof event.event === "object") {
          callbacks?.onAgentEvent?.(event.event as AgentEvent);
        }
        if (event.type === "agent_message" && event.message && typeof event.message === "object") {
          callbacks?.onAgentMessage?.(event.message as AgentMessage);
        }
      }
    });
    return loadThreadStateAfterStream(threadId);
  },
  agentResumeRun: async (
    threadId: string,
    runId: string,
    callbacks?: StreamCallbacks & {
      onAgentEvent?: (event: AgentEvent) => void;
      onAgentMessage?: (message: AgentMessage) => void;
    }
  ) => {
    await streamPost(`/agents/threads/${threadId}/runs/${runId}/resume`, {}, {
      onDelta: callbacks?.onDelta,
      onReasoningDelta: callbacks?.onReasoningDelta,
      onToolEvent: callbacks?.onToolEvent,
      onDone: callbacks?.onDone,
      onEvent: (event) => {
        callbacks?.onEvent?.(event);
        if (event.type === "agent_event" && event.event && typeof event.event === "object") {
          callbacks?.onAgentEvent?.(event.event as AgentEvent);
        }
        if (event.type === "agent_message" && event.message && typeof event.message === "object") {
          callbacks?.onAgentMessage?.(event.message as AgentMessage);
        }
      }
    });
    return loadThreadStateAfterStream(threadId);
  },
  agentRespond: async (
    threadId: string,
    content: string,
    attachments?: FileAttachment[],
    callbacks?: StreamCallbacks & {
      onAgentEvent?: (event: AgentEvent) => void;
      onAgentMessage?: (message: AgentMessage) => void;
    }
  ) => {
    await streamPost(`/agents/threads/${threadId}/respond`, { content, attachments }, {
      onDelta: callbacks?.onDelta,
      onReasoningDelta: callbacks?.onReasoningDelta,
      onToolEvent: callbacks?.onToolEvent,
      onDone: callbacks?.onDone,
      onEvent: (event) => {
        callbacks?.onEvent?.(event);
        if (event.type === "agent_event" && event.event && typeof event.event === "object") {
          callbacks?.onAgentEvent?.(event.event as AgentEvent);
        }
        if (event.type === "agent_message" && event.message && typeof event.message === "object") {
          callbacks?.onAgentMessage?.(event.message as AgentMessage);
        }
      }
    });
    return loadThreadStateAfterStream(threadId);
  }
};
