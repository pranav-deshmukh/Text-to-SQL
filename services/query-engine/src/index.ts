import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { assemblePromptFromRAG } from "./context/promptAssembler";
import { callLLM } from "./llm/gemini";
import { initSqlExecutor, executeSQL } from "./executor/sqlExecutor";
import { initVectorStore } from "./rag/vectorStore";
import { retrieveContext, retrieveContextDetailed } from "./rag/retriever";
import { validateSQL, initValidator } from "./validator/sqlValidator";
import { runAgent, streamAgent } from "./agent";
import {
  buildExecutionError,
  buildGenerationError,
  buildInternalError,
  buildRequestError,
  buildValidationError,
} from "./errors/queryError";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Stored at module scope so the validator can reuse the same connection string
// without opening a separate connection.
let dbConnectionString = "";



async function bootstrap() {

  // Connect to MS SQL Server (via shared memory / named pipes)
  const connStr = process.env.DB_CONNECTION_STRING || "";
  dbConnectionString = connStr;
  await initSqlExecutor({
    connectionString: connStr,
  });

  // Load allowed-tables whitelist dynamically from INFORMATION_SCHEMA
  await initValidator(connStr);

  // Initialize ChromaDB vector store (RAG)
  await initVectorStore();

  // --- Routes ---

  /**
   * POST /query
   * Body: { question: string }
   * Returns: { question, sql, data, tokens, retrievedTables }
   */
  app.post("/query", async (req, res) => {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    try {
      let ragContext;
      let llmResponse = "";

      try {
        ragContext = await retrieveContext(question, 10);
        console.log(`\n📝 Question: ${question}`);
        console.log(`🔍 Retrieved tables: ${ragContext.tables.map((t) => t.tableName).join(", ")}`);

        const prompt = assemblePromptFromRAG(ragContext.schemaContext, question);
        llmResponse = (await callLLM(prompt.systemPrompt, prompt.userPrompt)).trim();
      } catch (err: any) {
        console.error("❌ Generation error:", err.message);
        return res.status(502).json(buildGenerationError(err?.message || "Unable to generate SQL."));
      }

      if (!llmResponse || llmResponse.toUpperCase() === "ERROR") {
        return res.status(422).json(buildGenerationError("The language model did not return a usable SQL query."));
      }

      console.log(`🔧 SQL: ${llmResponse}`);

      // Step 5: SQL Validation — 4-layer pipeline
      // Layer 1: sanitization (JSON guard, SELECT-only, block DML/DDL keywords)
      // Layer 2: SET PARSEONLY ON — SQL Server parses but never executes (dialect-accurate)
      // Layer 3: schema whitelist — all referenced tables must exist in ALLOWED_TABLES
      // Layer 4: column-level checks — not yet implemented
      const validation = await validateSQL(llmResponse, dbConnectionString);
      if (!validation.valid) {
        console.warn(`⚠️  SQL validation failed: ${validation.error}`);
        return res.status(400).json(buildValidationError(validation.error || "SQL validation failed.", llmResponse));
      }

      // Step 6: Execute SQL against MS SQL Server
      let data;
      try {
        data = await executeSQL(llmResponse);
      } catch (err: any) {
        console.error("❌ Execution error:", err.message);
        return res.status(500).json(buildExecutionError(err?.message || "SQL execution failed.", llmResponse));
      }
      console.log(`✅ Returned ${data.rowCount} rows in ${data.executionTimeMs}ms`);

      return res.json({
        question,
        sql: llmResponse,
        data,
        retrievedTables: ragContext.tables,
      });
    } catch (err: any) {
      console.error("❌ Error:", err.message);
      return res.status(500).json(buildInternalError(err?.message || "Unexpected server error."));
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "query-engine" });
  });

  /**
   * POST /rag-inspect
   * Body: { question: string, topK?: number }
   * Returns the raw RAG matches plus the assembled context that will be sent to the LLM.
   */
  app.post("/rag-inspect", async (req, res) => {
    const { question, topK } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    const requestedTopK = typeof topK === "number" && Number.isFinite(topK)
      ? Math.max(1, Math.min(Math.floor(topK), 25))
      : 10;

    try {
      const ragContext = await retrieveContextDetailed(question, requestedTopK);
      const prompt = assemblePromptFromRAG(ragContext.schemaContext, question);

      return res.json({
        question,
        topK: requestedTopK,
        retrievedTables: ragContext.tables,
        matches: ragContext.matches,
        schemaContext: ragContext.schemaContext,
        promptPreview: {
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
        },
      });
    } catch (err: any) {
      console.error("🔎 [RAG Inspect] Error:", err.message);
      return res.status(500).json(buildInternalError(err?.message || "RAG inspect failed."));
    }
  });

  /**
   * POST /agent-query  (Phase 2 — LangGraph agent with self-correction)
   * Body: { question: string }
   * The agent retries up to 2 times on validation/execution errors.
   */
  app.post("/agent-query", async (req, res) => {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    try {
      const result = await runAgent(question);

      if (result.status === "success") {
        return res.json({
          status: result.status,
          question: result.question,
          sql: result.sql,
          data: result.data,
          retrievedTables: result.retrievedTables,
          retryCount: result.retryCount,
          errorHistory: result.errorHistory,
          finalError: null,
        });
      } else {
        return res.status(result.phase === "generation" ? 422 : 400).json({
          status: result.status,
          error: result.error,
          detail: result.detail,
          sql: result.sql,
          retryCount: result.retryCount,
          errorHistory: result.errorHistory,
          phase: result.phase,
          displayTarget: result.displayTarget,
          code: result.code,
          finalError: result.finalError,
        });
      }
    } catch (err: any) {
      console.error("🤖 [Agent] Unexpected error:", err.message);
      return res.status(500).json(buildInternalError(err?.message || "Unexpected agent error."));
    }
  });

  /**
   * POST /agent-query/stream  (Phase 2 — SSE streaming)
   * Body: { question: string }
   * Returns Server-Sent Events with real-time node updates.
   */
  app.post("/agent-query/stream", async (req, res) => {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    await streamAgent(question, res);
  });

  // --- Start ---
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Query engine running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start:", err.message);
  process.exit(1);
});
