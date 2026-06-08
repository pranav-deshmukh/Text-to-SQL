from typing import Literal

from pydantic import BaseModel


UserRole = Literal["end_user", "tech_team"]


class AuthUser(BaseModel):
    userId: str
    username: str
    role: UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: AuthUser