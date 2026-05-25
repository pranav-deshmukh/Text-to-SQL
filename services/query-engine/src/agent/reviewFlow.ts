import type { Response } from "express";
import { assemblePromptFromRAG } from "../context/promptAssembler";
import { buildExecutionError, buildGenerationError, buildValidationError } from "../errors/queryError";
import { executeSQL } from "../executor/sqlExecutor";
import { callLLM } from "../llm/gemini";
import { retrieveContextDetailed } from "../rag/retriever";
import { validateSQL } from "../validator/sqlValidator";
import { getAgentRetryConfig } from "../config/appConfig";
import { getDatabaseConfig } from "../config/dbRegistry";
import {
  completeReviewSession,
  createReviewSession,
  getReviewSession,
  updateReviewSession,
} from "./reviewSessions";

export interface ReviewDraftResponse {
  status: "awaiting_review";
  threadId: string;
  question: string;
  generatedSQL: string;
  editableSQL: string;
  schemaContext: string;
  promptPreview: {
    systemPrompt: string;
    userPrompt: string;
  };
  retrievedTables: string[];
  lastError?: {
    phase: "validation" | "execution";
    message: string;
  };
}

export interface ReviewExecutionSuccess {
  status: "success";
  threadId: string;
  question: string;
  sql: string;
  data: {
    columns: string[];
    rows: Record<string, any>[];
    rowCount: number;
    executionTimeMs: number;
  };
  retrievedTables: string[];
}

export type ReviewResumeResponse = ReviewDraftResponse | ReviewExecutionSuccess;

interface ReviewStreamHooks {
  onNodeStart?: (node: string) => void;
  onNodeEnd?: (event: {
    node: string;
    sql?: string;
    generationError?: string;
    validationError?: string;
    executionError?: string;
    retrievedTables?: string[];
    retryCount?: number;
    maxRetries: number;
    maxAttempts: number;
    status?: string;
    rowCount?: number;
    executionTimeMs?: number;
  }) => void;
}

interface StreamResponseMeta {
  conversationId?: string;
}

const retryConfig = getAgentRetryConfig();

function buildDraftResponse(session: ReturnType<typeof createReviewSession> | NonNullable<ReturnType<typeof getReviewSession>>): ReviewDraftResponse {
  return {
    status: "awaiting_review",
    threadId: session.threadId,
    question: session.question,
    generatedSQL: session.generatedSql,
    editableSQL: session.editableSql,
    schemaContext: session.schemaContext,
    promptPreview: session.promptPreview,
    retrievedTables: session.retrievedTables,
    lastError: session.lastError,
  };
}

export async function initiateReviewFlow(question: string, userId: string, dbId: string): Promise<ReviewDraftResponse> {
  const database = getDatabaseConfig(dbId);
  if (!database) {
    throw new Error(`Unknown database: ${dbId}`);
  }

  const ragContext = await retrieveContextDetailed(question, database.qdrantCollection);
  const prompt = assemblePromptFromRAG(ragContext.schemaContext, question);
  const generatedSQL = (await callLLM(prompt.systemPrompt, prompt.userPrompt)).trim();

  if (!generatedSQL || generatedSQL.toUpperCase() === "ERROR") {
    const error = buildGenerationError("The language model did not return a usable SQL query.");
    throw new Error(error.detail || error.error);
  }

  const session = createReviewSession({
    userId,
    dbId,
    question,
    generatedSql: generatedSQL,
    editableSql: generatedSQL,
    schemaContext: ragContext.schemaContext,
    promptPreview: prompt,
    retrievedTables: ragContext.tables.map((table) => table.tableName),
  });

  return buildDraftResponse(session);
}

export async function streamReviewFlow(
  question: string,
  userId: string,
  dbId: string,
  res: Response,
  hooks?: ReviewStreamHooks,
  responseMeta?: StreamResponseMeta,
): Promise<ReviewDraftResponse | null> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const database = getDatabaseConfig(dbId);
    if (!database) {
      throw new Error(`Unknown database: ${dbId}`);
    }

    hooks?.onNodeStart?.("retrieve");
    const ragContext = await retrieveContextDetailed(question, database.qdrantCollection);
    const retrieveEvent = {
      node: "retrieve",
      retrievedTables: ragContext.tables.map((table) => table.tableName),
      retryCount: 0,
      maxRetries: retryConfig.maxRetries,
      maxAttempts: retryConfig.maxAttempts,
      status: "done",
    };
    hooks?.onNodeEnd?.(retrieveEvent);
    sendEvent("node_end", retrieveEvent);

    hooks?.onNodeStart?.("generate");
    const prompt = assemblePromptFromRAG(ragContext.schemaContext, question);
    const generatedSQL = (await callLLM(prompt.systemPrompt, prompt.userPrompt)).trim();

    if (!generatedSQL || generatedSQL.toUpperCase() === "ERROR") {
      const error = buildGenerationError("The language model did not return a usable SQL query.");
      const generateEvent = {
        node: "generate",
        generationError: error.detail || error.error,
        retryCount: 0,
        maxRetries: retryConfig.maxRetries,
        maxAttempts: retryConfig.maxAttempts,
        status: "error",
      };
      hooks?.onNodeEnd?.(generateEvent);
      sendEvent("node_end", generateEvent);
      sendEvent("error", {
        ...error,
        ...responseMeta,
        maxRetries: retryConfig.maxRetries,
        maxAttempts: retryConfig.maxAttempts,
      });
      return null;
    }

    const session = createReviewSession({
      userId,
      dbId,
      question,
      generatedSql: generatedSQL,
      editableSql: generatedSQL,
      schemaContext: ragContext.schemaContext,
      promptPreview: prompt,
      retrievedTables: ragContext.tables.map((table) => table.tableName),
    });

    const draft = buildDraftResponse(session);
    const generateEvent = {
      node: "generate",
      sql: generatedSQL,
      retryCount: 0,
      maxRetries: retryConfig.maxRetries,
      maxAttempts: retryConfig.maxAttempts,
      status: "awaiting_review",
    };
    hooks?.onNodeEnd?.(generateEvent);
    sendEvent("node_end", generateEvent);
    sendEvent("done", {
      ...draft,
      ...responseMeta,
    });
    return draft;
  } catch (error: any) {
    const generationError = buildGenerationError(error?.message || "Unable to prepare SQL review draft.");
    sendEvent("error", {
      ...generationError,
      ...responseMeta,
      maxRetries: retryConfig.maxRetries,
      maxAttempts: retryConfig.maxAttempts,
    });
    return null;
  } finally {
    res.end();
  }
}

export async function resumeReviewFlow(threadId: string, userId: string, approvedSQL: string): Promise<ReviewResumeResponse> {
  const session = getReviewSession(threadId, userId);
  if (!session) {
    throw new Error("Review session not found or has expired.");
  }

  const trimmedSql = approvedSQL.trim();
  const database = getDatabaseConfig(session.dbId);
  if (!database) {
    throw new Error(`Unknown database: ${session.dbId}`);
  }

  const validationResult = await validateSQL(trimmedSql, session.dbId, database.connectionString);

  if (!validationResult.valid) {
    const updated = updateReviewSession(threadId, (current) => ({
      ...current,
      editableSql: trimmedSql,
      lastError: {
        phase: "validation",
        message: buildValidationError(validationResult.error || "Manual SQL failed validation.", trimmedSql).detail ||
          validationResult.error ||
          "Manual SQL failed validation.",
      },
    }));

    if (!updated) {
      throw new Error("Review session expired before validation could complete.");
    }

    return buildDraftResponse(updated);
  }

  try {
    const data = await executeSQL(trimmedSql, session.dbId);
    completeReviewSession(threadId);

    return {
      status: "success",
      threadId,
      question: session.question,
      sql: trimmedSql,
      data: {
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount,
        executionTimeMs: data.executionTimeMs,
      },
      retrievedTables: session.retrievedTables,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const executionError = buildExecutionError(message, trimmedSql);
    const updated = updateReviewSession(threadId, (current) => ({
      ...current,
      editableSql: trimmedSql,
      lastError: {
        phase: "execution",
        message: executionError.detail || executionError.error,
      },
    }));

    if (!updated) {
      throw new Error("Review session expired before execution could complete.");
    }

    return buildDraftResponse(updated);
  }
}

export function getReviewStatus(threadId: string, userId: string) {
  const session = getReviewSession(threadId, userId);
  if (!session) {
    return null;
  }

  return {
    status: "awaiting_review" as const,
    threadId: session.threadId,
    question: session.question,
    updatedAt: session.updatedAt,
    lastError: session.lastError,
  };
}
