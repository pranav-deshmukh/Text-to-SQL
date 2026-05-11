# How RAG Works in QueryAssist

## Goal

The RAG layer gives the LLM only the database context it needs for the current question instead of dumping the full schema into every prompt.

The updated implementation seeds Qdrant directly from SQL Server metadata. It no longer depends on handwritten business descriptions in local markdown files.

---

## Source of Truth

The seed pipeline reads metadata directly from SQL Server using `DB_CONNECTION_STRING`.

It extracts:

- user tables from `sys.tables`, `sys.schemas`, `sys.columns`, `sys.types`
- primary-key information from `sys.indexes` and `sys.index_columns`
- default constraints from `sys.default_constraints`
- foreign-key relationships from `sys.foreign_keys` and `sys.foreign_key_columns`
- approximate row counts from `sys.dm_db_partition_stats`
- stored procedures and views from `sys.objects` and `sys.sql_modules`
- procedure parameters from `sys.parameters`
- module dependencies from `sys.sql_expression_dependencies`

This means the RAG corpus is built from the live database catalog, not manual documentation.

It also extracts:

- CHECK constraints from `sys.check_constraints` (valid values for code columns)
- column value profiles for short `CHAR`/`VARCHAR` columns (top 10 values by frequency from actual data)

---

## What Gets Stored in Qdrant

The collection name is `sql_context`.

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

Flow:

1. Load environment variables
2. Read `DB_CONNECTION_STRING`
3. Query SQL Server system catalog views and DMVs
4. Build chunk documents for tables, relationships, procedures, and views
5. Generate embeddings with Gemini
6. Upsert points into Qdrant collection `sql_context`

Run it with:

```bash
cd services/query-engine
npm run seed
```

Because the old Qdrant data was removed, the next seed run will repopulate the collection from the current database state.

---

## Retrieval Flow

At query time:

1. The user question is embedded with Gemini
2. Qdrant returns the top matching chunks
3. Retrieved chunks are grouped by object type
4. The API assembles a single context string containing:
   - table context
   - relationship context
   - view context
   - procedure context
5. That context is injected into the SQL-generation prompt

The LLM therefore sees structural database knowledge, not the full catalog.

### Debug endpoint

There is also a debug API endpoint for inspecting retrieval behavior without executing SQL:

`POST /rag-inspect`

Request body:

```json
{
   "question": "Show total AUM by advisor",
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

## Design Choices We Made

- We store multiple chunk types instead of one huge schema blob.
- We seed from SQL Server directly instead of local schema markdown files.
- We keep stable point IDs so reseeding updates the same logical chunks.
- We segment large procedures/views to avoid oversized embeddings.
- We return retrieved table names from both direct table hits and referenced-table metadata.

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
