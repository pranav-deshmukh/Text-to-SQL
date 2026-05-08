import { QueryResult } from './query-result';

export interface QueryResponse {
  question?: string;
  sql?: string;
  data?: QueryResult;
  error?: string;
  detail?: string;
  retryCount?: number;
  tokens?: {
    prompt?: number;
    completion?: number;
  };
}
