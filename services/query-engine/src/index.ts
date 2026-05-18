import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { assemblePromptFromRAG } from "./context/promptAssembler";
import { initSqlExecutor } from "./executor/sqlExecutor";
import { initVectorStore } from "./rag/vectorStore";
import { retrieveContextDetailed } from "./rag/retriever";
import { initValidator } from "./validator/sqlValidator";
import { AgentExecutionHooks, runAgentWithHooks, streamAgent } from "./agent";
import { buildInternalError, buildRequestError } from "./errors/queryError";
import { getAgentRetryConfig } from "./config/appConfig";
import { getAuditConfig } from "./config/auditConfig";
import { beginAudit, completeAudit, stageError, stageSuccess, startStage } from "./logging/auditLogger";
import { queryAuditLogs } from "./logging/markdownLogParser";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const AGENT_NODE_TO_STAGE: Record<string, string> = {
  retrieve: "context_retrieval",
  generate: "llm_sql_generation",
  validate: "sql_safety_validation",
  execute: "sql_execution",
};

function createAgentAuditHooks(requestId: string): AgentExecutionHooks {
  return {
    onNodeStart: (node) => {
      const stage = AGENT_NODE_TO_STAGE[node];
      if (stage) {
        startStage(requestId, stage);
      }
    },
    onNodeEnd: (event) => {
      const stage = AGENT_NODE_TO_STAGE[event.node];
      if (!stage) {
        return;
      }

      const details = {
        retryCount: event.retryCount,
        rowCount: event.rowCount,
        executionTimeMs: event.executionTimeMs,
        sqlPreview: event.sql?.slice(0, 240),
        retrievedTables: event.retrievedTables,
      };

      if (event.generationError || event.validationError || event.executionError || event.status === "error") {
        stageError(requestId, stage, event.generationError || event.validationError || event.executionError || "Stage failed", details);
        return;
      }

      stageSuccess(requestId, stage, details);
    },
  };
}

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
    * Runs the LangGraph agent with self-correction up to the configured retry limit.
   */
  app.post("/query", async (req, res) => {
    const requestId = randomUUID();
    const { question } = req.body;
    const auditConfig = getAuditConfig();

    beginAudit(requestId, "/query", typeof question === "string" ? question : undefined);
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query",
      method: "POST",
    });

    startStage(requestId, "input_validation");

    if (!question || typeof question !== "string") {
      stageError(requestId, "input_validation", "Missing 'question' in request body.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query",
      });
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    stageSuccess(requestId, "input_validation", { questionLength: question.length });

    res.setHeader("x-request-id", requestId);

    try {
      const result = await runAgentWithHooks(question, createAgentAuditHooks(requestId));
      result.requestId = requestId;

      startStage(requestId, "response_formatting");
      stageSuccess(requestId, "response_formatting", {
        status: result.status,
        retryCount: result.retryCount,
      });

      if (result.status === "success") {
        startStage(requestId, "request_completed");
        stageSuccess(requestId, "request_completed", {
          rowCount: result.data?.rowCount,
          executionTimeMs: result.data?.executionTimeMs,
        });

        await completeAudit(requestId, "success", {
          endpoint: "/query",
          retryCount: result.retryCount,
          rowCount: result.data?.rowCount,
          appEnv: auditConfig.appEnv,
        });

        return res.json({
          requestId,
          status: result.status,
          question: result.question,
          sql: result.sql,
          data: result.data,
          retrievedTables: result.retrievedTables,
          retryCount: result.retryCount,
          maxRetries: result.maxRetries,
          maxAttempts: result.maxAttempts,
          errorHistory: result.errorHistory,
          finalError: null,
        });
      } else {
        startStage(requestId, "request_completed");
        stageError(requestId, "request_completed", result.detail || result.error || "Request ended with failure", {
          phase: result.phase,
          code: result.code,
        });

        await completeAudit(requestId, "error", {
          endpoint: "/query",
          phase: result.phase,
          code: result.code,
          retryCount: result.retryCount,
          appEnv: auditConfig.appEnv,
        });

        return res.status(result.phase === "generation" ? 422 : 400).json({
          requestId,
          status: result.status,
          error: result.error,
          detail: result.detail,
          sql: result.sql,
          retryCount: result.retryCount,
          maxRetries: result.maxRetries,
          maxAttempts: result.maxAttempts,
          errorHistory: result.errorHistory,
          phase: result.phase,
          displayTarget: result.displayTarget,
          code: result.code,
          finalError: result.finalError,
        });
      }
    } catch (err: any) {
      console.error("🤖 [Agent] Unexpected error:", err.message);

      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", err, {
        endpoint: "/query",
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query",
        code: "INTERNAL_ERROR",
      });

      return res.status(500).json(buildInternalError(err?.message || "Unexpected agent error."));
    }
  });

  /**
   * POST /query/stream
   * Body: { question: string }
   * Returns Server-Sent Events with real-time node-by-node updates.
   */
  app.post("/query/stream", async (req, res) => {
    const requestId = randomUUID();
    const { question } = req.body;

    beginAudit(requestId, "/query/stream", typeof question === "string" ? question : undefined);
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query/stream",
      method: "POST",
    });

    startStage(requestId, "input_validation");

    if (!question || typeof question !== "string") {
      stageError(requestId, "input_validation", "Missing 'question' in request body.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query/stream",
      });
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    stageSuccess(requestId, "input_validation", { questionLength: question.length });
    res.setHeader("x-request-id", requestId);

    const streamResult = await streamAgent(question, res, createAgentAuditHooks(requestId));

    startStage(requestId, "request_completed");
    if (streamResult?.status === "success") {
      stageSuccess(requestId, "request_completed", {
        endpoint: "/query/stream",
        rowCount: streamResult.data?.rowCount,
      });
      await completeAudit(requestId, "success", {
        endpoint: "/query/stream",
      });
    } else {
      stageError(requestId, "request_completed", streamResult?.detail || streamResult?.error || "Stream ended with failure", {
        endpoint: "/query/stream",
        phase: streamResult?.phase,
        code: streamResult?.code,
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query/stream",
      });
    }
  });

  app.get("/logs/api", async (req, res) => {
    const auditConfig = getAuditConfig();

    if (!auditConfig.uiEnabled) {
      return res.status(404).json({ error: "Logs UI is disabled in current environment." });
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));

    const result = await queryAuditLogs({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      stage: typeof req.query.stage === "string" ? req.query.stage : undefined,
      status: req.query.status === "success" || req.query.status === "error" ? req.query.status : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      page,
      pageSize,
    });

    return res.json(result);
  });

  app.get("/config", (_req, res) => {
    const retryConfig = getAgentRetryConfig();

    res.json({
      agent: retryConfig,
    });
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
