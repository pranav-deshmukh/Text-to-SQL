import { QueryResult } from './query-result';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  question?: string;
  sql?: string;
  data?: QueryResult;
  error?: string;
  detail?: string;
  tokens?: {
    prompt?: number;
    completion?: number;
  };
  timestamp: Date;
}
