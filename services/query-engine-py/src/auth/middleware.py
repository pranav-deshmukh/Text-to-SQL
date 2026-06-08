from typing import Callable

from fastapi import Depends, Header, HTTPException

from auth.models import AuthUser, UserRole
from auth.token import verify_auth_token


async def require_auth(authorization: str | None = Header(default=None)) -> AuthUser:
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail={"error": "Authentication required.", "code": "AUTH_REQUIRED", "detail": "Missing bearer token."})
    user = verify_auth_token(token)
    if not user:
        raise HTTPException(status_code=401, detail={"error": "Authentication required.", "code": "AUTH_REQUIRED", "detail": "Invalid or expired bearer token."})
    return user


def require_role(*roles: UserRole) -> Callable:
    async def dependency(user: AuthUser = Depends(require_auth)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail={"error": "You do not have permission to perform this action.", "code": "FORBIDDEN"})
        return user

    return dependency