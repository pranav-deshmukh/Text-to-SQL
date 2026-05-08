import { buildAgentGraph } from "./graph";
import type { Response } from "express";

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
  retryCount: number;
  errorHistory: string[];
  retrievedTables: string[];
}

/**
 * Run the agent graph end-to-end for a given question.
 * The agent will self-correct on validation/execution errors (max 2 retries).
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
    error: finalState.validationError || finalState.executionError || undefined,
    retryCount: finalState.retryCount,
    errorHistory: finalState.errorHistory,
    retrievedTables: finalState.retrievedTables,
  };

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
      error: accumulated.validationError || accumulated.executionError || undefined,
      retryCount: accumulated.retryCount || 0,
      errorHistory: accumulated.errorHistory || [],
      retrievedTables: accumulated.retrievedTables || [],
    };

    sendEvent("done", finalResult);
  } catch (err: any) {
    sendEvent("error", { error: err.message });
  } finally {
    res.end();
  }
}
