from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from google.genai import Client
from qdrant_client import QdrantClient

from config.settings import get_settings

EMBEDDING_MODEL = "gemini-embedding-001"
VECTOR_SIZE = 3072


@dataclass
class SearchResult:
    id: str
    text: str
    metadata: dict[str, Any]
    score: float


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    return QdrantClient(url=get_settings().qdrant_url)


@lru_cache(maxsize=1)
def get_ai_client() -> Client:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("Set GEMINI_API_KEY for embeddings")
    return Client(api_key=settings.gemini_api_key)


def stable_point_id(input_value: str) -> int:
    hash_value = 2166136261
    for char in input_value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return abs(hash_value)


async def init_vector_store(collection_name: str) -> None:
    client = get_qdrant_client()
    collections = client.get_collections().collections
    exists = any(collection.name == collection_name for collection in collections)
    if not exists:
        client.create_collection(
            collection_name=collection_name,
            vectors_config={"size": VECTOR_SIZE, "distance": "Cosine"},
        )


async def embed(text: str) -> list[float]:
    client = get_ai_client()
    result = client.models.embed_content(model=EMBEDDING_MODEL, contents=text)
    return result.embeddings[0].values if result.embeddings else []


def _to_search_metadata(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not payload:
        return {}
    return {k: v for k, v in payload.items() if k not in ("docId", "text")}


async def search_documents(collection_name: str, query: str, top_k: int = 5) -> list[SearchResult]:
    client = get_qdrant_client()
    query_vector = await embed(query)
    results = client.search(
        collection_name=collection_name,
        query_vector=query_vector,
        limit=top_k,
        with_payload=True,
    )
    return [
        SearchResult(
            id=str(r.payload.get("docId", r.id)) if r.payload else str(r.id),
            text=str(r.payload.get("text", "")) if r.payload else "",
            metadata=_to_search_metadata(r.payload),
            score=r.score,
        )
        for r in results
    ]


async def get_all_documents(collection_name: str) -> list[SearchResult]:
    client = get_qdrant_client()
    all_results: list[SearchResult] = []
    offset = None

    while True:
        response = client.scroll(
            collection_name=collection_name,
            limit=100,
            with_payload=True,
            offset=offset,
        )
        points, next_offset = response

        for point in points:
            payload = point.payload or {}
            all_results.append(
                SearchResult(
                    id=str(payload.get("docId", point.id)),
                    text=str(payload.get("text", "")),
                    metadata=_to_search_metadata(payload),
                    score=1.0,
                )
            )

        if not next_offset:
            break
        offset = next_offset

    return all_results
