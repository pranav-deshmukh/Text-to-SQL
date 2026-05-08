import { retrieveContext } from "../rag/retriever";
import { assemblePromptFromRAG } from "../context/promptAssembler";
import { callLLM } from "../llm/gemini";
import { validateSQL } from "../validator/sqlValidator";
import { executeSQL } from "../executor/sqlExecutor";
import type { AgentStateType } from "./state";

/**
 * Node: Retrieve schema context via RAG.
 * If retrying after an error, appends error context to improve retrieval relevance.
 */
export async function retrieveNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // On retry, augment the question with error hint so RAG retrieves better context
  const query = state.errorHistory.length > 0
    ? `${state.question} (context: ${state.errorHistory[state.errorHistory.length - 1]})`
    : state.question;

  const ragResult = await retrieveContext(query, 10);

  console.log(`🤖 [Agent:retrieve] Tables: ${ragResult.tables.map(t => t.tableName).join(", ")}`);

  return {
    context: ragResult.schemaContext,
    retrievedTables: ragResult.tables.map(t => t.tableName),
  };
}

/**
 * Node: Generate SQL using LLM.
 * Passes error history so the LLM can avoid repeating mistakes.
 */
export async function generateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  let errorContext = "";
  if (state.errorHistory.length > 0) {
    errorContext = "\n\nPREVIOUS ERRORS (do NOT repeat these mistakes):\n" +
      state.errorHistory.map((e, i) => `${i + 1}. ${e}`).join("\n");
  }

  const prompt = assemblePromptFromRAG(state.context + errorContext, state.question);
  const sql = await callLLM(prompt.systemPrompt, prompt.userPrompt);

  console.log(`🤖 [Agent:generate] SQL: ${sql.substring(0, 100)}...`);

  return { sql };
}

/**
 * Node: Validate the generated SQL (4-layer pipeline).
 * On failure, records the error and increments retry count.
 */
export async function validateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Need the connection string — get from env directly since it's available at module scope
  const connStr = process.env.DB_CONNECTION_STRING || "";
  const result = await validateSQL(state.sql, connStr);

  if (!result.valid) {
    console.warn(`🤖 [Agent:validate] FAILED: ${result.error}`);
    return {
      validationError: result.error || "Unknown validation error",
      errorHistory: [`Validation failed for SQL "${state.sql.substring(0, 80)}...": ${result.error}`],
      retryCount: state.retryCount + 1,
    };
  }

  console.log(`🤖 [Agent:validate] ✅ Passed`);
  return { validationError: "" };
}

/**
 * Node: Execute validated SQL on SQL Server.
 * On failure, records the error and increments retry count.
 */
export async function executeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  try {
    const data = await executeSQL(state.sql);
    console.log(`🤖 [Agent:execute] ✅ ${data.rowCount} rows in ${data.executionTimeMs}ms`);
    return {
      result: data.rows,
      columns: data.columns,
      rowCount: data.rowCount,
      executionTimeMs: data.executionTimeMs,
      executionError: "",
      status: "success",
    };
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    console.warn(`🤖 [Agent:execute] FAILED: ${errorMsg}`);
    return {
      executionError: errorMsg,
      errorHistory: [`Execution error: ${errorMsg}`],
      retryCount: state.retryCount + 1,
      status: "error",
    };
  }
}

/**
 * Node: Terminal error — max retries exceeded.
 */
export async function errorNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  console.error(`🤖 [Agent:error] Max retries reached. Giving up.`);
  return { status: "error" };
}
