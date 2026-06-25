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
    if settings.google_cloud_project:
        return Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )

    if not settings.gemini_api_key:
        raise ValueError("Set GOOGLE_CLOUD_PROJECT for Vertex AI or GEMINI_API_KEY for embeddings")

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
    response = client.query_points(
        collection_name=collection_name,
        query=query_vector,
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
        for r in response.points
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


async def get_document_by_id(collection_name: str, doc_id: str) -> SearchResult | None:
    client = get_qdrant_client()

    try:
        point_id = stable_point_id(doc_id)
        points = client.retrieve(collection_name=collection_name, ids=[point_id], with_payload=True)
        if not points:
            return None

        point = points[0]
        payload = point.payload or {}
        return SearchResult(
            id=doc_id,
            text=str(payload.get("text", "")),
            metadata=_to_search_metadata(payload),
            score=1.0,
        )
    except Exception:
        return None


async def get_document_count(collection_name: str) -> int:
    client = get_qdrant_client()
    info = client.get_collection(collection_name)
    return int(info.points_count or 0)


async def add_documents(collection_name: str, docs: list[dict]) -> None:
    """Upsert documents into Qdrant (safe to re-run)."""
    from qdrant_client.models import PointStruct

    client = get_qdrant_client()
    batch_size = 50
    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        points = []
        for doc in batch:
            vector = await embed(doc["text"])
            payload = {"text": doc["text"], "docId": doc["id"]}
            if doc.get("metadata"):
                payload.update(doc["metadata"])
            points.append(PointStruct(id=stable_point_id(doc["id"]), vector=vector, payload=payload))
        client.upsert(collection_name=collection_name, points=points)
        print(f"   ✅ Upserted batch {i // batch_size + 1} ({len(points)} points)")
