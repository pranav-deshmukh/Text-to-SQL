import re

from config.settings import get_settings
from rag.vector_store import SearchResult, get_all_documents, get_document_by_id, search_documents

settings = get_settings()

MAX_BACKFILL_PER_HOP = 20
MAX_HOPS = 2

_COLUMN_LINE_RE = re.compile(r"^- (.+?):\s+(.+?)(?:\s+\[.*\])?$")


def _extract_table_names(metadata: dict) -> list[str]:
    tables: list[str] = []

    table_name = metadata.get("tableName")
    if isinstance(table_name, str) and table_name:
        tables.append(table_name)

    referenced = metadata.get("referencedTables")
    if isinstance(referenced, list):
        tables.extend([table for table in referenced if isinstance(table, str) and table])

    return tables


def _to_detailed_match(match: SearchResult) -> dict:
    metadata = match.metadata
    table_name = metadata.get("tableName")
    object_name = metadata.get("objectName")
    schema_name = metadata.get("schemaName")
    object_type = metadata.get("objectType")

    return {
        "id": match.id,
        "score": match.score,
        "objectType": object_type if isinstance(object_type, str) else "other",
        "objectName": object_name if isinstance(object_name, str) and object_name else match.id,
        "schemaName": schema_name if isinstance(schema_name, str) else "",
        "tableName": table_name if isinstance(table_name, str) and table_name else None,
        "referencedTables": [table for table in _extract_table_names(metadata) if table != table_name],
        "text": match.text,
    }


def _to_schema_context(matches: list[SearchResult]) -> str:
    groups: dict[str, list[SearchResult]] = {}
    for match in matches:
        object_type = match.metadata.get("objectType")
        key = object_type if isinstance(object_type, str) else "other"
        groups.setdefault(key, []).append(match)

    ordered_types = ["table", "relationship", "view", "procedure", "other"]
    sections: list[str] = []
    for object_type in ordered_types:
        group = groups.get(object_type, [])
        if not group:
            continue
        title = "OTHER CONTEXT" if object_type == "other" else f"{object_type.upper()} CONTEXT"
        sections.append("### " + title)
        sections.extend([match.text for match in group])

    return "\n\n---\n\n".join(sections)


def _to_tables(matches: list[SearchResult]) -> list[dict]:
    best_score_by_table: dict[str, float] = {}
    for match in matches:
        for table_name in _extract_table_names(match.metadata):
            best = best_score_by_table.get(table_name)
            if best is None or match.score > best:
                best_score_by_table[table_name] = match.score

    return [
        {"tableName": table_name, "score": score}
        for table_name, score in best_score_by_table.items()
    ]


def _extract_available_columns(matches: list[SearchResult]) -> list[dict]:
    """
    Parse column names and data types from table-type RAG chunks.
    Returns: [{"tableName": "dbo.X", "columns": [{"name": "col", "dataType": "varchar(50)"}]}]
    """
    result: list[dict] = []
    for match in matches:
        if match.metadata.get("objectType") != "table":
            continue
        table_name = match.metadata.get("tableName")
        if not table_name:
            continue

        columns: list[dict] = []
        in_columns_section = False
        for line in match.text.split("\n"):
            stripped = line.strip()
            if stripped == "COLUMNS:":
                in_columns_section = True
                continue
            if in_columns_section:
                if stripped.startswith("- "):
                    col_match = _COLUMN_LINE_RE.match(stripped)
                    if col_match:
                        columns.append({"name": col_match.group(1), "dataType": col_match.group(2).strip()})
                else:
                    # End of COLUMNS section (hit OUTBOUND RELATIONSHIPS or similar)
                    break

        if columns:
            result.append({"tableName": table_name, "columns": columns})

    return result


async def _graph_expand_table_chunks(collection_name: str, results: list[SearchResult]) -> list[SearchResult]:
    """
    Multi-hop graph expansion: starting from retrieved chunks, follow referenced tables
    across multiple hops to ensure cross-domain joins are discoverable.

    Example: "revenue by vendor" retrieves Vendor -> ProductVendor -> (hop 1) Product -> (hop 2) SalesOrderDetail
    """
    all_results = list(results)
    tables_with_definition: set[str] = set()

    # Track which tables we already have definitions for
    for result in results:
        if result.metadata.get("objectType") == "table" and result.metadata.get("tableName"):
            tables_with_definition.add(str(result.metadata["tableName"]))

    # Collect all referenced tables from ALL retrieved chunks
    frontier: set[str] = set()
    for result in results:
        for table in _extract_table_names(result.metadata):
            if table not in tables_with_definition:
                frontier.add(table)

    # Multi-hop expansion
    for hop in range(MAX_HOPS):
        if not frontier:
            break
        next_frontier: set[str] = set()
        to_fetch = list(frontier)[:MAX_BACKFILL_PER_HOP]

        for table_name in to_fetch:
            if table_name in tables_with_definition:
                continue
            doc = await get_document_by_id(collection_name, f"table:{table_name}")
            if doc:
                print(f"[Retriever] ⬆️ Hop {hop + 1} expansion: {table_name}")
                all_results.append(doc)
                tables_with_definition.add(table_name)

                # Discover next-hop tables from the newly fetched chunk's relationships
                for next_table in _extract_table_names(doc.metadata):
                    if next_table not in tables_with_definition:
                        next_frontier.add(next_table)

        frontier = next_frontier

    return all_results


async def retrieve_context_detailed(
    question: str,
    collection_name: str,
    top_k: int | None = None,
    score_threshold: float | None = None,
) -> dict:
    effective_top_k = top_k if top_k is not None else settings.rag_top_k
    effective_threshold = score_threshold if score_threshold is not None else settings.rag_score_threshold
    search_mode = settings.rag_mode.strip().lower()

    if search_mode == "all":
        matches = await get_all_documents(collection_name)
        print(f"[Retriever] 📦 Loaded ALL {len(matches)} chunks from {collection_name}")
    else:
        search_top_k = max(effective_top_k, 1)
        raw_matches = await search_documents(collection_name, question, search_top_k)
        if search_mode == "hybrid":
            matches = raw_matches
            print(f"[Retriever] 🔍 Hybrid search returned {len(matches)} chunks (top_k={search_top_k})")
        else:
            matches = [match for match in raw_matches if match.score >= effective_threshold]
            if not matches:
                matches = raw_matches
            print(f"[Retriever] 🔍 Vector search returned {len(matches)} chunks (top_k={search_top_k}, threshold={effective_threshold})")

        # Graph expansion: follow referenced tables to fill in join paths
        matches = await _graph_expand_table_chunks(collection_name, matches)
        print(f"[Retriever] 🔗 After graph expansion: {len(matches)} chunks")

    return {
        "schemaContext": _to_schema_context(matches),
        "tables": _to_tables(matches),
        "matches": [_to_detailed_match(match) for match in matches],
        "availableColumns": _extract_available_columns(matches),
    }


async def retrieve_context(question: str, collection_name: str, top_k: int | None = None) -> dict:
    result = await retrieve_context_detailed(question, collection_name, top_k=top_k)
    return {
        "schemaContext": result["schemaContext"],
        "tables": result["tables"],
        "matches": result["matches"],
        "availableColumns": result["availableColumns"],
    }
