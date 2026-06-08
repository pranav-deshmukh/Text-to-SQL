import json

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