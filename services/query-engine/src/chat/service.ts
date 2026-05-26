import { AgentResult } from "../agent";
import { ReviewDraftResponse } from "../agent/reviewFlow";
import {
  archiveConversation,
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  updateConversationMetadata,
  updateMessage,
} from "./repository";
import { ChatConversationDetail, ChatConversationSummary, ChatMessageRecord } from "./types";

const MAX_CONVERSATION_TITLE_LENGTH = 120;

function truncateTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77).trim()}...`;
}

function normalizeConversationTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("Conversation title is required.");
  }

  if (normalized.length > MAX_CONVERSATION_TITLE_LENGTH) {
    return `${normalized.slice(0, MAX_CONVERSATION_TITLE_LENGTH - 3).trim()}...`;
  }

  return normalized;
}

export async function listUserConversations(userId: string): Promise<ChatConversationSummary[]> {
  return listConversations(userId);
}

export async function getUserConversation(userId: string, conversationId: string): Promise<ChatConversationDetail | null> {
  return getConversation(userId, conversationId);
}

export async function createUserConversation(userId: string, selectedDbId?: string | null, title?: string): Promise<ChatConversationSummary> {
  return createConversation({
    userId,
    selectedDbId,
    title: title?.trim() || "New chat",
  });
}

export async function archiveUserConversation(userId: string, conversationId: string): Promise<boolean> {
  return archiveConversation(userId, conversationId);
}

export async function renameUserConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<ChatConversationSummary | null> {
  return renameConversation(userId, conversationId, normalizeConversationTitle(title));
}

export async function deleteUserConversation(userId: string, conversationId: string): Promise<boolean> {
  return deleteConversation(userId, conversationId);
}

export async function ensureConversation(
  userId: string,
  question: string,
  dbId: string,
  conversationId?: string,
): Promise<ChatConversationSummary> {
  if (conversationId) {
    const existing = await getConversation(userId, conversationId);
    if (!existing) {
      throw new Error("Conversation not found.");
    }

    await updateConversationMetadata(conversationId, { selectedDbId: dbId });
    return {
      conversationId: existing.conversationId,
      title: existing.title,
      selectedDbId: dbId,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      lastMessageAt: existing.lastMessageAt,
      previewText: existing.previewText,
    };
  }

  return createConversation({
    userId,
    selectedDbId: dbId,
    title: truncateTitle(question),
  });
}

export async function persistUserQuestion(
  userId: string,
  question: string,
  dbId: string,
  conversationId?: string,
): Promise<{ conversation: ChatConversationSummary; message: ChatMessageRecord }> {
  const conversation = await ensureConversation(userId, question, dbId, conversationId);
  const message = await appendMessage({
    conversationId: conversation.conversationId,
    role: "user",
    messageType: "question",
    question,
    dbId,
    status: "success",
    completedAt: new Date().toISOString(),
  });

  return { conversation, message };
}

export async function persistAssistantResult(
  conversationId: string,
  response: {
    sql?: string;
    data?: ChatMessageRecord["result"];
    error?: string;
    detail?: string;
    phase?: ChatMessageRecord["phase"];
    displayTarget?: ChatMessageRecord["displayTarget"];
    code?: string | null;
    finalError?: ChatMessageRecord["finalError"];
    retryCount?: number | null;
    maxRetries?: number | null;
    maxAttempts?: number | null;
    retrievedTables?: string[];
    schemaContext?: string | null;
    promptPreview?: ChatMessageRecord["promptPreview"];
    tokens?: ChatMessageRecord["tokens"];
    agentSteps?: ChatMessageRecord["agentSteps"];
    messageType?: string;
    status?: ChatMessageRecord["status"];
  },
): Promise<ChatMessageRecord> {
  return appendMessage({
    conversationId,
    role: "assistant",
    messageType: response.messageType || "answer",
    responseText: response.error || null,
    sql: response.sql,
    dbId: null,
    status: response.status || (response.error ? "error" : "success"),
    error: response.error,
    detail: response.detail,
    phase: response.phase,
    displayTarget: response.displayTarget,
    code: response.code || null,
    result: (response as { data?: ChatMessageRecord["result"] }).data,
    retrievedTables: response.retrievedTables || [],
    schemaContext: response.schemaContext,
    promptPreview: response.promptPreview,
    finalError: response.finalError,
    tokens: response.tokens,
    agentSteps: response.agentSteps || [],
    retryCount: response.retryCount,
    maxRetries: response.maxRetries,
    maxAttempts: response.maxAttempts,
    completedAt: new Date().toISOString(),
  });
}

export async function persistReviewDraft(
  conversationId: string,
  draft: ReviewDraftResponse,
): Promise<ChatMessageRecord> {
  return appendMessage({
    conversationId,
    role: "assistant",
    messageType: "review_draft",
    responseText: null,
    generatedSQL: draft.generatedSQL,
    editableSQL: draft.editableSQL,
    threadId: draft.threadId,
    status: "awaiting_review",
    retrievedTables: draft.retrievedTables,
    schemaContext: draft.schemaContext,
    promptPreview: draft.promptPreview,
    lastError: draft.lastError || null,
  });
}

export async function updatePersistedReviewMessage(
  conversationId: string,
  messageId: string,
  changes: {
    sql?: string | null;
    generatedSQL?: string | null;
    editableSQL?: string | null;
    status?: ChatMessageRecord["status"];
    error?: string | null;
    detail?: string | null;
    code?: string | null;
    phase?: ChatMessageRecord["phase"];
    displayTarget?: ChatMessageRecord["displayTarget"];
    result?: ChatMessageRecord["result"];
    retrievedTables?: string[];
    schemaContext?: string | null;
    promptPreview?: ChatMessageRecord["promptPreview"];
    lastError?: ChatMessageRecord["lastError"];
    finalError?: ChatMessageRecord["finalError"];
    retryCount?: number | null;
    maxRetries?: number | null;
    maxAttempts?: number | null;
    completedAt?: string | null;
  },
): Promise<ChatMessageRecord | null> {
  return updateMessage(conversationId, messageId, {
    sql: changes.sql,
    generatedSQL: changes.generatedSQL,
    editableSQL: changes.editableSQL,
    status: changes.status,
    error: changes.error,
    detail: changes.detail,
    code: changes.code,
    phase: changes.phase,
    displayTarget: changes.displayTarget,
    result: changes.result,
    retrievedTables: changes.retrievedTables,
    schemaContext: changes.schemaContext,
    promptPreview: changes.promptPreview,
    lastError: changes.lastError,
    finalError: changes.finalError,
    retryCount: changes.retryCount,
    maxRetries: changes.maxRetries,
    maxAttempts: changes.maxAttempts,
    completedAt: changes.completedAt,
  });
}

export async function persistAgentSuccess(conversationId: string, result: AgentResult): Promise<ChatMessageRecord> {
  return persistAssistantResult(conversationId, {
    sql: result.sql,
    data: result.data,
    retrievedTables: result.retrievedTables,
    retryCount: result.retryCount,
    maxRetries: result.maxRetries,
    maxAttempts: result.maxAttempts,
    finalError: null,
    status: "success",
  });
}

export async function persistAgentError(conversationId: string, result: AgentResult): Promise<ChatMessageRecord> {
  return persistAssistantResult(conversationId, {
    sql: result.sql,
    error: result.error,
    detail: result.detail,
    phase: result.phase,
    displayTarget: result.displayTarget,
    code: result.code,
    finalError: result.finalError || null,
    retrievedTables: result.retrievedTables,
    retryCount: result.retryCount,
    maxRetries: result.maxRetries,
    maxAttempts: result.maxAttempts,
    status: "error",
    messageType: "error",
  });
}
