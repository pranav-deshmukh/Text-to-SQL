import json
from typing import Any

from fastapi.responses import StreamingResponse

from agent.review_sessions import (
    cancel_review_session,
    complete_review_session,
    create_review_session,
    get_review_session,
    update_review_session,
)
from chat.context import load_conversation_history
from config.db_registry import get_database_config
from executor.sql_executor import execute_sql
from llm.gemini import call_llm
from llm.prompts import assemble_prompt_from_rag
from rag.retriever import retrieve_context
from validator.sql_validator import validate_sql


def _build_error_payload(
    *,
    error: str,
    detail: str | None = None,
    phase: str = "generation",
    code: str,
    response_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "status": "error",
        "error": error,
        "detail": detail or error,
        "phase": phase,
        "code": code,
        "displayTarget": "error-box",
        "finalError": {
            "code": code,
            "phase": phase,
            "message": error,
            "detail": detail or error,
        },
    }
    if response_meta:
        payload.update(response_meta)
    return payload


def _table_names(tables: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for table in tables:
        table_name = table.get("tableName")
        if isinstance(table_name, str) and table_name:
            names.append(table_name)
    return names


def _build_draft_response(session) -> dict[str, Any]:
    return {
        "status": "awaiting_review",
        "threadId": session.thread_id,
        "question": session.question,
        "generatedSQL": session.generated_sql,
        "editableSQL": session.editable_sql,
        "schemaContext": session.schema_context,
        "promptPreview": session.prompt_preview,
        "retrievedTables": session.retrieved_tables,
        "availableColumns": session.available_columns,
        "lastError": session.last_error,
    }


async def initiate_review_flow(question: str, user_id: str, db_id: str, conversation_id: str | None = None) -> dict[str, Any]:
    database = get_database_config(db_id)
    if database is None:
        raise ValueError(f"Unknown database: {db_id}")
    conversation_history = load_conversation_history(conversation_id, current_db_id=db_id)
    rag_context = await retrieve_context(question, database.qdrant_collection)
    system_prompt, user_prompt = assemble_prompt_from_rag(rag_context["schemaContext"], question, conversation_history=conversation_history)
    generated_sql = (await call_llm(system_prompt, user_prompt)).strip()
    if not generated_sql or generated_sql.upper() == "ERROR":
        raise ValueError("The language model did not return a usable SQL query.")
    session = create_review_session(
        {
            "user_id": user_id,
            "db_id": db_id,
            "question": question,
            "generated_sql": generated_sql,
            "editable_sql": generated_sql,
            "schema_context": rag_context["schemaContext"],
            "prompt_preview": {"systemPrompt": system_prompt, "userPrompt": user_prompt},
            "retrieved_tables": _table_names(rag_context["tables"]),
            "available_columns": rag_context["availableColumns"],
        }
    )
    return _build_draft_response(session)


def stream_review_flow(question: str, user_id: str, db_id: str, on_complete=None, response_meta: dict[str, Any] | None = None, conversation_id: str | None = None, needed_columns: list[str] | None = None) -> StreamingResponse:
    async def event_generator():
        try:
            database = get_database_config(db_id)
            if database is None:
                raise ValueError(f"Unknown database: {db_id}")

            conversation_history = load_conversation_history(conversation_id, current_db_id=db_id)
            rag_context = await retrieve_context(question, database.qdrant_collection)
            yield f"event: node_end\ndata: {json.dumps({'node': 'retrieve', 'retrievedTables': _table_names(rag_context['tables']), 'status': 'done'})}\n\n"

            columns_context = ""
            if needed_columns:
                columns_context = f"\n\nADDITIONAL COLUMNS the user explicitly wants in the SELECT output: {', '.join(needed_columns)}. You MUST include ALL of these columns in the SELECT clause. Rewrite the query to return these columns as individual result columns alongside the answer."

            system_prompt, user_prompt = assemble_prompt_from_rag(rag_context["schemaContext"] + columns_context, question, conversation_history=conversation_history)
            generated_sql = (await call_llm(system_prompt, user_prompt)).strip()
            if not generated_sql or generated_sql.upper() == "ERROR":
                raise ValueError("The language model did not return a usable SQL query.")

            session = create_review_session(
                {
                    "user_id": user_id,
                    "db_id": db_id,
                    "question": question,
                    "generated_sql": generated_sql,
                    "editable_sql": generated_sql,
                    "schema_context": rag_context["schemaContext"],
                    "prompt_preview": {"systemPrompt": system_prompt, "userPrompt": user_prompt},
                    "retrieved_tables": _table_names(rag_context["tables"]),
                    "available_columns": rag_context["availableColumns"],
                }
            )
            payload = _build_draft_response(session)
            if response_meta:
                payload.update(response_meta)
            yield f"event: node_end\ndata: {json.dumps({'node': 'generate', 'sql': generated_sql, 'status': 'awaiting_review'})}\n\n"
            yield f"event: done\ndata: {json.dumps(payload)}\n\n"
            if on_complete:
                await on_complete(payload)
        except Exception as exc:
            payload = _build_error_payload(
                error="SQL review draft generation failed.",
                detail=str(exc),
                phase="generation",
                code="PY_REVIEW_FLOW_ERROR",
                response_meta=response_meta,
            )
            yield f"event: error\ndata: {json.dumps(payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def resume_review_flow(thread_id: str, user_id: str, approved_sql: str) -> dict[str, Any]:
    session = get_review_session(thread_id, user_id)
    if session is None:
        raise ValueError("Review session not found or has expired.")
    trimmed_sql = approved_sql.strip()
    database = get_database_config(session.db_id)
    if database is None:
        raise ValueError(f"Unknown database: {session.db_id}")

    validation_result = await validate_sql(trimmed_sql, session.db_id, database.connection_string)
    if not validation_result.valid:
        updated = update_review_session(
            thread_id,
            lambda current: {
                "editable_sql": trimmed_sql,
                "last_error": {"phase": "validation", "message": validation_result.error or "Manual SQL failed validation."},
            },
        )
        if updated is None:
            raise ValueError("Review session expired before validation could complete.")
        return _build_draft_response(updated)

    try:
        data = await execute_sql(trimmed_sql, session.db_id, database.connection_string)
        complete_review_session(thread_id)
        return {
            "status": "success",
            "threadId": thread_id,
            "question": session.question,
            "sql": trimmed_sql,
            "data": data,
            "retrievedTables": session.retrieved_tables,
            "availableColumns": session.available_columns,
        }
    except Exception as exc:
        updated = update_review_session(
            thread_id,
            lambda current: {
                "editable_sql": trimmed_sql,
                "last_error": {"phase": "execution", "message": str(exc)},
            },
        )
        if updated is None:
            raise ValueError("Review session expired before execution could complete.")
        return _build_draft_response(updated)


async def regenerate_review_flow(thread_id: str, user_id: str, needed_columns: list[str] | None = None) -> dict[str, Any]:
    print(f"[ReviewFlow] regenerate called with needed_columns={needed_columns}")
    session = get_review_session(thread_id, user_id)
    if session is None:
        raise ValueError("Review session not found or has expired.")
    database = get_database_config(session.db_id)
    if database is None:
        raise ValueError(f"Unknown database: {session.db_id}")

    error_context = ""
    if session.last_error:
        error_context = (
            f"\n\nPREVIOUS ERROR (do NOT repeat this mistake):\n"
            f"Phase: {session.last_error['phase']}\n"
            f"Failed SQL: {session.editable_sql}\n"
            f"Error: {session.last_error['message']}"
        )

    columns_context = ""
    if needed_columns:
        columns_context = f"\n\nADDITIONAL COLUMNS the user explicitly wants in the SELECT output: {', '.join(needed_columns)}. You MUST include ALL of these columns in the SELECT clause. Rewrite the query to return these columns as individual result columns alongside the answer."

    enriched_query = (
        f"{session.question} (context: previous SQL failed with {session.last_error['phase']} error: {session.last_error['message']})"
        if session.last_error
        else session.question
    )
    rag_context = await retrieve_context(enriched_query, database.qdrant_collection)
    conversation_history = load_conversation_history(session.conversation_id, current_db_id=session.db_id)
    system_prompt, user_prompt = assemble_prompt_from_rag(rag_context["schemaContext"] + error_context + columns_context, session.question, conversation_history=conversation_history)
    generated_sql = (await call_llm(system_prompt, user_prompt)).strip()
    if not generated_sql or generated_sql.upper() == "ERROR":
        raise ValueError("The language model did not return a usable SQL query on regeneration.")
    updated = update_review_session(
        thread_id,
        lambda current: {
            "generated_sql": generated_sql,
            "editable_sql": generated_sql,
            "schema_context": rag_context["schemaContext"],
            "prompt_preview": {"systemPrompt": system_prompt, "userPrompt": user_prompt},
            "retrieved_tables": _table_names(rag_context["tables"]),
            "available_columns": rag_context["availableColumns"],
            "last_error": None,
        },
    )
    if updated is None:
        raise ValueError("Review session expired before regeneration could complete.")
    return _build_draft_response(updated)


def get_review_status(thread_id: str, user_id: str) -> dict[str, Any] | None:
    session = get_review_session(thread_id, user_id)
    if session is None:
        return None
    return {
        "status": "awaiting_review",
        "threadId": session.thread_id,
        "question": session.question,
        "updatedAt": session.updated_at,
        "lastError": session.last_error,
        "conversationId": session.conversation_id,
    }


__all__ = [
    "cancel_review_session",
    "get_review_session",
    "get_review_status",
    "initiate_review_flow",
    "regenerate_review_flow",
    "resume_review_flow",
    "stream_review_flow",
    "update_review_session",
]