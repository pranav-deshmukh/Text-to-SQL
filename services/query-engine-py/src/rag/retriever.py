from rag.vector_store import SearchResult, get_all_documents


async def retrieve_context(question: str, collection_name: str) -> dict:
    matches: list[SearchResult] = await get_all_documents(collection_name)
    _ = question
    schema_context = "\n\n---\n\n".join(match.text for match in matches)
    tables = []
    for match in matches:
        table_name = match.metadata.get("tableName")
        if isinstance(table_name, str) and table_name:
            tables.append({"tableName": table_name, "score": match.score})
    return {
        "schemaContext": schema_context,
        "tables": tables,
        "matches": matches,
    }
