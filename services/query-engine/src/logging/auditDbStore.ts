import msnodesqlv8 from "msnodesqlv8";
import { getRegisteredDatabases, type DatabaseConfig } from "../config/dbRegistry";
import { type AuditRequestRecord } from "./auditLogger";

export interface LogQuery {
  q?: string;
  status?: "success" | "error" | "cancelled";
  stage?: string;
  from?: string;
  to?: string;
  dbId?: string;
  env?: "dev" | "prod" | "all";
  page: number;
  pageSize: number;
}

export interface LogQueryResult {
  total: number;
  page: number;
  pageSize: number;
  items: AuditRequestRecord[];
}

interface SqlRequestRow {
  requestId: string;
  endpoint: string;
  appEnv: string;
  startedAt: string;
  completedAt?: string;
  status: "success" | "error" | "cancelled";
  question?: string;
  dbId?: string;
  dbDisplayName?: string;
  userId?: string;
  userRole?: string;
  summaryJson?: string;
}

interface SqlStageRow {
  requestId: string;
  stageOrder: number;
  stage: string;
  status: "success" | "error" | "cancelled";
  timestamp: string;
  durationMs?: number;
  detailsJson?: string;
  errorName?: string;
  errorMessage?: string;
  errorCode?: string;
  errorStack?: string;
}

function resolveAuditConnectionString(): string {
  const explicit = process.env.AUTH_DB_CONNECTION_STRING?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = process.env.DB_CONNECTION_STRING?.trim();
  if (fallback) {
    return fallback;
  }

  const firstRegistered = getRegisteredDatabases()[0]?.connectionString?.trim();
  if (firstRegistered) {
    return firstRegistered;
  }

  throw new Error(
    "No audit database connection is configured. Set AUTH_DB_CONNECTION_STRING or ensure at least one query database is registered.",
  );
}

function queryRows<T>(connectionString: string, sqlQuery: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sqlQuery, (error, rows?: T[]) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows ?? []);
    });
  });
}

function executeNonQuery(connectionString: string, sqlQuery: string): Promise<void> {
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sqlQuery, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function toNullableNVarChar(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return "NULL";
  }

  return `N'${escapeSqlLiteral(value)}'`;
}

function toNullableJson(value: Record<string, unknown> | undefined): string {
  if (!value) {
    return "NULL";
  }

  return `N'${escapeSqlLiteral(JSON.stringify(value))}'`;
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function toIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function buildSearchPattern(query: string): string {
  return `%${query.replace(/[[\]%_]/g, "[$&]")}%`;
}

function normalizeFrom(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  return value;
}

function normalizeToExclusive(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }

  return value;
}

export async function syncAuditDatabases(databases: DatabaseConfig[]): Promise<void> {
  if (databases.length === 0) {
    return;
  }

  const connectionString = resolveAuditConnectionString();

  for (const database of databases) {
    const dbId = escapeSqlLiteral(database.dbId);
    const displayName = escapeSqlLiteral(database.displayName);

    const sql = `
MERGE [audit].[databases] AS target
USING (SELECT N'${dbId}' AS db_id, N'${displayName}' AS display_name) AS source
ON target.db_id = source.db_id
WHEN MATCHED THEN
  UPDATE SET
    display_name = source.display_name,
    is_active = 1,
    updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (db_id, display_name, is_active, created_at, updated_at)
  VALUES (source.db_id, source.display_name, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
`;

    await executeNonQuery(connectionString, sql);
  }
}

export async function writeAuditRecord(entry: AuditRequestRecord): Promise<void> {
  const connectionString = resolveAuditConnectionString();

  const insertRequestSql = `
INSERT INTO [audit].[requests] (
  request_id,
  endpoint,
  app_env,
  status,
  user_id,
  user_role,
  db_id,
  db_display_name,
  question,
  started_at,
  completed_at,
  summary_json
)
VALUES (
  '${escapeSqlLiteral(entry.requestId)}',
  N'${escapeSqlLiteral(entry.endpoint)}',
  N'${escapeSqlLiteral(entry.appEnv)}',
  N'${escapeSqlLiteral(entry.status)}',
  ${toNullableNVarChar(entry.userId)},
  ${toNullableNVarChar(entry.userRole)},
  ${toNullableNVarChar(entry.dbId)},
  ${toNullableNVarChar(entry.dbDisplayName)},
  ${toNullableNVarChar(entry.question)},
  '${escapeSqlLiteral(entry.startedAt)}',
  ${entry.completedAt ? `'${escapeSqlLiteral(entry.completedAt)}'` : "NULL"},
  ${toNullableJson(entry.summary)}
);
`;

  await executeNonQuery(connectionString, insertRequestSql);

  for (let index = 0; index < entry.stages.length; index += 1) {
    const stage = entry.stages[index];
    const insertStageSql = `
INSERT INTO [audit].[stages] (
  request_id,
  stage_order,
  stage_name,
  status,
  [timestamp],
  duration_ms,
  details_json,
  error_name,
  error_message,
  error_code,
  error_stack
)
VALUES (
  '${escapeSqlLiteral(entry.requestId)}',
  ${index + 1},
  N'${escapeSqlLiteral(stage.stage)}',
  N'${escapeSqlLiteral(stage.status)}',
  '${escapeSqlLiteral(stage.timestamp)}',
  ${Number.isFinite(stage.durationMs) ? Number(stage.durationMs) : "NULL"},
  ${toNullableJson(stage.details)},
  ${toNullableNVarChar(stage.error?.name)},
  ${toNullableNVarChar(stage.error?.message)},
  ${toNullableNVarChar(stage.error?.code)},
  ${toNullableNVarChar(stage.error?.stack)}
);
`;

    await executeNonQuery(connectionString, insertStageSql);
  }
}

export async function queryAuditLogs(query: LogQuery): Promise<LogQueryResult> {
  const connectionString = resolveAuditConnectionString();

  const whereClauses: string[] = ["1 = 1"];

  if (query.status) {
    whereClauses.push(`r.status = N'${escapeSqlLiteral(query.status)}'`);
  }

  if (query.dbId) {
    whereClauses.push(`r.db_id = N'${escapeSqlLiteral(query.dbId)}'`);
  }

  if (query.env === "dev" || query.env === "prod") {
    whereClauses.push(`r.app_env = N'${query.env}'`);
  }

  if (query.stage) {
    whereClauses.push(
      `EXISTS (SELECT 1 FROM [audit].[stages] s WHERE s.request_id = r.request_id AND s.stage_name = N'${escapeSqlLiteral(query.stage)}')`,
    );
  }

  if (query.q && query.q.trim().length > 0) {
    const pattern = escapeSqlLiteral(buildSearchPattern(query.q.trim()));
    whereClauses.push(`(
      CAST(r.request_id AS NVARCHAR(36)) LIKE N'${pattern}' ESCAPE N'\\' OR
      r.endpoint LIKE N'${pattern}' ESCAPE N'\\' OR
      ISNULL(r.question, N'') LIKE N'${pattern}' ESCAPE N'\\' OR
      ISNULL(r.summary_json, N'') LIKE N'${pattern}' ESCAPE N'\\' OR
      EXISTS (
        SELECT 1
        FROM [audit].[stages] s
        WHERE s.request_id = r.request_id
          AND (
            s.stage_name LIKE N'${pattern}' ESCAPE N'\\' OR
            ISNULL(s.error_message, N'') LIKE N'${pattern}' ESCAPE N'\\' OR
            ISNULL(s.details_json, N'') LIKE N'${pattern}' ESCAPE N'\\'
          )
      )
    )`);
  }

  if (query.from && query.from.trim().length > 0) {
    const normalizedFrom = escapeSqlLiteral(normalizeFrom(query.from.trim()));
    whereClauses.push(`r.started_at >= '${normalizedFrom}'`);
  }

  if (query.to && query.to.trim().length > 0) {
    const normalizedTo = escapeSqlLiteral(normalizeToExclusive(query.to.trim()));
    whereClauses.push(`r.started_at < '${normalizedTo}'`);
  }

  const whereSql = whereClauses.join("\n  AND ");
  const offset = Math.max(0, (query.page - 1) * query.pageSize);

  const totalRows = await queryRows<{ total: number }>(
    connectionString,
    `SELECT COUNT(1) AS total FROM [audit].[requests] r WHERE ${whereSql};`,
  );

  const requestRows = await queryRows<SqlRequestRow>(
    connectionString,
    `
SELECT
  CAST(r.request_id AS NVARCHAR(36)) AS requestId,
  r.endpoint AS endpoint,
  r.app_env AS appEnv,
  CONVERT(NVARCHAR(33), r.started_at, 127) AS startedAt,
  CONVERT(NVARCHAR(33), r.completed_at, 127) AS completedAt,
  r.status AS status,
  r.question AS question,
  r.db_id AS dbId,
  r.db_display_name AS dbDisplayName,
  r.user_id AS userId,
  r.user_role AS userRole,
  r.summary_json AS summaryJson
FROM [audit].[requests] r
WHERE ${whereSql}
ORDER BY r.started_at DESC
OFFSET ${offset} ROWS FETCH NEXT ${query.pageSize} ROWS ONLY;
`,
  );

  const requestIds = requestRows.map((row) => row.requestId);
  let stageRows: SqlStageRow[] = [];

  if (requestIds.length > 0) {
    const requestIdsSql = requestIds.map((id) => `'${escapeSqlLiteral(id)}'`).join(", ");
    stageRows = await queryRows<SqlStageRow>(
      connectionString,
      `
SELECT
  CAST(s.request_id AS NVARCHAR(36)) AS requestId,
  s.stage_order AS stageOrder,
  s.stage_name AS stage,
  s.status AS status,
  CONVERT(NVARCHAR(33), s.[timestamp], 127) AS [timestamp],
  s.duration_ms AS durationMs,
  s.details_json AS detailsJson,
  s.error_name AS errorName,
  s.error_message AS errorMessage,
  s.error_code AS errorCode,
  s.error_stack AS errorStack
FROM [audit].[stages] s
WHERE s.request_id IN (${requestIdsSql})
ORDER BY s.request_id ASC, s.stage_order ASC;
`,
    );
  }

  const stagesByRequestId = new Map<string, AuditRequestRecord["stages"]>();

  for (const stageRow of stageRows) {
    const currentStages = stagesByRequestId.get(stageRow.requestId) ?? [];
    currentStages.push({
      stage: stageRow.stage,
      status: stageRow.status,
      timestamp: toIso(stageRow.timestamp),
      durationMs: Number.isFinite(stageRow.durationMs) ? Number(stageRow.durationMs) : undefined,
      details: parseJsonObject(stageRow.detailsJson),
      error: stageRow.errorMessage
        ? {
            name: stageRow.errorName,
            message: stageRow.errorMessage,
            code: stageRow.errorCode,
            stack: stageRow.errorStack,
          }
        : undefined,
    });

    stagesByRequestId.set(stageRow.requestId, currentStages);
  }

  const items: AuditRequestRecord[] = requestRows.map((row) => ({
    requestId: row.requestId,
    endpoint: row.endpoint,
    appEnv: row.appEnv === "prod" ? "prod" : "dev",
    startedAt: toIso(row.startedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : undefined,
    status: row.status,
    question: row.question,
    dbId: row.dbId,
    dbDisplayName: row.dbDisplayName,
    userId: row.userId,
    userRole: row.userRole,
    stages: stagesByRequestId.get(row.requestId) ?? [],
    summary: parseJsonObject(row.summaryJson),
  }));

  return {
    total: Number(totalRows[0]?.total || 0),
    page: query.page,
    pageSize: query.pageSize,
    items,
  };
}
