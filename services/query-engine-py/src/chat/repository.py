import json
import uuid

import pyodbc

from auth.users import resolve_auth_connection_string
from chat.models import ChatConversationDetail, ChatConversationMessage, ChatConversationSummary

CONVERSATIONS_TABLE = "[dbo].[chat_conversations]"
MESSAGES_TABLE = "[dbo].[chat_messages]"


def _query_rows(sql_query: str, params: tuple = ()) -> list[pyodbc.Row]:
    conn = pyodbc.connect(resolve_auth_connection_string())
    try:
        cursor = conn.cursor()
        cursor.execute(sql_query, params)
        if cursor.description is None:
            conn.commit()
            return []
        rows = cursor.fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()


def _to_iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat() + ("Z" if not str(value).endswith("Z") else "")
    return str(value)


def _parse_json(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def _map_conversation(row: pyodbc.Row) -> ChatConversationSummary:
    return ChatConversationSummary(
        conversationId=str(row.conversationId),
        title=row.title,
        selectedDbId=row.selectedDbId,
        createdAt=_to_iso(row.createdAt) or "",
        updatedAt=_to_iso(row.updatedAt) or "",
        lastMessageAt=_to_iso(row.lastMessageAt),
        previewText=row.previewText,
    )


def _normalize_retrieved_tables(raw: list) -> list[str]:
    result = []
    for item in raw:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict) and "tableName" in item:
            result.append(item["tableName"])
    return result


def _map_message(row: pyodbc.Row) -> ChatConversationMessage:
    return ChatConversationMessage(
        messageId=str(row.messageId),
        conversationId=str(row.conversationId),
        sequenceNo=int(row.sequenceNo),
        role=row.role,
        messageType=row.messageType,
        question=row.question,
        responseText=row.responseText,
        sql=row.sql,
        generatedSQL=row.generatedSQL,
        editableSQL=row.editableSQL,
        threadId=row.threadId,
        dbId=row.dbId,
        status=row.status,
        error=row.error,
        detail=row.detail,
        phase=row.phase,
        displayTarget=row.displayTarget,
        code=row.code,
        result=_parse_json(row.resultJson),
        retrievedTables=_normalize_retrieved_tables(_parse_json(row.retrievedTablesJson) or []),
        schemaContext=row.schemaContext,
        promptPreview=_parse_json(row.promptPreviewJson),
        lastError=_parse_json(row.lastErrorJson),
        finalError=_parse_json(row.finalErrorJson),
        tokens=_parse_json(row.tokensJson),
        agentSteps=_parse_json(row.agentStepsJson) or [],
        retryCount=row.retryCount,
        maxRetries=row.maxRetries,
        maxAttempts=row.maxAttempts,
        createdAt=_to_iso(row.createdAt) or "",
        completedAt=_to_iso(row.completedAt),
    )


async def register_chat_store() -> None:
    rows = _query_rows(
        f"SELECT (SELECT COUNT(1) FROM {CONVERSATIONS_TABLE}) AS conversationCount, (SELECT COUNT(1) FROM {MESSAGES_TABLE}) AS messageCount;"
    )
    row = rows[0] if rows else None
    print(f"💬 Chat store ready with {getattr(row, 'conversationCount', 0)} conversation(s) and {getattr(row, 'messageCount', 0)} message(s).")


async def list_conversations(user_id: str, archived: bool = False) -> list[ChatConversationSummary]:
    rows = _query_rows(
        f"""
        SELECT
            c.conversation_id AS conversationId,
            c.title,
            c.selected_db_id AS selectedDbId,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            c.last_message_at AS lastMessageAt,
            latest.preview_text AS previewText
        FROM {CONVERSATIONS_TABLE} c
        OUTER APPLY (
            SELECT TOP 1 COALESCE(NULLIF(m.question_text, ''), NULLIF(m.response_text, ''), NULLIF(m.error_text, ''), NULLIF(m.sql_text, '')) AS preview_text
            FROM {MESSAGES_TABLE} m
            WHERE m.conversation_id = c.conversation_id
            ORDER BY m.sequence_no DESC
        ) latest
        WHERE c.user_id = ? AND c.is_archived = ?
        ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC, c.created_at DESC;
        """,
        (user_id, 1 if archived else 0),
    )
    return [_map_conversation(row) for row in rows]


async def get_conversation(user_id: str, conversation_id: str, archived: bool = False) -> ChatConversationDetail | None:
    rows = _query_rows(
        f"""
        SELECT TOP 1
            c.conversation_id AS conversationId,
            c.title,
            c.selected_db_id AS selectedDbId,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            c.last_message_at AS lastMessageAt,
            latest.preview_text AS previewText
        FROM {CONVERSATIONS_TABLE} c
        OUTER APPLY (
            SELECT TOP 1 COALESCE(NULLIF(m.question_text, ''), NULLIF(m.response_text, ''), NULLIF(m.error_text, ''), NULLIF(m.sql_text, '')) AS preview_text
            FROM {MESSAGES_TABLE} m
            WHERE m.conversation_id = c.conversation_id
            ORDER BY m.sequence_no DESC
        ) latest
        WHERE c.user_id = ? AND c.conversation_id = ? AND c.is_archived = ?;
        """,
        (user_id, conversation_id, 1 if archived else 0),
    )
    if not rows:
        return None
    convo = _map_conversation(rows[0])
    message_rows = _query_rows(
        f"""
        SELECT
            m.message_id AS messageId,
            m.conversation_id AS conversationId,
            m.sequence_no AS sequenceNo,
            m.role,
            m.message_type AS messageType,
            m.question_text AS question,
            m.response_text AS responseText,
            m.sql_text AS sql,
            m.generated_sql AS generatedSQL,
            m.editable_sql AS editableSQL,
            m.thread_id AS threadId,
            m.db_id AS dbId,
            m.status,
            m.error_text AS error,
            m.detail_text AS detail,
            m.phase,
            m.display_target AS displayTarget,
            m.code,
            m.result_json AS resultJson,
            m.retrieved_tables_json AS retrievedTablesJson,
            m.schema_context AS schemaContext,
            m.prompt_preview_json AS promptPreviewJson,
            m.last_error_json AS lastErrorJson,
            m.final_error_json AS finalErrorJson,
            m.tokens_json AS tokensJson,
            m.agent_steps_json AS agentStepsJson,
            m.retry_count AS retryCount,
            m.max_retries AS maxRetries,
            m.max_attempts AS maxAttempts,
            m.created_at AS createdAt,
            m.completed_at AS completedAt
        FROM {MESSAGES_TABLE} m
        WHERE m.conversation_id = ?
        ORDER BY m.sequence_no ASC;
        """,
        (conversation_id,),
    )
    return ChatConversationDetail(**convo.model_dump(), messages=[_map_message(row) for row in message_rows])


async def create_conversation(user_id: str, selected_db_id: str | None, title: str) -> ChatConversationSummary:
    conversation_id = str(uuid.uuid4())
    rows = _query_rows(
        f"""
        INSERT INTO {CONVERSATIONS_TABLE} (conversation_id, user_id, title, selected_db_id, created_at, updated_at, last_message_at, is_archived)
        OUTPUT inserted.conversation_id AS conversationId, inserted.title, inserted.selected_db_id AS selectedDbId, inserted.created_at AS createdAt, inserted.updated_at AS updatedAt, inserted.last_message_at AS lastMessageAt, NULL AS previewText
        VALUES (?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME(), NULL, 0);
        """,
        (conversation_id, user_id, title, selected_db_id),
    )
    return _map_conversation(rows[0])


async def update_conversation_metadata(conversation_id: str, title: str | None = None, selected_db_id: str | None = None, touch_last_message_at: bool = False) -> None:
    sets = ["updated_at = SYSUTCDATETIME()"]
    params: list = []
    if title is not None:
        sets.append("title = ?")
        params.append(title)
    if selected_db_id is not None:
        sets.append("selected_db_id = ?")
        params.append(selected_db_id)
    if touch_last_message_at:
        sets.append("last_message_at = SYSUTCDATETIME()")
    params.append(conversation_id)
    _query_rows(f"UPDATE {CONVERSATIONS_TABLE} SET {', '.join(sets)} WHERE conversation_id = ?;", tuple(params))


async def append_message(input_data: dict) -> ChatConversationMessage:
    message_id = str(uuid.uuid4())
    sequence_rows = _query_rows(f"SELECT ISNULL(MAX(sequence_no), 0) + 1 AS nextSequence FROM {MESSAGES_TABLE} WHERE conversation_id = ?;", (input_data["conversationId"],))
    sequence_no = int(sequence_rows[0][0]) if sequence_rows else 1
    rows = _query_rows(
        f"""
        INSERT INTO {MESSAGES_TABLE} (
            message_id, conversation_id, sequence_no, role, message_type, question_text, response_text, sql_text,
            generated_sql, editable_sql, thread_id, db_id, status, error_text, detail_text, phase, display_target,
            code, result_json, retrieved_tables_json, schema_context, prompt_preview_json, last_error_json,
            final_error_json, tokens_json, agent_steps_json, retry_count, max_retries, max_attempts, created_at, completed_at
        )
        OUTPUT
            inserted.message_id AS messageId,
            inserted.conversation_id AS conversationId,
            inserted.sequence_no AS sequenceNo,
            inserted.role,
            inserted.message_type AS messageType,
            inserted.question_text AS question,
            inserted.response_text AS responseText,
            inserted.sql_text AS sql,
            inserted.generated_sql AS generatedSQL,
            inserted.editable_sql AS editableSQL,
            inserted.thread_id AS threadId,
            inserted.db_id AS dbId,
            inserted.status,
            inserted.error_text AS error,
            inserted.detail_text AS detail,
            inserted.phase,
            inserted.display_target AS displayTarget,
            inserted.code,
            inserted.result_json AS resultJson,
            inserted.retrieved_tables_json AS retrievedTablesJson,
            inserted.schema_context AS schemaContext,
            inserted.prompt_preview_json AS promptPreviewJson,
            inserted.last_error_json AS lastErrorJson,
            inserted.final_error_json AS finalErrorJson,
            inserted.tokens_json AS tokensJson,
            inserted.agent_steps_json AS agentStepsJson,
            inserted.retry_count AS retryCount,
            inserted.max_retries AS maxRetries,
            inserted.max_attempts AS maxAttempts,
            inserted.created_at AS createdAt,
            inserted.completed_at AS completedAt
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), ?);
        """,
        (
            message_id,
            input_data["conversationId"],
            sequence_no,
            input_data["role"],
            input_data["messageType"],
            input_data.get("question"),
            input_data.get("responseText"),
            input_data.get("sql"),
            input_data.get("generatedSQL"),
            input_data.get("editableSQL"),
            input_data.get("threadId"),
            input_data.get("dbId"),
            input_data.get("status"),
            input_data.get("error"),
            input_data.get("detail"),
            input_data.get("phase"),
            input_data.get("displayTarget"),
            input_data.get("code"),
            json.dumps(input_data.get("result")) if input_data.get("result") is not None else None,
            json.dumps(input_data.get("retrievedTables", [])),
            input_data.get("schemaContext"),
            json.dumps(input_data.get("promptPreview")) if input_data.get("promptPreview") is not None else None,
            json.dumps(input_data.get("lastError")) if input_data.get("lastError") is not None else None,
            json.dumps(input_data.get("finalError")) if input_data.get("finalError") is not None else None,
            json.dumps(input_data.get("tokens")) if input_data.get("tokens") is not None else None,
            json.dumps(input_data.get("agentSteps", [])),
            input_data.get("retryCount"),
            input_data.get("maxRetries"),
            input_data.get("maxAttempts"),
            input_data.get("completedAt"),
        ),
    )
    await update_conversation_metadata(input_data["conversationId"], selected_db_id=input_data.get("dbId"), touch_last_message_at=True)
    return _map_message(rows[0])


async def update_message(conversation_id: str, message_id: str, changes: dict) -> ChatConversationMessage | None:
    assignments: list[str] = []
    params: list = []

    mapping = {
        "question": "question_text",
        "responseText": "response_text",
        "sql": "sql_text",
        "generatedSQL": "generated_sql",
        "editableSQL": "editable_sql",
        "threadId": "thread_id",
        "dbId": "db_id",
        "status": "status",
        "error": "error_text",
        "detail": "detail_text",
        "phase": "phase",
        "displayTarget": "display_target",
        "code": "code",
        "schemaContext": "schema_context",
        "retryCount": "retry_count",
        "maxRetries": "max_retries",
        "maxAttempts": "max_attempts",
        "completedAt": "completed_at",
    }
    json_fields = {
        "result": "result_json",
        "retrievedTables": "retrieved_tables_json",
        "promptPreview": "prompt_preview_json",
        "lastError": "last_error_json",
        "finalError": "final_error_json",
        "tokens": "tokens_json",
        "agentSteps": "agent_steps_json",
    }

    for key, column in mapping.items():
        if key in changes:
            assignments.append(f"{column} = ?")
            params.append(changes.get(key))

    for key, column in json_fields.items():
        if key in changes:
            assignments.append(f"{column} = ?")
            value = changes.get(key)
            params.append(json.dumps(value) if value is not None else None)

    if not assignments:
        return None

    params.extend([conversation_id, message_id])
    rows = _query_rows(
        f"""
        UPDATE {MESSAGES_TABLE}
        SET {', '.join(assignments)}
        OUTPUT
            inserted.message_id AS messageId,
            inserted.conversation_id AS conversationId,
            inserted.sequence_no AS sequenceNo,
            inserted.role,
            inserted.message_type AS messageType,
            inserted.question_text AS question,
            inserted.response_text AS responseText,
            inserted.sql_text AS sql,
            inserted.generated_sql AS generatedSQL,
            inserted.editable_sql AS editableSQL,
            inserted.thread_id AS threadId,
            inserted.db_id AS dbId,
            inserted.status,
            inserted.error_text AS error,
            inserted.detail_text AS detail,
            inserted.phase,
            inserted.display_target AS displayTarget,
            inserted.code,
            inserted.result_json AS resultJson,
            inserted.retrieved_tables_json AS retrievedTablesJson,
            inserted.schema_context AS schemaContext,
            inserted.prompt_preview_json AS promptPreviewJson,
            inserted.last_error_json AS lastErrorJson,
            inserted.final_error_json AS finalErrorJson,
            inserted.tokens_json AS tokensJson,
            inserted.agent_steps_json AS agentStepsJson,
            inserted.retry_count AS retryCount,
            inserted.max_retries AS maxRetries,
            inserted.max_attempts AS maxAttempts,
            inserted.created_at AS createdAt,
            inserted.completed_at AS completedAt
        WHERE conversation_id = ? AND message_id = ?;
        """,
        tuple(params),
    )
    await update_conversation_metadata(conversation_id, touch_last_message_at=True)
    return _map_message(rows[0]) if rows else None


async def rename_conversation(user_id: str, conversation_id: str, title: str) -> ChatConversationSummary | None:
    rows = _query_rows(
        f"""
        UPDATE {CONVERSATIONS_TABLE}
        SET title = ?, updated_at = SYSUTCDATETIME()
        OUTPUT inserted.conversation_id AS conversationId, inserted.title, inserted.selected_db_id AS selectedDbId, inserted.created_at AS createdAt, inserted.updated_at AS updatedAt, inserted.last_message_at AS lastMessageAt, NULL AS previewText
        WHERE user_id = ? AND conversation_id = ? AND is_archived = 0;
        """,
        (title, user_id, conversation_id),
    )
    return _map_conversation(rows[0]) if rows else None


async def archive_conversation(user_id: str, conversation_id: str) -> bool:
    rows = _query_rows(f"UPDATE {CONVERSATIONS_TABLE} SET is_archived = 1, updated_at = SYSUTCDATETIME() OUTPUT inserted.conversation_id WHERE user_id = ? AND conversation_id = ? AND is_archived = 0;", (user_id, conversation_id))
    return bool(rows)


async def unarchive_conversation(user_id: str, conversation_id: str) -> bool:
    rows = _query_rows(f"UPDATE {CONVERSATIONS_TABLE} SET is_archived = 0, updated_at = SYSUTCDATETIME() OUTPUT inserted.conversation_id WHERE user_id = ? AND conversation_id = ? AND is_archived = 1;", (user_id, conversation_id))
    return bool(rows)


async def delete_conversation(user_id: str, conversation_id: str) -> bool:
    _query_rows(
        f"DELETE FROM {MESSAGES_TABLE} WHERE conversation_id = ? AND EXISTS (SELECT 1 FROM {CONVERSATIONS_TABLE} WHERE user_id = ? AND conversation_id = ?);",
        (conversation_id, user_id, conversation_id),
    )
    rows = _query_rows(f"DELETE FROM {CONVERSATIONS_TABLE} OUTPUT deleted.conversation_id WHERE user_id = ? AND conversation_id = ?;", (user_id, conversation_id))
    return bool(rows)