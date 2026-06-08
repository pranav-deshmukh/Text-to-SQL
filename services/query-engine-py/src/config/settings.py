from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")
    qdrant_url: str = Field(default="http://localhost:6333", alias="QDRANT_URL")
    db_registry: str | None = Field(default=None, alias="DB_REGISTRY")
    registered_dbs: str | None = Field(default=None, alias="REGISTERED_DBS")
    db_connection_string: str | None = Field(default=None, alias="DB_CONNECTION_STRING")
    db_display_name_default: str | None = Field(default=None, alias="DB_DISPLAY_NAME_DEFAULT")
    auth_db_connection_string: str | None = Field(default=None, alias="AUTH_DB_CONNECTION_STRING")
    app_env: str = Field(default="dev", alias="APP_ENV")
    rag_mode: str = Field(default="all", alias="RAG_MODE")
    rag_top_k: int = Field(default=15, alias="RAG_TOP_K")
    rag_score_threshold: float = Field(default=0.45, alias="RAG_SCORE_THRESHOLD")
    agent_max_retries: int = Field(default=2, alias="AGENT_MAX_RETRIES")
    jwt_secret: str | None = Field(default=None, alias="JWT_SECRET")
    jwt_expiry_seconds: int = Field(default=60 * 60 * 8, alias="JWT_EXPIRY_SECONDS")
    review_session_ttl_minutes: int = Field(default=30, alias="REVIEW_SESSION_TTL_MINUTES")
    audit_enabled: bool = Field(default=True, alias="AUDIT_ENABLED")
    audit_ui_enabled: bool = Field(default=True, alias="AUDIT_UI_ENABLED")
    audit_include_stack: bool = Field(default=True, alias="AUDIT_INCLUDE_STACK")
    audit_max_text_length: int = Field(default=3000, alias="AUDIT_MAX_TEXT_LENGTH")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
