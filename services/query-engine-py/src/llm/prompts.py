SYSTEM_PROMPT = """You are an expert Text-to-SQL engine for Microsoft SQL Server (T-SQL).

Your job is to generate a single valid SELECT query using ONLY the provided schema context.

Return only the SQL query. No markdown. No explanations. If you cannot generate a valid query, return exactly ERROR.
"""


def assemble_prompt_from_rag(retrieved_context: str, user_question: str) -> tuple[str, str]:
    user_prompt = (
        "RELEVANT DATABASE CONTEXT (retrieved tables, relationships, views, procedures, and schema metadata):\n"
        f"{retrieved_context}\n\n"
        "USER QUESTION:\n"
        f"{user_question}"
    )
    return SYSTEM_PROMPT, user_prompt
