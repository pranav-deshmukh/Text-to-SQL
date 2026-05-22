import dotenv from "dotenv";
dotenv.config();

import { chunkDatabaseMetadata } from "./chunker";
import { initVectorStore, addDocuments, getDocumentCount } from "./vectorStore";
import { getDatabaseConfig, getRegisteredDatabases } from "../config/dbRegistry";

/**
 * Seed script — one-time: introspect SQL Server metadata → embed → store in Qdrant.
 * Run with: npx tsx src/rag/seed.ts
 */

function getDbArg(): string | undefined {
  const args = process.argv.slice(2);
  const dbIndex = args.indexOf("--db");
  if (dbIndex === -1) {
    return undefined;
  }

  return args[dbIndex + 1];
}

function printUsage(): void {
  console.log("Usage: npx tsx src/rag/seed.ts --db <dbId|all>");
}

async function seedDatabase(dbId: string): Promise<void> {
  const database = getDatabaseConfig(dbId);
  if (!database) {
    throw new Error(`Unknown database: ${dbId}`);
  }

  console.log(`🌱 Seeding database \"${database.displayName}\" (${database.dbId}) into collection \"${database.qdrantCollection}\"...\n`);

  const docs = await chunkDatabaseMetadata(database.connectionString);
  console.log(`📦 Created ${docs.length} metadata chunks for ${database.dbId}`);

  await initVectorStore(database.qdrantCollection);
  await addDocuments(database.qdrantCollection, docs);

  const count = await getDocumentCount(database.qdrantCollection);
  console.log(`✅ Seeded ${count} documents into ${database.qdrantCollection}\n`);
}

async function seed() {
  const requestedDb = getDbArg();
  if (!requestedDb) {
    printUsage();
    process.exit(1);
  }

  if (requestedDb === "all") {
    const databases = getRegisteredDatabases();
    if (databases.length === 0) {
      throw new Error("No databases registered. Check DB_REGISTRY or REGISTERED_DBS.");
    }

    for (const database of databases) {
      await seedDatabase(database.dbId);
    }
    return;
  }

  await seedDatabase(requestedDb);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
