import re
import uuid

import bcrypt
import pyodbc

from auth.models import AuthUser
from config.db_registry import get_registered_databases
from config.settings import get_settings

USERS_TABLE = "[dbo].[app_users]"
USERNAME_PATTERN = re.compile(r"^[a-z0-9._@-]{3,128}$", re.IGNORECASE)
USER_ID_PATTERN = re.compile(r"^[a-z0-9._:@-]{1,128}$", re.IGNORECASE)
MIN_PASSWORD_LENGTH = 8
DUMMY_BCRYPT_HASH = b"$2b$12$DkTFZXWZl8Qaw2SFLjDP/O.OesBJUHron8mlG2YjeOykKFoDfN3zq"


def resolve_auth_connection_string() -> str:
    settings = get_settings()
    explicit = (settings.auth_db_connection_string or "").strip()
    if explicit:
        return explicit
    fallback = (settings.db_connection_string or "").strip()
    if fallback:
        return fallback
    first_registered = get_registered_databases()[0].connection_string if get_registered_databases() else ""
    if first_registered:
        return first_registered
    raise ValueError("No auth database connection is configured.")


def _query_rows(sql_query: str, params: tuple = ()) -> list[pyodbc.Row]:
    conn = pyodbc.connect(resolve_auth_connection_string())
    try:
        cursor = conn.cursor()
        cursor.execute(sql_query, params)
        if cursor.description is None:
            conn.commit()
            return []
        return cursor.fetchall()
    finally:
        conn.close()


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def _validate_signup_password(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters long."
    if not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"[0-9]", password):
        return "Password must include uppercase, lowercase, and a number."
    return None


def _compare_dummy_hash(password: str) -> None:
    bcrypt.checkpw(password.encode("utf-8"), DUMMY_BCRYPT_HASH)


async def register_auth_store() -> None:
    rows = _query_rows(f"SELECT COUNT(1) AS activeUserCount FROM {USERS_TABLE} WHERE is_active = 1;")
    active_user_count = rows[0][0] if rows else 0
    print(f"🔐 Auth store ready with {active_user_count} active user(s).")


async def authenticate_user(username: str, password: str) -> AuthUser | None:
    normalized = _normalize_username(username)
    if not USERNAME_PATTERN.match(normalized):
        _compare_dummy_hash(password)
        return None

    rows = _query_rows(
        f"""
        SELECT TOP 1
            user_id,
            username,
            password_hash,
            role,
            is_active
        FROM {USERS_TABLE}
        WHERE username = ?;
        """,
        (normalized,),
    )
    if not rows:
        _compare_dummy_hash(password)
        return None

    user = rows[0]
    if not bool(user.is_active):
        _compare_dummy_hash(password)
        return None
    if user.role not in ("end_user", "tech_team"):
        _compare_dummy_hash(password)
        return None
    if not bcrypt.checkpw(password.encode("utf-8"), str(user.password_hash).encode("utf-8")):
        return None

    return AuthUser(userId=user.user_id, username=str(user.username).strip().lower(), role=user.role)


async def create_user(username: str, password: str) -> tuple[AuthUser | None, str | None, str | None]:
    normalized = _normalize_username(username)
    if not USERNAME_PATTERN.match(normalized):
        return None, "Username must be 3-128 characters and may only contain letters, numbers, dot, underscore, dash, or @.", "AUTH_INVALID_USERNAME"

    password_validation_error = _validate_signup_password(password)
    if password_validation_error:
        return None, password_validation_error, "AUTH_WEAK_PASSWORD"

    existing = _query_rows(f"SELECT TOP 1 user_id FROM {USERS_TABLE} WHERE username = ?;", (normalized,))
    if existing:
        return None, "Username already exists.", "AUTH_USERNAME_EXISTS"

    user_id = f"user-{uuid.uuid4()}"
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    _query_rows(
        f"""
        INSERT INTO {USERS_TABLE} (user_id, username, password_hash, role, is_active)
        VALUES (?, ?, ?, 'end_user', 1);
        """,
        (user_id, normalized, password_hash),
    )

    return AuthUser(userId=user_id, username=normalized, role="end_user"), None, None


async def find_user_by_id(user_id: str) -> AuthUser | None:
    normalized = user_id.strip()
    if not USER_ID_PATTERN.match(normalized):
        return None
    rows = _query_rows(
        f"""
        SELECT TOP 1 user_id, username, role
        FROM {USERS_TABLE}
        WHERE user_id = ? AND is_active = 1;
        """,
        (normalized,),
    )
    if not rows:
        return None
    row = rows[0]
    if row.role not in ("end_user", "tech_team"):
        return None
    return AuthUser(userId=row.user_id, username=str(row.username).strip().lower(), role=row.role)