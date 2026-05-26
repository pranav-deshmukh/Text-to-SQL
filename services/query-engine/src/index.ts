import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { assemblePromptFromRAG } from "./context/promptAssembler";
import { registerSqlExecutor } from "./executor/sqlExecutor";
import { initVectorStore } from "./rag/vectorStore";
import { retrieveContextDetailed } from "./rag/retriever";
import { registerValidator } from "./validator/sqlValidator";
import { AgentExecutionHooks, runAgentWithHooks, streamAgent } from "./agent";
import { initiateReviewFlow, resumeReviewFlow, getReviewStatus, streamReviewFlow } from "./agent/reviewFlow";
import { cancelReviewSession } from "./agent/reviewSessions";
import { getReviewSession, updateReviewSession } from "./agent/reviewSessions";
import { requireAuth, requireRole, type AuthenticatedRequest } from "./auth/middleware";
import { createAuthToken } from "./auth/token";
import { authenticateUser, createUser, registerAuthStore } from "./auth/users";
import {
  archiveUserConversation,
  createUserConversation,
  getUserConversation,
  listUserConversations,
  persistAgentError,
  persistAgentSuccess,
  persistAssistantResult,
  persistReviewDraft,
  persistUserQuestion,
  updatePersistedReviewMessage,
} from "./chat/service";
import { registerChatStore } from "./chat/repository";
import { buildInternalError, buildRequestError } from "./errors/queryError";
import { getAgentRetryConfig } from "./config/appConfig";
import { getAuditConfig } from "./config/auditConfig";
import { getDatabaseConfig, getRegisteredDatabases } from "./config/dbRegistry";
import { beginAudit, completeAudit, stageCancelled, stageError, stageSuccess, startStage } from "./logging/auditLogger";
import { queryAuditLogs, syncAuditDatabases } from "./logging/auditDbStore";

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

function resolveDatabaseOrError(dbId: unknown) {
  if (typeof dbId !== "string" || dbId.trim().length === 0) {
    return {
      error: buildRequestError("Missing 'dbId' in request body."),
      status: 400,
    };
  }

  const database = getDatabaseConfig(dbId);
  if (!database) {
    return {
      error: buildRequestError(`Unknown database: \"${dbId}\". Use GET /databases for available options.`),
      status: 400,
    };
  }

  return { database, status: 200 as const };
}

function resolveConversationId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isConversationNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message === "Conversation not found.";
}

async function bootstrap() {
  const databases = getRegisteredDatabases();
  if (databases.length === 0) {
    console.error("FATAL: No databases registered. Check DB_REGISTRY or REGISTERED_DBS env var.");
    process.exit(1);
  }

  for (const database of databases) {
    await registerSqlExecutor(database.dbId, { connectionString: database.connectionString });
    await registerValidator(database.dbId, database.connectionString);
    await initVectorStore(database.qdrantCollection);
    console.log(`✅ Initialized database: ${database.displayName} (${database.dbId})`);
  }

  await registerAuthStore();
  await registerChatStore();
  await syncAuditDatabases(databases);

  // --- Routes ---

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "query-engine" });
  });

  app.get("/databases", (_req, res) => {
    res.json({
      databases: getRegisteredDatabases().map((database) => ({
        dbId: database.dbId,
        displayName: database.displayName,
      })),
    });
  });

  app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json(buildRequestError("Missing 'username' or 'password' in request body."));
    }

    try {
      const user = await authenticateUser(username, password);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown authentication error";
      console.error("[AUTH] Login failed:", message);
      return res.status(500).json({
        ...buildInternalError("Authentication service unavailable."),
        error: "Authentication service unavailable.",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
  });

  app.post("/auth/signup", async (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json(buildRequestError("Missing 'username' or 'password' in request body."));
    }

    try {
      const result = await createUser(username, password);
      if (!result.user) {
        return res.status(400).json({
          ...buildRequestError(result.error || "Unable to create account."),
          error: result.error || "Unable to create account.",
          code: result.code || "AUTH_SIGNUP_FAILED",
        });
      }

      return res.status(201).json({
        token: createAuthToken(result.user),
        user: result.user,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown signup error";
      console.error("[AUTH] Signup failed:", message);
      return res.status(500).json({
        ...buildInternalError("Authentication service unavailable."),
        error: "Authentication service unavailable.",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
  });

  app.get("/auth/me", requireAuth, (req: AuthenticatedRequest, res) => {
    return res.json({ user: req.user });
  });

  app.get("/chats", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json(buildRequestError("Authentication required."));
    }

    const conversations = await listUserConversations(req.user.userId);
    return res.json({ conversations });
  });

  app.post("/chats", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json(buildRequestError("Authentication required."));
    }

    const conversation = await createUserConversation(
      req.user.userId,
      typeof req.body?.dbId === "string" ? req.body.dbId : null,
      typeof req.body?.title === "string" ? req.body.title : undefined,
    );

    return res.status(201).json({ conversation });
  });

  app.get("/chats/:conversationId", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json(buildRequestError("Authentication required."));
    }

    const conversation = await getUserConversation(req.user.userId, String(req.params.conversationId));
    if (!conversation) {
      return res.status(404).json({
        ...buildRequestError("Conversation not found."),
        error: "Conversation not found.",
        code: "CHAT_NOT_FOUND",
      });
    }

    return res.json({ conversation });
  });

  app.delete("/chats/:conversationId", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json(buildRequestError("Authentication required."));
    }

    const archived = await archiveUserConversation(req.user.userId, String(req.params.conversationId));
    if (!archived) {
      return res.status(404).json({
        ...buildRequestError("Conversation not found."),
        error: "Conversation not found.",
        code: "CHAT_NOT_FOUND",
      });
    }

    return res.status(204).send();
  });

  /**
   * POST /rag-inspect
   * Body: { question: string, topK?: number }
   * Returns the raw RAG matches plus the assembled context that will be sent to the LLM.
   * Useful for debugging retrieval quality without triggering SQL generation.
   */
  app.post("/rag-inspect", requireAuth, async (req, res) => {
    const { question, dbId, topK } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json(buildRequestError("Missing 'question' in request body."));
    }

    const resolvedDatabase = resolveDatabaseOrError(dbId);
    if (!resolvedDatabase.database) {
      return res.status(resolvedDatabase.status).json(resolvedDatabase.error);
    }

    const requestedTopK =
      typeof topK === "number" && Number.isFinite(topK)
        ? Math.max(1, Math.min(Math.floor(topK), 25))
        : undefined; // undefined = use RAG_TOP_K env default

    try {
      const ragContext = await retrieveContextDetailed(question, resolvedDatabase.database.qdrantCollection, requestedTopK);
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
    const { question, dbId } = req.body ?? {};
    const conversationId = resolveConversationId(req.body?.conversationId);
    const user = req.user;
    const auditConfig = getAuditConfig();
    const requestedDbId = typeof dbId === "string" ? dbId : undefined;
    const requestedDatabase = requestedDbId ? getDatabaseConfig(requestedDbId) : undefined;

    beginAudit(requestId, "/query/initiate", typeof question === "string" ? question : undefined, {
      dbId: requestedDbId,
      dbDisplayName: requestedDatabase?.displayName,
      userId: user?.userId,
      userRole: user?.role,
    });
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

    const resolvedDatabase = resolveDatabaseOrError(dbId);
    if (!resolvedDatabase.database) {
      stageError(requestId, "input_validation", resolvedDatabase.error.detail || resolvedDatabase.error.error || "Invalid database.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query/initiate",
      });
      return res.status(resolvedDatabase.status).json(resolvedDatabase.error);
    }

    stageSuccess(requestId, "input_validation", {
      questionLength: question.length,
      role: user.role,
      dbId: resolvedDatabase.database.dbId,
    });

    res.setHeader("x-request-id", requestId);

    try {
      const persistedTurn = await persistUserQuestion(user.userId, question, resolvedDatabase.database.dbId, conversationId);
      const persistedConversationId = persistedTurn.conversation.conversationId;

      if (user.role === "tech_team") {
        startStage(requestId, "context_retrieval");
        const reviewDraft = await initiateReviewFlow(question, user.userId, resolvedDatabase.database.dbId);
        const persistedReviewMessage = await persistReviewDraft(persistedConversationId, reviewDraft);
        updateReviewSession(reviewDraft.threadId, (session) => ({
          ...session,
          conversationId: persistedConversationId,
          assistantMessageId: persistedReviewMessage.messageId,
        }));
        stageSuccess(requestId, "context_retrieval", {
          retrievedTables: reviewDraft.retrievedTables,
          dbId: resolvedDatabase.database.dbId,
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
          conversationId: persistedConversationId,
          ...reviewDraft,
        });
      }

      const result = await runAgentWithHooks(question, resolvedDatabase.database.dbId, createAgentAuditHooks(requestId));
      result.requestId = requestId;

      startStage(requestId, "response_formatting");
      stageSuccess(requestId, "response_formatting", {
        status: result.status,
        retryCount: result.retryCount,
      });

      if (result.status === "success") {
        await persistAgentSuccess(persistedConversationId, result);
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
          conversationId: persistedConversationId,
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

      await persistAgentError(persistedConversationId, result);

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
        conversationId: persistedConversationId,
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
      if (isConversationNotFoundError(err)) {
        return res.status(404).json({
          ...buildRequestError(err.message),
          error: err.message,
          code: "CHAT_NOT_FOUND",
        });
      }

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
    const existingSession = user && typeof threadId === "string" ? getReviewSession(threadId, user.userId) : null;
    const existingDatabase = existingSession ? getDatabaseConfig(existingSession.dbId) : undefined;

    beginAudit(requestId, "/query/resume", typeof approvedSQL === "string" ? approvedSQL : undefined, {
      dbId: existingSession?.dbId,
      dbDisplayName: existingDatabase?.displayName,
      userId: user?.userId,
      userRole: user?.role,
    });
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
      dbId: existingSession?.dbId,
    });

    try {
      const result = await resumeReviewFlow(threadId, user.userId, approvedSQL);
      const persistedConversationId = existingSession?.conversationId;
      const assistantMessageId = existingSession?.assistantMessageId;

      if (persistedConversationId && assistantMessageId) {
        if (result.status === "awaiting_review") {
          await updatePersistedReviewMessage(persistedConversationId, assistantMessageId, {
            generatedSQL: result.generatedSQL,
            editableSQL: result.editableSQL,
            status: "awaiting_review",
            retrievedTables: result.retrievedTables,
            schemaContext: result.schemaContext,
            promptPreview: result.promptPreview,
            lastError: result.lastError || null,
          });
        } else {
          await updatePersistedReviewMessage(persistedConversationId, assistantMessageId, {
            sql: result.sql,
            editableSQL: result.sql,
            status: "success",
            error: null,
            detail: null,
            result: result.data,
            retrievedTables: result.retrievedTables,
            lastError: null,
            completedAt: new Date().toISOString(),
          });
        }
      }

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

        return res.status(200).json({ requestId, conversationId: persistedConversationId, ...result });
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

      return res.json({ requestId, conversationId: persistedConversationId, ...result });
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

  app.post("/query/review/cancel", requireAuth, requireRole("tech_team"), async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    const { threadId, reason } = req.body ?? {};
    const user = req.user;
    const reviewSession = user && typeof threadId === "string" ? getReviewSession(threadId, user.userId) : null;
    const reviewDatabase = reviewSession ? getDatabaseConfig(reviewSession.dbId) : undefined;

    beginAudit(requestId, "/query/review/cancel", reviewSession?.question, {
      dbId: reviewSession?.dbId,
      dbDisplayName: reviewDatabase?.displayName,
      userId: user?.userId,
      userRole: user?.role,
    });
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query/review/cancel",
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
        endpoint: "/query/review/cancel",
        code: "AUTH_REQUIRED",
      });
      return res.status(401).json({
        ...buildRequestError("Authentication required."),
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    if (typeof threadId !== "string") {
      stageError(requestId, "input_validation", "Missing 'threadId' in request body.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Review cancel validation failed.");
      await completeAudit(requestId, "error", {
        endpoint: "/query/review/cancel",
        code: "BAD_REQUEST",
      });
      return res.status(400).json(buildRequestError("Missing 'threadId' in request body."));
    }

    stageSuccess(requestId, "input_validation", {
      threadId,
      hasReason: typeof reason === "string" && reason.trim().length > 0,
    });

    const cancelledSession = cancelReviewSession(threadId, user.userId);
    if (!cancelledSession) {
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Review session not found or has expired.", {
        endpoint: "/query/review/cancel",
        threadId,
      });
      await completeAudit(requestId, "error", {
        endpoint: "/query/review/cancel",
        code: "REVIEW_SESSION_NOT_FOUND",
      });
      return res.status(404).json({
        ...buildRequestError("Review session not found or has expired."),
        error: "Review session not found or has expired.",
        code: "REVIEW_SESSION_NOT_FOUND",
      });
    }

    startStage(requestId, "review_cancelled");
    stageCancelled(requestId, "review_cancelled", {
      threadId,
      reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "Execution cancelled by tech team user.",
    });
    startStage(requestId, "request_completed");
    stageCancelled(requestId, "request_completed", {
      status: "cancelled",
      threadId,
    });

    await completeAudit(requestId, "cancelled", {
      endpoint: "/query/review/cancel",
      threadId,
      dbId: cancelledSession.dbId,
      reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "Execution cancelled by tech team user.",
    });

    return res.json({
      requestId,
      status: "cancelled",
      threadId,
      question: cancelledSession.question,
      detail: `The generated SQL for \"${cancelledSession.question}\" was not executed. Submit the question again to regenerate a draft.`,
    });
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

    const session = getReviewSession(String(req.params.threadId), user.userId);
    return res.json({
      ...result,
      conversationId: session?.conversationId,
    });
  });

  /**
   * POST /query
   * Body: { question: string }
    * Runs the LangGraph agent with self-correction up to the configured retry limit.
   */
  app.post("/query", requireAuth, async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    const { question, dbId } = req.body;
    const conversationId = resolveConversationId(req.body?.conversationId);
    const auditConfig = getAuditConfig();
    const user = req.user;
    const requestedDbId = typeof dbId === "string" ? dbId : undefined;
    const requestedDatabase = requestedDbId ? getDatabaseConfig(requestedDbId) : undefined;

    beginAudit(requestId, "/query", typeof question === "string" ? question : undefined, {
      dbId: requestedDbId,
      dbDisplayName: requestedDatabase?.displayName,
      userId: user?.userId,
      userRole: user?.role,
    });
    startStage(requestId, "request_received");
    stageSuccess(requestId, "request_received", {
      endpoint: "/query",
      method: "POST",
      role: user?.role,
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

    const resolvedDatabase = resolveDatabaseOrError(dbId);
    if (!resolvedDatabase.database) {
      stageError(requestId, "input_validation", resolvedDatabase.error.detail || resolvedDatabase.error.error || "Invalid database.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query",
      });
      return res.status(resolvedDatabase.status).json(resolvedDatabase.error);
    }

    stageSuccess(requestId, "input_validation", { questionLength: question.length, dbId: resolvedDatabase.database.dbId });

    res.setHeader("x-request-id", requestId);

    try {
      if (!user) {
        startStage(requestId, "request_completed");
        stageError(requestId, "request_completed", "Request rejected: missing authenticated user.");
        await completeAudit(requestId, "error", {
          endpoint: "/query",
          code: "AUTH_REQUIRED",
        });
        return res.status(401).json({
          ...buildRequestError("Authentication required."),
          error: "Authentication required.",
          code: "AUTH_REQUIRED",
        });
      }

      const persistedTurn = await persistUserQuestion(user.userId, question, resolvedDatabase.database.dbId, conversationId);
      const persistedConversationId = persistedTurn.conversation.conversationId;
      const result = await runAgentWithHooks(question, resolvedDatabase.database.dbId, createAgentAuditHooks(requestId));
      result.requestId = requestId;

      startStage(requestId, "response_formatting");
      stageSuccess(requestId, "response_formatting", {
        status: result.status,
        retryCount: result.retryCount,
      });

      if (result.status === "success") {
        await persistAgentSuccess(persistedConversationId, result);
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
          conversationId: persistedConversationId,
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
        await persistAgentError(persistedConversationId, result);
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
          conversationId: persistedConversationId,
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
      if (isConversationNotFoundError(err)) {
        return res.status(404).json({
          ...buildRequestError(err.message),
          error: err.message,
          code: "CHAT_NOT_FOUND",
        });
      }

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
    const { question, dbId } = req.body;
    const conversationId = resolveConversationId(req.body?.conversationId);
    const user = req.user;

    const requestedDbId = typeof dbId === "string" ? dbId : undefined;
    const requestedDatabase = requestedDbId ? getDatabaseConfig(requestedDbId) : undefined;

    beginAudit(requestId, "/query/stream", typeof question === "string" ? question : undefined, {
      dbId: requestedDbId,
      dbDisplayName: requestedDatabase?.displayName,
      userId: user?.userId,
      userRole: user?.role,
    });
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

    const resolvedDatabase = resolveDatabaseOrError(dbId);
    if (!resolvedDatabase.database) {
      stageError(requestId, "input_validation", resolvedDatabase.error.detail || resolvedDatabase.error.error || "Invalid database.");
      startStage(requestId, "request_completed");
      stageError(requestId, "request_completed", "Request validation failed.");
      await completeAudit(requestId, "error", {
        code: "BAD_REQUEST",
        endpoint: "/query/stream",
      });
      return res.status(resolvedDatabase.status).json(resolvedDatabase.error);
    }

    stageSuccess(requestId, "input_validation", { questionLength: question.length, dbId: resolvedDatabase.database.dbId });
    res.setHeader("x-request-id", requestId);

    if (!user) {
      return res.status(401).json({
        ...buildRequestError("Authentication required."),
        error: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    let persistedConversationId: string;
    try {
      const persistedTurn = await persistUserQuestion(user.userId, question, resolvedDatabase.database.dbId, conversationId);
      persistedConversationId = persistedTurn.conversation.conversationId;
    } catch (error) {
      if (isConversationNotFoundError(error)) {
        return res.status(404).json({
          ...buildRequestError("Conversation not found."),
          error: "Conversation not found.",
          code: "CHAT_NOT_FOUND",
        });
      }

      throw error;
    }

    const streamResult = user?.role === "tech_team"
      ? await streamReviewFlow(
        question,
        user.userId,
        resolvedDatabase.database.dbId,
        res,
        createAgentAuditHooks(requestId),
        { conversationId: persistedConversationId },
      )
      : await streamAgent(
        question,
        resolvedDatabase.database.dbId,
        res,
        createAgentAuditHooks(requestId),
        { conversationId: persistedConversationId },
      );

    if (streamResult?.status === "success") {
      await persistAgentSuccess(persistedConversationId, streamResult);
    } else if (streamResult?.status === "awaiting_review") {
      const persistedReviewMessage = await persistReviewDraft(persistedConversationId, streamResult);
      updateReviewSession(streamResult.threadId, (session) => ({
        ...session,
        conversationId: persistedConversationId,
        assistantMessageId: persistedReviewMessage.messageId,
      }));
    } else {
      await persistAssistantResult(persistedConversationId, {
        error: user.role === "tech_team" ? "Unable to prepare SQL review draft." : "Unable to complete the query.",
        detail: user.role === "tech_team"
          ? "The review draft could not be generated."
          : "The streaming request ended before a final result was produced.",
        messageType: "error",
        status: "error",
      });
    }

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

    if (auditConfig.appEnv !== "dev" || !auditConfig.uiEnabled) {
      return res.status(403).json({ error: "Logs API is available only in dev mode." });
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));

    const result = await queryAuditLogs({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      stage: typeof req.query.stage === "string" ? req.query.stage : undefined,
      status:
        req.query.status === "success" || req.query.status === "error" || req.query.status === "cancelled"
          ? req.query.status
          : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      dbId: typeof req.query.dbId === "string" ? req.query.dbId : undefined,
      env:
        req.query.env === "dev" || req.query.env === "prod" || req.query.env === "all"
          ? req.query.env
          : "all",
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
