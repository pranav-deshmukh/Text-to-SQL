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
import { initiateReviewFlow, resumeReviewFlow, getReviewStatus, streamReviewFlow } from "./agent/reviewFlow";
import { requireAuth, requireRole, type AuthenticatedRequest } from "./auth/middleware";
import { createAuthToken } from "./auth/token";
import { authenticateUser } from "./auth/users";
import { buildInternalError, buildRequestError } from "./errors/queryError";
import { getAgentRetryConfig } from "./config/appConfig";
import { getAuditConfig } from "./config/auditConfig";
import { beginAudit, completeAudit, stageError, stageSuccess, startStage } from "./logging/auditLogger";
import { queryAuditLogs } from "./logging/markdownLogParser";

dotenv.config();

// Validate critical env vars early (after dotenv loads them)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  console.error(
    "FATAL: JWT_SECRET environment variable is not set or is less than 32 characters. " +
      "The application cannot start without a secure signing secret."
  );
  process.exit(1);
}

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

  app.post("/auth/login", (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json(buildRequestError("Missing 'username' or 'password' in request body."));
    }

    const user = authenticateUser(username, password);
    if (!user) {
      return res.status(401).json({
        ...buildRequestError("Invalid username or password."),
        error: "Invalid username or password.",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    return res.json({
      token: createAuthToken(user),
      user,
    });
  });

  app.get("/auth/me", requireAuth, (req: AuthenticatedRequest, res) => {
    return res.json({ user: req.user });
  });

  /**
   * POST /rag-inspect
   * Body: { question: string, topK?: number }
   * Returns the raw RAG matches plus the assembled context that will be sent to the LLM.
   * Useful for debugging retrieval quality without triggering SQL generation.
   */
  app.post("/rag-inspect", requireAuth, async (req, res) => {
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

  app.post("/query/initiate", requireAuth, async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    const { question } = req.body ?? {};
    const user = req.user;
    const auditConfig = getAuditConfig();

    beginAudit(requestId, "/query/initiate", typeof question === "string" ? question : undefined);
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query/initiate",
      method: "POST",
      role: user?.role,
    });

    startStage(requestId, "input_validation");

    if (!user) {
      stageError(requestId, "input_validation", "Authentication required.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request rejected: missing authenticated user.");
      await completeAudit(requestId, "error", {
        endpoint: "/query/initiate",
        code: "AUTH_REQUIRED",
      });
      return res.status(401).json({
        ...buildRequestError("Authentication required."),
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    if (!question || typeof question !== "string") {
      stageError(requestId, "input_validation", "Missing 'question' in request body.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query/initiate",
      });
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    stageSuccess(requestId, "input_validation", {
      questionLength: question.length,
      role: user.role,
    });

    res.setHeader("x-request-id", requestId);

    try {
      if (user.role === "tech_team") {
        startStage(requestId, "context_retrieval");
        const reviewDraft = await initiateReviewFlow(question, user.userId);
        stageSuccess(requestId, "context_retrieval", {
          retrievedTables: reviewDraft.retrievedTables,
        });

        startStage(requestId, "llm_sql_generation");
        stageSuccess(requestId, "llm_sql_generation", {
          sqlPreview: reviewDraft.generatedSQL.slice(0, 240),
        });

        startStage(requestId, "request_completed");
        stageSuccess(requestId, "request_completed", {
          status: reviewDraft.status,
          threadId: reviewDraft.threadId,
        });

        await completeAudit(requestId, "success", {
          endpoint: "/query/initiate",
          mode: "tech_review",
          appEnv: auditConfig.appEnv,
        });

        return res.json({
          requestId,
          ...reviewDraft,
        });
      }

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
          endpoint: "/query/initiate",
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
      }

      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", result.detail || result.error || "Request ended with failure", {
        phase: result.phase,
        code: result.code,
      });

      await completeAudit(requestId, "error", {
        endpoint: "/query/initiate",
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
    } catch (err: any) {
      console.error("🤖 [Role Query] Unexpected error:", err.message);

      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", err?.message || String(err), {
        endpoint: "/query/initiate",
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query/initiate",
        code: "INTERNAL_ERROR",
      });

      return res.status(500).json(buildInternalError(err?.message || "Unexpected initiate error."));
    }
  });

  app.post("/query/resume", requireAuth, requireRole("tech_team"), async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    const { threadId, approvedSQL } = req.body ?? {};
    const user = req.user;
    const auditConfig = getAuditConfig();

    beginAudit(requestId, "/query/resume", typeof approvedSQL === "string" ? approvedSQL : undefined);
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query/resume",
      method: "POST",
      role: user?.role,
      threadId,
    });
    startStage(requestId, "input_validation");

    if (!user) {
      stageError(requestId, "input_validation", "Authentication required.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request rejected: missing authenticated user.");
      await completeAudit(requestId, "error", {
        endpoint: "/query/resume",
        code: "AUTH_REQUIRED",
      });
      return res.status(401).json({
        ...buildRequestError("Authentication required."),
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    if (typeof threadId !== "string" || typeof approvedSQL !== "string") {
      stageError(requestId, "input_validation", "Missing 'threadId' or 'approvedSQL' in request body.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Resume request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query/resume",
      });
      return res.status(400).json(buildRequestError("Missing 'threadId' or 'approvedSQL' in request body."));
    }

    stageSuccess(requestId, "input_validation", {
      threadId,
      sqlLength: approvedSQL.length,
    });

    try {
      const result = await resumeReviewFlow(threadId, user.userId, approvedSQL);

      if (result.status === "awaiting_review") {
        startStage(requestId, "sql_safety_validation");
        stageError(requestId, "sql_safety_validation", result.lastError?.message || "Manual SQL needs correction.", {
          threadId,
          phase: result.lastError?.phase,
        });
        startStage(requestId, "request_completed");
        stageSuccess(requestId, "request_completed", {
          status: result.status,
          threadId,
        });

        await completeAudit(requestId, "error", {
          endpoint: "/query/resume",
          threadId,
          phase: result.lastError?.phase,
          appEnv: auditConfig.appEnv,
        });

        return res.status(200).json({ requestId, ...result });
      }

      startStage(requestId, "sql_execution");
      stageSuccess(requestId, "sql_execution", {
        threadId,
        rowCount: result.data.rowCount,
        executionTimeMs: result.data.executionTimeMs,
      });
      startStage(requestId, "request_completed");
      stageSuccess(requestId, "request_completed", {
        status: result.status,
        threadId,
      });

      await completeAudit(requestId, "success", {
        endpoint: "/query/resume",
        threadId,
        rowCount: result.data.rowCount,
        appEnv: auditConfig.appEnv,
      });

      return res.json({ requestId, ...result });
    } catch (err: any) {
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", err?.message || String(err), {
        endpoint: "/query/resume",
        threadId,
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query/resume",
        code: "INTERNAL_ERROR",
      });

      return res.status(404).json({
        ...buildRequestError(err?.message || "Review session not found."),
        error: err?.message || "Review session not found.",
        code: "REVIEW_SESSION_NOT_FOUND",
      });
    }
  });

  app.get("/query/status/:threadId", requireAuth, requireRole("tech_team"), (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        ...buildRequestError("Authentication required."),
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    const result = getReviewStatus(String(req.params.threadId), user.userId);
    if (!result) {
      return res.status(404).json({
        ...buildRequestError("Review session not found or has expired."),
        error: "Review session not found or has expired.",
        code: "REVIEW_SESSION_NOT_FOUND",
      });
    }

    return res.json(result);
  });

  /**
   * POST /query
   * Body: { question: string }
    * Runs the LangGraph agent with self-correction up to the configured retry limit.
   */
  app.post("/query", requireAuth, async (req, res) => {
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
  app.post("/query/stream", requireAuth, async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    const { question } = req.body;
    const user = req.user;

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

    const streamResult = user?.role === "tech_team"
      ? await streamReviewFlow(question, user.userId, res, createAgentAuditHooks(requestId))
      : await streamAgent(question, res, createAgentAuditHooks(requestId));

    startStage(requestId, "request_completed");
    if (streamResult?.status === "success") {
      stageSuccess(requestId, "request_completed", {
        endpoint: "/query/stream",
        rowCount: streamResult.data?.rowCount,
      });
      await completeAudit(requestId, "success", {
        endpoint: "/query/stream",
      });
    } else if (streamResult?.status === "awaiting_review") {
      stageSuccess(requestId, "request_completed", {
        endpoint: "/query/stream",
        status: streamResult.status,
        threadId: streamResult.threadId,
      });
      await completeAudit(requestId, "success", {
        endpoint: "/query/stream",
        mode: "tech_review",
      });
    } else {
      const failureDetail = streamResult && "detail" in streamResult
        ? streamResult.detail || streamResult.error || "Stream ended with failure"
        : "Stream ended with failure";
      const failureMeta = streamResult && "phase" in streamResult
        ? { phase: streamResult.phase, code: streamResult.code }
        : undefined;

      stageError(requestId, "request_completed", failureDetail, {
        endpoint: "/query/stream",
        phase: failureMeta?.phase,
        code: failureMeta?.code,
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query/stream",
      });
    }
  });

  app.get("/logs/api", requireAuth, requireRole("tech_team"), async (req, res) => {
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
