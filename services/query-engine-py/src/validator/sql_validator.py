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


async def validate_sql(sql: str, db_id: str, connection_string: str) -> ValidationResult:
    sanitize_result = _sanitize(sql)
    if not sanitize_result.valid:
        return sanitize_result
    return _check_parseonly(sql, connection_string)
