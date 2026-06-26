from uuid import uuid4

from time import perf_counter

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from agent.service import execute_agent, stream_agent
from agent.review_flow import (
    cancel_review_session,
    get_review_session,
    get_review_status,
    initiate_review_flow,
    regenerate_review_flow,
    resume_review_flow,
    stream_review_flow,
    update_review_session,
)
from api.models import QueryRequest, RagInspectRequest, ReviewCancelRequest, ReviewRegenerateRequest, ReviewRunRequest
from audit.config import get_audit_config
from audit.db_store import query_audit_logs, sync_audit_databases
from audit.logger import begin_audit, complete_audit, log_event, stage_cancelled, stage_error, stage_success, start_stage
from auth.middleware import require_auth
from auth.models import AuthUser, LoginRequest, LoginResponse, SignupRequest
from auth.token import create_auth_token
from auth.users import authenticate_user, create_user, find_user_by_id, register_auth_store
from chat.models import CreateChatRequest, RenameChatRequest
from chat.service import (
    archive_user_conversation,
    create_user_conversation,
    delete_user_conversation,
    get_user_conversation,
    list_user_conversations,
    persist_agent_error,
    persist_agent_success,
    persist_review_draft,
    persist_user_question,
    register_chat_store,
    rename_user_conversation,
    unarchive_user_conversation,
    update_persisted_review_message,
)
from config.db_registry import get_database_config, get_registered_databases
from config.settings import get_settings
from llm.prompts import assemble_prompt_from_rag
from rag.retriever import retrieve_context
from validator.sql_validator import register_validator

settings = get_settings()
app = FastAPI(title="query-engine-py", version="0.1.0")


def run() -> None:
    uvicorn.run("main:app", host="127.0.0.1", port=3001, reload=True, app_dir="src")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    started = perf_counter()
    log_event("info", "request_started", requestId=request_id, method=request.method, path=request.url.path)
    try:
        response = await call_next(request)
    except Exception as exc:
        log_event(
            "error",
            "request_failed",
            requestId=request_id,
            method=request.method,
            path=request.url.path,
            durationMs=int((perf_counter() - started) * 1000),
            error=str(exc),
        )
        raise
    response.headers["x-request-id"] = request_id
    log_event(
        "info",
        "request_completed",
        requestId=request_id,
        method=request.method,
        path=request.url.path,
        statusCode=response.status_code,
        durationMs=int((perf_counter() - started) * 1000),
    )
    return response


@app.on_event("startup")
async def startup() -> None:
    await register_auth_store()
    await register_chat_store()
    for database in get_registered_databases():
        await register_validator(database.db_id, database.connection_string)
    if get_audit_config().enabled:
        await sync_audit_databases(get_registered_databases())


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app_env": settings.app_env,
        "databases": len(get_registered_databases()),
    }


@app.get("/databases")
def list_databases() -> dict:
    return {
        "databases": [
            {"dbId": db.db_id, "displayName": db.display_name}
            for db in get_registered_databases()
        ]
    }


@app.post("/auth/login", response_model=LoginResponse)
async def auth_login(request: LoginRequest) -> LoginResponse:
    user = await authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(status_code=401, detail={"error": "Invalid username or password.", "code": "AUTH_INVALID_CREDENTIALS"})
    return LoginResponse(token=create_auth_token(user), user=user)


@app.post("/auth/signup", response_model=LoginResponse)
async def auth_signup(request: SignupRequest) -> LoginResponse:
    user, error, code = await create_user(request.username, request.password)
    if not user:
        raise HTTPException(status_code=400, detail={"error": error, "code": code})
    return LoginResponse(token=create_auth_token(user), user=user)


@app.get("/auth/me")
async def auth_me(user: AuthUser = Depends(require_auth)) -> dict:
    persisted_user = await find_user_by_id(user.userId)
    if not persisted_user:
        raise HTTPException(status_code=401, detail={"error": "Authentication required.", "code": "AUTH_REQUIRED"})
    return {"user": persisted_user}


@app.get("/chats")
async def chats_list(archived: bool = False, user: AuthUser = Depends(require_auth)) -> dict:
    conversations = await list_user_conversations(user.userId, archived)
    return {"conversations": [conversation.model_dump() for conversation in conversations]}


@app.get("/chats/{conversation_id}")
async def chats_get(conversation_id: str, archived: bool = False, user: AuthUser = Depends(require_auth)) -> dict:
    conversation = await get_user_conversation(user.userId, conversation_id, archived)
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found.", "code": "CHAT_NOT_FOUND"})
    return {"conversation": conversation.model_dump()}


@app.post("/chats")
async def chats_create(request: CreateChatRequest, user: AuthUser = Depends(require_auth)) -> dict:
    conversation = await create_user_conversation(user.userId, request.dbId, request.title)
    return {"conversation": conversation.model_dump()}


@app.patch("/chats/{conversation_id}")
async def chats_rename(conversation_id: str, request: RenameChatRequest, user: AuthUser = Depends(require_auth)) -> dict:
    conversation = await rename_user_conversation(user.userId, conversation_id, request.title)
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found.", "code": "CHAT_NOT_FOUND"})
    return {"conversation": conversation.model_dump()}


@app.post("/chats/{conversation_id}/archive", status_code=204)
async def chats_archive(conversation_id: str, user: AuthUser = Depends(require_auth)) -> Response:
    archived = await archive_user_conversation(user.userId, conversation_id)
    if not archived:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found.", "code": "CHAT_NOT_FOUND"})
    return Response(status_code=204)


@app.post("/chats/{conversation_id}/unarchive", status_code=204)
async def chats_unarchive(conversation_id: str, user: AuthUser = Depends(require_auth)) -> Response:
    restored = await unarchive_user_conversation(user.userId, conversation_id)
    if not restored:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found.", "code": "CHAT_NOT_FOUND"})
    return Response(status_code=204)


@app.delete("/chats/{conversation_id}", status_code=204)
async def chats_delete(conversation_id: str, user: AuthUser = Depends(require_auth)) -> Response:
    deleted = await delete_user_conversation(user.userId, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found.", "code": "CHAT_NOT_FOUND"})
    return Response(status_code=204)


@app.post("/rag-inspect")
async def rag_inspect(request: RagInspectRequest, _user: AuthUser = Depends(require_auth)) -> dict:
    database = next((db for db in get_registered_databases() if db.db_id == request.dbId), None)
    if not database:
        raise HTTPException(status_code=400, detail=f'Unknown database: "{request.dbId}". Use GET /databases for available options.')

    try:
        rag_context = await retrieve_context(request.question, database.qdrant_collection, top_k=request.topK)
        system_prompt, user_prompt = assemble_prompt_from_rag(rag_context["schemaContext"], request.question)
        return {
            "question": request.question,
            "topK": request.topK,
            "retrievedTables": rag_context["tables"],
            "matches": [
                {
                    "id": match["id"],
                    "score": match["score"],
                    "objectType": match.get("objectType"),
                    "objectName": match.get("objectName"),
                    "schemaName": match.get("schemaName"),
                    "tableName": match.get("tableName"),
                    "referencedTables": match.get("referencedTables", []),
                    "text": match["text"],
                }
                for match in rag_context["matches"]
            ],
            "schemaContext": rag_context["schemaContext"],
            "promptPreview": {
                "systemPrompt": system_prompt,
                "userPrompt": user_prompt,
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/query/initiate")
@app.post("/query")
async def query_initiate(request: QueryRequest, raw_request: Request, user: AuthUser = Depends(require_auth)) -> dict:
    database = next((db for db in get_registered_databases() if db.db_id == request.dbId), None)
    if not database:
        raise HTTPException(status_code=400, detail=f'Unknown database: "{request.dbId}". Use GET /databases for available options.')

    request_id = getattr(raw_request.state, "request_id", str(uuid4()))
    begin_audit(request_id, "/query/initiate", request.question, {
        "dbId": request.dbId,
        "dbDisplayName": database.display_name,
        "userId": user.userId,
        "userRole": user.role,
    })
    start_stage(request_id, "request_received")
    stage_success(request_id, "request_received", {"endpoint": "/query/initiate", "method": "POST", "role": user.role})
    conversation, _ = await persist_user_question(user.userId, request.question, request.dbId, request.conversationId)
    if user.role == "tech_team":
        try:
            draft = await initiate_review_flow(request.question, user.userId, request.dbId, conversation_id=conversation.conversationId)
            review_message = await persist_review_draft(conversation.conversationId, draft)
            update_review_session(
                draft["threadId"],
                lambda current: {
                    "conversation_id": conversation.conversationId,
                    "assistant_message_id": review_message.messageId,
                },
            )
            start_stage(request_id, "request_completed")
            stage_success(request_id, "request_completed", {"status": draft["status"], "threadId": draft["threadId"]})
            await complete_audit(request_id, "success", {"endpoint": "/query/initiate", "mode": "tech_review"})
            return {"requestId": request_id, "conversationId": conversation.conversationId, **draft}
        except Exception as exc:
            start_stage(request_id, "request_completed")
            stage_error(request_id, "request_completed", exc, {"endpoint": "/query/initiate"})
            await complete_audit(request_id, "error", {"endpoint": "/query/initiate"})
            raise HTTPException(status_code=400, detail={"error": str(exc), "code": "PY_REVIEW_DRAFT_ERROR"}) from exc

    result = await execute_agent(request.question, request.dbId, conversation_id=conversation.conversationId, needed_columns=request.neededColumns)
    result["requestId"] = request_id
    result["conversationId"] = conversation.conversationId

    if result["status"] == "success":
        await persist_agent_success(conversation.conversationId, result)
        start_stage(request_id, "request_completed")
        stage_success(request_id, "request_completed", {"status": result["status"], "rowCount": result["data"]["rowCount"] if result.get("data") else 0})
        await complete_audit(request_id, "success", {"endpoint": "/query/initiate"})
        return result

    await persist_agent_error(conversation.conversationId, result)
    start_stage(request_id, "request_completed")
    stage_error(request_id, "request_completed", result.get("detail") or result.get("error") or "Query failed", {"endpoint": "/query/initiate", "phase": result.get("phase")})
    await complete_audit(request_id, "error", {"endpoint": "/query/initiate"})
    raise HTTPException(status_code=422 if result.get("phase") == "generation" else 400, detail=result)


@app.post("/query/stream")
async def query_stream(request: QueryRequest, raw_request: Request, user: AuthUser = Depends(require_auth)):
    database = next((db for db in get_registered_databases() if db.db_id == request.dbId), None)
    if not database:
        raise HTTPException(status_code=400, detail=f'Unknown database: "{request.dbId}". Use GET /databases for available options.')

    request_id = getattr(raw_request.state, "request_id", str(uuid4()))
    begin_audit(request_id, "/query/stream", request.question, {
        "dbId": request.dbId,
        "dbDisplayName": database.display_name,
        "userId": user.userId,
        "userRole": user.role,
    })
    start_stage(request_id, "request_received")
    stage_success(request_id, "request_received", {"endpoint": "/query/stream", "method": "POST", "role": user.role})

    conversation, _ = await persist_user_question(user.userId, request.question, request.dbId, request.conversationId)

    async def on_complete(result: dict) -> None:
        if result.get("status") == "success":
            await persist_agent_success(conversation.conversationId, result)
            start_stage(request_id, "request_completed")
            stage_success(request_id, "request_completed", {"endpoint": "/query/stream", "rowCount": (result.get("data") or {}).get("rowCount")})
            await complete_audit(request_id, "success", {"endpoint": "/query/stream"})
        elif result.get("status") == "awaiting_review":
            review_message = await persist_review_draft(conversation.conversationId, result)
            update_review_session(
                result["threadId"],
                lambda current: {
                    "conversation_id": conversation.conversationId,
                    "assistant_message_id": review_message.messageId,
                },
            )
            start_stage(request_id, "request_completed")
            stage_success(request_id, "request_completed", {"endpoint": "/query/stream", "status": "awaiting_review", "threadId": result["threadId"]})
            await complete_audit(request_id, "success", {"endpoint": "/query/stream", "mode": "tech_review"})
        else:
            await persist_agent_error(conversation.conversationId, result)
            start_stage(request_id, "request_completed")
            stage_error(request_id, "request_completed", result.get("detail") or result.get("error") or "Stream failed", {"endpoint": "/query/stream", "phase": result.get("phase")})
            await complete_audit(request_id, "error", {"endpoint": "/query/stream"})

    if user.role == "tech_team":
        print(f"[/query/stream] tech_team neededColumns={request.neededColumns}")
        return stream_review_flow(
            request.question,
            user.userId,
            request.dbId,
            on_complete=on_complete,
            response_meta={"conversationId": conversation.conversationId, "requestId": request_id},
            conversation_id=conversation.conversationId,
            needed_columns=request.neededColumns,
        )

    return stream_agent(
        request.question,
        request.dbId,
        on_complete=on_complete,
        response_meta={"conversationId": conversation.conversationId, "requestId": request_id},
        conversation_id=conversation.conversationId,
        needed_columns=request.neededColumns,
    )


@app.post("/query/resume")
@app.post("/query/review/run")
async def query_resume(request: ReviewRunRequest, raw_request: Request, user: AuthUser = Depends(require_auth)) -> dict:
    if user.role != "tech_team":
        raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})
    request_id = getattr(raw_request.state, "request_id", str(uuid4()))
    session = get_review_session(request.threadId, user.userId)
    database = get_database_config(session.db_id) if session else None
    begin_audit(request_id, "/query/resume", request.approvedSQL, {
        "dbId": session.db_id if session else None,
        "dbDisplayName": database.display_name if database else None,
        "userId": user.userId,
        "userRole": user.role,
    })
    start_stage(request_id, "request_received")
    stage_success(request_id, "request_received", {"endpoint": "/query/resume", "threadId": request.threadId})
    if session is None:
        start_stage(request_id, "request_completed")
        stage_error(request_id, "request_completed", "Review session not found or has expired.", {"endpoint": "/query/resume"})
        await complete_audit(request_id, "error", {"endpoint": "/query/resume", "code": "REVIEW_SESSION_NOT_FOUND"})
        raise HTTPException(status_code=404, detail={"error": "Review session not found or has expired.", "code": "REVIEW_SESSION_NOT_FOUND"})
    try:
        result = await resume_review_flow(request.threadId, user.userId, request.approvedSQL)
        if session.conversation_id and session.assistant_message_id:
            if result["status"] == "awaiting_review":
                await update_persisted_review_message(session.conversation_id, session.assistant_message_id, {
                    "generatedSQL": result.get("generatedSQL"),
                    "editableSQL": result.get("editableSQL"),
                    "status": "awaiting_review",
                    "retrievedTables": result.get("retrievedTables", []),
                    "schemaContext": result.get("schemaContext"),
                    "promptPreview": result.get("promptPreview"),
                    "lastError": result.get("lastError"),
                })
            else:
                await update_persisted_review_message(session.conversation_id, session.assistant_message_id, {
                    "sql": result.get("sql"),
                    "editableSQL": result.get("sql"),
                    "status": "success",
                    "error": None,
                    "detail": None,
                    "result": result.get("data"),
                    "retrievedTables": result.get("retrievedTables", []),
                    "lastError": None,
                    "completedAt": None,
                })
        start_stage(request_id, "request_completed")
        if result["status"] == "awaiting_review":
            stage_error(request_id, "request_completed", (result.get("lastError") or {}).get("message") or "Manual SQL needs correction.", {"endpoint": "/query/resume", "phase": (result.get("lastError") or {}).get("phase")})
            await complete_audit(request_id, "error", {"endpoint": "/query/resume", "phase": (result.get("lastError") or {}).get("phase")})
        else:
            stage_success(request_id, "request_completed", {"endpoint": "/query/resume", "rowCount": (result.get("data") or {}).get("rowCount")})
            await complete_audit(request_id, "success", {"endpoint": "/query/resume", "rowCount": (result.get("data") or {}).get("rowCount")})
        return {"requestId": request_id, "conversationId": session.conversation_id, **result}
    except Exception as exc:
        start_stage(request_id, "request_completed")
        stage_error(request_id, "request_completed", exc, {"endpoint": "/query/resume", "threadId": request.threadId})
        await complete_audit(request_id, "error", {"endpoint": "/query/resume", "code": "INTERNAL_ERROR"})
        raise HTTPException(status_code=404, detail={"error": str(exc), "code": "REVIEW_SESSION_NOT_FOUND"}) from exc


@app.post("/query/regenerate")
@app.post("/query/review/regenerate")
async def query_regenerate(request: ReviewRegenerateRequest, user: AuthUser = Depends(require_auth)) -> dict:
    if user.role != "tech_team":
        raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})
    session = get_review_session(request.threadId, user.userId)
    if session is None:
        raise HTTPException(status_code=404, detail={"error": "Review session not found or has expired.", "code": "REVIEW_SESSION_NOT_FOUND"})
    result = await regenerate_review_flow(request.threadId, user.userId, needed_columns=request.neededColumns)
    if session.conversation_id and session.assistant_message_id:
        await update_persisted_review_message(session.conversation_id, session.assistant_message_id, {
            "generatedSQL": result.get("generatedSQL"),
            "editableSQL": result.get("editableSQL"),
            "status": "awaiting_review",
            "retrievedTables": result.get("retrievedTables", []),
            "schemaContext": result.get("schemaContext"),
            "promptPreview": result.get("promptPreview"),
            "lastError": None,
        })
    return {**result, "conversationId": request.conversationId or session.conversation_id}


@app.post("/query/review/cancel")
async def query_review_cancel(request: ReviewCancelRequest, raw_request: Request, user: AuthUser = Depends(require_auth)) -> dict:
    if user.role != "tech_team":
        raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})
    request_id = getattr(raw_request.state, "request_id", str(uuid4()))
    session = get_review_session(request.threadId, user.userId)
    database = get_database_config(session.db_id) if session else None
    begin_audit(request_id, "/query/review/cancel", session.question if session else None, {
        "dbId": session.db_id if session else None,
        "dbDisplayName": database.display_name if database else None,
        "userId": user.userId,
        "userRole": user.role,
    })
    start_stage(request_id, "request_received")
    stage_success(request_id, "request_received", {"endpoint": "/query/review/cancel", "threadId": request.threadId})
    cancelled_session = cancel_review_session(request.threadId, user.userId)
    if cancelled_session is None:
        start_stage(request_id, "request_completed")
        stage_error(request_id, "request_completed", "Review session not found or has expired.", {"endpoint": "/query/review/cancel"})
        await complete_audit(request_id, "error", {"endpoint": "/query/review/cancel", "code": "REVIEW_SESSION_NOT_FOUND"})
        raise HTTPException(status_code=404, detail={"error": "Review session not found or has expired.", "code": "REVIEW_SESSION_NOT_FOUND"})
    start_stage(request_id, "review_cancelled")
    stage_cancelled(request_id, "review_cancelled", {"threadId": request.threadId, "reason": request.reason or "Execution cancelled by tech team user."})
    start_stage(request_id, "request_completed")
    stage_cancelled(request_id, "request_completed", {"status": "cancelled", "threadId": request.threadId})
    await complete_audit(request_id, "cancelled", {"endpoint": "/query/review/cancel", "threadId": request.threadId, "reason": request.reason or "Execution cancelled by tech team user."})
    return {
        "requestId": request_id,
        "status": "cancelled",
        "threadId": request.threadId,
        "question": cancelled_session.question,
        "detail": f"The generated SQL for \"{cancelled_session.question}\" was not executed. Submit the question again to regenerate a draft.",
    }


@app.get("/query/status/{thread_id}")
async def query_status(thread_id: str, user: AuthUser = Depends(require_auth)) -> dict:
    if user.role != "tech_team":
        raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})
    result = get_review_status(thread_id, user.userId)
    if result is None:
        raise HTTPException(status_code=404, detail={"error": "Review session not found or has expired.", "code": "REVIEW_SESSION_NOT_FOUND"})
    return result


@app.get("/config")
async def app_config(_user: AuthUser = Depends(require_auth)) -> dict:
    return {
        "agent": {
            "maxRetries": settings.agent_max_retries,
            "maxAttempts": settings.agent_max_retries + 1,
        }
    }


@app.get("/logs/api")
async def logs_api(
    q: str | None = None,
    status: str | None = None,
    stage: str | None = None,
    dbId: str | None = None,
    env: str = "all",
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    page: int = 1,
    pageSize: int = 20,
    user: AuthUser = Depends(require_auth),
) -> dict:
    if user.role != "tech_team":
        raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})

    audit_config = get_audit_config()
    if audit_config.app_env != "dev" or not audit_config.ui_enabled:
        raise HTTPException(status_code=403, detail={"error": "Logs API is available only in dev mode."})

    return await query_audit_logs(
        {
            "q": q,
            "stage": stage,
            "status": status if status in {"success", "error", "cancelled"} else None,
            "from": from_,
            "to": to,
            "dbId": dbId,
            "env": env if env in {"dev", "prod", "all"} else "all",
            "page": max(1, page),
            "pageSize": min(100, max(1, pageSize)),
        }
    )
