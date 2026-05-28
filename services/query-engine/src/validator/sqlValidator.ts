import msnodesqlv8 from "msnodesqlv8";

/**
 * SQL Validation Layer — Step 5 in architecture.
 *
 * 4-layer validation pipeline, executed in order (cheap → expensive):
 *
 *   Layer 1 — Lightweight sanitization (regex, no DB needed)
 *   Layer 2 — SET PARSEONLY ON (SQL Server parses but never executes — 100% dialect-accurate)
 *   Layer 3 — Schema-level checks (tables must exist in INFORMATION_SCHEMA)
 *   Layer 4 — Column-level checks (skipped for now — see further considerations)
 *
 * Why not use node-sql-parser for everything?
 *   node-sql-parser's MSSQL dialect coverage is incomplete. T-SQL-specific syntax
 *   like TOP 1000, CROSS APPLY, or complex CTEs can cause false parse failures.
 *   We use it only for the fast Layer 1 structural check, then let SQL Server itself
 *   do the authoritative syntax validation in Layer 2.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Populated at startup by registerValidator() via INFORMATION_SCHEMA query.
// Never hardcoded — works for any database without code changes.
const ALLOWED_TABLES_MAP = new Map<string, Set<string>>();

/**
 * Must be called once at startup (before any validateSQL calls).
 * Queries INFORMATION_SCHEMA.TABLES to build the allowed-tables whitelist dynamically.
 * This way the validator works for any database without hardcoding table names.
 */
export async function registerValidator(dbId: string, connectionString: string): Promise<void> {
  const sql = `
    SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS full_name
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
  `;

  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sql, (err: any, rows?: any[]) => {
      if (err) {
        reject(new Error(`[Validator] Failed to load table whitelist: ${err.message}`));
        return;
      }
      const allowedTables = new Set((rows ?? []).map((r: any) => r.full_name.toLowerCase()));
      ALLOWED_TABLES_MAP.set(dbId, allowedTables);
      console.log(`[Validator] ✅ Loaded ${allowedTables.size} tables into whitelist for ${dbId}: ${[...allowedTables].join(", ")}`);
      resolve();
    });
  });
}

// DML/DDL keywords that must never appear in a read-only query.
// Word-boundary regex prevents false positives (e.g., "EXECUTION" matching "EXEC").
const DANGEROUS_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|DENY)\b/i;

/**
 * Layer 1 — Lightweight sanitization (pure regex, no DB call).
 *
 * FURTHER CONSIDERATION: If the LLM is updated to return multi-statement batches
 * (e.g., a CTE followed by a SELECT), the semicolon check below would need to
 * be relaxed to allow semicolons only within string literals, not as statement separators.
 */
function sanitize(sql: string): ValidationResult {
  // Strip trailing semicolons — LLMs often append one. A single trailing ; is not multi-statement.
  const trimmed = sql.trim().replace(/;\s*$/, "");

  // Guard against LLM returning JSON instead of SQL (root cause of original bug).
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { valid: false, error: "LLM returned JSON instead of SQL. Check responseMimeType and system prompt." };
  }

  // Guard against LLM returning 'ERROR' (as instructed in system prompt fallback).
  if (trimmed.toUpperCase() === "ERROR") {
    return { valid: false, error: "LLM could not generate a valid SQL query for this question." };
  }

  // Must start with SELECT or WITH (CTEs like "WITH cte AS (...) SELECT ..." are valid).
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return { valid: false, error: `Query must start with SELECT or WITH. Got: "${trimmed.substring(0, 50)}..."` };
  }

  // Block dangerous DML/DDL keywords.
  const dangerousMatch = trimmed.match(DANGEROUS_KEYWORDS);
  if (dangerousMatch) {
    return { valid: false, error: `Forbidden keyword detected: ${dangerousMatch[0]}. Only SELECT statements are allowed.` };
  }

  // Block multiple statements (semicolon-separated).
  // FURTHER CONSIDERATION: CTEs use semicolons in some styles (;WITH ...). If the LLM
  // starts generating CTEs with leading semicolons, handle that edge case here.
  if (trimmed.includes(";")) {
    return { valid: false, error: "Multiple statements detected (semicolon found). Only a single SELECT is allowed." };
  }

  return { valid: true };
}

/**
 * Layer 2 — SQL Server syntax check via SET PARSEONLY ON.
 *
 * SQL Server parses the query fully but never executes it.
 * This is the most dialect-accurate syntax check possible — zero false positives
 * from library dialect gaps.
 *
 * FURTHER CONSIDERATION: SET PARSEONLY does not catch runtime errors like
 * "column ambiguous in multi-table join" or division by zero. Those only surface
 * at execution time. For now this is acceptable — we catch structure, not semantics.
 */
async function checkParseOnly(sql: string, connectionString: string): Promise<ValidationResult> {
  const parseOnlySQL = `SET PARSEONLY ON;\n${sql}\nSET PARSEONLY OFF;`;

  return new Promise((resolve) => {
    msnodesqlv8.query(connectionString, parseOnlySQL, (err: any) => {
      if (err) {
        // Strip the internal PARSEONLY boilerplate from the error message for clarity.
        const msg = err.message.replace(/SET PARSEONLY (ON|OFF);?\s*/gi, "").trim();
        resolve({ valid: false, error: `SQL syntax error (PARSEONLY): ${msg}` });
      } else {
        resolve({ valid: true });
      }
    });
  });
}

/**
 * Extract CTE names defined in a WITH clause (e.g. WITH Foo AS (...), Bar AS (...)).
 * These are aliases, not real tables, and must be excluded from the schema whitelist check.
 */
function extractCTENames(sql: string): Set<string> {
  const ctePattern = /\b(\w+)\s+AS\s*\(/gi;
  const names = new Set<string>();
  let match;
  while ((match = ctePattern.exec(sql)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

/**
 * Extract schema-qualified table names from a SQL string.
 * Matches patterns after FROM and JOIN keywords.
 *
 * FURTHER CONSIDERATION: This regex won't handle all edge cases:
 *   - Subqueries in FROM (e.g., FROM (SELECT ...) AS sub) — the subquery alias will be extracted, not a real table
 *   - CTEs referenced by alias — the CTE name will be checked against ALLOWED_TABLES and fail
 * For POC with LLM-generated SQL that always uses dbo.tablename, this is acceptable.
 * For production, replace with a proper AST walk (node-sql-parser or SQL Server DMVs).
 */
function extractTableNames(sql: string): string[] {
  const tablePattern = /(?:FROM|JOIN)\s+([\w]+\.[\w]+|[\w]+)/gi;
  const tables: string[] = [];
  let match;
  while ((match = tablePattern.exec(sql)) !== null) {
    tables.push(match[1].toLowerCase());
  }
  return [...new Set(tables)];
}

/**
 * Layer 3 — Schema-level whitelist check.
 *
 * Cross-references extracted table names against ALLOWED_TABLES (loaded from
 * INFORMATION_SCHEMA.TABLES at startup by initValidator). In-memory check — no DB call.
 * Works for any database: add/remove tables in SQL Server and the validator picks them
 * up on next restart without any code changes.
 *
 * FURTHER CONSIDERATION: Column-level validation (Layer 4) is not implemented.
 * When added, extract column names per table from the SELECT clause and verify them
 * against INFORMATION_SCHEMA.COLUMNS. This catches LLM hallucinating column names
 * that don't exist in the actual table.
 */
function checkSchema(sql: string, dbId: string): ValidationResult {
  const allowedTables = ALLOWED_TABLES_MAP.get(dbId);
  if (!allowedTables) {
    return { valid: false, error: `Validator not initialized for database: ${dbId}.` };
  }

  const cteNames = extractCTENames(sql);
  const tables = extractTableNames(sql);

  for (const table of tables) {
    // Skip CTE aliases — they are not real tables, just named subqueries.
    if (cteNames.has(table)) continue;

    // Allow INFORMATION_SCHEMA views and sys catalog views — they are read-only system
    // views, not user tables, so they don't appear in ALLOWED_TABLES (which only contains
    // BASE TABLEs). Queries like "what tables do we have" or "which table has the most rows"
    // legitimately need these system views.
    if (table.startsWith("information_schema.")) continue;

    // Allow a safe subset of sys.* catalog views for metadata queries (row counts, schema
    // inspection, etc.). We don't blanket-allow all sys.* to prevent access to sensitive
    // DMVs like sys.sql_logins or sys.credentials.
    const ALLOWED_SYS_VIEWS = new Set([
      "sys.tables", "sys.schemas", "sys.partitions", "sys.columns",
      "sys.indexes", "sys.objects", "sys.types", "sys.views",
    ]);
    if (ALLOWED_SYS_VIEWS.has(table)) continue;

    if (!allowedTables.has(table)) {
      return {
        valid: false,
        error: `Unknown table referenced: "${table}". Allowed tables: ${[...allowedTables].join(", ")}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Main entry point — runs all 4 layers in sequence.
 * Stops at the first failure and returns the error immediately.
 *
 * @param sql - Raw SQL string from LLM
 * @param connectionString - ODBC connection string for PARSEONLY check
 */
export async function validateSQL(sql: string, dbId: string, connectionString: string): Promise<ValidationResult> {
  // Normalize: strip trailing semicolons (LLMs often append one).
  const cleanSql = sql.trim().replace(/;\s*$/, "");

  // Layer 1 — Sanitization
  const sanitizeResult = sanitize(cleanSql);
  if (!sanitizeResult.valid) {
    console.warn(`[Validator] Layer 1 (Sanitize) failed: ${sanitizeResult.error}`);
    return sanitizeResult;
  }

  // Layer 2 — SQL Server PARSEONLY syntax check
  const parseResult = await checkParseOnly(cleanSql, connectionString);
  if (!parseResult.valid) {
    console.warn(`[Validator] Layer 2 (PARSEONLY) failed: ${parseResult.error}`);
    return parseResult;
  }

  // Layer 3 — Schema whitelist check
  const schemaResult = checkSchema(cleanSql, dbId);
  if (!schemaResult.valid) {
    console.warn(`[Validator] Layer 3 (Schema) failed: ${schemaResult.error}`);
    return schemaResult;
  }

  console.log("[Validator] ✅ All layers passed.");
  return { valid: true };
}
