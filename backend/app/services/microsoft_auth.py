"""Conversa com o Entra ID / Microsoft Graph. Não toca no banco.

Espelha o microsoft_auth_service.py do HSGrowth CRM, com duas diferenças:
o escopo é só User.Read (aqui a Microsoft serve para identificar, não para
mandar e-mail nem ler calendário) e o GET /me sai por httpx async.

As duas funções do msal são SÍNCRONAS e fazem HTTP bloqueante — quem
chamar de dentro de endpoint async precisa usar asyncio.to_thread, senão
trava o event loop (e, com 1 worker, os SSE abertos junto).
"""
import httpx
import msal

from app.core.config import settings

SCOPES = ["User.Read"]
GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"


def _msal_app() -> msal.ConfidentialClientApplication:
    return msal.ConfidentialClientApplication(
        client_id=settings.MS_CLIENT_ID,
        client_credential=settings.MS_CLIENT_SECRET,
        authority=f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}",
    )


def get_authorization_url() -> str:
    """URL de login da Microsoft para onde redirecionar o navegador."""
    return _msal_app().get_authorization_request_url(
        scopes=SCOPES,
        redirect_uri=settings.MS_REDIRECT_URI,
        prompt="select_account",
    )


def exchange_code_for_token(code: str) -> str:
    """Troca o authorization code pelo access token da Microsoft."""
    try:
        resultado = _msal_app().acquire_token_by_authorization_code(
            code=code,
            scopes=SCOPES,
            redirect_uri=settings.MS_REDIRECT_URI,
        )
    except ValueError:
        # ValueError do próprio código (dict sem access_token); relança direto
        raise
    except Exception as e:
        # Exceções de rede (timeout, DNS, conexão recusada, etc.)
        raise ValueError(f"falha ao conectar com autoridade Microsoft: {type(e).__name__}")

    if "access_token" not in resultado:
        # error_description pode conter o motivo; nunca contém segredo nosso.
        raise ValueError(
            resultado.get("error_description") or resultado.get("error") or "troca de código falhou"
        )
    return resultado["access_token"]


async def get_user_email(access_token: str) -> str:
    """E-mail da pessoa autenticada, normalizado.

    'mail' vem nulo em algumas contas corporativas — daí o fallback para
    userPrincipalName.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GRAPH_ME_URL, headers={"Authorization": f"Bearer {access_token}"})
    if resp.status_code != 200:
        raise ValueError(f"Graph /me respondeu {resp.status_code}")
    try:
        dados = resp.json()
    except Exception as e:
        raise ValueError(f"Graph /me respondeu com JSON inválido: {type(e).__name__}")
    email = dados.get("mail") or dados.get("userPrincipalName") or ""
    return email.lower().strip()
