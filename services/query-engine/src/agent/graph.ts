import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, AgentStateType } from "./state";
import {
  retrieveNode,
  generateNode,
  validateNode,
  executeNode,
  errorNode,
} from "./nodes";
import { getAgentRetryConfig } from "../config/appConfig";

const { maxAttempts: MAX_ATTEMPTS } = getAgentRetryConfig();

function afterGeneration(state: AgentStateType): "validate" | "retrieve" | "error" {
  if (!state.generationError) return "validate";
  if (state.retryCount < MAX_ATTEMPTS) return "retrieve"; // retry with error context
  return "error";
}

/**
 * Conditional edge after validation:
 * - valid → execute
 * - syntax invalid + retries left → generate (retry directly with error context)
 * - schema/context invalid + retries left → retrieve (retry with error context)
 * - invalid + max retries → error
 */
function afterValidation(state: AgentStateType): "execute" | "generate" | "retrieve" | "error" {
  if (!state.validationError) return "execute";
  if (state.retryCount >= MAX_ATTEMPTS) return "error";

  if (state.validationError.includes("SQL syntax error (PARSEONLY)")) {
    return "generate";
  }

  return "retrieve";
}

/**
 * Conditional edge after execution:
 * - success → end
 * - exec error + retries left → generate (retry SQL with error context)
 * - exec error + max retries → error
 */
function afterExecution(state: AgentStateType): "__end__" | "generate" | "error" {
  if (!state.executionError) return "__end__";
  if (state.retryCount >= MAX_ATTEMPTS) return "error";
  return "generate";
}

/**
 * Build and compile the agent graph.
 *
 * Flow:
 *   retrieve → generate → validate ─(valid)─→ execute → END
 *                              │                   │
 *                    (syntax invalid)        (exec error)
 *                              │                   │
 *                              ▼                   ▼
 *                          generate            generate
 *                              │
 *                    (schema/context invalid)
 *                              │
 *                              ▼
 *                          retrieve
 *                         (retry path)
 *                              │
 *                       (max retries?)
 *                              ▼
 *                            ERROR
 */
export function buildAgentGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("retrieve", retrieveNode)
    .addNode("generate", generateNode)
    .addNode("validate", validateNode)
    .addNode("execute", executeNode)
    .addNode("error", errorNode)
    .addEdge("__start__", "retrieve")
    .addEdge("retrieve", "generate")
    .addConditionalEdges("generate", afterGeneration, {
      validate: "validate",
      retrieve: "retrieve",
      error: "error",
    })
    .addConditionalEdges("validate", afterValidation, {
      execute: "execute",
      generate: "generate",
      retrieve: "retrieve",
      error: "error",
    })
    .addConditionalEdges("execute", afterExecution, {
      __end__: END,
      generate: "generate",
      error: "error",
    })
    .addEdge("error", END);

  return graph.compile();
}
