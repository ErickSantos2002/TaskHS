import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
import app.models  # noqa: F401 — ensures all models are registered before create_all
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders
from app.core.config import settings
from app.reminders import reminder_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    task = asyncio.create_task(reminder_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="TaskHS API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(boards.router, prefix="/api")
app.include_router(lists.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(labels.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
