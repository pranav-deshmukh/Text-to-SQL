import { QueryResult } from './query-result';

export interface ChatConversationSummary {
  conversationId: string;
  title: string;
  selectedDbId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  previewText: string | null;
}

export interface ChatConversationMessage {
  messageId: string;
  conversationId: string;
  sequenceNo: number;
  role: 'user' | 'assistant' | 'system';
  messageType: string;
  question: string | null;
  responseText: string | null;
  sql: string | null;
  generatedSQL: string | null;
  editableSQL: string | null;
  threadId: string | null;
  dbId: string | null;
  status: 'success' | 'error' | 'awaiting_review' | null;
  error: string | null;
  detail: string | null;
  phase: 'request' | 'generation' | 'validation' | 'execution' | 'internal' | null;
  displayTarget: 'sql-box' | 'error-box' | null;
  code: string | null;
  result: QueryResult | null;
  retrievedTables: string[];
  schemaContext: string | null;
  promptPreview: {
    systemPrompt: string;
    userPrompt: string;
  } | null;
  lastError: {
    phase: 'validation' | 'execution';
    message: string;
  } | null;
  finalError: {
    code: string;
    phase: 'request' | 'generation' | 'validation' | 'execution' | 'internal';
    message: string;
    detail?: string;
  } | null;
  tokens: {
    prompt?: number;
    completion?: number;
  } | null;
  agentSteps: Array<{
    node: string;
    status: 'running' | 'done' | 'error';
    detail?: string;
  }>;
  retryCount: number | null;
  maxRetries: number | null;
  maxAttempts: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatConversationMessage[];
}

export interface ChatListResponse {
  conversations: ChatConversationSummary[];
}

export interface ChatDetailResponse {
  conversation: ChatConversationDetail;
}

export interface CreateChatRequest {
  dbId?: string | null;
  title?: string;
}

export interface CreateChatResponse {
  conversation: ChatConversationSummary;
}
