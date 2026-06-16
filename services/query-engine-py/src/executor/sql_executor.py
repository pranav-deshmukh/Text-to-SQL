import time
from datetime import date, datetime, time as time_value
from decimal import Decimal

import pyodbc


def _normalize_columns(description: tuple | None) -> list[str]:
    if not description:
        return []

    columns: list[str] = []
    for index, col in enumerate(description, start=1):
        raw_name = str(col[0] or "").strip()
        columns.append(raw_name or f"Column{index}")
    return columns


def _to_json_safe(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (datetime, date, time_value)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


async def execute_sql(sql: str, db_id: str, connection_string: str) -> dict:
    started = time.perf_counter()
    connection = pyodbc.connect(connection_string)
    try:
        cursor = connection.cursor()
        cursor.execute(sql)

        while cursor.description is None and cursor.nextset():
            pass

        if cursor.description is None:
            return {
                "rows": [],
                "columns": [],
                "rowCount": 0,
                "executionTimeMs": int((time.perf_counter() - started) * 1000),
            }

        columns = _normalize_columns(cursor.description)
        rows = []
        for row in cursor.fetchall():
            rows.append({column: _to_json_safe(value) for column, value in zip(columns, row)})

        if not columns and rows:
            columns = list(rows[0].keys())

        return {
            "rows": rows,
            "columns": columns,
            "rowCount": len(rows),
            "executionTimeMs": int((time.perf_counter() - started) * 1000),
        }
    except pyodbc.Error as exc:
        raise RuntimeError(f"SQL execution failed: {exc}") from exc
    finally:
        connection.close()
