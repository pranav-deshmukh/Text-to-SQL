import { buildAgentGraph } from "./graph";
import type { Response } from "express";
import {
  buildExecutionError,
  buildGenerationError,
  buildValidationError,
} from "../errors/queryError";
import type { QueryErrorPhase } from "../errors/queryError";
import { getAgentRetryConfig } from "../config/appConfig";

const agent = buildAgentGraph();
const retryConfig = getAgentRetryConfig();

export interface AgentResult {
  requestId?: string;
  question: string;
  sql: string;
  data: {
    columns: string[];
    rows: Record<string, any>[];
    rowCount: number;
    executionTimeMs: number;
  } | null;
  status: "success" | "error";
  error?: string;
  detail?: string;
  retryCount: number;
  maxRetries: number;
  maxAttempts: number;
  errorHistory: string[];
  retrievedTables: string[];
  phase?: QueryErrorPhase;
  displayTarget?: "sql-box" | "error-box";
  code?: string;
  finalError?: {
    code: string;
    phase: QueryErrorPhase;
    message: string;
    detail?: string;
  };
}

export interface AgentNodeUpdate {
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
}

export interface AgentExecutionHooks {
  onNodeStart?: (node: string) => void;
  onNodeEnd?: (event: AgentNodeUpdate) => void;
}

function getNextNode(update: Record<string, any>): string | undefined {
  if (update.generationError) {
    return (update.retryCount ?? 0) < retryConfig.maxAttempts ? "retrieve" : "error";
  }

  if (update.validationError) {
    return (update.retryCount ?? 0) < retryConfig.maxAttempts ? "retrieve" : "error";
  }

  if (update.executionError) {
    return (update.retryCount ?? 0) < retryConfig.maxAttempts ? "generate" : "error";
  }

  if (update.status === "success") {
    return undefined;
  }

  if (update.status === "error") {
    return "error";
  }

  if (update.rowCount !== undefined || update.executionTimeMs !== undefined) {
    return undefined;
  }

  if (update.sql) {
    return "validate";
  }

  if (update.retrievedTables) {
    return "generate";
  }

  return undefined;
}

async function executeAgent(question: string, hooks?: AgentExecutionHooks): Promise<AgentResult> {
  const accumulated: Record<string, any> = { question };

  hooks?.onNodeStart?.("retrieve");
  const stream = await agent.stream({ question }, { streamMode: "updates" });

  for await (const chunk of stream) {
    for (const [nodeName, stateUpdate] of Object.entries(chunk)) {
      const update = stateUpdate as Record<string, any>;
      Object.assign(accumulated, update);

      const event: AgentNodeUpdate = {
        node: nodeName,
        sql: update.sql,
        generationError: update.generationError,
        validationError: update.validationError,
        executionError: update.executionError,
        retrievedTables: update.retrievedTables,
        retryCount: update.retryCount,
        maxRetries: retryConfig.maxRetries,
        maxAttempts: retryConfig.maxAttempts,
        status: update.status,
        rowCount: update.rowCount,
        executionTimeMs: update.executionTimeMs,
      };

      hooks?.onNodeEnd?.(event);

      const nextNode = getNextNode(update);
      if (nextNode) {
        hooks?.onNodeStart?.(nextNode);
      }
    }
  }

  const finalResult: AgentResult = {
    question,
    sql: accumulated.sql || "",
    data: accumulated.status === "success" ? {
      columns: accumulated.columns || [],
      rows: accumulated.result || [],
      rowCount: accumulated.rowCount || 0,
      executionTimeMs: accumulated.executionTimeMs || 0,
    } : null,
    status: accumulated.status as "success" | "error",
    retryCount: accumulated.retryCount || 0,
    maxRetries: retryConfig.maxRetries,
    maxAttempts: retryConfig.maxAttempts,
    errorHistory: accumulated.errorHistory || [],
    retrievedTables: accumulated.retrievedTables || [],
  };

  if (finalResult.status !== "success") {
    const errorPayload = accumulated.generationError
      ? buildGenerationError(accumulated.generationError)
      : accumulated.validationError
        ? buildValidationError(accumulated.validationError, finalResult.sql)
        : buildExecutionError(accumulated.executionError || "The query failed during execution.", finalResult.sql);

    finalResult.error = errorPayload.error;
    finalResult.detail = errorPayload.detail;
    finalResult.phase = errorPayload.phase;
    finalResult.displayTarget = errorPayload.displayTarget;
    finalResult.code = errorPayload.code;
    finalResult.finalError = {
      code: errorPayload.code,
      phase: errorPayload.phase,
      message: errorPayload.error,
      detail: errorPayload.detail,
    };
  }

  return finalResult;
}

/**
 * Run the agent graph end-to-end for a given question.
 * The agent will self-correct on validation/execution errors up to the configured retry limit.
 * 
 */
export async function runAgent(question: string): Promise<AgentResult> {
  console.log(`\n🤖 [Agent] Starting for: "${question}"`);
  const result = await executeAgent(question);

  console.log(`🤖 [Agent] Done. Status: ${result.status} | Retries: ${result.retryCount}`);
  return result;
}

export async function runAgentWithHooks(question: string, hooks?: AgentExecutionHooks): Promise<AgentResult> {
  console.log(`\n🤖 [Agent] Starting for: "${question}"`);
  const result = await executeAgent(question, hooks);
  console.log(`🤖 [Agent] Done. Status: ${result.status} | Retries: ${result.retryCount}`);
  return result;
}

/**
 * Stream the agent graph execution via Server-Sent Events (SSE).
 * Sends real-time node updates so the frontend can show a live step tracker.
 *
 * Event types sent:
 *   - node_end:   { node, ...partialState } — a node just completed
 *   - done:       { ...finalResult }        — full final result with rows
 *   - error:      { error: string }         — unexpected failure
 */
export async function streamAgent(question: string, res: Response, hooks?: AgentExecutionHooks): Promise<AgentResult | null> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const finalResult = await executeAgent(question, {
      onNodeStart: hooks?.onNodeStart,
      onNodeEnd: (event) => {
        hooks?.onNodeEnd?.(event);
        sendEvent("node_end", event);
      },
    });

    sendEvent("done", finalResult);
    return finalResult;
  } catch (err: any) {
    sendEvent("error", {
      ...buildGenerationError(err?.message || "Agent stream failed before SQL could be generated."),
      maxRetries: retryConfig.maxRetries,
      maxAttempts: retryConfig.maxAttempts,
    });
    return null;
  } finally {
    res.end();
  }
}
