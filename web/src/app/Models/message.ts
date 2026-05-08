import { QueryResult } from './query-result';

export interface AgentStep {
  node: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

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
  agentSteps?: AgentStep[];
  retryCount?: number;
  timestamp: Date;
}
