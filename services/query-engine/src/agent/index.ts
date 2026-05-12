import { buildAgentGraph } from "./graph";
import type { Response } from "express";
import {
  buildExecutionError,
  buildGenerationError,
  buildValidationError,
} from "../errors/queryError";
import type { QueryErrorPhase } from "../errors/queryError";

const agent = buildAgentGraph();

export interface AgentResult {
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

/**
 * Run the agent graph end-to-end for a given question.
 * The agent will self-correct on validation/execution errors (max 2 retries).
 * 
 */
export async function runAgent(question: string): Promise<AgentResult> {
  console.log(`\n🤖 [Agent] Starting for: "${question}"`);

  const finalState = await agent.invoke({ question });

  const result: AgentResult = {
    question,
    sql: finalState.sql,
    data: finalState.status === "success" ? {
      columns: finalState.columns,
      rows: finalState.result,
      rowCount: finalState.rowCount,
      executionTimeMs: finalState.executionTimeMs,
    } : null,
    status: finalState.status as "success" | "error",
    retryCount: finalState.retryCount,
    errorHistory: finalState.errorHistory,
    retrievedTables: finalState.retrievedTables,
  };

  if (finalState.status !== "success") {
    const errorPayload = finalState.generationError
      ? buildGenerationError(finalState.generationError)
      : finalState.validationError
        ? buildValidationError(finalState.validationError, finalState.sql)
        : buildExecutionError(finalState.executionError || "The query failed during execution.", finalState.sql);

    result.error = errorPayload.error;
    result.detail = errorPayload.detail;
    result.phase = errorPayload.phase;
    result.displayTarget = errorPayload.displayTarget;
    result.code = errorPayload.code;
    result.finalError = {
      code: errorPayload.code,
      phase: errorPayload.phase,
      message: errorPayload.error,
      detail: errorPayload.detail,
    };
  }

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
export async function streamAgent(question: string, res: Response): Promise<void> {
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
    // Accumulate state from stream updates
    let accumulated: Record<string, any> = { question };

    const stream = await agent.stream({ question }, { streamMode: "updates" });

    for await (const chunk of stream) {
      for (const [nodeName, stateUpdate] of Object.entries(chunk)) {
        const update = stateUpdate as Record<string, any>;
        // Merge into accumulated state
        Object.assign(accumulated, update);

        // Send a lean event (no rows — too large for SSE per-node)
        sendEvent("node_end", {
          node: nodeName,
          sql: update.sql,
          generationError: update.generationError,
          validationError: update.validationError,
          executionError: update.executionError,
          retrievedTables: update.retrievedTables,
          retryCount: update.retryCount,
          status: update.status,
          rowCount: update.rowCount,
          executionTimeMs: update.executionTimeMs,
        });
      }
    }

    // Build final result from accumulated state
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

    sendEvent("done", finalResult);
  } catch (err: any) {
    sendEvent("error", buildGenerationError(err?.message || "Agent stream failed before SQL could be generated."));
  } finally {
    res.end();
  }
}
