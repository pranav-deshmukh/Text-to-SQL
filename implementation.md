# Implementation Plan: Role-Based Application Modes (Tech Team & End User)

---

## 1. Overview

We need to split the application into two distinct operational modes:

| Feature | End User | Tech Team |
|---|---|---|
| Natural language input | ✅ | ✅ |
| View results | ✅ | ✅ |
| View generated SQL | ❌ | ✅ |
| Edit SQL manually | ❌ | ✅ |
| Re-run modified SQL | ❌ | ✅ |
| View schema context/prompt | ❌ | ✅ |
| Debug inspection | ❌ | ✅ |

---

## 2. Do We Need a Login System?

**Yes — a login system is required**, but it can be lightweight.

### Why?
- Role distinction must be **enforced server-side**, not just UI-hidden.
- If we only hide the SQL editor on the frontend, a savvy user could call the API directly and bypass restrictions.
- The backend (query-engine) must know **who is calling** and **what they are allowed to do**.

### Recommended Approach: Lightweight JWT Auth

- No need for a full OAuth/SSO system at this stage.
- Implement a simple **username + password login** that returns a **JWT token** containing the user's role (`end_user` | `tech_team`).
- The JWT is sent with every request to the query-engine.
- The query-engine validates the JWT and enforces role-based behavior.

### User Store (Simple for Now)
- Store users in a `.env` config or a simple JSON/SQLite file.
- Users have: `username`, `hashed_password`, `role`.
- No need for a full database for auth at this stage.

---

## 3. Phase Breakdown

---

### Phase 1: Authentication Layer

#### 3.1 Backend — Auth Service (inside `services/query-engine`)

**New file: `src/auth/authRouter.ts`**
- `POST /auth/login` — accepts `{ username, password }`, returns `{ token: JWT }`.
- JWT payload: `{ userId, role: 'end_user' | 'tech_team', exp }`.
- Sign with `JWT_SECRET` from `.env`.

**New file: `src/auth/authMiddleware.ts`**
- Express middleware to validate JWT on all `/query` routes.
- Attaches `req.user = { userId, role }` to the request.
- Returns `401` if token is missing/invalid.
- Returns `403` if role is insufficient for the requested operation.

**New file: `src/auth/users.ts`**
- Hardcoded or file-based user store for now.
- `bcrypt` for password hashing.

**`.env` additions:**
```
JWT_SECRET=your_secret_here
JWT_EXPIRY=8h
ADMIN_USERNAME=techteam
ADMIN_PASSWORD_HASH=<bcrypt_hash>
USER_USERNAME=enduser
USER_PASSWORD_HASH=<bcrypt_hash>
```

#### 3.2 Frontend — Angular Auth Module (`web/src/app/auth/`)

**New files:**
- `auth.service.ts` — handles login API call, stores JWT in `localStorage`, exposes `currentUser$` observable.
- `auth.guard.ts` — route guard, redirects unauthenticated users to `/login`.
- `role.guard.ts` — route guard for tech-team-only routes.
- `login/login.component.ts` + template — simple login form.
- `interceptors/auth.interceptor.ts` — attaches `Authorization: Bearer <token>` to all HTTP requests.

**Role helper:**
```typescript
// auth.service.ts
get isTechTeam(): boolean {
  return this.decodedToken?.role === 'tech_team';
}
```

---

### Phase 2: Backend — LangGraph Human-in-the-Loop Changes

This is the most significant backend change.

#### Current Flow (as per how_rag_works.md & architecture.md):
```
User Query → RAG (schema retrieval) → Prompt Build → LLM → SQL → Execute → Results
```

#### New Flow with Role Awareness + Human-in-the-Loop:

```
User Query
    ↓
[RAG: Schema Retrieval]
    ↓
[Prompt Build]
    ↓
[LLM: Generate SQL]
    ↓
[Interrupt Node] ← NEW (conditional, based on role)
    ↓ (if tech_team: PAUSE and return SQL to frontend for review)
    ↓ (if end_user: continue automatically)
[Validate SQL]
    ↓
[Execute SQL]
    ↓
[Return Results]
```

#### 3.3 LangGraph Graph Changes (`services/query-engine/src/graph/`)

**Concept: Interrupt / Resume Pattern**

LangGraph supports a **"human-in-the-loop" interrupt** pattern where:
1. The graph runs until an interrupt node.
2. The state is **persisted** (checkpointed).
3. The frontend receives the intermediate state (generated SQL).
4. The tech user reviews/edits the SQL.
5. The frontend sends the (possibly edited) SQL back to resume the graph.
6. The graph continues from the checkpoint with the new SQL.

**Implementation Steps:**

**Step 1: Add a Checkpointer**

LangGraph needs a checkpointer to persist state between interrupt and resume.

```typescript
// src/graph/checkpointer.ts
import { MemorySaver } from "@langchain/langgraph";

// For production, replace with a Redis or Postgres checkpointer
export const checkpointer = new MemorySaver();
```

**Step 2: Add an Interrupt Node**

```typescript
// src/graph/nodes/humanReviewNode.ts
import { interrupt } from "@langchain/langgraph";

export async function humanReviewNode(state: GraphState) {
  if (state.role === 'tech_team') {
    // Pause graph execution, send current SQL to frontend
    const humanDecision = interrupt({
      generatedSQL: state.generatedSQL,
      schemaContext: state.schemaContext,
      originalQuery: state.userQuery,
    });
    // humanDecision will contain the (possibly edited) SQL when resumed
    return {
      ...state,
      generatedSQL: humanDecision.approvedSQL,
    };
  }
  // end_user: pass through automatically
  return state;
}
```

**Step 3: Modify Graph Definition**

```typescript
// src/graph/queryGraph.ts
const graph = new StateGraph(GraphStateAnnotation)
  .addNode("retrieveSchema", retrieveSchemaNode)
  .addNode("buildPrompt", buildPromptNode)
  .addNode("generateSQL", generateSQLNode)
  .addNode("humanReview", humanReviewNode)      // ← NEW
  .addNode("validateSQL", validateSQLNode)
  .addNode("executeSQL", executeSQLNode)
  .addEdge("retrieveSchema", "buildPrompt")
  .addEdge("buildPrompt", "generateSQL")
  .addEdge("generateSQL", "humanReview")        // ← NEW edge
  .addEdge("humanReview", "validateSQL")
  .addEdge("validateSQL", "executeSQL")
  .compile({ checkpointer });                   // ← attach checkpointer
```

**Step 4: Thread ID for Session Management**

Each query session gets a unique `threadId`. This is how LangGraph knows which checkpoint to resume from.

```typescript
// On first run (initiate query):
const threadId = uuidv4();
const config = { configurable: { thread_id: threadId } };
const result = await graph.stream(initialState, config);

// The stream will pause at the interrupt node.
// Return threadId + generatedSQL to the frontend.

// On resume (tech user approved/edited SQL):
const config = { configurable: { thread_id: threadId } };
await graph.invoke(
  new Command({ resume: { approvedSQL: editedSQL } }),
  config
);
```

#### 3.4 New API Endpoints in Query Engine

**Current:** Probably a single `POST /query` endpoint.

**New endpoints:**

```
POST /query/initiate
  Body: { question: string }
  Headers: Authorization: Bearer <JWT>
  Response (end_user):   { results, columns, sql: null }
  Response (tech_team):  { threadId, generatedSQL, schemaContext, status: 'awaiting_review' }

POST /query/resume
  Body: { threadId: string, approvedSQL: string }
  Headers: Authorization: Bearer <JWT> (tech_team only)
  Response: { results, columns, sql: approvedSQL }

GET /query/status/:threadId
  Headers: Authorization: Bearer <JWT>
  Response: { status: 'awaiting_review' | 'completed' | 'error', ... }
```

**Role enforcement in router:**
```typescript
// Only tech_team can call /resume
router.post('/query/resume', requireRole('tech_team'), resumeHandler);
```

---

### Phase 3: Frontend — UI Mode Changes

#### 3.5 Query Component Changes (`web/src/app/query/`)

**Current flow (assumed):**
- User types question → results shown.

**New flow:**

**End User Mode:**
- Same as current — type question, see results.
- SQL panel is completely hidden (not just visually — not rendered).

**Tech Team Mode:**

Step 1: User types question → submits.
Step 2: Frontend calls `POST /query/initiate`.
Step 3: Response comes back with `status: 'awaiting_review'` and `generatedSQL`.
Step 4: **SQL Review Panel** appears with:
  - Read-only view of generated SQL (syntax highlighted).
  - **Editable SQL editor** (CodeMirror or Monaco Editor).
  - Buttons: **"Approve & Run"** | **"Edit & Run"** | **"Cancel"**.
Step 5: On approve/edit, frontend calls `POST /query/resume` with `threadId` + SQL.
Step 6: Results are displayed.

**New Angular Components:**

- `sql-review-panel/sql-review-panel.component.ts`
  - Shows generated SQL.
  - Contains SQL editor (Monaco or CodeMirror).
  - Emits `approved(sql: string)` and `cancelled()` events.

- `query-results/query-results.component.ts` (existing, extended)
  - For tech team: also shows the final executed SQL below results.

- `schema-context-panel/schema-context-panel.component.ts` (tech team only)
  - Shows which schema chunks were retrieved by RAG.
  - Shows the full prompt sent to the LLM (optional toggle).

**Role-based rendering pattern:**
```html
<!-- In query.component.html -->
<app-sql-review-panel
  *ngIf="authService.isTechTeam && awaitingReview"
  [generatedSQL]="generatedSQL"
  (approved)="onSQLApproved($event)"
  (cancelled)="onCancelled()">
</app-sql-review-panel>
```

#### 3.6 Install SQL Editor Library

```bash
cd web
npm install monaco-editor
npm install ngx-monaco-editor-v2
```

Configure in `angular.json` assets for Monaco.

---

### Phase 4: Validation Layer (Unchanged but Enforced)

The existing SQL validation must continue to apply to **both** auto-generated SQL and manually edited SQL from tech team users.

**Validation rules (enforce in `validateSQLNode`):**
- SELECT-only (no INSERT, UPDATE, DELETE, DROP, etc.)
- No multiple statements (no `;` tricks)
- Row limit enforcement (e.g., `LIMIT 1000`)
- Optional: schema whitelist (only query allowed tables)

**This node runs AFTER the humanReview node**, so any edited SQL also goes through validation.

If validation fails on manually edited SQL, return error to frontend with clear message: `"Your modified SQL failed validation: <reason>"`.

---

### Phase 5: State Management (Angular)

Use an Angular service to manage the query state machine on the frontend:

```typescript
// query-state.service.ts
type QueryStatus = 'idle' | 'loading' | 'awaiting_review' | 'executing' | 'done' | 'error';

interface QueryState {
  status: QueryStatus;
  threadId?: string;
  generatedSQL?: string;
  schemaContext?: string[];
  results?: any[];
  columns?: string[];
  error?: string;
}
```

---

## 4. File Structure After Implementation

```
services/query-engine/src/
  auth/
    authRouter.ts          ← NEW
    authMiddleware.ts      ← NEW
    users.ts               ← NEW
  graph/
    checkpointer.ts        ← NEW
    queryGraph.ts          ← MODIFIED
    nodes/
      retrieveSchemaNode.ts
      buildPromptNode.ts
      generateSQLNode.ts
      humanReviewNode.ts   ← NEW
      validateSQLNode.ts   ← MODIFIED (runs after human review)
      executeSQLNode.ts
  routes/
    queryRouter.ts         ← MODIFIED (new /initiate and /resume endpoints)

web/src/app/
  auth/
    auth.service.ts        ← NEW
    auth.guard.ts          ← NEW
    role.guard.ts          ← NEW
    interceptors/
      auth.interceptor.ts  ← NEW
    login/
      login.component.ts   ← NEW
      login.component.html ← NEW
  query/
    query.component.ts     ← MODIFIED
    query-state.service.ts ← NEW
    sql-review-panel/      ← NEW
    schema-context-panel/  ← NEW
  shared/
    role.directive.ts      ← NEW (*showForRole directive)
```

---

## 5. Implementation Order

| Step | Task | Priority |
|---|---|---|
| 1 | Backend: JWT auth endpoints + middleware | 🔴 Must First |
| 2 | Frontend: Login page + auth service + interceptor | 🔴 Must First |
| 3 | Backend: LangGraph checkpointer setup | 🟠 High |
| 4 | Backend: humanReviewNode + interrupt logic | 🟠 High |
| 5 | Backend: `/query/initiate` + `/query/resume` endpoints | 🟠 High |
| 6 | Frontend: query-state.service with status machine | 🟡 Medium |
| 7 | Frontend: SQL review panel + Monaco editor | 🟡 Medium |
| 8 | Frontend: Role-based rendering in query component | 🟡 Medium |
| 9 | Frontend: Schema context panel (debug view) | 🟢 Low |
| 10 | Testing: End-to-end role enforcement tests | 🟢 Low |

---

## 6. Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| JWT over session cookies | Stateless, works well with Angular HTTP interceptors |
| MemorySaver checkpointer (start) | Simple, no extra infra; swap to Redis later for multi-instance |
| `/initiate` + `/resume` split endpoints | Clean separation of graph phases, makes resume explicit |
| Validation runs AFTER human review node | Ensures manually edited SQL is also validated |
| Monaco Editor | Best SQL syntax highlighting, familiar to devs |
| Role in JWT payload | Avoids extra DB lookup per request |

---

## 7. Security Considerations

- JWT secret must be strong and stored only in `.env` (never committed).
- Role checked **server-side** on every request — frontend role hiding is UX only.
- Manually edited SQL goes through **same validation pipeline** as generated SQL.
- `threadId` should be validated to belong to the requesting user (prevent session hijacking).
- Token expiry should be short (8h) with refresh considered for later.

---

## 8. Future Enhancements (Out of Scope Now)

- Full OAuth/SSO integration (Azure AD, Google).
- Audit log: who ran what query, what SQL edits were made.
- Redis-backed checkpointer for horizontal scaling.
- Per-user query history.
- Role management UI for admins.