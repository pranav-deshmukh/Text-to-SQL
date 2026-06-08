from typing import Literal, TypedDict


class AgentState(TypedDict, total=False):
    question: str
    db_id: str
    context: str
    retrieved_tables: list[str]
    sql: str
    generation_error: str
    validation_error: str
    execution_error: str
    result: list[dict]
    columns: list[str]
    row_count: int
    execution_time_ms: int
    error_history: list[str]
    retry_count: int
    status: Literal["pending", "success", "error"]
