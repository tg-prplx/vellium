import type { UnifiedGenerateMessage } from "../../services/unifiedGeneration.js";
import type { PreparedMcpServerDiagnostic } from "../../services/mcp.js";
import type { WorkspaceCommandRiskCategory } from "../../services/workspaceTools.js";
import type { insertAgentEvent, insertAgentMessage } from "./repository.js";

export type AgentPendingConfirmation = {
  id: string;
  threadId: string;
  runId: string;
  tool: string;
  argumentsJson: string;
  arguments: Record<string, unknown>;
  category: WorkspaceCommandRiskCategory | "delete_path" | "move_overwrite";
  reason: string;
  createdAt: string;
};

export type AgentSubagentRole = "general" | "research" | "builder" | "reviewer";

export type AgentTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type PreparedAgentToolbox = {
  tools: AgentTool[];
  diagnostics: PreparedMcpServerDiagnostic[];
  executeToolCall: (callName: string, rawArgs: string | undefined, signal?: AbortSignal) => Promise<{
    modelText: string;
    traceText: string;
  }>;
  close: () => Promise<void>;
};

export type AgentStepResult = {
  summary: string;
  assistantMessage: string;
  status: "continue" | "needs_user" | "done";
  skillIds: string[];
  toolCalls: Array<{ tool: string; arguments: Record<string, unknown>; reason: string }>;
  subagents: Array<{ title: string; goal: string; instructions: string; role: AgentSubagentRole }>;
  updates: string[];
};

export type AgentRuntimeToolName = "agent_log_plan" | "agent_refresh_memory";

export const AGENT_RUNTIME_TOOL_DEFINITIONS: AgentTool[] = [
  {
    type: "function",
    function: {
      name: "agent_log_plan",
      description: "Record a user-visible step note or plan checkpoint in the trace. Use only when the plan is worth showing.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short label for the plan note." },
          content: { type: "string", description: "The compact plan/checkpoint content to show in the trace." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agent_refresh_memory",
      description: "Request a durable memory refresh for this run only when the thread memory should materially change.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why this run changed the durable memory." },
          summary: { type: "string", description: "Optional compact memory focus to emphasize during refresh." }
        },
        additionalProperties: false
      }
    }
  }
];

export type RuntimeEventWriter = {
  emitEvent: (event: ReturnType<typeof insertAgentEvent>) => void;
  emitMessage: (message: ReturnType<typeof insertAgentMessage>) => void;
  emitDelta: (delta: string) => void;
  emitReasoningDelta: (delta: string) => void;
  getDraft: () => { content: string; reasoning: string };
  clearDraft: () => void;
};

export type AgentLaunchIntent = {
  mode: "resume" | "retry";
  sourceRunId: string;
  sourceStatus: "running" | "done" | "error" | "aborted";
  sourceTitle: string;
};

export type AgentRunExecution = {
  stepCount: number;
  toolCalls: number;
  subagents: number;
  planEvents: number;
  usedSynthesis: boolean;
  memoryRefreshRequested: boolean;
};

export type AgentRunOutcome = {
  runId: string;
  finalMessage: string;
  reasoning: string;
  summary: string;
  status: "done" | "error" | "aborted";
  streamedResponse: boolean;
  execution: AgentRunExecution;
};

export type OpenAIToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export const AGENT_STEP_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Compact internal summary of this planning step."
    },
    assistantMessage: {
      type: "string",
      description: "Concise user-facing message, or an empty string when tool work is needed first."
    },
    status: {
      type: "string",
      enum: ["continue", "needs_user", "done"],
      description: "Use continue when requesting tool/subagent work, needs_user when blocked, done when complete."
    },
    skillIds: {
      type: "array",
      items: { type: "string" },
      description: "Enabled custom skill ids to activate next, if any."
    },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Exact tool name from the tool catalog."
          },
          argumentsJson: {
            type: "string",
            description: "A JSON object string containing the arguments for the selected tool."
          },
          reason: {
            type: "string",
            description: "Why this tool call is the next best action."
          }
        },
        required: ["tool", "argumentsJson", "reason"],
        additionalProperties: false
      },
      description: "Tool calls the runtime should execute before finalizing."
    },
    subagents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          instructions: { type: "string" },
          role: {
            type: "string",
            enum: ["general", "research", "builder", "reviewer"]
          }
        },
        required: ["title", "goal", "instructions", "role"],
        additionalProperties: false
      },
      description: "Bounded side tasks to delegate, if any."
    },
    updates: {
      type: "array",
      items: { type: "string" },
      description: "Short trace updates worth showing or remembering."
    }
  },
  required: ["summary", "assistantMessage", "status", "skillIds", "toolCalls", "subagents", "updates"],
  additionalProperties: false
} as const;

export const FOLLOWUP_INTENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["continuation", "new_task", "unclear"],
      description: "Whether the latest user message continues the prior task, starts a new task, or is unclear."
    },
    confidence: {
      type: "number",
      description: "Classifier confidence from 0 to 1."
    },
    reason: {
      type: "string",
      description: "Short reason for the classification."
    }
  },
  required: ["intent", "confidence", "reason"],
  additionalProperties: false
} as const;

export type AgentPromptHistorySelection = {
  history: UnifiedGenerateMessage[];
  compactedNote: string;
};

export type AgentPromptHistoryItem = {
  role: string;
  originalContent: UnifiedGenerateMessage["content"];
  content: string;
  tokenCount: number;
};
