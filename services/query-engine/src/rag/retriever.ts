import { searchDocuments, getDocumentById, getAllDocuments, SearchResult } from "./vectorStore";

/**
 * RAG Retriever — Step 2 in architecture.
 * Standalone tool: input = user question, output = relevant schema context.
 * Knows nothing about prompt assembly or SQL generation.
 *
 * Tuning via environment variables (set in .env):
 *   RAG_TOP_K           — number of chunks to fetch from Qdrant (default: 15)
 *   RAG_SCORE_THRESHOLD — minimum cosine similarity to include a chunk (default: 0.45)
 */

const DEFAULT_TOP_K = parseInt(process.env.RAG_TOP_K ?? "15", 10);
const DEFAULT_SCORE_THRESHOLD = parseFloat(process.env.RAG_SCORE_THRESHOLD ?? "0.45");

export interface RetrievedContext {
  /** Combined schema context string ready for prompt injection */
  schemaContext: string;
  /** Individual table chunks that were retrieved */
  tables: { tableName: string; score: number }[];
}

export interface RetrievedMatch {
  id: string;
  score: number;
  objectType: string;
  objectName: string;
  schemaName: string;
  tableName: string | null;
  referencedTables: string[];
  text: string;
}

export interface RetrievedContextDetailed extends RetrievedContext {
  matches: RetrievedMatch[];
}

function extractTableNames(metadata: SearchResult["metadata"]): string[] {
  const directTable = typeof metadata.tableName === "string" && metadata.tableName ? [metadata.tableName] : [];
  const referencedTables = Array.isArray(metadata.referencedTables)
    ? metadata.referencedTables.filter((table): table is string => typeof table === "string" && table.length > 0)
    : [];

  return [...directTable, ...referencedTables];
}

/**
 * Given a user question, retrieve the top-K most relevant table schemas.
 * Returns a formatted context string ready for the prompt assembler.
 */
const MAX_BACKFILL_PER_HOP = 20;
const MAX_HOPS = 2;

/**
 * Multi-hop graph expansion: starting from retrieved chunks, follow referenced tables
 * across multiple hops to ensure cross-domain joins are discoverable.
 * 
 * Example: "revenue by vendor" retrieves Vendor → ProductVendor → (hop 1) Product → (hop 2) SalesOrderDetail
 * 
 * Uses O(1) point lookups per table — negligible latency even with 1000s of tables.
 */
async function graphExpandTableChunks(collectionName: string, results: SearchResult[]): Promise<SearchResult[]> {
  const allResults = [...results];
  const tablesWithDefinition = new Set<string>();

  // Track which tables we already have definitions for
  for (const result of results) {
    if (result.metadata.objectType === "table" && result.metadata.tableName) {
      tablesWithDefinition.add(result.metadata.tableName as string);
    }
  }

  // Collect all referenced tables from ALL retrieved chunks (no score threshold)
  let frontier = new Set<string>();
  for (const result of results) {
    const tables = extractTableNames(result.metadata);
    tables.forEach(t => {
      if (!tablesWithDefinition.has(t)) frontier.add(t);
    });
  }

  // Multi-hop expansion
  for (let hop = 0; hop < MAX_HOPS && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();
    const toFetch = [...frontier].slice(0, MAX_BACKFILL_PER_HOP);

    for (const tableName of toFetch) {
      if (tablesWithDefinition.has(tableName)) continue;

      const doc = await getDocumentById(collectionName, `table:${tableName}`);
      if (doc) {
        console.log(`[Retriever] ⬆️ Hop ${hop + 1} expansion: ${tableName}`);
        allResults.push(doc);
        tablesWithDefinition.add(tableName);

        // Discover next-hop tables from the newly fetched chunk's relationships
        const nextTables = extractTableNames(doc.metadata);
        nextTables.forEach(t => {
          if (!tablesWithDefinition.has(t)) nextFrontier.add(t);
        });
      }
    }

    frontier = nextFrontier;
  }

  return allResults;
}

export async function retrieveContextDetailed(
  question: string,
  collectionName: string,
  topK: number = DEFAULT_TOP_K,
  scoreThreshold: number = DEFAULT_SCORE_THRESHOLD
): Promise<RetrievedContextDetailed> {
  // Fetch ALL chunks from the collection to provide full schema context
  let results: SearchResult[] = await getAllDocuments(collectionName);
  console.log(`[Retriever] 📦 Loaded ALL ${results.length} chunks from ${collectionName}`);

  const groupedResults = new Map<string, SearchResult[]>();
  for (const result of results) {
    const objectType = typeof result.metadata.objectType === "string" ? result.metadata.objectType : "other";
    groupedResults.set(objectType, [...(groupedResults.get(objectType) ?? []), result]);
  }

  const orderedTypes = ["table", "relationship", "view", "procedure", "other"];
  const schemaContext = orderedTypes
    .flatMap((objectType) => {
      const group = groupedResults.get(objectType);
      if (!group || group.length === 0) return [];

      const title = objectType === "other" ? "OTHER CONTEXT" : `${objectType.toUpperCase()} CONTEXT`;
      return [`### ${title}`, ...group.map((result) => result.text)];
    })
    .join("\n\n---\n\n");

  const tables = [...new Set(results.flatMap((result) => extractTableNames(result.metadata)))].map((tableName) => {
    const bestScore = Math.max(
      ...results
        .filter((result) => extractTableNames(result.metadata).includes(tableName))
        .map((result) => result.score)
    );

    return { tableName, score: bestScore };
  });

  const matches = results.map((result) => ({
    id: result.id,
    score: result.score,
    objectType: typeof result.metadata.objectType === "string" ? result.metadata.objectType : "other",
    objectName: typeof result.metadata.objectName === "string" ? result.metadata.objectName : result.id,
    schemaName: typeof result.metadata.schemaName === "string" ? result.metadata.schemaName : "",
    tableName: typeof result.metadata.tableName === "string" && result.metadata.tableName.length > 0
      ? result.metadata.tableName
      : null,
    referencedTables: Array.isArray(result.metadata.referencedTables)
      ? result.metadata.referencedTables.filter(
          (table): table is string => typeof table === "string" && table.length > 0
        )
      : [],
    text: result.text,
  }));

  return { schemaContext, tables, matches };
}

export async function retrieveContext(
  question: string,
  collectionName: string,
  topK: number = DEFAULT_TOP_K
): Promise<RetrievedContext> {
  const { schemaContext, tables } = await retrieveContextDetailed(question, collectionName, topK);
  return { schemaContext, tables };
}
