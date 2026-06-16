import json
import os
from dataclasses import dataclass
from functools import lru_cache

from config.settings import get_settings

DEFAULT_DB_ID = "default"
DEFAULT_DISPLAY_NAME = "Default Database"
DEFAULT_COLLECTION = "sql_context"


@dataclass(frozen=True)
class DatabaseConfig:
    db_id: str
    display_name: str
    connection_string: str
    qdrant_collection: str


def _to_database_config(entry: object, index: int) -> DatabaseConfig:
    if not isinstance(entry, dict):
        raise ValueError(f"DB registry entry at index {index} must be an object.")

    db_id = str(entry.get("dbId", "")).strip()
    if not db_id:
        raise ValueError(f"DB registry entry at index {index} is missing a valid dbId.")

    connection_string = str(entry.get("connectionString", "")).strip()
    if not connection_string:
        raise ValueError(f"Database '{db_id}' is missing a connection string.")

    display_name = str(entry.get("displayName", "")).strip() or db_id
    settings = get_settings()
    use_default_collection = db_id == DEFAULT_DB_ID and not settings.db_registry and not settings.registered_dbs

    return DatabaseConfig(
        db_id=db_id,
        display_name=display_name,
        connection_string=connection_string,
        qdrant_collection=DEFAULT_COLLECTION if use_default_collection else f"sql_context_{db_id}",
    )


def _parse_json_registry() -> list[DatabaseConfig]:
    settings = get_settings()
    raw_registry = (settings.db_registry or "").strip()
    if not raw_registry:
        return []

    if ((raw_registry.startswith("'") and raw_registry.endswith("'")) or
            (raw_registry.startswith('"') and raw_registry.endswith('"'))):
        raw_registry = raw_registry[1:-1]

    parsed = json.loads(raw_registry)
    if not isinstance(parsed, list):
        raise ValueError("DB_REGISTRY must be a JSON array.")

    return [_to_database_config(entry, index) for index, entry in enumerate(parsed)]


def _parse_env_registry() -> list[DatabaseConfig]:
    settings = get_settings()
    raw_ids = (settings.registered_dbs or "").split(",")
    db_ids = [value.strip() for value in raw_ids if value.strip()]
    databases: list[DatabaseConfig] = []

    for index, db_id in enumerate(db_ids):
        env_key = db_id.upper()
        display_name = os.getenv(f"DB_DISPLAY_NAME_{env_key}")
        connection_string = os.getenv(f"DB_CONNECTION_STRING_{env_key}")
        databases.append(
            _to_database_config(
                {
                    "dbId": db_id,
                    "displayName": display_name,
                    "connectionString": connection_string,
                },
                index,
            )
        )

    return databases


def _build_fallback_registry() -> list[DatabaseConfig]:
    settings = get_settings()
    connection_string = (settings.db_connection_string or "").strip()
    if not connection_string:
        return []

    return [
        DatabaseConfig(
            db_id=DEFAULT_DB_ID,
            display_name=(settings.db_display_name_default or "").strip() or DEFAULT_DISPLAY_NAME,
            connection_string=connection_string,
            qdrant_collection=DEFAULT_COLLECTION,
        )
    ]


def _validate_databases(databases: list[DatabaseConfig]) -> list[DatabaseConfig]:
    seen: set[str] = set()
    for database in databases:
        normalized = database.db_id.lower()
        if normalized in seen:
            raise ValueError(f"Duplicate database registration for dbId '{database.db_id}'.")
        seen.add(normalized)
    return databases


@lru_cache(maxsize=1)
def get_registered_databases() -> list[DatabaseConfig]:
    json_registry = _parse_json_registry()
    if json_registry:
        return _validate_databases(json_registry)

    env_registry = _parse_env_registry()
    if env_registry:
        return _validate_databases(env_registry)

    return _validate_databases(_build_fallback_registry())


def get_database_config(db_id: str) -> DatabaseConfig | None:
    for database in get_registered_databases():
        if database.db_id == db_id:
            return database
    return None
