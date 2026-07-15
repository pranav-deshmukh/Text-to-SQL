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
query-engine-py
```

That command starts the FastAPI server on `http://127.0.0.1:3001`.

## Environment Variables

Create a `.env` file inside `services/query-engine-py`.

At minimum, keep these aligned with the TypeScript service:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `QDRANT_URL`
- `DB_REGISTRY`
- `APP_ENV`

For embeddings, the Python service now supports an env switch between Google and Hugging Face without removing the existing Google path:

- `EMBEDDING_PROVIDER=google` uses the current Google embedding flow
- `EMBEDDING_PROVIDER=huggingface` uses Hugging Face inference for embeddings
- `EMBEDDING_MODEL=gemini-embedding-001` is the default Google embedding model
- `EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B` is the Hugging Face model id for Qwen3 Embedding 8B
- `EMBEDDING_MODEL=qwen3-embedding:8b` is also accepted and normalized to the Hugging Face model id
- `HUGGINGFACE_API_KEY` is optional for public access but should be set when your endpoint or quota requires authentication
- `EMBEDDING_VECTOR_SIZE` is optional and can override the default dimension for the selected provider

For RAG retrieval mode, the Python service now supports both dense-only similarity search and hybrid dense+sparse search:

- `RAG_MODE=similarity` keeps the existing dense-only search path
- `RAG_MODE=hybrid` fuses dense and keyword search in Qdrant
- `RAG_MODE=all` bypasses ranking and loads all chunks
- `RAG_HYBRID_PREFETCH_K=50` controls how many dense and sparse candidates are fetched before fusion
- `RAG_HYBRID_FUSION=rrf` selects fusion mode (`rrf` or `dbsf`)
- `SPARSE_EMBEDDING_MODEL=Qdrant/bm25` selects the sparse encoder used for keyword search

Example `.env` values for Hugging Face:

```env
EMBEDDING_PROVIDER=huggingface
EMBEDDING_MODEL=qwen3-embedding:8b
EMBEDDING_VECTOR_SIZE=4096
HUGGINGFACE_API_KEY=your_token_if_needed
```

If you switch providers for an existing Qdrant collection, the collection's vector size must match the active embedding model. Reseed into a fresh collection, or recreate the existing collection before running:

```powershell
python -m rag.seed --db all
```

Hybrid search has an additional migration requirement: existing dense-only collections need to be recreated or versioned before reseeding, because hybrid retrieval stores both a named dense vector and a named sparse vector per chunk. The Qdrant server stays the same; only the collection schema changes.

Example `.env` values for hybrid search:

```env
RAG_MODE=hybrid
RAG_HYBRID_PREFETCH_K=50
RAG_HYBRID_FUSION=rrf
SPARSE_EMBEDDING_MODEL=Qdrant/bm25
```

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
query-engine-py
```

If you added this command after your virtual environment was already created, run this once to refresh the installed entrypoint:

```powershell
python -m pip install -e .
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
