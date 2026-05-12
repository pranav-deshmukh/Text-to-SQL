import { QueryResult } from './query-result';

export interface QueryResponse {
  status?: 'success' | 'error';
  question?: string;
  sql?: string;
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
  tokens?: {
    prompt?: number;
    completion?: number;
  };
}
