import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.database import engine, Base, AsyncSessionLocal
import app.models  # noqa: F401 — ensures all models are registered before create_all
import app.audit  # noqa: F401 — registra os listeners de auditoria
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders, automations, integration, logs
from app.core.config import settings
from app.reminders import reminder_loop
from app.migrations import run_migrations
from app.audit_context import set_request_actor, get_actor
from app.models.audit import AuditLog

logger = logging.getLogger("audit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    async with engine.begin() as conn:
        # create_all cria só as tabelas que faltam; alterar tabela existente é
        # com as migrations, que por isso rodam depois. Falha aqui derruba o
        # boot de propósito — ver app/migrations.py.
        await conn.run_sync(Base.metadata.create_all)
        await run_migrations(conn)
    from app import realtime
    task = asyncio.create_task(reminder_loop())
    rt_task = asyncio.create_task(realtime.consumer())
    try:
        yield
    finally:
        task.cancel()
        rt_task.cancel()


app = FastAPI(title="TaskHS API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def audit_context_middleware(request: Request, call_next):
    ip = request.client.host if request.client else None
    set_request_actor(ip, f"{request.method} {request.url.path}")
    return await call_next(request)


@app.exception_handler(StarletteHTTPException)
async def audit_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 403:
        actor = get_actor()
        try:
            async with AsyncSessionLocal() as db:
                db.add(AuditLog(
                    actor_type=actor.actor_type, actor_user_id=actor.user_id,
                    actor_name=(actor.name or "sistema")[:120], actor_email=(actor.email[:255] if actor.email else None),
                    action="acesso_negado", entity_type="sessao",
                    summary=f"tentativa bloqueada: {exc.detail}",
                    ip=(actor.ip[:45] if actor.ip else None), path=(actor.path[:255] if actor.path else None),
                ))
                await db.commit()
        except Exception:
            logger.exception("falha ao registrar acesso_negado")
    return await http_exception_handler(request, exc)


app.include_router(auth.router, prefix="/api")
app.include_router(boards.router, prefix="/api")
app.include_router(lists.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(labels.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(automations.router, prefix="/api")
app.include_router(integration.router, prefix="/api")
app.include_router(logs.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
