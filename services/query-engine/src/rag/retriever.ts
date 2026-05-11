import { searchDocuments, SearchResult } from "./vectorStore";

/**
 * RAG Retriever — Step 2 in architecture.
 * Standalone tool: input = user question, output = relevant schema context.
 * Knows nothing about prompt assembly or SQL generation.
 */

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
export async function retrieveContextDetailed(
  question: string,
  topK: number = 5
): Promise<RetrievedContextDetailed> {
  const results: SearchResult[] = await searchDocuments(question, topK);

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
  topK: number = 5
): Promise<RetrievedContext> {
  const { schemaContext, tables } = await retrieveContextDetailed(question, topK);
  return { schemaContext, tables };
}
