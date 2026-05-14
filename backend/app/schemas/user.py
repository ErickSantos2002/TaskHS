from datetime import datetime
from pydantic import BaseModel, EmailStr


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
    is_admin: bool = False


class UserAdminUpdate(BaseModel):
    is_admin: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str
