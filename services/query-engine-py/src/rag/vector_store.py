from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from google.genai import Client
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, Fusion, FusionQuery, PointStruct, Prefetch, SparseVector, SparseVectorParams, VectorParams

from config.settings import get_settings

DEFAULT_VECTOR_SIZES = {
    "google": 3072,
    "huggingface": 4096,
}

HUGGINGFACE_MODEL_ALIASES = {
    "qwen3-embedding:8b": "Qwen/Qwen3-Embedding-8B",
}

DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "sparse"


def _collection_migration_error(collection_name: str) -> ValueError:
    return ValueError(
        f'Collection "{collection_name}" is not configured for hybrid dense+sparse retrieval. '
        "Recreate or version the collection, then reseed it before using hybrid search."
    )


def _get_collection_vector_layout(collection_name: str) -> str:
    client = get_qdrant_client()
    collection_info = client.get_collection(collection_name)
    vectors = getattr(collection_info.config.params, "vectors", None)
    sparse_vectors = getattr(collection_info.config.params, "sparse_vectors", None)

    if isinstance(vectors, dict):
        has_named_dense = DENSE_VECTOR_NAME in vectors
        has_sparse = isinstance(sparse_vectors, dict) and SPARSE_VECTOR_NAME in sparse_vectors
        if has_named_dense and has_sparse:
            return "hybrid_named"
        if has_named_dense:
            return "dense_named"

    if vectors is not None and getattr(vectors, "size", None) is not None:
        return "legacy_unnamed"

    raise ValueError(f'Collection "{collection_name}" has an unsupported vector configuration.')


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


@lru_cache(maxsize=1)
def get_sparse_embedding_client():
    try:
        from fastembed import SparseTextEmbedding
    except ImportError as exc:
        raise ValueError(
            "fastembed is required for hybrid RAG search. Run 'pip install -e .' in services/query-engine-py "
            "after pulling the updated pyproject.toml dependencies."
        ) from exc

    return SparseTextEmbedding(model_name=get_settings().sparse_embedding_model)


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
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(size=vector_size, distance=Distance.COSINE),
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: SparseVectorParams(),
            },
        )
        return

    collection_info = client.get_collection(collection_name)
    vectors = getattr(collection_info.config.params, "vectors", None)
    sparse_vectors = getattr(collection_info.config.params, "sparse_vectors", None)

    dense_params = None
    if isinstance(vectors, dict):
        dense_params = vectors.get(DENSE_VECTOR_NAME)
        if dense_params is None and "size" in vectors:
            raise _collection_migration_error(collection_name)
    elif vectors is not None and getattr(vectors, "size", None) is not None:
        raise _collection_migration_error(collection_name)

    if dense_params is None:
        raise _collection_migration_error(collection_name)

    existing_size = getattr(dense_params, "size", None)
    if existing_size is not None and int(existing_size) != vector_size:
        provider = get_embedding_provider()
        model = get_embedding_model()
        raise ValueError(
            f'Collection "{collection_name}" already exists with vector size {existing_size}, '
            f"but {provider}/{model} is configured for {vector_size}. "
            "Use a different collection or recreate the existing one before reseeding."
        )

    sparse_config = None
    if isinstance(sparse_vectors, dict):
        sparse_config = sparse_vectors.get(SPARSE_VECTOR_NAME)
    elif sparse_vectors is not None:
        sparse_config = sparse_vectors

    if sparse_config is None:
        raise _collection_migration_error(collection_name)


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


def sparse_embed(text: str) -> SparseVector:
    embeddings = list(get_sparse_embedding_client().embed([text]))
    if not embeddings:
        return SparseVector(indices=[], values=[])

    sparse = embeddings[0]
    indices = [int(index) for index in getattr(sparse, "indices", [])]
    values = [float(value) for value in getattr(sparse, "values", [])]
    return SparseVector(indices=indices, values=values)


def _to_search_metadata(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not payload:
        return {}
    return {k: v for k, v in payload.items() if k not in ("docId", "text")}


async def search_documents(collection_name: str, query: str, top_k: int = 5) -> list[SearchResult]:
    client = get_qdrant_client()
    settings = get_settings()
    search_mode = settings.rag_mode.strip().lower()
    vector_layout = _get_collection_vector_layout(collection_name)

    if search_mode == "hybrid":
        if vector_layout != "hybrid_named":
            raise _collection_migration_error(collection_name)

        query_vector = await embed(query)
        sparse_query = sparse_embed(query)
        prefetch_limit = max(top_k, settings.rag_hybrid_prefetch_k)

        fusion_name = settings.rag_hybrid_fusion.strip().lower()
        if fusion_name == "dbsf":
            fusion = Fusion.DBSF
        else:
            fusion = Fusion.RRF

        response = client.query_points(
            collection_name=collection_name,
            prefetch=[
                Prefetch(query=sparse_query, using=SPARSE_VECTOR_NAME, limit=prefetch_limit),
                Prefetch(query=query_vector, using=DENSE_VECTOR_NAME, limit=prefetch_limit),
            ],
            query=FusionQuery(fusion=fusion),
            limit=top_k,
            with_payload=True,
        )
    else:
        query_vector = await embed(query)
        query_kwargs = {
            "collection_name": collection_name,
            "query": query_vector,
            "limit": top_k,
            "with_payload": True,
        }
        if vector_layout in ("hybrid_named", "dense_named"):
            query_kwargs["using"] = DENSE_VECTOR_NAME

        response = client.query_points(**query_kwargs)

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

    client = get_qdrant_client()
    batch_size = 10
    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        points = []
        for doc in batch:
            dense_vector = await embed(doc["text"])
            sparse_vector = sparse_embed(doc["text"])
            payload = {"text": doc["text"], "docId": doc["id"]}
            if doc.get("metadata"):
                payload.update(doc["metadata"])
            points.append(
                PointStruct(
                    id=stable_point_id(doc["id"]),
                    vector={
                        DENSE_VECTOR_NAME: dense_vector,
                        SPARSE_VECTOR_NAME: sparse_vector,
                    },
                    payload=payload,
                )
            )
            await asyncio.sleep(0.5)
        client.upsert(collection_name=collection_name, points=points)
        print(f"   ✅ Upserted batch {i // batch_size + 1} ({len(points)} points)")
        await asyncio.sleep(1)
