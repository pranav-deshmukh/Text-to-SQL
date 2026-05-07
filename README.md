# Text-to-SQL

> Natural language → validated T-SQL → results. Ask your database questions in plain English.

**Repo:** https://github.com/pranav-deshmukh/Text-to-SQL

---

## What It Does

Text-to-SQL is a RAG-enhanced controlled pipeline that lets non-technical users query a MS SQL Server database using plain English. Type a question, get a data table back — no SQL knowledge required.

```
"For each region, show top 3 advisors by AUM"
        ↓
  RAG retrieves relevant table schemas
        ↓
  Gemini generates T-SQL
        ↓
  4-layer SQL validation (sanitize → PARSEONLY → schema whitelist)
        ↓
  Execute on MS SQL Server
        ↓
  Results shown in chat UI
```

The LLM is **only** the SQL writer. All guardrails, retrieval, validation, and execution are deterministic code.

---

## Architecture

| Step | What Happens |
|---|---|
| 1. RAG Retrieval | User question → vector search → top relevant table schemas fetched from Qdrant |
| 2. Prompt Assembly | System rules + retrieved schema context + user question → one complete prompt |
| 3. LLM (single call) | Gemini generates a T-SQL SELECT query |
| 4. SQL Validation | Layer 1: regex sanitization · Layer 2: `SET PARSEONLY ON` · Layer 3: schema whitelist |
| 5. Execute | Read-only ODBC connection to MS SQL Server, returns rows + metadata |
| 6. Response | Chat UI shows results, generated SQL, row count, execution time |

---

## Tech Stack

| Component | Technology |
|---|---|
| Chat UI | Next.js + Tailwind CSS |
| Backend API | Express (TypeScript) |
| LLM | Gemini 2.5 Flash (Google GenAI SDK) |
| Embeddings | Gemini `gemini-embedding-001` |
| Vector DB | Qdrant |
| SQL Validation | Custom 4-layer pipeline (`SET PARSEONLY ON` via msnodesqlv8) |
| Database | MS SQL Server via `msnodesqlv8` (ODBC) |

---

## Project Structure

```
Text-to-SQL/
├── services/
│   ├── Data/                        # Schema DDL + column definitions
│   └── query-engine/                # Express backend (TypeScript)
│       └── src/
│           ├── index.ts             # Entry point — POST /query
│           ├── context/
│           │   └── promptAssembler.ts
│           ├── rag/
│           │   ├── chunker.ts       # Parse schema → one chunk per table
│           │   ├── seed.ts          # One-time: embed + store in Qdrant
│           │   ├── retriever.ts     # Per-query: embed → search Qdrant
│           │   └── vectorStore.ts   # Qdrant wrapper
│           ├── llm/
│           │   └── gemini.ts        # Gemini wrapper (single call)
│           ├── validator/
│           │   └── sqlValidator.ts  # 4-layer SQL validation pipeline
│           └── executor/
│               └── sqlExecutor.ts  # MS SQL executor
└── web/                             # Next.js chat UI
    └── app/
        └── page.tsx
```

---

## Prerequisites

- Node.js 20+
- Docker (for Qdrant)
- MS SQL Server (local or remote)
- Gemini API key → [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- ODBC Driver 18 for SQL Server (Windows)

---

## Setup & Running Locally

### 1. Clone the repo

```bash
git clone https://github.com/pranav-deshmukh/Text-to-SQL.git
cd Text-to-SQL
```

### 2. Start Qdrant (vector DB)

The repo includes a `docker-compose.yml` that runs Qdrant with a persistent volume:

```bash
docker compose up -d
```

This starts Qdrant on `http://localhost:6333` and persists vector data in a Docker volume (`qdrant_data`) so embeddings survive restarts.

> **Without Docker / Qdrant:** The backend will still start, but the RAG retrieval step will fail on every query since there's no vector store to search. You must run Qdrant and seed it (`npm run seed`) at least once before queries will work.

### 3. Configure the backend

```bash
cd services/query-engine
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=3001
QDRANT_URL=http://localhost:6333
DB_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=YOUR_SERVER;Database=YOUR_DB;Uid=YOUR_USER;Pwd=YOUR_PASSWORD;TrustServerCertificate=Yes;
```

### 4. Install backend dependencies

```bash
npm install
```

### 5. Seed the vector store (one-time)

Chunks your schema files and stores embeddings in Qdrant:

```bash
npm run seed
```

### 6. Start the backend

```bash
npm run dev
# Runs on http://localhost:3001
# Auto-restarts on file changes (tsx watch)
```

### 7. Start the frontend

```bash
cd ../../web
npm install
npm run dev
# Runs on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) and start asking questions.

---

## Example Questions

- `Show total AUM by advisor`
- `List active accounts opened this year`
- `Top 10 advisors by AUM in the Northeast`
- `For each region, show top 3 advisors by AUM with their office and unrealized gain/loss`
- `What tables do we have?`

---

## API

### `POST /query`

```json
// Request
{ "question": "Show total AUM by advisor" }

// Response
{
  "question": "Show total AUM by advisor",
  "sql": "SELECT TOP 1000 r.rep_nm AS AdvisorName, SUM(a.aum_amt) AS TotalAUM ...",
  "data": {
    "columns": ["AdvisorName", "TotalAUM"],
    "rows": [...],
    "rowCount": 42,
    "executionTimeMs": 120
  },
  "retrievedTables": [...]
}
```

### `GET /health`

```json
{ "status": "ok", "service": "query-engine" }
```

---

## SQL Validation Pipeline

All LLM output passes through a 4-layer validator before execution:

1. **Sanitization** — blocks JSON output, DML/DDL keywords (`DROP`, `DELETE`, etc.), multiple statements
2. **`SET PARSEONLY ON`** — SQL Server parses but never executes; 100% T-SQL dialect-accurate
3. **Schema whitelist** — table names verified against `INFORMATION_SCHEMA` (loaded at startup)
4. **Column-level checks** — planned for future

Validation failure returns a `400` with the specific layer and reason — the query never reaches the database.
