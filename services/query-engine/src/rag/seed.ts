import dotenv from "dotenv";
dotenv.config();

import { chunkSchemaFiles } from "./chunker";
import { initVectorStore, addDocuments, getDocumentCount } from "./vectorStore";

/**
 * Seed script — one-time: chunk schema files → embed → store in Qdrant.
 * Run with: npx tsx src/rag/seed.ts
 */

async function seed() {
  console.log("🌱 Seeding vector store with schema chunks...\n");

  // 1. Chunk the schema files
  const chunks = chunkSchemaFiles();
  console.log(`📦 Created ${chunks.length} table chunks:`);
  for (const chunk of chunks) {
    console.log(`   - ${chunk.tableName} (${chunk.columnDefinitions.split("\n").length} columns)`);
  }

  // 2. Init ChromaDB
  await initVectorStore();

  // 3. Store chunks
  const docs = chunks.map((chunk) => ({
    id: chunk.tableName,
    text: chunk.embeddingText,
    metadata: {
      tableName: chunk.tableName,
      businessPurpose: chunk.businessPurpose,
    },
  }));

  await addDocuments(docs);

  const count = await getDocumentCount();
  console.log(`\n✅ Seeded ${count} documents into ChromaDB`);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
