import re
from dataclasses import dataclass

import pyodbc


@dataclass
class ValidationResult:
    valid: bool
    error: str = ""


DANGEROUS_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|DENY)\b",
    re.IGNORECASE,
)

ALLOWED_TABLES_MAP: dict[str, set[str]] = {}


def _sanitize(sql: str) -> ValidationResult:
    trimmed = sql.strip().rstrip(";")
    if trimmed.startswith("{") or trimmed.startswith("["):
        return ValidationResult(valid=False, error="LLM returned JSON instead of SQL.")
    if trimmed.upper() == "ERROR":
        return ValidationResult(valid=False, error="LLM could not generate a valid SQL query.")
    if not re.match(r"^(SELECT|WITH)\b", trimmed, re.IGNORECASE):
        return ValidationResult(valid=False, error=f'Query must start with SELECT or WITH. Got: "{trimmed[:50]}..."')
    match = DANGEROUS_KEYWORDS.search(trimmed)
    if match:
        return ValidationResult(valid=False, error=f"Forbidden keyword detected: {match.group(0)}. Only SELECT statements are allowed.")
    if ";" in trimmed:
        return ValidationResult(valid=False, error="Multiple statements detected (semicolon found). Only a single SELECT is allowed.")
    return ValidationResult(valid=True)


def _check_parseonly(sql: str, connection_string: str) -> ValidationResult:
    parseonly_sql = f"SET PARSEONLY ON;\n{sql}\nSET PARSEONLY OFF;"
    try:
        connection = pyodbc.connect(connection_string)
        try:
            cursor = connection.cursor()
            cursor.execute(parseonly_sql)
            return ValidationResult(valid=True)
        except pyodbc.Error as exc:
            msg = str(exc).replace("SET PARSEONLY ON;", "").replace("SET PARSEONLY OFF;", "").strip()
            return ValidationResult(valid=False, error=f"SQL syntax error (PARSEONLY): {msg}")
        finally:
            connection.close()
    except Exception as exc:
        return ValidationResult(valid=False, error=f"Validation connection failed: {exc}")


async def register_validator(db_id: str, connection_string: str) -> None:
    query = """
        SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS full_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
    """

    connection = pyodbc.connect(connection_string)
    try:
        cursor = connection.cursor()
        cursor.execute(query)
        tables = {
            str(row.full_name).lower()
            for row in cursor.fetchall()
            if getattr(row, "full_name", None)
        }
        ALLOWED_TABLES_MAP[db_id] = tables
    finally:
        connection.close()


def _extract_cte_names(sql: str) -> set[str]:
    cte_pattern = re.compile(r"\b(\w+)\s+AS\s*\(", re.IGNORECASE)
    return {match.group(1).lower() for match in cte_pattern.finditer(sql)}


def _extract_table_names(sql: str) -> list[str]:
    table_pattern = re.compile(r"(?:FROM|JOIN)\s+([\w]+\.[\w]+|[\w]+)", re.IGNORECASE)
    return list({match.group(1).lower() for match in table_pattern.finditer(sql)})


def _check_schema(sql: str, db_id: str) -> ValidationResult:
    allowed_tables = ALLOWED_TABLES_MAP.get(db_id)
    if allowed_tables is None:
        return ValidationResult(valid=False, error=f"Validator not initialized for database: {db_id}.")

    cte_names = _extract_cte_names(sql)
    table_names = _extract_table_names(sql)

    allowed_sys_views = {
        "sys.tables",
        "sys.schemas",
        "sys.partitions",
        "sys.columns",
        "sys.indexes",
        "sys.objects",
        "sys.types",
        "sys.views",
    }

    for table_name in table_names:
        if table_name in cte_names:
            continue
        if table_name.startswith("information_schema."):
            continue
        if table_name in allowed_sys_views:
            continue
        if table_name not in allowed_tables:
            allowed = ", ".join(sorted(allowed_tables))
            return ValidationResult(valid=False, error=f'Unknown table referenced: "{table_name}". Allowed tables: {allowed}.')

    return ValidationResult(valid=True)


async def validate_sql(sql: str, db_id: str, connection_string: str) -> ValidationResult:
    clean_sql = sql.strip().rstrip(";")

    sanitize_result = _sanitize(clean_sql)
    if not sanitize_result.valid:
        return sanitize_result

    parse_result = _check_parseonly(clean_sql, connection_string)
    if not parse_result.valid:
        return parse_result

    return _check_schema(clean_sql, db_id)
