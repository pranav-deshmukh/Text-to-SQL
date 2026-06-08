import argparse

from config.db_registry import get_database_config, get_registered_databases


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Qdrant from SQL Server metadata")
    parser.add_argument("--db", required=True, help="Database id or 'all'")
    args = parser.parse_args()

    if args.db == "all":
        for database in get_registered_databases():
            print(f"TODO: seed {database.db_id} -> {database.qdrant_collection}")
        return

    database = get_database_config(args.db)
    if not database:
        raise SystemExit(f"Unknown database: {args.db}")

    print(f"TODO: seed {database.db_id} -> {database.qdrant_collection}")


if __name__ == "__main__":
    main()
