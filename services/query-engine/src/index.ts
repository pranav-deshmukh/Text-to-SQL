import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { assemblePromptFromRAG } from "./context/promptAssembler";
import { initSqlExecutor } from "./executor/sqlExecutor";
import { initVectorStore } from "./rag/vectorStore";
import { retrieveContextDetailed } from "./rag/retriever";
import { initValidator } from "./validator/sqlValidator";
import { runAgent, streamAgent } from "./agent";
import { buildInternalError, buildRequestError } from "./errors/queryError";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

async function bootstrap() {
  const connStr = process.env.DB_CONNECTION_STRING || "";

  await initSqlExecutor({ connectionString: connStr });
  await initValidator(connStr);
  await initVectorStore();

  // --- Routes ---

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "query-engine" });
  });

  /**
   * POST /rag-inspect
   * Body: { question: string, topK?: number }
   * Returns the raw RAG matches plus the assembled context that will be sent to the LLM.
   * Useful for debugging retrieval quality without triggering SQL generation.
   */
  app.post("/rag-inspect", async (req, res) => {
    const { question, topK } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    const requestedTopK =
      typeof topK === "number" && Number.isFinite(topK)
        ? Math.max(1, Math.min(Math.floor(topK), 25))
        : undefined; // undefined = use RAG_TOP_K env default

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
   * POST /query
   * Body: { question: string }
   * Runs the LangGraph agent with self-correction (up to 2 retries on validation/execution errors).
   */
  app.post("/query", async (req, res) => {
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
   * POST /query/stream
   * Body: { question: string }
   * Returns Server-Sent Events with real-time node-by-node updates.
   */
  app.post("/query/stream", async (req, res) => {
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
