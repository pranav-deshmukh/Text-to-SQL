import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenAI } from "@google/genai";

/**
 * Vector Store — Qdrant + Gemini Embeddings.
 * Abstract interface so we can swap providers later.
 */

const EMBEDDING_MODEL = "gemini-embedding-001";
const VECTOR_SIZE = 3072;

let qdrant: QdrantClient | null = null;
let ai: GoogleGenAI | null = null;

async function ensureClients(): Promise<{ qdrant: QdrantClient; ai: GoogleGenAI }> {
  if (!ai) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (project) {
      const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
      ai = new GoogleGenAI({ vertexai: true, project, location });
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Set GOOGLE_CLOUD_PROJECT (Vertex) or GEMINI_API_KEY for embeddings");
      ai = new GoogleGenAI({ apiKey });
    }
  }

  if (!qdrant) {
    qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || "http://localhost:6333",
    });
  }

  return { qdrant, ai };
}

export async function initVectorStore(collectionName: string): Promise<void> {
  const { qdrant } = await ensureClients();

  // Create collection if it doesn't exist
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === collectionName);

  if (!exists) {
    await qdrant.createCollection(collectionName, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`✅ Created Qdrant collection "${collectionName}"`);
  }

  const info = await qdrant.getCollection(collectionName);
  console.log(`✅ Qdrant collection "${collectionName}" ready (${info.points_count} points)`);
}

function stablePointId(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

/**
 * Generate embedding for a text using Gemini.
 */
async function embed(text: string): Promise<number[]> {
  const { ai } = await ensureClients();
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return result.embeddings?.[0]?.values ?? [];
}

export interface DocumentToStore {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean | string[] | number[] | null>;
}

/**
 * Add documents to Qdrant. Upserts (safe to re-run).
 */
export async function addDocuments(collectionName: string, docs: DocumentToStore[]): Promise<void> {
  const { qdrant } = await ensureClients();

  // Generate embeddings for all docs
  const points = await Promise.all(
    docs.map(async (doc) => ({
      id: stablePointId(doc.id),
      vector: await embed(doc.text),
      payload: {
        text: doc.text,
        docId: doc.id,
        ...doc.metadata,
      },
    }))
  );

  await qdrant.upsert(collectionName, { points });
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean | string[] | number[] | null>;
  score: number;
}

function toSearchMetadata(
  payload: Record<string, unknown> | null | undefined
): Record<string, string | number | boolean | string[] | number[] | null> {
  const entries = Object.entries(payload ?? {}).filter(([key]) => key !== "docId" && key !== "text");

  return Object.fromEntries(entries) as Record<
    string,
    string | number | boolean | string[] | number[] | null
  >;
}

/**
 * Search for the top-K most relevant documents given a query.
 */
export async function searchDocuments(
  collectionName: string,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  const { qdrant } = await ensureClients();

  const queryVector = await embed(query);

  const results = await qdrant.search(collectionName, {
    vector: queryVector,
    limit: topK,
    with_payload: true,
  });

  return results.map((r) => ({
    id: (r.payload?.docId as string) ?? String(r.id),
    text: (r.payload?.text as string) ?? "",
    metadata: toSearchMetadata(r.payload as Record<string, unknown> | null | undefined),
    score: r.score,
  }));
}

/**
 * Retrieve a single document by its logical doc ID from Qdrant.
 * Uses the same stablePointId hash as addDocuments.
 * O(1) lookup — used to backfill table definitions when only profiles were retrieved.
 */
export async function getDocumentById(collectionName: string, docId: string): Promise<SearchResult | null> {
  const { qdrant } = await ensureClients();

  try {
    const pointId = stablePointId(docId);
    const response = await qdrant.retrieve(collectionName, {
      ids: [pointId],
      with_payload: true,
    });

    if (response.length === 0) return null;

    const point = response[0];
    const payload = point.payload as Record<string, unknown> | null | undefined;

    return {
      id: docId,
      score: 1.0,
      metadata: toSearchMetadata(payload),
      text: (payload?.text as string) || "",
    };
  } catch (err: any) {
    console.warn(`[VectorStore] getDocumentById failed for "${docId}": ${err.message}`);
    return null;
  }
}

/**
 * Get document count.
 */
export async function getDocumentCount(collectionName: string): Promise<number> {
  const { qdrant } = await ensureClients();
  const info = await qdrant.getCollection(collectionName);
  return info.points_count ?? 0;
}

/**
 * Retrieve ALL documents from a collection using scroll.
 * Used when we want to provide full schema context to the LLM.
 */
export async function getAllDocuments(collectionName: string): Promise<SearchResult[]> {
  const { qdrant } = await ensureClients();
  const allResults: SearchResult[] = [];
  let offset: string | number | undefined = undefined;

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      with_payload: true,
      offset,
    });

    for (const point of response.points) {
      const payload = point.payload as Record<string, unknown> | null | undefined;
      allResults.push({
        id: (payload?.docId as string) ?? String(point.id),
        text: (payload?.text as string) ?? "",
        metadata: toSearchMetadata(payload),
        score: 1.0,
      });
    }

    if (!response.next_page_offset) break;
    offset = response.next_page_offset;
  }

  return allResults;
}
