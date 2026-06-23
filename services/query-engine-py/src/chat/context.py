"""
Conversation context loader — builds a concise history string from recent chat messages
to give the LLM context for resolving follow-up references (pronouns, "same", "those", etc.).
"""

import pyodbc

from auth.users import resolve_auth_connection_string

MESSAGES_TABLE = "[dbo].[chat_messages]"
MAX_HISTORY_MESSAGES = 5


def _query_rows(sql_query: str, params: tuple = ()) -> list[pyodbc.Row]:
    conn = pyodbc.connect(resolve_auth_connection_string())
    try:
        cursor = conn.cursor()
        cursor.execute(sql_query, params)
        if cursor.description is None:
            return []
        return cursor.fetchall()
    finally:
        conn.close()


def load_conversation_history(conversation_id: str | None, current_db_id: str | None = None) -> str:
    """
    Load the last N messages from a conversation and format them as a concise
    history string suitable for LLM prompt injection.

    Returns empty string if no conversation or no prior messages.
    """
    if not conversation_id:
        return ""

    rows = _query_rows(
        f"""
        SELECT TOP {MAX_HISTORY_MESSAGES}
            role,
            question_text,
            sql_text,
            status,
            error_text,
            db_id
        FROM {MESSAGES_TABLE}
        WHERE conversation_id = ?
        ORDER BY sequence_no DESC;
        """,
        (conversation_id,),
    )

    if not rows:
        return ""

    # Reverse to chronological order (query was DESC for TOP N)
    rows = list(reversed(rows))

    # Filter to same db_id if provided (avoid cross-db confusion)
    if current_db_id:
        rows = [r for r in rows if not r.db_id or r.db_id == current_db_id]

    if not rows:
        return ""

    lines: list[str] = []
    for i, row in enumerate(rows, 1):
        if row.role == "user" and row.question_text:
            lines.append(f"Q{i}: \"{row.question_text}\"")
        elif row.role == "assistant":
            if row.status == "success" and row.sql_text:
                sql_preview = row.sql_text.strip().replace("\n", " ")[:150]
                lines.append(f"A{i}: SQL: {sql_preview}")
            elif row.status == "error" and row.error_text:
                lines.append(f"A{i}: (failed — {row.error_text[:80]})")
            elif row.sql_text:
                sql_preview = row.sql_text.strip().replace("\n", " ")[:150]
                lines.append(f"A{i}: SQL: {sql_preview}")

    if not lines:
        return ""

    return "\n".join(lines)
