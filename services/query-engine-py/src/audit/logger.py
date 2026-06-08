import json
from datetime import datetime
from pathlib import Path
import logging

from audit.config import get_audit_config
from audit.db_store import write_audit_record

LOGGER_NAME = "query_engine_py"
_in_flight: dict[str, dict] = {}


def _get_logger() -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def _clamp_text(value: str, maximum: int) -> str:
    if len(value) <= maximum:
        return value
    return f"{value[:maximum]}... [truncated {len(value) - maximum} chars]"


def _sanitize(value, maximum: int):
    if value is None:
        return None
    if isinstance(value, str):
        redacted = value
        for token in ["api_key", "token", "password", "authorization", "pwd"]:
            redacted = redacted.replace(token, token)
        return _clamp_text(redacted, maximum)
    if isinstance(value, list):
        return [_sanitize(item, maximum) for item in value]
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            if key.lower() in {"password", "pwd", "token", "authorization", "apikey", "api_key"}:
                sanitized[key] = "[REDACTED]"
            else:
                sanitized[key] = _sanitize(item, maximum)
        return sanitized
    return value


def _append_markdown(entry: dict) -> None:
    config = get_audit_config()
    if config.app_env != "dev":
        return
    log_dir = Path(__file__).resolve().parents[2] / "logs" / "dev"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{datetime.utcnow().strftime('%Y-%m-%d')}.md"
    lines = [
        f"## {entry['requestId']}",
        f"- endpoint: {entry['endpoint']}",
        f"- status: {entry['status']}",
        f"- startedAt: {entry['startedAt']}",
        f"- completedAt: {entry.get('completedAt')}",
        f"- dbId: {entry.get('dbId')}",
        f"- userId: {entry.get('userId')}",
        f"- question: {entry.get('question')}",
        f"- summary: {json.dumps(entry.get('summary') or {}, ensure_ascii=True)}",
        "",
    ]
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def log_event(level: str, event: str, **fields) -> None:
    payload = {"event": event, **fields}
    text = json.dumps(payload, default=str)
    logger = _get_logger()
    getattr(logger, level.lower(), logger.info)(text)


def begin_audit(request_id: str, endpoint: str, question: str | None = None, context: dict | None = None) -> None:
    config = get_audit_config()
    if not config.enabled:
        return
    _in_flight[request_id] = {
        "requestId": request_id,
        "endpoint": endpoint,
        "question": question,
        "context": context or {},
        "startedAt": datetime.utcnow().isoformat() + "Z",
        "stages": [],
        "stageStarts": {},
    }


def start_stage(request_id: str, stage: str) -> None:
    current = _in_flight.get(request_id)
    if current is None:
        return
    current["stageStarts"][stage] = datetime.utcnow().timestamp()


def _record_stage(request_id: str, stage: str, status: str, details: dict | None = None, error=None) -> None:
    config = get_audit_config()
    current = _in_flight.get(request_id)
    if not config.enabled or current is None:
        return
    started_at = current["stageStarts"].get(stage)
    duration_ms = int((datetime.utcnow().timestamp() - started_at) * 1000) if started_at else None
    error_payload = None
    if error is not None:
        if isinstance(error, Exception):
            error_payload = {
                "name": error.__class__.__name__,
                "message": str(error),
                "stack": _clamp_text(getattr(error, "stack", "") or "", config.max_text_length) if config.include_stack else None,
            }
        else:
            error_payload = {"message": str(error)}
    current["stages"].append({
        "stage": stage,
        "status": status,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "durationMs": duration_ms,
        "details": _sanitize(details, config.max_text_length),
        "error": _sanitize(error_payload, config.max_text_length),
    })


def stage_success(request_id: str, stage: str, details: dict | None = None) -> None:
    _record_stage(request_id, stage, "success", details)


def stage_error(request_id: str, stage: str, error, details: dict | None = None) -> None:
    _record_stage(request_id, stage, "error", details, error)


def stage_cancelled(request_id: str, stage: str, details: dict | None = None) -> None:
    _record_stage(request_id, stage, "cancelled", details)


async def complete_audit(request_id: str, status: str, summary: dict | None = None) -> None:
    config = get_audit_config()
    current = _in_flight.get(request_id)
    if not config.enabled or current is None:
        return
    entry = {
        "requestId": current["requestId"],
        "endpoint": current["endpoint"],
        "appEnv": config.app_env,
        "startedAt": current["startedAt"],
        "completedAt": datetime.utcnow().isoformat() + "Z",
        "status": status,
        "dbId": current["context"].get("dbId"),
        "dbDisplayName": current["context"].get("dbDisplayName"),
        "userId": current["context"].get("userId"),
        "userRole": current["context"].get("userRole"),
        "question": _sanitize(current.get("question"), config.max_text_length),
        "stages": current["stages"],
        "summary": _sanitize(summary, config.max_text_length),
    }
    try:
        await write_audit_record(entry)
    finally:
        _append_markdown(entry)
        _in_flight.pop(request_id, None)