import { QueryResult } from './query-result';

export interface AgentStep {
  node: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface Message {
  id: string;
  conversationId?: string;
  role: 'user' | 'assistant';
  question?: string;
  responseText?: string;
  sql?: string;
  generatedSQL?: string;
  editableSQL?: string;
  threadId?: string;
  dbId?: string;
  status?: 'success' | 'error' | 'awaiting_review' | 'cancelled';
  allowSqlView?: boolean;
  retrievedTables?: string[];
  availableColumns?: { tableName: string; columns: { name: string; dataType: string }[] }[];
  schemaContext?: string;
  promptPreview?: {
    systemPrompt: string;
    userPrompt: string;
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
  tokens?: {
    prompt?: number;
    completion?: number;
  };
  agentSteps?: AgentStep[];
  retryCount?: number;
  maxRetries?: number;
  maxAttempts?: number;
  lastError?: {
    phase: 'validation' | 'execution';
    message: string;
  } | null;
  timestamp: Date;
}
