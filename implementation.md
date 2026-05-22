# Multi-Database Support — Copilot Implementation Prompt

## Goal

Refactor the Text-to-SQL application to support **multiple databases** via a frontend database selector. Each database has its own pre-seeded Qdrant collection and its own SQL Server connection string. The user picks a database from a dropdown; all subsequent queries are scoped entirely to that database's Qdrant collection and SQL connection. No cross-database contamination is possible.

**Architecture rule:** One Qdrant instance, separate collections per database. Collections are seeded once offline via a CLI script — never at runtime.

---

## Codebase Context

The project has two services:

- **Backend:** `services/query-engine/` — Express + TypeScript, LangGraph agent, Qdrant RAG, SQL Server via `msnodesqlv8`
- **Frontend:** `web/` — Angular standalone components, the main chat UI is in `web/src/app/quotes/`

Key files that need changes (read all of them fully before starting):

| File | Current Role | What Changes |
|---|---|---|
| `src/rag/vectorStore.ts` | Hardcoded `COLLECTION_NAME = "sql_context"`, single Qdrant client | Parameterize all functions to accept `collectionName` |
| `src/rag/seed.ts` | Seeds one collection from one `DB_CONNECTION_STRING` | Accept `--db <dbId>` CLI arg, read registry, seed into db-specific collection |
| `src/rag/retriever.ts` | Calls `searchDocuments()` / `getDocumentById()` with no collection param | Pass `collectionName` through |
| `src/rag/chunker.ts` | Accepts a connection string, introspects schema | No change needed (already parameterized) |
| `src/executor/sqlExecutor.ts` | Single global `connectionString` | Connection pool `Map<string, string>` keyed by `dbId`, with `executeSQL(sql, dbId)` |
| `src/validator/sqlValidator.ts` | Single global `ALLOWED_TABLES` set, `initValidator(connStr)` once at startup | Per-db table whitelist: `Map<string, Set<string>>`, `validateSQL(sql, connStr)` already takes connStr — but `ALLOWED_TABLES` must be per-db |
| `src/agent/nodes.ts` | Calls `retrieveContext(query)`, `executeSQL(sql)`, `validateSQL(sql, connStr)` | Thread `dbId` through — get collection + connStr from registry |
| `src/agent/state.ts` | LangGraph agent state — no `dbId` field | Add `dbId` field to agent state |
| `src/agent/graph.ts` | Builds the LangGraph | No structural change, but nodes now read `dbId` from state |
| `src/agent/index.ts` | `runAgentWithHooks(question, hooks)` | Becomes `runAgentWithHooks(question, dbId, hooks)` |
| `src/agent/reviewFlow.ts` | `initiateReviewFlow(question, userId)` | Becomes `initiateReviewFlow(question, userId, dbId)` |
| `src/context/promptAssembler.ts` | Assembles LLM prompt from RAG context | No change needed (already receives context string) |
| `src/index.ts` | Express routes, bootstrap inits one DB | Bootstrap inits all registered DBs; routes extract `dbId` from request body |
| `web/src/app/Models/query-request.ts` | `{ question: string }` | `{ question: string; dbId: string }` |
| `web/src/app/Services/query-service.ts` | Sends `{ question }` to all endpoints | Sends `{ question, dbId }` |
| `web/src/app/quotes/quotes.ts` | Main chat component, no db selector | Add `selectedDbId` property, fetch db list from backend |
| `web/src/app/quotes/quotes.html` | Chat UI template | Add database dropdown selector in the topbar |
| `web/src/app/quotes/quotes.css` | Chat UI styles | Add styles for the dropdown selector |

---

## Step 1: Create the Database Registry

Create a new file: `src/config/dbRegistry.ts`

```
Purpose: Single source of truth mapping dbId → display name, SQL connection string, Qdrant collection name.
```

**Structure:**

```typescript
export interface DatabaseConfig {
  dbId: string;              // unique key, e.g. "lpl_operations", "hr_db"
  displayName: string;       // shown in frontend dropdown, e.g. "LPL Operations"
  connectionString: string;  // SQL Server connection string (read from env vars)
  qdrantCollection: string;  // e.g. "sql_context_lpl_operations"
}
```

- Read connection strings from environment variables, NOT hardcoded. Pattern: `DB_CONNECTION_STRING_<DBID_UPPERCASE>`. Example: `DB_CONNECTION_STRING_LPL_OPERATIONS`, `DB_CONNECTION_STRING_HR_DB`.
- Export a `getRegisteredDatabases(): DatabaseConfig[]` function that builds the list from env vars.
- Export a `getDatabaseConfig(dbId: string): DatabaseConfig | undefined` lookup function.
- The registry should be defined in a `DB_REGISTRY` env var as JSON, OR as individual env vars per DB — pick whichever is cleaner. I recommend a JSON env var like:

```
DB_REGISTRY='[{"dbId":"lpl_operations","displayName":"LPL Operations","connectionString":"..."},{"dbId":"hr_db","displayName":"HR Database","connectionString":"..."}]'
```

Or simpler: define the dbId list and derive collection names automatically:

```
REGISTERED_DBS=lpl_operations,hr_db
DB_DISPLAY_NAME_LPL_OPERATIONS=LPL Operations
DB_CONNECTION_STRING_LPL_OPERATIONS=Driver={ODBC Driver 18...};Server=...
DB_DISPLAY_NAME_HR_DB=HR Database
DB_CONNECTION_STRING_HR_DB=Driver={ODBC Driver 18...};Server=...
```

The Qdrant collection name should be derived automatically: `sql_context_${dbId}` — never manually configured.

---

## Step 2: Parameterize vectorStore.ts

Current state: All functions use the hardcoded `const COLLECTION_NAME = "sql_context"`.

**Changes:**

1. Remove the module-level `COLLECTION_NAME` constant.
2. Every exported function (`initVectorStore`, `addDocuments`, `searchDocuments`, `getDocumentById`, `getDocumentCount`) must accept a `collectionName: string` parameter.
3. `initVectorStore(collectionName: string)` — creates the collection if it doesn't exist, using the passed name.
4. The single `qdrant` client instance and `ai` instance can remain module-level singletons (one Qdrant client talks to all collections). But extract their initialization into a separate `ensureClients()` helper so it's called lazily and only once.
5. Do NOT change the embedding logic, vector size, or any Qdrant config — only parameterize the collection name.

**Example signature changes:**

```typescript
export async function initVectorStore(collectionName: string): Promise<void>
export async function addDocuments(collectionName: string, docs: DocumentToStore[]): Promise<void>
export async function searchDocuments(collectionName: string, query: string, topK?: number): Promise<SearchResult[]>
export async function getDocumentById(collectionName: string, docId: string): Promise<SearchResult | null>
export async function getDocumentCount(collectionName: string): Promise<number>
```

---

## Step 3: Update seed.ts for Multi-DB

Current state: Reads `DB_CONNECTION_STRING` from env, seeds into the hardcoded collection.

**Changes:**

1. Accept a `--db <dbId>` CLI argument (use `process.argv` parsing — no need for a library).
2. If `--db` is provided: look up that dbId in the registry, get its connection string and derived collection name, seed only that one.
3. If `--db all` is provided: iterate over all registered databases and seed each one sequentially.
4. If no `--db` flag: print usage help and exit.
5. Update the console output to show which database and collection is being seeded.

**Usage:**

```bash
npx tsx src/rag/seed.ts --db lpl_operations    # seeds sql_context_lpl_operations
npx tsx src/rag/seed.ts --db hr_db             # seeds sql_context_hr_db
npx tsx src/rag/seed.ts --db all               # seeds all registered databases
```

The `chunkDatabaseMetadata(connectionString)` call in chunker.ts already accepts a connection string, so no changes needed there.

---

## Step 4: Parameterize the Retriever

Current state: `retriever.ts` calls `searchDocuments(query, topK)` and `getDocumentById(docId)` with no collection param.

**Changes:**

1. `retrieveContext(question, collectionName, topK?)` and `retrieveContextDetailed(question, collectionName, topK?, scoreThreshold?)` — add `collectionName` as the second parameter.
2. Inside, pass `collectionName` to every `searchDocuments()` and `getDocumentById()` call.
3. No other logic changes. The retrieval algorithm, backfill logic, scoring thresholds — all stay the same.

---

## Step 5: Multi-DB SQL Executor

Current state: Single global `connectionString` variable set once at startup.

**Changes:**

1. Replace the single `connectionString` with a `Map<string, string>` keyed by `dbId`.
2. `initSqlExecutor` becomes `registerSqlExecutor(dbId: string, config: SqlExecutorConfig): Promise<void>` — tests the connection and stores it in the map.
3. `executeSQL` becomes `executeSQL(sqlQuery: string, dbId: string): Promise<QueryResult>` — looks up the connection string from the map.
4. At bootstrap, iterate over all registered databases and call `registerSqlExecutor` for each.
5. If `executeSQL` is called with an unknown `dbId`, throw a clear error: `"No SQL connection registered for database: ${dbId}"`.

---

## Step 6: Multi-DB Validator

Current state: `sqlValidator.ts` has a single `ALLOWED_TABLES: Set<string>` populated at startup.

**Changes:**

1. Replace `ALLOWED_TABLES` with `const ALLOWED_TABLES_MAP = new Map<string, Set<string>>()`.
2. `initValidator` becomes `registerValidator(dbId: string, connectionString: string): Promise<void>` — queries `INFORMATION_SCHEMA.TABLES` for that DB and stores the result in the map under `dbId`.
3. `validateSQL(sql: string, connectionString: string)` currently takes a connection string for the PARSEONLY check — it also needs `dbId` to look up the correct allowed tables set. New signature: `validateSQL(sql: string, dbId: string, connectionString: string): Promise<ValidationResult>`.
4. At bootstrap, iterate and call `registerValidator` for each registered database.

---

## Step 7: Thread dbId Through the Agent

### state.ts

Add `dbId` to the LangGraph agent state:

```typescript
dbId: Annotation<string>(),
```

### nodes.ts

**retrieveNode:** Get `dbId` from `state.dbId`, look up `collectionName` from the registry, call `retrieveContext(query, collectionName)`.

**generateNode:** No change needed — it receives context string, doesn't touch DB directly.

**validateNode:** Get `dbId` from `state.dbId`, look up `connectionString` from registry, call `validateSQL(state.sql, dbId, connStr)`.

**executeNode:** Call `executeSQL(state.sql, state.dbId)`.

**errorNode:** No change.

### graph.ts

No structural change. The graph shape stays the same. Nodes read `dbId` from state.

### index.ts (agent entry)

`runAgentWithHooks(question, hooks)` becomes `runAgentWithHooks(question, dbId, hooks)`. It invokes the graph with `{ question, dbId }` as initial state.

`streamAgent(question, res, hooks)` becomes `streamAgent(question, dbId, res, hooks)`.

### reviewFlow.ts

`initiateReviewFlow(question, userId)` becomes `initiateReviewFlow(question, userId, dbId)`. It looks up the collection from registry and passes `dbId` through to the retriever, validator, and executor calls. The review session should store `dbId` so that `resumeReviewFlow` can use the correct DB when executing the approved SQL.

`resumeReviewFlow` and `streamReviewFlow` — extract `dbId` from the stored review session.

---

## Step 8: Update Express Routes (index.ts)

### Bootstrap

Replace:
```typescript
const connStr = process.env.DB_CONNECTION_STRING || "";
await initSqlExecutor({ connectionString: connStr });
await initValidator(connStr);
await initVectorStore();
```

With:
```typescript
import { getRegisteredDatabases } from "./config/dbRegistry";

const databases = getRegisteredDatabases();
if (databases.length === 0) {
  console.error("FATAL: No databases registered. Check DB_REGISTRY or REGISTERED_DBS env var.");
  process.exit(1);
}

for (const db of databases) {
  await registerSqlExecutor(db.dbId, { connectionString: db.connectionString });
  await registerValidator(db.dbId, db.connectionString);
  await initVectorStore(db.qdrantCollection);
  console.log(`✅ Initialized database: ${db.displayName} (${db.dbId})`);
}
```

### New endpoint: GET /databases

Add a public (no auth required) endpoint that returns the list of available databases for the frontend dropdown:

```typescript
app.get("/databases", (_req, res) => {
  const databases = getRegisteredDatabases();
  res.json({
    databases: databases.map(db => ({
      dbId: db.dbId,
      displayName: db.displayName,
    })),
  });
});
```

Do NOT expose connection strings or collection names to the frontend.

### All query endpoints

Every endpoint that currently reads `question` from `req.body` must also read and validate `dbId`:

```typescript
const { question, dbId } = req.body ?? {};

// Validate dbId
const dbConfig = getDatabaseConfig(dbId);
if (!dbConfig) {
  return res.status(400).json(buildRequestError(`Unknown database: "${dbId}". Use GET /databases for available options.`));
}
```

Then pass `dbId` to `runAgentWithHooks`, `streamAgent`, `initiateReviewFlow`, etc.

**Affected routes:**
- `POST /query`
- `POST /query/initiate`
- `POST /query/stream`
- `POST /rag-inspect`

The `/query/resume` route gets `dbId` from the stored review session (it was saved when the review was initiated), NOT from the request body — this is important because the review session was created against a specific DB and must execute against the same one.

---

## Step 9: Frontend — Database Selector

### Models — query-request.ts

```typescript
export interface QueryRequest {
  question: string;
  dbId: string;
}
```

### Models — Add database.ts

```typescript
export interface DatabaseOption {
  dbId: string;
  displayName: string;
}

export interface DatabaseListResponse {
  databases: DatabaseOption[];
}
```

### Services — query-service.ts

1. Add a method to fetch the database list:

```typescript
getDatabases(): Observable<DatabaseListResponse> {
  return this.http.get<DatabaseListResponse>(`${this.apiUrl}/databases`);
}
```

2. Update ALL methods that send requests to include `dbId`:
   - `submitQuestion(question, dbId)` → sends `{ question, dbId }`
   - `initiateQuestion(question, dbId)` → sends `{ question, dbId }`
   - `streamAgentQuestion(question, dbId, handlers)` → sends `{ question, dbId }`
   - `resumeQuestion(threadId, approvedSQL)` → **no change** (dbId comes from session server-side)

### Component — quotes.ts

1. Add properties:

```typescript
databases: DatabaseOption[] = [];
selectedDbId: string = '';
databasesLoading = true;
```

2. In the constructor or `ngOnInit`, fetch the database list:

```typescript
ngOnInit(): void {
  this.queryService.getDatabases().subscribe({
    next: (response) => {
      this.databases = response.databases;
      if (this.databases.length > 0) {
        this.selectedDbId = this.databases[0].dbId;
      }
      this.databasesLoading = false;
    },
    error: () => {
      this.databasesLoading = false;
    },
  });
}
```

3. Update `canSubmit` to also require a selected database:

```typescript
get canSubmit(): boolean {
  return !this.loading && !this.reviewLoading && !this.pendingReview && !!this.selectedDbId;
}
```

4. Update `submitQuery` and `submitAgentQuery` to pass `this.selectedDbId` to the service methods.

5. Update the `suggestions` array — these are currently hardcoded for the LPL database. Either make suggestions per-database (overkill for now) or make them generic, or hide them when no DB is selected.

### Template — quotes.html

Add a database selector dropdown in the topbar, next to the existing status badge. Replace the hardcoded "MS SQL Connected" status badge with a dynamic one showing the selected database:

```html
<div class="db-selector">
  <label class="db-selector-label">Database:</label>
  <select
    [(ngModel)]="selectedDbId"
    [disabled]="loading || reviewLoading || !!pendingReview"
    class="db-dropdown"
  >
    <option *ngFor="let db of databases" [value]="db.dbId">
      {{ db.displayName }}
    </option>
  </select>
</div>
```

Place this in the `topbar-actions` div, before the mode badge. The selector should be disabled while a query is running or a review is pending (switching DB mid-conversation would be confusing).

Also update the status badge to be dynamic:

```html
<div class="status-badge" *ngIf="selectedDbId">
  <span class="status-dot"></span>
  <span>{{ getSelectedDbName() }} Connected</span>
</div>
```

Add a helper in the component:

```typescript
getSelectedDbName(): string {
  return this.databases.find(db => db.dbId === this.selectedDbId)?.displayName || 'Unknown';
}
```

### Styles — quotes.css

Add styles for the dropdown that match the existing topbar design language (the dark theme with `#1a1a2e` backgrounds, `#e2e8f0` text). The dropdown should look native to the existing UI — not like an unstyled browser select. Use the same border-radius, font-size, and color scheme as the existing `.mode-badge` and `.status-badge`.

---

## Step 10: Update .env.example

Add the new environment variables:

```env
# Multi-Database Configuration
# Option A: JSON registry
DB_REGISTRY='[{"dbId":"lpl_operations","displayName":"LPL Operations","connectionString":"Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=LPLOperations;Uid=sa;Pwd=yourpassword;TrustServerCertificate=yes;"},{"dbId":"hr_db","displayName":"HR Database","connectionString":"Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=HRDatabase;Uid=sa;Pwd=yourpassword;TrustServerCertificate=yes;"}]'

# Option B: Individual env vars (alternative to DB_REGISTRY)
# REGISTERED_DBS=lpl_operations,hr_db
# DB_DISPLAY_NAME_LPL_OPERATIONS=LPL Operations
# DB_CONNECTION_STRING_LPL_OPERATIONS=Driver={ODBC Driver 18...}
# DB_DISPLAY_NAME_HR_DB=HR Database
# DB_CONNECTION_STRING_HR_DB=Driver={ODBC Driver 18...}
```

Remove the old single `DB_CONNECTION_STRING` (or keep it as a fallback if only one DB is configured — your choice, but I recommend a clean break).

---

## Important Constraints

1. **Do NOT change the LangGraph graph structure** (node names, edges, conditional routing). Only add `dbId` to the state and thread it through existing nodes.
2. **Do NOT change the RAG chunking strategy** in `chunker.ts`. It already accepts a connection string and introspects any DB.
3. **Do NOT change the prompt assembler** (`promptAssembler.ts`). It receives a context string — it doesn't care which DB it came from.
4. **Do NOT change the LLM layer** (`gemini.ts`). It's DB-agnostic.
5. **Do NOT change the audit logging logic** — it should continue working as-is. Optionally add `dbId` to audit metadata for traceability, but don't restructure logging.
6. **Collection names are derived, not configured.** Pattern: `sql_context_${dbId}`. This is enforced in the registry, not left to the user.
7. **The frontend dropdown should be disabled during active queries** to prevent mid-conversation DB switching.
8. **Seeding is offline-only.** No runtime seeding. No seed-on-first-request. The `seed.ts` script is a CLI tool run by a developer.
9. **The `/query/resume` endpoint does NOT accept `dbId` from the client.** It reads it from the stored review session to prevent the user from switching DB between review initiation and execution.
10. **Keep backward compatibility during development:** if `DB_REGISTRY` is not set but `DB_CONNECTION_STRING` is, auto-create a single-db registry with `dbId: "default"` and `collectionName: "sql_context"` so the existing setup keeps working without config changes.

---

## File Change Summary (Execution Order)

1. `src/config/dbRegistry.ts` — **CREATE** — registry config
2. `src/rag/vectorStore.ts` — **EDIT** — parameterize collection name
3. `src/rag/seed.ts` — **EDIT** — multi-db CLI seeding
4. `src/rag/retriever.ts` — **EDIT** — pass collection name through
5. `src/executor/sqlExecutor.ts` — **EDIT** — connection pool map
6. `src/validator/sqlValidator.ts` — **EDIT** — per-db table whitelist
7. `src/agent/state.ts` — **EDIT** — add dbId field
8. `src/agent/nodes.ts` — **EDIT** — thread dbId to retriever/executor/validator
9. `src/agent/graph.ts` — **VERIFY** — should need no changes
10. `src/agent/index.ts` — **EDIT** — pass dbId to graph invocation
11. `src/agent/reviewFlow.ts` — **EDIT** — pass dbId, store in session
12. `src/agent/reviewSessions.ts` — **EDIT** — store dbId in session data
13. `src/index.ts` — **EDIT** — multi-db bootstrap, new `/databases` endpoint, validate dbId on all routes
14. `src/context/promptAssembler.ts` — **NO CHANGE**
15. `src/llm/gemini.ts` — **NO CHANGE**
16. `src/rag/chunker.ts` — **NO CHANGE**
17. `.env.example` — **EDIT** — add multi-db env vars
18. `web/src/app/Models/query-request.ts` — **EDIT** — add dbId
19. `web/src/app/Models/database.ts` — **CREATE** — database option interface
20. `web/src/app/Services/query-service.ts` — **EDIT** — pass dbId, add getDatabases()
21. `web/src/app/quotes/quotes.ts` — **EDIT** — db selector state, fetch db list, pass dbId
22. `web/src/app/quotes/quotes.html` — **EDIT** — add dropdown in topbar
23. `web/src/app/quotes/quotes.css` — **EDIT** — dropdown styles

---

## Testing Checklist

After implementation, verify:

- [ ] `GET /databases` returns the list of registered databases (dbId + displayName only, no secrets)
- [ ] `npx tsx src/rag/seed.ts --db <dbId>` seeds only that database's collection
- [ ] `npx tsx src/rag/seed.ts --db all` seeds all registered databases
- [ ] Sending a query with `dbId: "lpl_operations"` only searches `sql_context_lpl_operations` and executes against the LPL connection
- [ ] Sending a query with `dbId: "hr_db"` only searches `sql_context_hr_db` and executes against the HR connection
- [ ] Sending a query with an invalid `dbId` returns a 400 error
- [ ] The frontend dropdown loads databases on page load
- [ ] The dropdown is disabled while a query is running
- [ ] Switching the dropdown and asking a question uses the new DB
- [ ] The review flow (`/query/initiate` → `/query/resume`) uses the same DB throughout, even if the user switches the dropdown between initiate and resume
- [ ] Backward compat: if only `DB_CONNECTION_STRING` is set (no registry), the app works with a single "default" database