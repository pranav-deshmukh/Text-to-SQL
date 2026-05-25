export interface AuditStageError {
  name?: string;
  message: string;
  code?: string;
  stack?: string;
}

export interface AuditStageRecord {
  stage: string;
  status: 'success' | 'error' | 'cancelled';
  timestamp: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: AuditStageError;
}

export interface AuditRequestRecord {
  requestId: string;
  endpoint: string;
  appEnv: 'dev' | 'prod';
  dbId?: string;
  dbDisplayName?: string;
  userId?: string;
  userRole?: string;
  startedAt: string;
  completedAt?: string;
  status: 'success' | 'error' | 'cancelled';
  question?: string;
  stages: AuditStageRecord[];
  summary?: Record<string, unknown>;
}

export interface AuditLogsResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AuditRequestRecord[];
}
