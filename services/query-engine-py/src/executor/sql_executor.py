import time

import pyodbc


async def execute_sql(sql: str, db_id: str, connection_string: str) -> dict:
    started = time.perf_counter()
    connection = pyodbc.connect(connection_string)
    try:
        cursor = connection.cursor()
        cursor.execute(sql)
        if cursor.description is None:
            return {
                "rows": [],
                "columns": [],
                "rowCount": 0,
                "executionTimeMs": int((time.perf_counter() - started) * 1000),
            }
        columns = [col[0] for col in cursor.description]
        rows = []
        for row in cursor.fetchall():
            rows.append(dict(zip(columns, row)))
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
