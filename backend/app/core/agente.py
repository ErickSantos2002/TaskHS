"""Token de agente do HS.OS (JWT EdDSA). Função pura: sem config e sem banco."""
import jwt


class TokenDeAgenteInvalido(Exception):
    pass


def eh_token_de_agente(token: str) -> bool:
    """Olha o payload SEM verificar: só decide o caminho (agente ou login normal)."""
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except Exception:
        return False
    return isinstance(payload, dict) and payload.get("iss") == "hsos"


def validar_token_de_agente(token: str, chave_pem: str) -> tuple[str, str]:
    """→ (email, bot). Qualquer falha lança TokenDeAgenteInvalido."""
    chave = (chave_pem or "").replace("\\n", "\n").strip()
    if not chave:
        raise TokenDeAgenteInvalido("chave pública não configurada")
    try:
        payload = jwt.decode(
            token,
            chave,
            algorithms=["EdDSA"],
            audience="taskhs",
            issuer="hsos",
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise TokenDeAgenteInvalido(str(exc)) from exc
    email = payload.get("sub")
    act = payload.get("act")
    bot = act.get("sub") if isinstance(act, dict) else None
    if not isinstance(email, str) or not email or not isinstance(bot, str) or not bot:
        raise TokenDeAgenteInvalido("sub ou act.sub ausente")
    return email, bot
