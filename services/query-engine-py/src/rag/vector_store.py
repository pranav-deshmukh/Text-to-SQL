from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from google.genai import Client
from qdrant_client import QdrantClient

from config.settings import get_settings

DEFAULT_VECTOR_SIZES = {
    "google": 3072,
    "huggingface": 4096,
}

HUGGINGFACE_MODEL_ALIASES = {
    "qwen3-embedding:8b": "Qwen/Qwen3-Embedding-8B",
}


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
def get_google_ai_client() -> Client:
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


@lru_cache(maxsize=1)
def get_huggingface_client():
    from huggingface_hub import InferenceClient
    settings = get_settings()
    return InferenceClient(
        provider=settings.huggingface_inference_provider,
        timeout=settings.huggingface_timeout_seconds,
        api_key=settings.huggingface_api_key,
    )


def get_embedding_provider() -> str:
    provider = get_settings().embedding_provider.strip().lower()
    if provider not in DEFAULT_VECTOR_SIZES:
        supported = ", ".join(sorted(DEFAULT_VECTOR_SIZES))
        raise ValueError(f"Unsupported EMBEDDING_PROVIDER '{provider}'. Expected one of: {supported}")
    return provider


def get_embedding_model() -> str:
    model = get_settings().embedding_model.strip()
    if not model:
        raise ValueError("Set EMBEDDING_MODEL to a non-empty model name")
    if get_embedding_provider() == "huggingface":
        return HUGGINGFACE_MODEL_ALIASES.get(model.lower(), model)
    return model


def get_vector_size() -> int:
    settings = get_settings()
    if settings.embedding_vector_size is not None:
        return settings.embedding_vector_size
    return DEFAULT_VECTOR_SIZES[get_embedding_provider()]


def stable_point_id(input_value: str) -> int:
    hash_value = 2166136261
    for char in input_value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return abs(hash_value)


async def init_vector_store(collection_name: str) -> None:
    client = get_qdrant_client()
    vector_size = get_vector_size()
    collections = client.get_collections().collections
    exists = any(collection.name == collection_name for collection in collections)
    if not exists:
        client.create_collection(
            collection_name=collection_name,
            vectors_config={"size": vector_size, "distance": "Cosine"},
        )
        return

    collection_info = client.get_collection(collection_name)
    vectors = getattr(collection_info.config.params, "vectors", None)
    existing_size = getattr(vectors, "size", None)
    if isinstance(vectors, dict):
        existing_size = vectors.get("size")

    if existing_size is not None and int(existing_size) != vector_size:
        provider = get_embedding_provider()
        model = get_embedding_model()
        raise ValueError(
            f'Collection "{collection_name}" already exists with vector size {existing_size}, '
            f"but {provider}/{model} is configured for {vector_size}. "
            "Use a different collection or recreate the existing one before reseeding."
        )


def _embed_with_huggingface(text: str) -> list[float]:
    provider = get_settings().huggingface_inference_provider
    model = get_embedding_model()
    try:
        response = get_huggingface_client().feature_extraction(text, model=model)
    except Exception as exc:
        raise ValueError(
            f"Hugging Face embedding request failed for provider '{provider}' and model '{model}': {exc}"
        ) from exc

    if hasattr(response, "tolist"):
        response = response.tolist()

    if not isinstance(response, list):
        raise ValueError("Hugging Face embedding response did not return a vector")

    if response and isinstance(response[0], list):
        response = response[0]

    return [float(value) for value in response]


async def embed(text: str) -> list[float]:
    provider = get_embedding_provider()
    if provider == "huggingface":
        return _embed_with_huggingface(text)

    client = get_google_ai_client()
    result = client.models.embed_content(model=get_embedding_model(), contents=text)
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
    import asyncio

    from qdrant_client.models import PointStruct

    client = get_qdrant_client()
    batch_size = 10
    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        points = []
        for doc in batch:
            vector = await embed(doc["text"])
            payload = {"text": doc["text"], "docId": doc["id"]}
            if doc.get("metadata"):
                payload.update(doc["metadata"])
            points.append(PointStruct(id=stable_point_id(doc["id"]), vector=vector, payload=payload))
            await asyncio.sleep(0.5)
        client.upsert(collection_name=collection_name, points=points)
        print(f"   ✅ Upserted batch {i // batch_size + 1} ({len(points)} points)")
        await asyncio.sleep(1)
