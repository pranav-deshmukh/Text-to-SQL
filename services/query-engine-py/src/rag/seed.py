"""
Seed script — introspects SQL Server metadata, embeds, and stores in Qdrant.
Run with: python -m rag.seed --db <dbId|all>
"""

import argparse
import asyncio

from config.db_registry import get_database_config, get_registered_databases
from rag.chunker import chunk_database_metadata
from rag.vector_store import add_documents, get_document_count, init_vector_store


async def seed_database(db_id: str) -> None:
    database = get_database_config(db_id)
    if not database:
        raise SystemExit(f"Unknown database: {db_id}")

    print(f'🌱 Seeding database "{database.display_name}" ({database.db_id}) into collection "{database.qdrant_collection}"...\n')

    docs = chunk_database_metadata(database.connection_string)
    print(f"📦 Created {len(docs)} metadata chunks for {database.db_id}")

    await init_vector_store(database.qdrant_collection)
    await add_documents(database.qdrant_collection, docs)

    count = await get_document_count(database.qdrant_collection)
    print(f"✅ Seeded {count} documents into {database.qdrant_collection}\n")


async def main_async() -> None:
    parser = argparse.ArgumentParser(description="Seed Qdrant from SQL Server metadata")
    parser.add_argument("--db", required=True, help="Database id or 'all'")
    args = parser.parse_args()

    if args.db == "all":
        databases = get_registered_databases()
        if not databases:
            raise SystemExit("No databases registered. Check DB_REGISTRY or REGISTERED_DBS.")
        for database in databases:
            await seed_database(database.db_id)
        return

    await seed_database(args.db)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
