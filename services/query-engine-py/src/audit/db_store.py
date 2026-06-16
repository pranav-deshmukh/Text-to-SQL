import json
from datetime import datetime, timedelta, timezone

import pyodbc

from auth.users import resolve_auth_connection_string
from config.db_registry import DatabaseConfig


def _connection() -> pyodbc.Connection:
    return pyodbc.connect(resolve_auth_connection_string())


def _execute(sql_query: str, params: tuple = ()) -> list[pyodbc.Row]:
    conn = _connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql_query, params)
        rows = cursor.fetchall() if cursor.description else []
        conn.commit()
        return rows
    finally:
        conn.close()


def _parse_json_object(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _to_iso(value) -> str:
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        parsed = value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_from(value: str) -> str:
    if len(value) == 10:
        return f"{value}T00:00:00.000Z"
    return value


def _normalize_to_exclusive(value: str) -> str:
    if len(value) == 10:
        base = datetime.fromisoformat(f"{value}T00:00:00+00:00")
        return (base + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    return value


def _build_search_pattern(query: str) -> str:
    escaped = query.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
    return f"%{escaped}%"


async def sync_audit_databases(databases: list[DatabaseConfig]) -> None:
    if not databases:
        return
    for database in databases:
        _execute(
            """
            MERGE [audit].[databases] AS target
            USING (SELECT ? AS db_id, ? AS display_name) AS source
            ON target.db_id = source.db_id
            WHEN MATCHED THEN
              UPDATE SET display_name = source.display_name, is_active = 1, updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (db_id, display_name, is_active, created_at, updated_at)
              VALUES (source.db_id, source.display_name, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
            """,
            (database.db_id, database.display_name),
        )


async def write_audit_record(entry: dict) -> None:
    _execute(
        """
        INSERT INTO [audit].[requests] (
          request_id, endpoint, app_env, status, user_id, user_role, db_id, db_display_name,
          question, started_at, completed_at, summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry["requestId"],
            entry["endpoint"],
            entry["appEnv"],
            entry["status"],
            entry.get("userId"),
            entry.get("userRole"),
            entry.get("dbId"),
            entry.get("dbDisplayName"),
            entry.get("question"),
            entry["startedAt"],
            entry.get("completedAt"),
            json.dumps(entry.get("summary")) if entry.get("summary") is not None else None,
        ),
    )
    for index, stage in enumerate(entry.get("stages", []), start=1):
        _execute(
            """
            INSERT INTO [audit].[stages] (
              request_id, stage_order, stage_name, status, [timestamp], duration_ms, details_json,
              error_name, error_message, error_code, error_stack
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry["requestId"],
                index,
                stage["stage"],
                stage["status"],
                stage["timestamp"],
                stage.get("durationMs"),
                json.dumps(stage.get("details")) if stage.get("details") is not None else None,
                (stage.get("error") or {}).get("name"),
                (stage.get("error") or {}).get("message"),
                (stage.get("error") or {}).get("code"),
                (stage.get("error") or {}).get("stack"),
            ),
        )


async def query_audit_logs(query: dict) -> dict:
    where_clauses = ["1 = 1"]
    params: list = []

    if query.get("status"):
        where_clauses.append("r.status = ?")
        params.append(query["status"])

    if query.get("dbId"):
        where_clauses.append("r.db_id = ?")
        params.append(query["dbId"])

    if query.get("env") in {"dev", "prod"}:
        where_clauses.append("r.app_env = ?")
        params.append(query["env"])

    if query.get("stage"):
        where_clauses.append(
            "EXISTS (SELECT 1 FROM [audit].[stages] s WHERE s.request_id = r.request_id AND s.stage_name = ?)"
        )
        params.append(query["stage"])

    if query.get("q"):
        pattern = _build_search_pattern(query["q"].strip())
        where_clauses.append(
            """
            (
              CAST(r.request_id AS NVARCHAR(36)) LIKE ? ESCAPE '\\' OR
              r.endpoint LIKE ? ESCAPE '\\' OR
              ISNULL(r.question, N'') LIKE ? ESCAPE '\\' OR
              ISNULL(r.summary_json, N'') LIKE ? ESCAPE '\\' OR
              EXISTS (
                SELECT 1
                FROM [audit].[stages] s
                WHERE s.request_id = r.request_id
                  AND (
                    s.stage_name LIKE ? ESCAPE '\\' OR
                    ISNULL(s.error_message, N'') LIKE ? ESCAPE '\\' OR
                    ISNULL(s.details_json, N'') LIKE ? ESCAPE '\\'
                  )
              )
            )
            """
        )
        params.extend([pattern, pattern, pattern, pattern, pattern, pattern, pattern])

    if query.get("from"):
        where_clauses.append("r.started_at >= ?")
        params.append(_normalize_from(query["from"].strip()))

    if query.get("to"):
        where_clauses.append("r.started_at < ?")
        params.append(_normalize_to_exclusive(query["to"].strip()))

    where_sql = " AND ".join(where_clauses)
    page = max(1, int(query.get("page", 1)))
    page_size = max(1, min(100, int(query.get("pageSize", 20))))
    offset = max(0, (page - 1) * page_size)

    total_rows = _execute(f"SELECT COUNT(1) AS total FROM [audit].[requests] r WHERE {where_sql};", tuple(params))

    request_rows = _execute(
        f"""
        SELECT
          CAST(r.request_id AS NVARCHAR(36)) AS requestId,
          r.endpoint AS endpoint,
          r.app_env AS appEnv,
          r.started_at AS startedAt,
          r.completed_at AS completedAt,
          r.status AS status,
          r.question AS question,
          r.db_id AS dbId,
          r.db_display_name AS dbDisplayName,
          r.user_id AS userId,
          r.user_role AS userRole,
          r.summary_json AS summaryJson
        FROM [audit].[requests] r
        WHERE {where_sql}
        ORDER BY r.started_at DESC
        OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY;
        """,
        tuple(params),
    )

    request_ids = [str(row.requestId) for row in request_rows]
    stages_by_request_id: dict[str, list[dict]] = {}

    if request_ids:
        placeholders = ", ".join("?" for _ in request_ids)
        stage_rows = _execute(
            f"""
            SELECT
              CAST(s.request_id AS NVARCHAR(36)) AS requestId,
              s.stage_order AS stageOrder,
              s.stage_name AS stage,
              s.status AS status,
              s.[timestamp] AS [timestamp],
              s.duration_ms AS durationMs,
              s.details_json AS detailsJson,
              s.error_name AS errorName,
              s.error_message AS errorMessage,
              s.error_code AS errorCode,
              s.error_stack AS errorStack
            FROM [audit].[stages] s
            WHERE s.request_id IN ({placeholders})
            ORDER BY s.request_id ASC, s.stage_order ASC;
            """,
            tuple(request_ids),
        )

        for row in stage_rows:
            stages_by_request_id.setdefault(str(row.requestId), []).append(
                {
                    "stage": row.stage,
                    "status": row.status,
                    "timestamp": _to_iso(row.timestamp),
                    "durationMs": int(row.durationMs) if row.durationMs is not None else None,
                    "details": _parse_json_object(row.detailsJson),
                    "error": {
                        "name": row.errorName,
                        "message": row.errorMessage,
                        "code": row.errorCode,
                        "stack": row.errorStack,
                    } if row.errorMessage else None,
                }
            )

    items = [
        {
            "requestId": str(row.requestId),
            "endpoint": row.endpoint,
            "appEnv": "prod" if row.appEnv == "prod" else "dev",
            "dbId": row.dbId,
            "dbDisplayName": row.dbDisplayName,
            "userId": row.userId,
            "userRole": row.userRole,
            "startedAt": _to_iso(row.startedAt),
            "completedAt": _to_iso(row.completedAt) if row.completedAt is not None else None,
            "status": row.status,
            "question": row.question,
            "stages": stages_by_request_id.get(str(row.requestId), []),
            "summary": _parse_json_object(row.summaryJson),
        }
        for row in request_rows
    ]

    return {
        "total": int(total_rows[0].total) if total_rows else 0,
        "page": page,
        "pageSize": page_size,
        "items": items,
    }