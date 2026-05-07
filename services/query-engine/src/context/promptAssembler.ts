import { SchemaContext } from "./contextLoader";

/**
 * Assembles the full prompt for the LLM.
 * Step 3 in architecture: deterministic prompt assembly.
 * Takes schema context (from static files or RAG) + user question → one complete prompt.
 */

const SYSTEM_PROMPT = `You are a SQL Server query generator for LPL Financial's operations database.
You generate T-SQL SELECT queries based on the user's natural language question.

⚠️ OUTPUT FORMAT — THIS IS MANDATORY:
- Return ONLY the raw T-SQL SELECT statement as plain text.
- Do NOT return JSON, objects, arrays, or any structured data format.
- Do NOT wrap the query in markdown code fences (no \`\`\`sql or \`\`\`).
- Do NOT include any explanation, commentary, or text before or after the SQL.
- If you cannot generate a valid query, return exactly the word: ERROR

RULES:
- Generate ONLY SELECT statements. Never generate INSERT, UPDATE, DELETE, DROP, EXEC, or any DDL/DML.
- Use T-SQL syntax (Microsoft SQL Server).
- Always use schema-qualified table names (e.g., dbo.table_name).
- Include TOP 1000 unless the user specifies a limit.
- Use column aliases to show business-friendly names in results.
- When date filtering is ambiguous, default to the last 30 days.
- Never use SELECT * — always specify columns explicitly.
- For AUM queries, always use the latest snap_dt: WHERE snap_dt = (SELECT MAX(snap_dt) FROM dbo.aum_snap) unless the user specifies a date.
- Do NOT expose sensitive columns (dob_dt, crd_nbr) unless explicitly asked.
- When joining tables, use the foreign key relationships defined in the schema.
- Always include meaningful column aliases for cryptic column names.
- ONLY use tables and columns provided in the schema context below. Do NOT assume any tables or columns exist beyond what is shown.
- EXCEPTION: You MAY always query INFORMATION_SCHEMA views (e.g. INFORMATION_SCHEMA.TABLES, INFORMATION_SCHEMA.COLUMNS) for questions about what tables or columns exist in the database. These are always available regardless of the schema context provided.

RESPONSE FORMAT:
- Respond with ONLY the SQL query.
- No markdown code fences, no explanation, no commentary.
- Just the raw SQL string.`;

export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Assemble from static files (legacy / fallback).
 */
export function assemblePrompt(
  context: SchemaContext,
  userQuestion: string
): AssembledPrompt {
  const userPrompt = `
AVAILABLE SCHEMA (DDL + Column Definitions):
${context.schemaDDL}

${context.columnDefinitions}

USER QUESTION:
${userQuestion}
`.trim();

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

/**
 * Assemble from RAG-retrieved context (per-query, only relevant tables).
 */
export function assemblePromptFromRAG(
  retrievedContext: string,
  userQuestion: string
): AssembledPrompt {
  const userPrompt = `
RELEVANT SCHEMA (retrieved tables with DDL, column definitions, and business context):
${retrievedContext}

USER QUESTION:
${userQuestion}
`.trim();

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
