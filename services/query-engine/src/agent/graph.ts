import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, AgentStateType } from "./state";
import {
  retrieveNode,
  generateNode,
  validateNode,
  executeNode,
  errorNode,
} from "./nodes";

const MAX_RETRIES = 2;

function afterGeneration(state: AgentStateType): "validate" | "error" {
  if (state.generationError) return "error";
  return "validate";
}

/**
 * Conditional edge after validation:
 * - valid → execute
 * - invalid + retries left → retrieve (retry with error context)
 * - invalid + max retries → error
 */
function afterValidation(state: AgentStateType): "execute" | "retrieve" | "error" {
  if (!state.validationError) return "execute";
  if (state.retryCount >= MAX_RETRIES) return "error";
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
  if (state.retryCount >= MAX_RETRIES) return "error";
  return "generate";
}

/**
 * Build and compile the agent graph.
 *
 * Flow:
 *   retrieve → generate → validate ─(valid)─→ execute → END
 *                              │                   │
 *                         (invalid)           (exec error)
 *                              │                   │
 *                              ▼                   ▼
 *                          retrieve            generate
 *                         (retry)              (retry)
 *                              │                   │
 *                       (max retries?)       (max retries?)
 *                              ▼                   ▼
 *                           ERROR               ERROR
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
      error: "error",
    })
    .addConditionalEdges("validate", afterValidation, {
      execute: "execute",
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
