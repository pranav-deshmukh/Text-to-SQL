import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenAI } from "@google/genai";

/**
 * Vector Store — Qdrant + Gemini Embeddings.
 * Abstract interface so we can swap providers later.
 */

const COLLECTION_NAME = "schema_tables";
const EMBEDDING_MODEL = "gemini-embedding-001";
const VECTOR_SIZE = 3072;

let qdrant: QdrantClient | null = null;
let ai: GoogleGenAI | null = null;

export async function initVectorStore(): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (project) {
    const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
    ai = new GoogleGenAI({ vertexai: true, project, location });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Set GOOGLE_CLOUD_PROJECT (Vertex) or GEMINI_API_KEY for embeddings");
    ai = new GoogleGenAI({ apiKey });
  }
  qdrant = new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333",
  });

  // Create collection if it doesn't exist
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`✅ Created Qdrant collection "${COLLECTION_NAME}"`);
  }

  const info = await qdrant.getCollection(COLLECTION_NAME);
  console.log(`✅ Qdrant collection "${COLLECTION_NAME}" ready (${info.points_count} points)`);
}

/**
 * Generate embedding for a text using Gemini.
 */
async function embed(text: string): Promise<number[]> {
  if (!ai) throw new Error("Vector store not initialized");
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return result.embeddings?.[0]?.values ?? [];
}

export interface DocumentToStore {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

/**
 * Add documents to Qdrant. Upserts (safe to re-run).
 */
export async function addDocuments(docs: DocumentToStore[]): Promise<void> {
  if (!qdrant) throw new Error("Vector store not initialized");

  // Generate embeddings for all docs
  const points = await Promise.all(
    docs.map(async (doc, i) => ({
      id: i + 1, // Qdrant needs numeric or UUID ids
      vector: await embed(doc.text),
      payload: {
        text: doc.text,
        docId: doc.id,
        ...doc.metadata,
      },
    }))
  );

  await qdrant.upsert(COLLECTION_NAME, { points });
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: Record<string, string>;
  score: number;
}

/**
 * Search for the top-K most relevant documents given a query.
 */
export async function searchDocuments(
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  if (!qdrant) throw new Error("Vector store not initialized");

  const queryVector = await embed(query);

  const results = await qdrant.search(COLLECTION_NAME, {
    vector: queryVector,
    limit: topK,
    with_payload: true,
  });

  return results.map((r) => ({
    id: (r.payload?.docId as string) ?? String(r.id),
    text: (r.payload?.text as string) ?? "",
    metadata: {
      tableName: (r.payload?.tableName as string) ?? "",
      businessPurpose: (r.payload?.businessPurpose as string) ?? "",
    },
    score: r.score,
  }));
}

/**
 * Get document count.
 */
export async function getDocumentCount(): Promise<number> {
  if (!qdrant) throw new Error("Vector store not initialized");
  const info = await qdrant.getCollection(COLLECTION_NAME);
  return info.points_count ?? 0;
}
