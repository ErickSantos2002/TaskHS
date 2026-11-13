"""Capacidade do Guardi (HS.OS): o que este login consegue fazer pelo token de agente.

O TaskHS não tem papel nas ferramentas do Guardi: o agente pode chamar toda rota
autenticada por `get_current_user`, menos as que passam por `bloquear_token_de_agente`
(gestão de quadro, membros de quadro, usuários, lixeira...). A lista sai da árvore de
dependências das próprias rotas, então não há tabela à parte para envelhecer.
Regras que dependem do caso (membresia do quadro, dono do comentário) continuam
conferidas na hora, como sempre.
"""
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRoute

from app.audit_context import get_actor
from app.dependencies import bloquear_token_de_agente, get_current_user
from app.models.user import User

router = APIRouter(prefix="/agente", tags=["agente"])

PREFIXO = "/api"
PAPEL_EXIBIDO = {"administrador": "Administrador", "coordenador": "Coordenador", "membro": "Membro"}


def dependencias(dependant) -> set:
    """Todas as funções da árvore de dependências (inclusive as do router)."""
    vistas = set()
    pilha = [dependant]
    while pilha:
        d = pilha.pop()
        if d.call is not None:
            vistas.add(d.call)
        pilha.extend(d.dependencies)
    return vistas


def rotas_do_agente(app: FastAPI) -> list[list[str]]:
    rotas = set()
    for r in app.routes:
        if not isinstance(r, APIRoute) or not r.path.startswith(PREFIXO + "/"):
            continue
        deps = dependencias(r.dependant)
        # Sem get_current_user o token de agente nem é lido (rota pública, X-API-Key, ticket SSE).
        if get_current_user not in deps or bloquear_token_de_agente in deps:
            continue
        for metodo in r.methods - {"HEAD", "OPTIONS"}:
            rotas.add((metodo, r.path[len(PREFIXO):]))
    return [list(p) for p in sorted(rotas, key=lambda p: (p[1], p[0]))]


@router.get("/capacidades")
async def capacidades(request: Request, user: User = Depends(get_current_user)):
    # Só pelo token de agente; login normal não precisa saber que a rota existe.
    if get_actor().via is None:
        raise HTTPException(status_code=404, detail="Not Found")
    papel = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {"papel": PAPEL_EXIBIDO.get(papel, papel), "rotas": rotas_do_agente(request.app)}
