# How RAG Works in QueryAssist

## Goal

The RAG layer gives the LLM the database context it needs for the current question. The system supports multiple databases, each with its own Qdrant collection, and can operate in two retrieval modes: similarity search or full-schema fetch.

The implementation seeds Qdrant directly from SQL Server metadata. It does not depend on handwritten business descriptions in local markdown files.

---

## Multi-Database Architecture

QueryAssist supports multiple databases simultaneously via a **database registry**. Each registered database gets:

- its own SQL Server connection
- its own Qdrant collection (named `sql_context_<dbId>`)
- its own validator whitelist

### Database Registration

Databases are registered via the `DB_REGISTRY` environment variable — a JSON array:

```json
[
  { "dbId": "bykestores", "displayName": "Byke Stores", "connectionString": "..." },
  { "dbId": "lpl_poc", "displayName": "LPL POC", "connectionString": "..." },
  { "dbId": "AdventureWorks2019", "displayName": "Enterprise AI Test DB", "connectionString": "..." }
]
```

At startup, the query engine initializes all registered databases: connects to SQL Server, loads the validator whitelist from `INFORMATION_SCHEMA`, and verifies the Qdrant collection is ready.

### Database Selection

The frontend stores the user's selected database in `localStorage` so it persists across page reloads and navigation. Every query request includes the `dbId` to ensure the correct schema context and SQL connection are used.

---

## Source of Truth

The seed pipeline reads metadata directly from each database's SQL Server connection string.

It extracts:

- user tables from `sys.tables`, `sys.schemas`, `sys.columns`, `sys.types`
- primary-key information from `sys.indexes` and `sys.index_columns`
- default constraints from `sys.default_constraints`
- foreign-key relationships from `sys.foreign_keys` and `sys.foreign_key_columns`
- approximate row counts from `sys.dm_db_partition_stats`
- stored procedures and views from `sys.objects` and `sys.sql_modules`
- procedure parameters from `sys.parameters`
- module dependencies from `sys.sql_expression_dependencies`
- CHECK constraints from `sys.check_constraints` (valid values for code columns)
- column value profiles for short `CHAR`/`VARCHAR` columns (top 10 values by frequency from actual data)

This means the RAG corpus is built from the live database catalog, not manual documentation.

---

## What Gets Stored in Qdrant

Each database gets its own collection named `sql_context_<dbId>` (e.g., `sql_context_AdventureWorks2019`).

Each stored point contains:

- embedded text used for similarity search
- stable `docId`
- metadata payload for downstream filtering and interpretation

### Chunk Types

#### 1. Table chunks

One chunk per table.

Each table chunk contains:

- schema-qualified table name
- approximate row count
- primary key columns
- full column list with data types
- nullability, identity, and default information
- outbound foreign-key relationships
- inbound foreign-key relationships

Example shape:

```text
OBJECT TYPE: TABLE
TABLE: dbo.aum_snap
ROW COUNT ESTIMATE: 125034
PRIMARY KEY: snap_id
COLUMNS:
- snap_id: bigint [PRIMARY KEY, NOT NULL]
- acct_id: varchar(20) [NOT NULL]
- rep_id: varchar(20) [NOT NULL]
OUTBOUND RELATIONSHIPS:
- acct_id -> dbo.acct_master.acct_id
- rep_id -> dbo.rep_master.rep_id
INBOUND RELATIONSHIPS:
- none
```

#### 2. Relationship chunks

One chunk per foreign-key edge.

Each relationship chunk contains:

- foreign-key name
- source table and column
- target table and column
- explicit join condition

Example shape:

```text
OBJECT TYPE: RELATIONSHIP
FOREIGN KEY: fk_aum_acct
FROM: dbo.aum_snap.acct_id
TO: dbo.acct_master.acct_id
JOIN CONDITION: dbo.aum_snap.acct_id = dbo.acct_master.acct_id
```

#### 3. Procedure chunks

Stored procedures are embedded because they often encode business usage patterns even when there is no separate business glossary.

Each procedure chunk contains:

- procedure name
- referenced tables detected from dependencies
- procedure parameters
- the SQL definition body

Large procedure bodies are split into multiple segments so one very large module does not become a single oversized embedding.

#### 4. View chunks

Views are treated similarly to stored procedures.

Each view chunk contains:

- view name
- referenced tables
- the view definition body

Views are valuable because they often act as a lightweight semantic layer already present in the client database.

#### 5. CHECK constraint lines (appended to table chunks)

If a table has CHECK constraints, they are appended to the table chunk text:

```text
CHECK CONSTRAINTS:
- chk_rep_stts: ([rep_stts_cd]='AC' OR [rep_stts_cd]='IA' OR [rep_stts_cd]='SU' OR [rep_stts_cd]='TR')
```

This tells the model exactly which values are valid for status/code columns.

#### 6. Column profile chunks

For every short `CHAR`/`VARCHAR` column (max length ≤ 20), the seed script queries the top 10 values by frequency and stores them as a profile chunk:

```text
OBJECT TYPE: COLUMN_PROFILE
TABLE: dbo.rep_master
COLUMN: rep_stts_cd
TOP VALUES: AC (8), IA (2), SU (1), TR (1)
```

This grounds the model with real data values so it does not guess filter constants like `'A'` when the actual value is `'AC'`.

---

## Metadata Stored Alongside Each Chunk

Every chunk also stores payload metadata such as:

- `objectType` — `table`, `relationship`, `procedure`, or `view`
- `schemaName`
- `objectName`
- `tableName` when applicable
- `referencedTables`
- `rowCount` for table chunks
- `segmentIndex` and `segmentCount` for large module chunks
- `source` to indicate the SQL Server catalog source

This metadata is not what gets embedded; it is stored with the vector point to help interpret and assemble context after retrieval.

---

## Seeding Flow

The seeding script is `services/query-engine/src/rag/seed.ts`.

### Multi-Database Seeding

The seed script supports seeding individual databases or all registered databases at once.

**Seed a single database:**

```bash
cd services/query-engine
npx tsx src/rag/seed.ts --db bykestores
```

**Seed all registered databases:**

```bash
cd services/query-engine
npx tsx src/rag/seed.ts --db all
```

Flow per database:

1. Load environment variables and database registry
2. Read the database's connection string from `DB_REGISTRY`
3. Query that database's SQL Server system catalog views and DMVs
4. Build chunk documents for tables, relationships, procedures, views, and column profiles
5. Generate embeddings with Gemini
6. Upsert points into the database's Qdrant collection (`sql_context_<dbId>`)

Each database is seeded independently into its own collection, so reseeding one database does not affect others.

---

## Retrieval Flow

At query time, retrieval operates per-database using the `dbId` from the request.

### Retrieval Modes

Controlled by the `RAG_MODE` environment variable:

#### `RAG_MODE=all` (current default)

All chunks from the database's Qdrant collection are fetched via scroll and injected into the prompt. This gives the LLM the complete schema — every table, relationship, view, procedure, and column profile.

Best for databases with fewer than ~200 tables where the full schema fits within the LLM's context window. Eliminates retrieval misses entirely.

#### `RAG_MODE=similarity` (default when `RAG_MODE` is not set)

1. The user question is embedded with Gemini
2. Qdrant returns the top-K most similar chunks (configured via `RAG_TOP_K`, default 50)
3. Chunks below `RAG_SCORE_THRESHOLD` (default 0.35) are filtered out
4. **Graph expansion** follows foreign-key relationships across 2 hops to pull in related tables the initial search may have missed
5. Retrieved chunks are grouped by object type

Graph expansion example: a question about "vendor revenue" retrieves `Purchasing.Vendor` → hop 1 follows FK to `Production.Product` → hop 2 follows FK to `Sales.SalesOrderDetail`.

### Context Assembly (both modes)

Retrieved chunks are grouped and assembled into a single context string containing:

- table context (DDL, columns, constraints)
- relationship context (FK join conditions)
- view context
- procedure context
- column profile context

That context is injected into the SQL-generation prompt.

### Debug endpoint

`POST /rag-inspect`

Request body:

```json
{
  "question": "Show total AUM by advisor",
  "dbId": "lpl_poc",
  "topK": 10
}
```

Response includes:

- matched chunks with scores
- retrieved tables
- assembled schema context
- prompt preview that will be sent to the LLM

---

## Why This Works Without Manual Business Descriptions

This approach relies on:

- meaningful table and column names when available
- explicit foreign-key relationships
- view logic
- stored procedure logic

Even if there is no business glossary, the model can often infer query structure from these sources.

Stored procedures and views are especially important because they capture real query patterns from the client system.

---

## Limitations

This approach is strong on structure but weaker on hidden business semantics.

Examples of what the database catalog alone may not explain well:

- cryptic code columns
- organization-specific abbreviations
- business rules that exist only in people’s heads or external docs
- when to prefer one table over another if multiple tables look structurally valid

Because of that, the application still needs:

- SQL validation
- clarification for ambiguous questions
- safe defaults and guardrails

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_REGISTRY` | — | JSON array of database configs (`dbId`, `displayName`, `connectionString`) |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `RAG_MODE` | `similarity` | `all` = fetch entire schema; `similarity` = embedding-based search |
| `RAG_TOP_K` | `15` | Number of chunks to fetch in similarity mode |
| `RAG_SCORE_THRESHOLD` | `0.45` | Minimum cosine similarity score in similarity mode |

---

## Design Choices We Made

- We store multiple chunk types instead of one huge schema blob.
- We seed from SQL Server directly instead of local schema markdown files.
- We keep stable point IDs so reseeding updates the same logical chunks.
- We segment large procedures/views to avoid oversized embeddings.
- We return retrieved table names from both direct table hits and referenced-table metadata.
- We use one Qdrant collection per database to isolate schemas.
- We support `RAG_MODE=all` for small-to-medium databases to eliminate retrieval misses.
- We use multi-hop graph expansion in similarity mode to bridge cross-schema joins (e.g., Purchasing → Production → Sales).

---

## Current Non-Goals

The current implementation does not yet embed:

- query feedback memory
- approved question → SQL examples
- code-table expansions (e.g. lookup table joins)
- column-level semantic descriptions written by SMEs

Those can be added later as extra chunk types if retrieval quality needs improvement.

---

## Prompt Rules for Code Values

The system prompt includes explicit rules to prevent the model from guessing filter values:

- Do NOT guess or invent status code values. Only use values confirmed in CHECK_CONSTRAINTS or COLUMN_PROFILE sections.
- If the user says "active", find the relevant status column and its known values from the context before applying a filter.
- If no valid values are available for a filter column, omit the filter rather than guessing.

This was added after testing revealed the model was inventing status codes like `'A'` when the real value was `'AC'`.
