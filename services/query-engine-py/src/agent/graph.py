from langgraph.graph import END, StateGraph

from agent.nodes import error_node, execute_node, generate_node, retrieve_node, validate_node
from agent.state import AgentState
from config.settings import get_settings

settings = get_settings()
MAX_ATTEMPTS = settings.agent_max_retries + 1


def after_generation(state: AgentState) -> str:
    if not state.get("generation_error"):
        return "validate"
    if state.get("retry_count", 0) < MAX_ATTEMPTS:
        return "retrieve"
    return "error"


def after_validation(state: AgentState) -> str:
    if not state.get("validation_error"):
        return "execute"
    if state.get("retry_count", 0) >= MAX_ATTEMPTS:
        return "error"
    if "parse" in state.get("validation_error", "").lower():
        return "generate"
    return "retrieve"


def after_execution(state: AgentState) -> str:
    if not state.get("execution_error"):
        return "__end__"
    if state.get("retry_count", 0) >= MAX_ATTEMPTS:
        return "error"
    return "generate"


def build_agent_graph():
    graph = StateGraph(AgentState)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("generate", generate_node)
    graph.add_node("validate", validate_node)
    graph.add_node("execute", execute_node)
    graph.add_node("error", error_node)
    graph.add_edge("__start__", "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_conditional_edges("generate", after_generation, {
        "validate": "validate",
        "retrieve": "retrieve",
        "error": "error",
    })
    graph.add_conditional_edges("validate", after_validation, {
        "execute": "execute",
        "generate": "generate",
        "retrieve": "retrieve",
        "error": "error",
    })
    graph.add_conditional_edges("execute", after_execution, {
        "__end__": END,
        "generate": "generate",
        "error": "error",
    })
    graph.add_edge("error", END)
    return graph.compile()
