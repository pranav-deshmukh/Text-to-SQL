import { QueryResult } from './query-result';

export interface QueryResponse {
  requestId?: string;
  conversationId?: string;
  status?: 'success' | 'error' | 'cancelled' | 'awaiting_review';
  question?: string;
  sql?: string;
  threadId?: string;
  generatedSQL?: string;
  editableSQL?: string;
  schemaContext?: string;
  retrievedTables?: string[];
  availableColumns?: { tableName: string; columns: { name: string; dataType: string }[] }[];
  promptPreview?: {
    systemPrompt: string;
    userPrompt: string;
  };
  lastError?: {
    phase: 'validation' | 'execution';
    message: string;
  };
  data?: QueryResult;
  error?: string;
  detail?: string;
  phase?: 'request' | 'generation' | 'validation' | 'execution' | 'internal';
  displayTarget?: 'sql-box' | 'error-box';
  code?: string;
  finalError?: {
    code: string;
    phase: 'request' | 'generation' | 'validation' | 'execution' | 'internal';
    message: string;
    detail?: string;
  } | null;
  retryCount?: number;
  maxRetries?: number;
  maxAttempts?: number;
  tokens?: {
    prompt?: number;
    completion?: number;
  };
}
