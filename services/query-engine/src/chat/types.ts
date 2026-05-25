export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageStatus = "success" | "error" | "awaiting_review";

export interface ChatConversationSummary {
  conversationId: string;
  title: string;
  selectedDbId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  previewText: string | null;
}

export interface ChatMessageRecord {
  messageId: string;
  conversationId: string;
  sequenceNo: number;
  role: ChatMessageRole;
  messageType: string;
  question: string | null;
  responseText: string | null;
  sql: string | null;
  generatedSQL: string | null;
  editableSQL: string | null;
  threadId: string | null;
  dbId: string | null;
  status: ChatMessageStatus | null;
  error: string | null;
  detail: string | null;
  phase: "request" | "generation" | "validation" | "execution" | "internal" | null;
  displayTarget: "sql-box" | "error-box" | null;
  code: string | null;
  result: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    executionTimeMs: number;
  } | null;
  retrievedTables: string[];
  schemaContext: string | null;
  promptPreview: {
    systemPrompt: string;
    userPrompt: string;
  } | null;
  lastError: {
    phase: "validation" | "execution";
    message: string;
  } | null;
  finalError: {
    code: string;
    phase: "request" | "generation" | "validation" | "execution" | "internal";
    message: string;
    detail?: string;
  } | null;
  tokens: {
    prompt?: number;
    completion?: number;
  } | null;
  agentSteps: Array<{
    node: string;
    status: "running" | "done" | "error";
    detail?: string;
  }>;
  retryCount: number | null;
  maxRetries: number | null;
  maxAttempts: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatMessageRecord[];
}

export interface CreateConversationInput {
  userId: string;
  title: string;
  selectedDbId?: string | null;
}

export interface CreateMessageInput {
  conversationId: string;
  role: ChatMessageRole;
  messageType: string;
  question?: string | null;
  responseText?: string | null;
  sql?: string | null;
  generatedSQL?: string | null;
  editableSQL?: string | null;
  threadId?: string | null;
  dbId?: string | null;
  status?: ChatMessageStatus | null;
  error?: string | null;
  detail?: string | null;
  phase?: "request" | "generation" | "validation" | "execution" | "internal" | null;
  displayTarget?: "sql-box" | "error-box" | null;
  code?: string | null;
  result?: ChatMessageRecord["result"];
  retrievedTables?: string[];
  schemaContext?: string | null;
  promptPreview?: ChatMessageRecord["promptPreview"];
  lastError?: ChatMessageRecord["lastError"];
  finalError?: ChatMessageRecord["finalError"];
  tokens?: ChatMessageRecord["tokens"];
  agentSteps?: ChatMessageRecord["agentSteps"];
  retryCount?: number | null;
  maxRetries?: number | null;
  maxAttempts?: number | null;
  completedAt?: string | null;
}

export type UpdateMessageInput = Partial<Omit<CreateMessageInput, "conversationId" | "role" | "messageType">>;
