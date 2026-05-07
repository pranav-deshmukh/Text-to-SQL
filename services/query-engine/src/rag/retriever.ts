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

/**
 * Given a user question, retrieve the top-K most relevant table schemas.
 * Returns a formatted context string ready for the prompt assembler.
 */
export async function retrieveContext(
  question: string,
  topK: number = 5
): Promise<RetrievedContext> {
  const results: SearchResult[] = await searchDocuments(question, topK);

  const schemaContext = results
    .map((r) => r.text)
    .join("\n\n---\n\n");

  const tables = results.map((r) => ({
    tableName: r.metadata.tableName || r.id,
    score: r.score,
  }));

  return { schemaContext, tables };
}
