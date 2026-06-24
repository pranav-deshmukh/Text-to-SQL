import json
from dataclasses import asdict, dataclass
from typing import Any

from fastapi.responses import StreamingResponse

from agent.graph import build_agent_graph
from chat.context import load_conversation_history
from config.settings import get_settings

agent = build_agent_graph()
settings = get_settings()


@dataclass
class AgentNodeUpdate:
    node: str
    sql: str | None = None
    generationError: str | None = None
    validationError: str | None = None
    executionError: str | None = None
    retrievedTables: list[str] | None = None
    retryCount: int | None = None
    maxRetries: int = settings.agent_max_retries
    maxAttempts: int = settings.agent_max_retries + 1
    status: str | None = None
    rowCount: int | None = None
    executionTimeMs: int | None = None


def _get_next_node(update: dict[str, Any]) -> str | None:
    if update.get("generation_error"):
        return "retrieve" if (update.get("retry_count", 0) < settings.agent_max_retries + 1) else "error"
    if update.get("validation_error"):
        if update.get("retry_count", 0) >= settings.agent_max_retries + 1:
            return "error"
        if "parse" in str(update.get("validation_error", "")).lower():
            return "generate"
        return "retrieve"
    if update.get("execution_error"):
        return "generate" if (update.get("retry_count", 0) < settings.agent_max_retries + 1) else "error"
    if update.get("status") == "success":
        return None
    if update.get("status") == "error":
        return "error"
    if update.get("sql"):
        return "validate"
    if update.get("retrieved_tables"):
        return "generate"
    return None


async def execute_agent(question: str, db_id: str, on_node_event=None, conversation_id: str | None = None, needed_columns: list[str] | None = None) -> dict[str, Any]:
    conversation_history = load_conversation_history(conversation_id, current_db_id=db_id)

    accumulated: dict[str, Any] = {
        "question": question,
        "db_id": db_id,
        "error_history": [],
        "retry_count": 0,
        "status": "pending",
    }

    if on_node_event:
        on_node_event({"node": "retrieve", "maxRetries": settings.agent_max_retries, "maxAttempts": settings.agent_max_retries + 1})

    initial_state: dict[str, Any] = {"question": question, "db_id": db_id}
    if conversation_history:
        initial_state["conversation_history"] = conversation_history
    if needed_columns:
        initial_state["needed_columns"] = needed_columns

    stream = agent.astream(initial_state, stream_mode="updates")
    async for chunk in stream:
        for node_name, state_update in chunk.items():
            update = dict(state_update)
            accumulated.update(update)
            event = AgentNodeUpdate(
                node=node_name,
                sql=update.get("sql"),
                generationError=update.get("generation_error"),
                validationError=update.get("validation_error"),
                executionError=update.get("execution_error"),
                retrievedTables=update.get("retrieved_tables"),
                retryCount=update.get("retry_count"),
                status=update.get("status"),
                rowCount=update.get("row_count"),
                executionTimeMs=update.get("execution_time_ms"),
            )
            if on_node_event:
                on_node_event(asdict(event))
                next_node = _get_next_node(update)
                if next_node:
                    on_node_event({"node": next_node, "maxRetries": settings.agent_max_retries, "maxAttempts": settings.agent_max_retries + 1})

    success = accumulated.get("status") == "success"
    return {
        "question": question,
        "sql": accumulated.get("sql", ""),
        "data": {
            "columns": accumulated.get("columns", []),
            "rows": accumulated.get("result", []),
            "rowCount": accumulated.get("row_count", 0),
            "executionTimeMs": accumulated.get("execution_time_ms", 0),
        } if success else None,
        "status": "success" if success else "error",
        "retryCount": accumulated.get("retry_count", 0),
        "maxRetries": settings.agent_max_retries,
        "maxAttempts": settings.agent_max_retries + 1,
        "errorHistory": accumulated.get("error_history", []),
        "retrievedTables": accumulated.get("retrieved_tables", []),
        "availableColumns": accumulated.get("available_columns", []),
        "error": accumulated.get("generation_error") or accumulated.get("validation_error") or accumulated.get("execution_error"),
        "detail": accumulated.get("generation_error") or accumulated.get("validation_error") or accumulated.get("execution_error"),
        "phase": "generation" if accumulated.get("generation_error") else "validation" if accumulated.get("validation_error") else "execution" if accumulated.get("execution_error") else None,
        "finalError": None if success else {
            "code": "PY_AGENT_ERROR",
            "phase": "generation" if accumulated.get("generation_error") else "validation" if accumulated.get("validation_error") else "execution",
            "message": accumulated.get("generation_error") or accumulated.get("validation_error") or accumulated.get("execution_error") or "Agent failed",
        },
    }


def stream_agent(question: str, db_id: str, on_complete=None, response_meta: dict[str, Any] | None = None, conversation_id: str | None = None, needed_columns: list[str] | None = None) -> StreamingResponse:
    async def event_generator():
        events: list[dict[str, Any]] = []

        def collect(event: dict[str, Any]) -> None:
            events.append(event)

        try:
            result = await execute_agent(question, db_id, on_node_event=collect, conversation_id=conversation_id, needed_columns=needed_columns)
            if response_meta:
                result.update(response_meta)
            for event in events:
                yield f"event: node_end\ndata: {json.dumps(event)}\n\n"
            yield f"event: done\ndata: {json.dumps(result)}\n\n"
            if on_complete:
                await on_complete(result)
        except Exception as exc:
            payload = {
                "error": str(exc),
                "detail": str(exc),
                "phase": "internal",
                "code": "PY_AGENT_STREAM_ERROR",
                "maxRetries": settings.agent_max_retries,
                "maxAttempts": settings.agent_max_retries + 1,
            }
            if response_meta:
                payload.update(response_meta)
            yield f"event: error\ndata: {json.dumps(payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")