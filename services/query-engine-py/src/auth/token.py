from datetime import datetime, timedelta, timezone

import jwt

from auth.models import AuthUser
from config.settings import get_settings


def _get_secret() -> str:
    secret = (get_settings().jwt_secret or "").strip()
    if len(secret) < 32:
        raise ValueError("JWT_SECRET must be set and at least 32 characters long")
    return secret


def create_auth_token(user: AuthUser) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.userId,
        "username": user.username,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.jwt_expiry_seconds)).timestamp()),
    }
    return jwt.encode(payload, _get_secret(), algorithm="HS256")


def verify_auth_token(token: str) -> AuthUser | None:
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=["HS256"])
        if not payload.get("sub") or not payload.get("username") or not payload.get("role"):
            return None
        return AuthUser(userId=payload["sub"], username=payload["username"], role=payload["role"])
    except Exception:
        return None