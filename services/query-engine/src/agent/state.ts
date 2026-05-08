import { Annotation } from "@langchain/langgraph";

/**
 * AgentState — shared state flowing through all nodes in the LangGraph.
 * Each field is a channel with a reducer that defines how updates merge.
 */
export const AgentState = Annotation.Root({
  /** Original user question */
  question: Annotation<string>(),

  /** RAG-retrieved schema context string */
  context: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  /** Table names retrieved by RAG */
  retrievedTables: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  /** LLM-generated SQL */
  sql: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  /** Validation error (empty = passed) */
  validationError: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  /** Execution error from SQL Server */
  executionError: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  /** Final result rows */
  result: Annotation<Record<string, any>[]>({ reducer: (_, b) => b, default: () => [] }),

  /** Column names from result */
  columns: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  /** Row count */
  rowCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  /** Execution time in ms */
  executionTimeMs: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  /** Accumulated error history for self-correction */
  errorHistory: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  /** Current retry count */
  retryCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  /** Final status */
  status: Annotation<string>({ reducer: (_, b) => b, default: () => "pending" }),
});

export type AgentStateType = typeof AgentState.State;
