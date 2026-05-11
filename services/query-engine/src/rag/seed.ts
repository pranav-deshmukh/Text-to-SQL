import dotenv from "dotenv";
dotenv.config();

import { chunkDatabaseMetadata } from "./chunker";
import { initVectorStore, addDocuments, getDocumentCount } from "./vectorStore";

/**
 * Seed script — one-time: introspect SQL Server metadata → embed → store in Qdrant.
 * Run with: npx tsx src/rag/seed.ts
 */

async function seed() {
  console.log("🌱 Seeding vector store with SQL Server metadata...\n");

  const connectionString = process.env.DB_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION_STRING in environment. The seed script now reads schema metadata directly from SQL Server.");
  }

  // 1. Introspect the database and build RAG documents
  const docs = await chunkDatabaseMetadata(connectionString);
  console.log(`📦 Created ${docs.length} metadata chunks`);

  // 2. Init Qdrant
  await initVectorStore();

  // 3. Store chunks
  await addDocuments(docs);

  const count = await getDocumentCount();
  console.log(`\n✅ Seeded ${count} documents into Qdrant`);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
