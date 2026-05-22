import { searchDocuments, getDocumentById, SearchResult } from "./vectorStore";

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
const BACKFILL_SCORE_THRESHOLD = 0.60;
const MAX_BACKFILL = 5;

/**
 * If RAG retrieved a profile/relationship for a table but NOT the table definition itself,
 * fetch the table chunk by ID. Ensures the LLM always sees full column list + relationships
 * for any table referenced in retrieved context.
 *
 * Only backfills from high-scoring chunks (>0.60) and caps at 5 to prevent prompt bloat.
 * Uses O(1) point lookups — negligible latency even with 1000s of tables.
 */
async function backfillMissingTableChunks(collectionName: string, results: SearchResult[]): Promise<SearchResult[]> {
  const referencedTables = new Set<string>();
  for (const result of results) {
    if (result.score >= BACKFILL_SCORE_THRESHOLD) {
      const tables = extractTableNames(result.metadata);
      tables.forEach(t => referencedTables.add(t));
    }
  }

  const tablesWithDefinition = new Set<string>();
  for (const result of results) {
    if (result.metadata.objectType === "table" && result.metadata.tableName) {
      tablesWithDefinition.add(result.metadata.tableName as string);
    }
  }

  const missingTables = [...referencedTables].filter(t => !tablesWithDefinition.has(t));
  const backfilled: SearchResult[] = [];

  for (const tableName of missingTables.slice(0, MAX_BACKFILL)) {
    const doc = await getDocumentById(collectionName, `table:${tableName}`);
    if (doc) {
      console.log(`[Retriever] ⬆️ Backfilled table definition: ${tableName}`);
      backfilled.push(doc);
    }
  }

  return [...results, ...backfilled];
}

export async function retrieveContextDetailed(
  question: string,
  collectionName: string,
  topK: number = DEFAULT_TOP_K,
  scoreThreshold: number = DEFAULT_SCORE_THRESHOLD
): Promise<RetrievedContextDetailed> {
  const raw: SearchResult[] = await searchDocuments(collectionName, question, topK);
  let results = raw.filter((r) => r.score >= scoreThreshold);

  // Backfill: if we got a profile/relationship for a table but not its definition, fetch it
  results = await backfillMissingTableChunks(collectionName, results);

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
