import fs from "fs/promises";
import path from "path";
import { getAuditConfig } from "../config/auditConfig";

export type AuditStageStatus = "success" | "error";

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
  status: "success" | "error";
  question?: string;
  stages: AuditStageRecord[];
  summary?: Record<string, unknown>;
}

interface InFlightAudit {
  requestId: string;
  endpoint: string;
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

async function appendMarkdownEntry(entry: AuditRequestRecord): Promise<void> {
  const config = getAuditConfig();
  if (!config.enabled) return;

  await fs.mkdir(config.logDir, { recursive: true });
  const day = entry.startedAt.slice(0, 10);
  const filePath = path.join(config.logDir, `${day}.md`);

  const markdown = [
    "<!-- AUDIT_ENTRY_START -->",
    "```json",
    JSON.stringify(entry, null, 2),
    "```",
    "<!-- AUDIT_ENTRY_END -->",
    "",
  ].join("\n");

  await fs.appendFile(filePath, markdown, "utf-8");
}

export function beginAudit(requestId: string, endpoint: string, question?: string): void {
  const config = getAuditConfig();
  if (!config.enabled) return;

  inFlight.set(requestId, {
    requestId,
    endpoint,
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

export async function completeAudit(
  requestId: string,
  status: "success" | "error",
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
    question: sanitize(current.question, config.maxTextLength) as string | undefined,
    stages: current.stages,
    summary: sanitize(summary, config.maxTextLength) as Record<string, unknown> | undefined,
  };

  await appendMarkdownEntry(entry);
  inFlight.delete(requestId);
}
