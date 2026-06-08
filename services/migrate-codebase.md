# Query Engine Migration: TypeScript → Python

## Overview

Migrate `services/query-engine` to Python using LangGraph, FastAPI, and the Python ecosystem. The new service lives at `services/query-engine-py`.

---

## Target Stack

| Component | Current (TypeScript) | Target (Python) |
|-----------|---------------------|-----------------|
| Web framework | Express + SSE | FastAPI + StreamingResponse |
| Agent framework | Custom graph (graph.ts) | LangGraph |
| LLM SDK | @google/genai | google-genai (Python) |
| Embeddings | @google/genai | google-genai (Python) |
| Vector DB client | @qdrant/js-client-rest | qdrant-client |
| SQL connection | node-odbc | pyodbc |
| Auth | jsonwebtoken | PyJWT |
| Config | dotenv | pydantic-settings |
| Dev server | tsx watch | uvicorn --reload |

---

## Folder Structure

```
services/query-engine-py/
├── pyproject.toml
├── .env
├── README.md
├── src/
│   ├── main.py                     # FastAPI app, routes, startup
│   ├── config/
│   │   ├── settings.py             # Pydantic Settings (env vars)
│   │   └── db_registry.py          # Multi-DB registry
│   ├── agent/
│   │   ├── graph.py                # LangGraph StateGraph definition
│   │   ├── state.py                # TypedDict agent state
│   │   └── nodes.py                # retrieve, generate, validate, execute nodes
│   ├── rag/
│   │   ├── vector_store.py         # Qdrant + Gemini embeddings
│   │   ├── retriever.py            # getAllDocuments / similarity search
│   │   ├── chunker.py              # SQL Server metadata introspection
│   │   └── seed.py                 # CLI: seed Qdrant collections
│   ├── llm/
│   │   ├── gemini.py               # Gemini generation wrapper
│   │   └── prompts.py              # System prompt (multi-step)
│   ├── validator/
│   │   └── sql_validator.py        # PARSEONLY + schema whitelist
│   ├── executor/
│   │   └── sql_executor.py         # pyodbc query execution
│   ├── auth/
│   │   ├── middleware.py           # JWT verification dependency
│   │   ├── users.py                # User store (pyodbc)
│   │   └── models.py               # Auth Pydantic models
│   └── chat/
│       ├── repository.py           # Chat history CRUD
│       ├── service.py              # Conversation logic
│       └── models.py               # Chat Pydantic models
└── tests/
    ├── test_agent.py
    ├── test_retriever.py
    └── test_validator.py
```

---

## Phases

### Phase 1: Core Pipeline (Agent + RAG + LLM)

Get a single query working end-to-end: question → retrieve schema → generate SQL → validate → execute → return results.

#### TODOs

- [ ] Initialize `services/query-engine-py` with `pyproject.toml`
- [ ] Set up `pydantic-settings` config (DB_REGISTRY, GEMINI_API_KEY, QDRANT_URL, etc.)
- [ ] Port `db_registry.py` — parse DB_REGISTRY JSON, expose DatabaseConfig
- [ ] Port `vector_store.py` — Qdrant client + Gemini embeddings + getAllDocuments + searchDocuments
- [ ] Port `chunker.py` — pyodbc introspection of sys.tables, sys.columns, sys.foreign_keys, etc.
- [ ] Port `seed.py` — CLI script to seed Qdrant per database
- [ ] Port `retriever.py` — getAllDocuments mode (full schema context)
- [ ] Port `prompts.py` — the 5-step system prompt
- [ ] Port `gemini.py` — google-genai generateContent wrapper
- [ ] Port `sql_validator.py` — PARSEONLY check + table whitelist via pyodbc
- [ ] Port `sql_executor.py` — execute query, return rows/columns/timing
- [ ] Build `state.py` — LangGraph TypedDict (question, dbId, context, sql, result, errors, retryCount)
- [ ] Build `nodes.py` — retrieve_node, generate_node, validate_node, execute_node, error_node
- [ ] Build `graph.py` — LangGraph StateGraph with conditional routing (retry logic)
- [ ] Test: run a question against HospitalAnalyticsDB end-to-end

### Phase 2: API Layer (FastAPI)

Expose the agent as HTTP endpoints matching the existing frontend contract.

#### TODOs

- [ ] `POST /query/stream` — SSE streaming (agent step events)
- [ ] `POST /query/initiate` — non-streaming single response
- [ ] `GET /databases` — list registered databases
- [ ] `POST /rag-inspect` — debug endpoint (retrieval + prompt preview)
- [ ] Proper error responses matching current frontend expectations
- [ ] CORS configuration
- [ ] Request/response Pydantic models matching current TypeScript interfaces

### Phase 3: Auth + Chat History

Port authentication and conversation persistence.

#### TODOs

- [ ] `auth/middleware.py` — FastAPI Dependency for JWT verification
- [ ] `auth/users.py` — pyodbc queries against QueryAssist.Users table
- [ ] `POST /auth/login`, `POST /auth/signup`, `GET /auth/me` endpoints
- [ ] `chat/repository.py` — CRUD for conversations + messages
- [ ] `chat/service.py` — conversation management (create, rename, delete, load history)
- [ ] `GET /conversations`, `GET /conversations/:id/messages`, `DELETE /conversations/:id`
- [ ] Wire chat persistence into agent flow (save messages after execution)

### Phase 4: Review Flow (Tech Team)

Port the SQL review/edit/regenerate flow for tech_team users.

#### TODOs

- [ ] Review session state management
- [ ] `POST /query/review/run` — execute edited SQL
- [ ] `POST /query/review/regenerate` — re-run agent with feedback
- [ ] `POST /query/review/cancel` — discard review
- [ ] Role-based routing: end_user → auto-execute, tech_team → awaiting_review

### Phase 5: Audit + Logging

Port the audit logging system.

#### TODOs

- [ ] Audit DB store (pyodbc insert into AuditSQL table)
- [ ] Request/response logging middleware
- [ ] Structured logging with Python `logging` module
- [ ] Markdown log files (optional, for dev mode)

---

## Key Implementation Notes

### LangGraph State

```python
from typing import TypedDict, Annotated

class AgentState(TypedDict):
    question: str
    db_id: str
    context: str
    retrieved_tables: list[str]
    sql: str
    result: list[dict] | None
    columns: list[str]
    row_count: int
    execution_time_ms: int
    generation_error: str
    validation_error: str
    execution_error: str
    error_history: Annotated[list[str], lambda x, y: x + y]
    retry_count: int
    status: str
```

### LangGraph Conditional Routing

```python
def route_after_generate(state: AgentState) -> str:
    if state["generation_error"]:
        return "error" if state["retry_count"] >= 3 else "retrieve"
    return "validate"

def route_after_validate(state: AgentState) -> str:
    if state["validation_error"]:
        if state["retry_count"] >= 3:
            return "error"
        if "parse" in state["validation_error"].lower():
            return "generate"  # syntax error, just regenerate
        return "retrieve"  # schema error, re-retrieve
    return "execute"

def route_after_execute(state: AgentState) -> str:
    if state["execution_error"]:
        return "error" if state["retry_count"] >= 3 else "generate"
    return "__end__"
```

### FastAPI Streaming (SSE)

```python
from fastapi.responses import StreamingResponse
import json

@app.post("/query/stream")
async def stream_query(request: QueryRequest):
    async def event_generator():
        async for event in agent.astream(initial_state):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

### pyodbc Connection

```python
import pyodbc

def get_connection(connection_string: str) -> pyodbc.Connection:
    return pyodbc.connect(connection_string)

def execute_sql(sql: str, connection_string: str) -> dict:
    conn = get_connection(connection_string)
    cursor = conn.cursor()
    cursor.execute(sql)
    columns = [col[0] for col in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    conn.close()
    return {"columns": columns, "rows": rows, "row_count": len(rows)}
```

---

## Migration Order (recommended)

```
Week 1: Phase 1 — Core pipeline working locally
Week 2: Phase 2 — API layer, frontend can switch backends
Week 3: Phase 3 — Auth + Chat, full feature parity
Week 4: Phase 4+5 — Review flow + audit, production-ready
```

---

## Running

```bash
cd services/query-engine-py
pip install -e .
uvicorn src.main:app --reload --port 3001
```

Seed databases:
```bash
python -m src.rag.seed --db all
```

---

## Notes

- Keep the TypeScript version running in parallel until Python is fully validated
- Frontend (`web/`) requires NO changes — same API contract
- Reuse existing Qdrant collections (same embedding model, same point IDs)
- Reuse existing SQL Server databases and auth tables
