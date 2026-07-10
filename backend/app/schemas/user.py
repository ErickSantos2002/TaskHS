from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.models.user import Role


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    initials: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    initials: str
    is_active: bool
    role: Role
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserAdminCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    initials: str
    role: Role = Role.membro


class UserAdminUpdate(BaseModel):
    role: Role


class LoginIn(BaseModel):
    email: EmailStr
    password: str
