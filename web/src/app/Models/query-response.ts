import { QueryResult } from './query-result';

export interface QueryResponse {
  question?: string;
  sql?: string;
  data?: QueryResult;
  error?: string;
  detail?: string;
  phase?: 'request' | 'generation' | 'validation' | 'execution' | 'internal';
  displayTarget?: 'sql-box' | 'error-box';
  code?: string;
  retryCount?: number;
  tokens?: {
    prompt?: number;
    completion?: number;
  };
}
