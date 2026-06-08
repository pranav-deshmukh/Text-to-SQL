# query-engine-py

Python migration target for the Text-to-SQL query engine.

## Phase 1 scope

- Multi-database config loading
- LangGraph agent shell
- FastAPI startup and health endpoints
- Core state, graph, and node boundaries mirroring the TypeScript service

## First-Time Setup

Run this once after cloning the repo or whenever you recreate the virtual environment:

```powershell
cd services/query-engine-py
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
```

## Start The Codebase

After the virtual environment already exists, start it like this:

```powershell
cd services/query-engine-py
.venv\Scripts\Activate.ps1
uvicorn main:app --reload --app-dir src --port 3001
```

## Environment Variables

Create a `.env` file inside `services/query-engine-py`.

At minimum, keep these aligned with the TypeScript service:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `QDRANT_URL`
- `DB_REGISTRY`
- `APP_ENV`

## Do I Need To Install Dependencies Every Time?

No.

You only need to run `pip install -e .` again when one of these happens:

- you create a new virtual environment
- `pyproject.toml` dependencies change
- your local environment gets deleted or corrupted

In normal daily use, you only need to:

```powershell
cd services/query-engine-py
.venv\Scripts\Activate.ps1
uvicorn main:app --reload --app-dir src --port 3001
```

## Current Status

This Python service is still a Phase 1 scaffold.

Working now:

- `GET /health`
- `GET /databases`

Not fully implemented yet:

- SQL generation
- SQL validation against SQL Server
- SQL execution
- RAG seeding and retrieval logic
- streaming query endpoints
