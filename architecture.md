# QueryAssist — Text-to-SQL Architecture for LPL Financial

## Overview

RAG-enhanced controlled pipeline for natural language to SQL conversion. Non-technical operations users ask questions in plain English, the system retrieves relevant schema context via RAG, generates SQL using a single LLM call, validates it, executes it on MS SQL Server, and returns results.

**Key Principle**: The LLM is the SQL writer, nothing more. Everything around it is deterministic application code that we control, test, and audit.

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────┐
│                      USER (Chat UI)                      │
│            "What's the total AUM for advisor 12345?"     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  1. GUARDRAILS (Pre-LLM, deterministic code)             │
│     • Reject harmful/off-topic queries                   │
│     • Check user permissions                             │
│     • Rate limiting                                      │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  2. RAG RETRIEVAL (Vector search, NOT the LLM)           │
│                                                          │
│  Query the vector DB with the user's question to pull:   │
│                                                          │
│  ┌────────────────┐ ┌──────────────┐ ┌────────────────┐ │
│  │ Relevant Tables│ │  Column Defs │ │ Past Examples  │ │
│  │ & Schema (DDL) │ │  & Business  │ │ (question→SQL  │ │
│  │                │ │  Meanings    │ │  pairs)        │ │
│  └────────────────┘ └──────────────┘ └────────────────┘ │
│                                                          │
│  ┌────────────────┐ ┌──────────────┐                     │
│  │ Join Paths     │ │ Business     │                     │
│  │ & Relationships│ │ Rules/Notes  │                     │
│  └────────────────┘ └──────────────┘                     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  3. PROMPT ASSEMBLY (deterministic code)                  │
│                                                          │
│  System Prompt:                                          │
│  ┌─ Rules (SELECT only, T-SQL, TOP 1000, etc.)          │
│  ├─ Retrieved schema context (from step 2)               │
│  ├─ Retrieved column definitions (from step 2)           │
│  ├─ Retrieved join paths (from step 2)                   │
│  ├─ Retrieved similar examples (from step 2)             │
│  └─ User question                                        │
│                                                          │
│  → ONE assembled prompt, everything the LLM needs        │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  4. LLM (Single call → generates SQL)                    │
│                                                          │
│  Input: fully assembled prompt with all context          │
│  Output: SQL query string                                │
│                                                          │
│  The LLM does NOT call tools, does NOT explore schema.   │
│  It has everything it needs. Just generates SQL.         │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  5. SQL VALIDATION (deterministic code, NO LLM)          │
│                                                          │
│  • Parse SQL (sqlparse / sqlglot)                        │
│  • ✅ SELECT only — block INSERT/UPDATE/DELETE/DROP      │
│  • ✅ Tables exist in known schema                       │
│  • ✅ Columns exist on those tables                      │
│  • ✅ Joins match known valid join paths                 │
│  • ✅ Has WHERE clause on large tables                   │
│  • ✅ TOP/LIMIT present                                  │
│  • ❌ Reject if any check fails → return error to user   │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  6. EXECUTE (Read-only MS SQL connection)                 │
│                                                          │
│  • DB user with SELECT-only permissions (defense-in-depth)│
│  • Query timeout: 30 seconds                             │
│  • Max rows: 1000                                        │
│  • Use read replica if available                         │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  7. RESPONSE (Back to UI)                                │
│                                                          │
│  • Data table (formatted results)                        │
│  • Generated SQL (shown to power users/admins)           │
│  • Natural language summary (optional second LLM call)   │
│  • Chart (optional, if applicable)                       │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  8. FEEDBACK & MEMORY (Background, async)                │
│                                                          │
│  • Log: user, question, SQL, result status (audit)       │
│  • User thumbs up/down → save to example store           │
│  • Successful queries get saved to vector DB             │
│    (improves RAG retrieval for future questions)          │
└──────────────────────────────────────────────────────────┘
```

---

## Why This Architecture (Pipeline-First, Agent-Ready)

| Approach | What happens |
|---|---|
| **Agent-driven** | LLM decides which tools to call, in what order, across multiple roundtrips |
| **Our primary path** ✅ | Code fetches context via RAG → assembles everything → **one LLM call** → code validates & executes |
| **Current repo support** | Pipeline path for speed/predictability, plus an optional LangGraph retry loop for self-correction |

### Advantages for LPL:

1. **One LLM call on the main path** — faster, cheaper, predictable latency
2. **No LLM decision-making on WHAT context to fetch** — our code controls that, eliminating a failure point
3. **Fully deterministic pipeline except for SQL generation** — everything else is our code, auditable, testable
4. **Validation happens OUTSIDE the LLM** — the LLM can't bypass it
5. **Compliant with financial regulations** — full audit trail, deterministic guardrails, and bounded agent behavior when agent mode is used

---

## RAG Vector Store — What Gets Embedded

| Document Type | Example | Why |
|---|---|---|
| **Table DDL + descriptions** | `dbo.txn_master: Transaction history table with columns txn_amt (Transaction amount USD), txn_dt (Date)...` | So RAG retrieves only relevant tables |
| **Column business definitions** | `aum_val: Assets under management, updated monthly, in USD` | So LLM understands cryptic names |
| **Join relationships** | `dbo.txn_master.acct_id → dbo.account_master.acct_id (many-to-one)` | So LLM generates correct joins |
| **Business rules** | `When querying AUM, always use the latest snapshot date. Filter: snapshot_dt = (SELECT MAX(snapshot_dt)...)` | Domain-specific logic the LLM can't infer |
| **Validated question→SQL examples** | `Q: "Total AUM for advisor 12345" → SELECT SUM(aum_val) FROM dbo.aum_snapshot WHERE advisor_id = '12345' AND snapshot_dt = (SELECT MAX(snapshot_dt) FROM dbo.aum_snapshot)` | Few-shot examples = biggest accuracy boost |

---

## Semantic Layer (Static Config — YAML/JSON)

```yaml
tables:
  dbo.txn_master:
    business_name: "Transaction History"
    columns:
      txn_amt: "Transaction amount in USD"
      txn_dt: "Transaction date"
      acct_id: "Account identifier (FK to dbo.account_master)"
    common_joins:
      - "JOIN dbo.account_master ON txn_master.acct_id = account_master.acct_id"
    rules:
      - "Always filter by txn_dt when querying large date ranges"

  dbo.aum_snapshot:
    business_name: "Assets Under Management (Monthly Snapshot)"
    columns:
      aum_val: "Assets under management value in USD"
      snapshot_dt: "Snapshot date (monthly)"
      advisor_id: "Advisor identifier"
    rules:
      - "Always use latest snapshot_dt unless user specifies a date"
      - "Use MAX(snapshot_dt) subquery for current values"
```

This YAML is:
- Source of truth for column meanings
- Embedded into vector DB for RAG retrieval
- Used by validation layer to check table/column existence

---

## Prompt Template

```
You are a SQL Server query generator for LPL Financial's operations database.

RULES:
- Generate ONLY SELECT statements. Never generate INSERT, UPDATE, DELETE, DROP, or any DDL/DML.
- Use T-SQL syntax (Microsoft SQL Server).
- Always use schema-qualified table names (e.g., dbo.table_name).
- Include TOP 1000 unless the user specifies a limit.
- Use column aliases to show business-friendly names in results.
- When date filtering is ambiguous, default to the last 30 days.
- Never use SELECT * — always specify columns explicitly.

AVAILABLE SCHEMA:
{schema_context}

COLUMN DEFINITIONS:
{semantic_mappings}

JOIN RELATIONSHIPS:
{join_context}

SIMILAR EXAMPLES:
{few_shot_examples}

USER QUESTION:
{user_question}

Respond with ONLY the SQL query. No explanation.
```

---

## Tech Stack (POC)

| Component | Technology | Notes |
|---|---|---|
| **Chat UI** | Angular | Current repo implementation |
| **Backend API** | Express (TypeScript) | Current repo implementation |
| **LLM** | Gemini 2.0 Flash | SQL generation |
| **Vector DB** | Qdrant | Dockerized with named volume |
| **SQL Validation** | Custom TypeScript + SQL Server `PARSEONLY` | Uses real T-SQL parser behavior |
| **Database** | MS SQL Server via `msnodesqlv8` | Shared-memory/ODBC path |
| **Embeddings** | Gemini `text-embedding-004` | Retrieval embeddings |
| **Auth** | LPL's existing SSO/AD integration | |

---

## SQL Validation Rules (Layer 5 Detail)

```python
# Pseudocode for validation layer
def validate_sql(sql: str, known_schema: dict) -> ValidationResult:
    parsed = sqlglot.parse_one(sql, dialect="tsql")

    # 1. Statement type check
    if not isinstance(parsed, sqlglot.exp.Select):
        return reject("Only SELECT statements allowed")

    # 2. Dangerous keyword check
    dangerous = {"INSERT", "UPDATE", "DELETE", "DROP", "EXEC", "EXECUTE",
                 "ALTER", "CREATE", "TRUNCATE", "MERGE", "GRANT", "REVOKE"}
    if any(kw in sql.upper() for kw in dangerous):
        return reject(f"Blocked: contains dangerous keyword")

    # 3. Table existence check
    tables_used = extract_tables(parsed)
    for table in tables_used:
        if table not in known_schema:
            return reject(f"Unknown table: {table}")

    # 4. Column existence check
    columns_used = extract_columns(parsed)
    for col, table in columns_used:
        if col not in known_schema[table]["columns"]:
            return reject(f"Unknown column: {col} on {table}")

    # 5. JOIN validity check
    joins_used = extract_joins(parsed)
    for join in joins_used:
        if join not in known_valid_joins:
            return reject(f"Invalid join path: {join}")

    # 6. Safety checks
    if not has_top_or_limit(parsed):
        return warn("No TOP/LIMIT clause — adding TOP 1000")

    if is_large_table(tables_used) and not has_where_clause(parsed):
        return reject("WHERE clause required on large tables")

    return approve(sql)
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **SQL hallucination** (non-existent tables/columns) | Query fails or wrong data | Validate SQL against known schema before execution |
| **Wrong JOINs** | Incorrect results, silent data errors | Pre-define valid join paths; validate joins against whitelist |
| **Ambiguous user questions** | Wrong interpretation | Show interpreted intent + SQL before executing; ask clarifying questions |
| **Performance (full table scans)** | DB load on production | Read replica, query timeout, mandatory WHERE on large tables |
| **Data sensitivity** | Unauthorized PII access | Column-level exclusion list; role-based table access |
| **Over-trust in results** | Bad business decisions | Show SQL alongside results; confidence indicators |
| **Prompt injection** | User manipulates LLM | Validation layer is the real gate — never trust LLM output without parsing |
| **RAG retrieves wrong context** | LLM gets irrelevant schema, generates bad SQL | Tune embedding model, test retrieval quality, use hybrid search (keyword + semantic) |

---

## Future Enhancements (Post-POC)

1. **Self-improving memory** — Successful queries (user thumbs-up) saved to vector DB, improving RAG retrieval over time
2. **Query caching** — Cache frequent question→SQL mappings for instant responses
3. **Multi-turn conversations** — "Now filter that by last quarter" (lightweight session state)
4. **Visualization** — Auto-generate charts from tabular results
5. **Confidence scoring** — LLM self-rates confidence; low confidence triggers clarifying questions
6. **Domain routing** — Classify questions into domains (AUM, Transactions, Accounts) to retrieve more targeted context
7. **Approval workflow** — For sensitive queries, require manager approval before execution

---

## Core Design Principle: Agent-Ready Components from Day One

### The Principle

Every component in Phase 1 must be built as a **standalone, independently callable service** with a clean interface — well-defined input, well-defined output, no hidden dependencies on other components. Phase 1 is a fixed pipeline. Phase 2 wraps an agent around the **exact same components**. No rewrite.

### Why This Matters for LPL

The business will ask harder questions 6–12 months after a successful POC. Multi-step queries, self-correction, multi-turn conversations. If Phase 1 components are tangled together in a monolithic pipeline, Phase 2 is a rewrite. If they're clean tools, Phase 2 is a rewiring — done in days, not months.

### Component Interfaces

Each component has ONE job, takes a defined input, returns a defined output, and knows nothing about the others:

```
┌─────────────────────────────────────────────────────────────────┐
│  RAG Retrieval Tool                                             │
│  Input:  natural language question (str)                        │
│  Output: ContextPackage {tables, columns, joins, examples,      │
│          business_rules}                                        │
│  Knows nothing about: prompt assembly, SQL generation           │
├─────────────────────────────────────────────────────────────────┤
│  SQL Generator Tool                                             │
│  Input:  ContextPackage + user question (str)                   │
│  Output: SQL string                                             │
│  Knows nothing about: retrieval, validation, execution          │
├─────────────────────────────────────────────────────────────────┤
│  SQL Validator Tool                                             │
│  Input:  SQL string                                             │
│  Output: ValidationResult {approved: bool, reason: str,         │
│          sanitized_sql: str}                                    │
│  Knows nothing about: how the SQL was generated                 │
├─────────────────────────────────────────────────────────────────┤
│  SQL Executor Tool                                              │
│  Input:  validated SQL string                                   │
│  Output: ResultSet {rows, columns, row_count, execution_time}   │
│  Enforces: read-only connection, timeout, row limit             │
│  Knows nothing about: who called it or why                      │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1 vs Phase 2 — Same Tools, Different Orchestration

```
PHASE 1 (Fixed Pipeline):
  retrieve → generate → validate → execute
  Linear. Predictable. If validation fails → error to user.

PHASE 2 (Agent Orchestration):
  retrieve → generate → validate → REJECTED →
  → agent reasons about rejection →
  → retrieve again (more specific query) →
  → regenerate → validate → APPROVED → execute
  Self-correcting. Same tools. Same safety guarantees.
```

### What the Agent Gains (Without Sacrificing Safety)

| Capability | Pipeline (Phase 1) | Agent (Phase 2) |
|---|---|---|
| **Self-correction** | Fails → error to user | Fails → re-retrieves context → regenerates → re-validates |
| **Exploratory queries** | Not possible | Runs intermediate query ("what values exist in this column?") before final query |
| **Multi-turn** | Requires custom session logic | Agent maintains state naturally |
| **Complex reasoning** | One-shot, single attempt | Multiple tool calls to decompose complex questions |

All of this goes through the same trusted tool interfaces. The agent never bypasses the validator. The safety properties are **structural**, not dependent on the LLM behaving correctly.

### The One Non-Negotiable Rule

> **Every critical constraint belongs in the tools, not in the agent's system prompt.**

| Rule | Where it lives | Why |
|---|---|---|
| SELECT only | `SQL Validator Tool` (Python) | Agent cannot reason around compiled code |
| Read-only connection | `SQL Executor Tool` (DB permissions) | Structural enforcement, not LLM instruction |
| Row limits | `SQL Executor Tool` (Python) | Cannot be bypassed regardless of caller |
| Table/column whitelist | `SQL Validator Tool` (Python) | Deterministic check, not LLM judgment |

The agent's system prompt describes **when to call tools and how to interpret results**. It does NOT contain safety rules. Those live in the tools.

### The Trap to Avoid

> Building Phase 1 as a monolithic pipeline — one script, one function, everything coupled. When Phase 2 comes and you try to wrap an agent around it, retrieval logic, prompt assembly, and validation are tangled together and can't be called independently. You rewrite.

**The discipline**: build each component as if something external will call it, even in Phase 1.

---

## Phase 1 POC Scope

**Start narrow, prove value fast:**

- Pick **3-5 high-value domains** the ops team queries daily (e.g., AUM lookups, transaction history, account details)
- Curate **50-100 validated question→SQL examples** for those domains
- Build the full pipeline end-to-end for those domains only
- Measure: accuracy, latency, user satisfaction
- Expand domains incrementally after validation
