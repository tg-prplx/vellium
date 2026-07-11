type Id = string;

interface ExportFileAttachment {
  id: string;
  filename: string;
  type: "image" | "text" | "video" | "audio";
  url: string;
  mimeType?: string;
  dataUrl?: string;
  content?: string;
}

interface ExportChatMessage {
  id: Id;
  chatId: Id;
  branchId: Id;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount: number;
  createdAt: string;
  parentId?: Id | null;
  characterName?: string;
  attachments?: ExportFileAttachment[];
}

interface ExportBranch {
  id: Id;
  chatId: Id;
  name: string;
  parentMessageId?: Id | null;
  createdAt: string;
}

interface ExportPromptBlock {
  id: Id;
  kind: "system" | "jailbreak" | "character" | "author_note" | "lore" | "scene" | "history";
  enabled: boolean;
  order: number;
  content: string;
}

export interface ChatExportBundle {
  format: "vellium.chat.export";
  version: number;
  exportedAt: string;
  chat: {
    id: Id;
    title: string;
    characterId?: Id | null;
    characterIds?: Id[];
    lorebookId?: Id | null;
    lorebookIds?: Id[];
    autoConversation?: boolean;
    contextSummary?: string;
    createdAt: string;
  };
  participants: Array<{
    id: string;
    kind: "user" | "character" | "system" | "tool";
    name: string;
    characterId: Id | null;
    avatarUrl: string | null;
  }>;
  conversation: {
    branchId: Id | null;
    branchName: string | null;
    multiCharacter: boolean;
    messages: Array<{
      sequence: number;
      id: Id;
      role: ExportChatMessage["role"];
      speakerId: string;
      speakerName: string;
      characterId: Id | null;
      content: string;
      attachments: ExportFileAttachment[];
      tokenCount: number;
      createdAt: string;
      parentId: Id | null;
    }>;
  };
  activeBranchId?: Id | null;
  branches: ExportBranch[];
  messages: ExportChatMessage[];
  messagesByBranch: Record<Id, ExportChatMessage[]>;
  promptBlocks: ExportPromptBlock[];
  sceneState?: {
    payload: Record<string, unknown> | null;
    updatedAt: string;
  } | null;
}
