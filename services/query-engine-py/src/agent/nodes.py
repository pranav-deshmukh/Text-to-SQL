from agent.state import AgentState
from config.db_registry import get_database_config
from executor.sql_executor import execute_sql
from llm.gemini import call_llm
from llm.prompts import assemble_prompt_from_rag
from rag.retriever import retrieve_context
from validator.sql_validator import validate_sql


async def retrieve_node(state: AgentState) -> AgentState:
    database = get_database_config(state["db_id"])
    if not database:
        raise ValueError(f"Unknown database: {state['db_id']}")

    query = state["question"]
    error_history = state.get("error_history", [])
    if error_history:
        query = f"{query} (context: {error_history[-1]})"

    rag_result = await retrieve_context(query, database.qdrant_collection)

    return {
        "context": rag_result["schemaContext"],
        "retrieved_tables": [table["tableName"] for table in rag_result["tables"]],
    }


async def generate_node(state: AgentState) -> AgentState:
    try:
        error_context = ""
        if state.get("error_history"):
            error_context = "\n\nPREVIOUS ERRORS (do NOT repeat these mistakes):\n" + "\n".join(
                f"{index + 1}. {message}" for index, message in enumerate(state.get("error_history", []))
            )

        system_prompt, user_prompt = assemble_prompt_from_rag(
            state.get("context", "") + error_context,
            state["question"],
            conversation_history=state.get("conversation_history", ""),
        )
        sql = (await call_llm(system_prompt, user_prompt)).strip()

        if not sql or sql.upper() == "ERROR":
            return {
                "sql": "",
                "generation_error": "The language model did not return a usable SQL query.",
                "error_history": state.get("error_history", []) + ["Generation failed: LLM returned no usable SQL"],
                "retry_count": state.get("retry_count", 0) + 1,
                "status": "error",
            }

        return {
            "sql": sql,
            "generation_error": "",
            "validation_error": "",
            "execution_error": "",
        }
    except Exception as exc:
        return {
            "sql": "",
            "generation_error": str(exc),
            "error_history": state.get("error_history", []) + [f"Generation failed: {exc}"],
            "retry_count": state.get("retry_count", 0) + 1,
            "status": "error",
        }


async def validate_node(state: AgentState) -> AgentState:
    database = get_database_config(state["db_id"])
    if not database:
        raise ValueError(f"Unknown database: {state['db_id']}")

    result = await validate_sql(state.get("sql", ""), state["db_id"], database.connection_string)
    if not result.valid:
        return {
            "validation_error": result.error,
            "error_history": state.get("error_history", []) + [
                f"Validation failed for SQL '{state.get('sql', '')[:80]}...': {result.error}"
            ],
            "retry_count": state.get("retry_count", 0) + 1,
        }

    return {
        "validation_error": "",
        "generation_error": "",
    }


async def execute_node(state: AgentState) -> AgentState:
    try:
        database = get_database_config(state["db_id"])
        if not database:
            raise ValueError(f"Unknown database: {state['db_id']}")

        data = await execute_sql(state.get("sql", ""), state["db_id"], database.connection_string)
        return {
            "result": data["rows"],
            "columns": data["columns"],
            "row_count": data["rowCount"],
            "execution_time_ms": data["executionTimeMs"],
            "execution_error": "",
            "status": "success",
        }
    except Exception as exc:
        return {
            "execution_error": str(exc),
            "error_history": state.get("error_history", []) + [f"Execution error: {exc}"],
            "retry_count": state.get("retry_count", 0) + 1,
            "status": "error",
        }


async def error_node(state: AgentState) -> AgentState:
    return {
        "status": "error",
    }
