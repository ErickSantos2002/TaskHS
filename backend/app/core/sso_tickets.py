"""Cofre de tickets de uso único do SSO.

O callback do Microsoft não pode devolver o JWT na URL (histórico do
navegador, Referer, log de proxy). Ele guarda o JWT aqui sob uma chave
opaca e manda só a chave; o front troca a chave pelo token num POST.

Estado em memória: assume processo único, como o hub SSE
(app/realtime.py) e o loop de lembretes (app/reminders.py). Reiniciar o
backend descarta tickets pendentes — quem estava no meio do redirect
clica de novo.
"""
import secrets
import time

TTL_SEGUNDOS = 60

# ticket -> (jwt, instante de expiração em time.monotonic())
_tickets: dict[str, tuple[str, float]] = {}


def _limpar(agora: float) -> None:
    vencidos = [t for t, (_, expira) in _tickets.items() if expira <= agora]
    for t in vencidos:
        _tickets.pop(t, None)


def issue(token: str) -> str:
    """Guarda o JWT e devolve o ticket opaco que o representa."""
    agora = time.monotonic()
    _limpar(agora)
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = (token, agora + TTL_SEGUNDOS)
    return ticket


def redeem(ticket: str) -> str | None:
    """Devolve o JWT e queima o ticket. None se inválido, expirado ou já usado."""
    entrada = _tickets.pop(ticket, None)
    if entrada is None:
        return None
    token, expira = entrada
    return token if expira > time.monotonic() else None
