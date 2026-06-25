from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from config.settings import get_settings


@dataclass(frozen=True)
class ReviewSession:
    thread_id: str
    user_id: str
    db_id: str
    conversation_id: str | None
    assistant_message_id: str | None
    question: str
    generated_sql: str
    editable_sql: str
    schema_context: str
    prompt_preview: dict
    retrieved_tables: list[str]
    available_columns: list[dict]
    created_at: str
    updated_at: str
    last_error: dict | None = None


_review_sessions: dict[str, ReviewSession] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_expired(session: ReviewSession) -> bool:
    updated_at = datetime.fromisoformat(session.updated_at.replace("Z", "+00:00"))
    ttl = timedelta(minutes=max(1, get_settings().review_session_ttl_minutes))
    return datetime.now(timezone.utc) - updated_at > ttl


def cleanup_expired_review_sessions() -> None:
    expired = [thread_id for thread_id, session in _review_sessions.items() if _is_expired(session)]
    for thread_id in expired:
        _review_sessions.pop(thread_id, None)


def create_review_session(input_data: dict) -> ReviewSession:
    cleanup_expired_review_sessions()
    now = _now_iso()
    session = ReviewSession(
        thread_id=str(uuid4()),
        user_id=input_data["user_id"],
        db_id=input_data["db_id"],
        conversation_id=input_data.get("conversation_id"),
        assistant_message_id=input_data.get("assistant_message_id"),
        question=input_data["question"],
        generated_sql=input_data["generated_sql"],
        editable_sql=input_data["editable_sql"],
        schema_context=input_data["schema_context"],
        prompt_preview=input_data["prompt_preview"],
        retrieved_tables=list(input_data.get("retrieved_tables", [])),
        available_columns=list(input_data.get("available_columns", [])),
        created_at=now,
        updated_at=now,
        last_error=input_data.get("last_error"),
    )
    _review_sessions[session.thread_id] = session
    return session


def get_review_session(thread_id: str, user_id: str) -> ReviewSession | None:
    cleanup_expired_review_sessions()
    session = _review_sessions.get(thread_id)
    if session is None or session.user_id != user_id:
        return None
    if _is_expired(session):
        _review_sessions.pop(thread_id, None)
        return None
    return session


def update_review_session(thread_id: str, updater) -> ReviewSession | None:
    existing = _review_sessions.get(thread_id)
    if existing is None:
        return None
    next_session = updater(existing)
    if not isinstance(next_session, ReviewSession):
        next_session = replace(existing, **next_session)
    next_session = replace(next_session, updated_at=_now_iso())
    _review_sessions[thread_id] = next_session
    return next_session


def complete_review_session(thread_id: str) -> None:
    _review_sessions.pop(thread_id, None)


def cancel_review_session(thread_id: str, user_id: str) -> ReviewSession | None:
    session = get_review_session(thread_id, user_id)
    if session is None:
        return None
    _review_sessions.pop(thread_id, None)
    return session