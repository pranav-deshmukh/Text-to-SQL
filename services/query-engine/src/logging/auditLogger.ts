import { getAuditConfig } from "../config/auditConfig";
import { writeAuditRecord } from "./auditDbStore";

export type AuditStageStatus = "success" | "error" | "cancelled";

export interface AuditStageRecord {
  stage: string;
  status: AuditStageStatus;
  timestamp: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface AuditRequestRecord {
  requestId: string;
  endpoint: string;
  appEnv: "dev" | "prod";
  startedAt: string;
  completedAt?: string;
  status: AuditStageStatus;
  dbId?: string;
  dbDisplayName?: string;
  userId?: string;
  userRole?: string;
  question?: string;
  stages: AuditStageRecord[];
  summary?: Record<string, unknown>;
}

export interface AuditRequestContext {
  dbId?: string;
  dbDisplayName?: string;
  userId?: string;
  userRole?: string;
}

interface InFlightAudit {
  requestId: string;
  endpoint: string;
  context?: AuditRequestContext;
  question?: string;
  startedAt: Date;
  stages: AuditStageRecord[];
  stageStarts: Map<string, number>;
}

const inFlight = new Map<string, InFlightAudit>();

function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function sanitize(value: unknown, maxTextLength: number): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return clampText(
      value
        .replace(/(api[_-]?key|token|password|authorization|pwd)\s*[=:]\s*[^\s;]+/gi, "$1=[REDACTED]")
        .replace(/(Driver=\{ODBC Driver 18 for SQL Server\};Server=.*?;Database=.*?;Uid=.*?;Pwd=)(.*?)(;|$)/gi, "$1[REDACTED]$3"),
      maxTextLength,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, maxTextLength));
  }

  if (typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (["password", "pwd", "token", "authorization", "apikey", "apiKey"].includes(key)) {
        cloned[key] = "[REDACTED]";
      } else {
        cloned[key] = sanitize(val, maxTextLength);
      }
    }
    return cloned;
  }

  return value;
}

export function beginAudit(requestId: string, endpoint: string, question?: string, context?: AuditRequestContext): void {
  const config = getAuditConfig();
  if (!config.enabled) return;

  inFlight.set(requestId, {
    requestId,
    endpoint,
    context,
    question,
    startedAt: new Date(),
    stages: [],
    stageStarts: new Map<string, number>(),
  });
}

export function startStage(requestId: string, stage: string): void {
  const current = inFlight.get(requestId);
  if (!current) return;

  current.stageStarts.set(stage, Date.now());
}

export function stageSuccess(requestId: string, stage: string, details?: Record<string, unknown>): void {
  const config = getAuditConfig();
  const current = inFlight.get(requestId);
  if (!config.enabled || !current) return;

  const started = current.stageStarts.get(stage);
  const durationMs = started ? Date.now() - started : undefined;

  current.stages.push({
    stage,
    status: "success",
    timestamp: new Date().toISOString(),
    durationMs,
    details: sanitize(details, config.maxTextLength) as Record<string, unknown> | undefined,
  });
}

export function stageError(requestId: string, stage: string, error: unknown, details?: Record<string, unknown>): void {
  const config = getAuditConfig();
  const current = inFlight.get(requestId);
  if (!config.enabled || !current) return;

  const started = current.stageStarts.get(stage);
  const durationMs = started ? Date.now() - started : undefined;

  const errObj = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        code: (error as Error & { code?: string }).code,
        stack: config.includeStack ? clampText(error.stack || "", config.maxTextLength) : undefined,
      }
    : {
        message: String(error),
      };

  current.stages.push({
    stage,
    status: "error",
    timestamp: new Date().toISOString(),
    durationMs,
    details: sanitize(details, config.maxTextLength) as Record<string, unknown> | undefined,
    error: sanitize(errObj, config.maxTextLength) as { name?: string; message: string; code?: string; stack?: string },
  });
}

export function stageCancelled(requestId: string, stage: string, details?: Record<string, unknown>): void {
  const config = getAuditConfig();
  const current = inFlight.get(requestId);
  if (!config.enabled || !current) return;

  const started = current.stageStarts.get(stage);
  const durationMs = started ? Date.now() - started : undefined;

  current.stages.push({
    stage,
    status: "cancelled",
    timestamp: new Date().toISOString(),
    durationMs,
    details: sanitize(details, config.maxTextLength) as Record<string, unknown> | undefined,
  });
}

export async function completeAudit(
  requestId: string,
  status: AuditStageStatus,
  summary?: Record<string, unknown>,
): Promise<void> {
  const config = getAuditConfig();
  const current = inFlight.get(requestId);
  if (!config.enabled || !current) return;

  const entry: AuditRequestRecord = {
    requestId: current.requestId,
    endpoint: current.endpoint,
    appEnv: config.appEnv,
    startedAt: current.startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status,
    dbId: current.context?.dbId,
    dbDisplayName: current.context?.dbDisplayName,
    userId: current.context?.userId,
    userRole: current.context?.userRole,
    question: sanitize(current.question, config.maxTextLength) as string | undefined,
    stages: current.stages,
    summary: sanitize(summary, config.maxTextLength) as Record<string, unknown> | undefined,
  };

  try {
    await writeAuditRecord(entry);
  } finally {
    inFlight.delete(requestId);
  }
}
