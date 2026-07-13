from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class Actor:
    actor_type: str = "sistema"
    user_id: int | None = None
    name: str = "sistema"
    email: str | None = None
    ip: str | None = None
    path: str | None = None


current_actor: ContextVar[Actor | None] = ContextVar("current_actor", default=None)


def get_actor() -> Actor:
    """Ator da operação atual. Fora de request (loop de lembretes) → 'sistema'."""
    return current_actor.get() or Actor()


def set_request_actor(ip: str | None, path: str | None) -> Actor:
    """Chamado pelo middleware no começo do request."""
    actor = Actor(ip=ip, path=path)
    current_actor.set(actor)
    return actor


def set_actor_identity(actor_type: str, user_id: int | None, name: str, email: str | None = None) -> None:
    """Enriquece o ator do request (mantém ip/path). Muta o objeto — as referências já
    existentes enxergam a mudança, o que evita depender de propagação de ContextVar."""
    actor = current_actor.get()
    if actor is None:
        actor = Actor()
        current_actor.set(actor)
    actor.actor_type = actor_type
    actor.user_id = user_id
    actor.name = name
    actor.email = email
