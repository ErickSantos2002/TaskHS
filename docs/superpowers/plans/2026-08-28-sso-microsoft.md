# SSO Microsoft (Entra ID) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um botão "Entrar com Microsoft" na tela de login que autentica a pessoa no Entra ID da empresa, casa o e-mail com um usuário já cadastrado no TaskHS e devolve a mesma sessão JWT do login por senha.

**Architecture:** Três endpoints públicos novos no router `auth` (autorização, callback, troca de ticket) mais um de status. O callback fala com a Microsoft pelo `msal` (fora do event loop, via `asyncio.to_thread`), lê o e-mail no Graph, acha o `User`, gera o JWT de sempre e guarda esse JWT sob um ticket opaco de uso único em memória — só o ticket viaja na URL de volta. No front, uma página `/auth/callback` troca o ticket pelo token e entrega ao `AuthContext`, que passa a ter um `loginWithToken` para não duplicar a persistência.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + `msal` + `httpx`; React 19 + TypeScript + React Router 7 + Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-08-28-sso-microsoft-design.md](../specs/2026-08-28-sso-microsoft-design.md)

## Global Constraints

- **Não há suíte de testes** neste projeto (nem pytest, nem testes no front). Toda verificação é manual: `curl`, navegador, `npm run build`. Não invente comandos de teste nem crie framework de teste.
- **Repositório PÚBLICO.** Nunca escreva senha, `MS_CLIENT_SECRET`, `SECRET_KEY`, `PGPASSWORD` ou `DATABASE_URL` em arquivo versionado, comando de exemplo, saída colada no chat ou mensagem de commit. Nada de `cat backend/.env` — para confirmar presença de uma env use `grep -c`.
- **Sem migration:** esta feature não cria nem altera coluna nenhuma. O modelo `User` fica intacto.
- **Interface e mensagens em português.**
- **Cada mudança fecha com entrada nova no changelog** (`frontend/src/data/changelog.ts`); versão desta feature: **1.14.0**.
- **Envs já configuradas** por Erick em 2026-08-28, no `backend/.env` local e no Easypanel: `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI`, `FRONTEND_URL`. Os valores locais apontam para **produção** — para testar na máquina, trocar `MS_REDIRECT_URI` para `http://localhost:8000/api/auth/microsoft/callback` e `FRONTEND_URL` para `http://localhost:5173` (a redirect URI de dev já está cadastrada no Azure).
- Backend roda em Docker. O `backend/Dockerfile` faz `COPY . .` e o compose **não** tem bind mount do código: `docker compose restart backend` reinicia a imagem antiga e **não** enxerga o Python que você acabou de editar. Depois de qualquer edição no backend, sempre `docker compose up -d --build` (e conferir `docker compose logs --tail 30 backend`).
- Front: `cd frontend && npm run dev` (http://localhost:5173).
- Branch: `feat/sso-microsoft`, criada a partir da `main`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/core/sso_tickets.py` *(novo)* | Só o cofre de tickets: emitir e resgatar. Não sabe nada de HTTP, de usuário nem de Microsoft. |
| `backend/app/services/microsoft_auth.py` *(novo)* | Só a conversa com a Microsoft: montar URL, trocar código, ler o e-mail no Graph. Não toca no banco. |
| `backend/app/core/config.py` *(modificar)* | As cinco envs + a property `sso_enabled`. |
| `backend/app/routers/auth.py` *(modificar)* | Os quatro endpoints: amarram serviço + cofre + banco + auditoria. |
| `backend/requirements.txt` *(modificar)* | `msal`, `httpx`. |
| `backend/.env.example` *(modificar)* | As cinco vars, vazias. |
| `frontend/src/contexts/AuthContext.tsx` *(modificar)* | Ganha `loginWithToken`; o `login` por senha passa a usá-lo. Persistência num lugar só. |
| `frontend/src/pages/AuthCallbackPage.tsx` *(novo)* | A tela de "Autenticando…", a troca do ticket e o erro. Isolada — não encosta no `LoginPage`. |
| `frontend/src/App.tsx` *(modificar)* | Uma rota pública nova. |
| `frontend/src/pages/LoginPage.tsx` *(modificar)* | O botão, o divisor e a leitura do `?erro=`. |
| `frontend/src/data/changelog.ts` *(modificar)* | Entrada 1.14.0. |

---

## Task 1: Configuração e cofre de tickets

**Files:**
- Create: `backend/app/core/sso_tickets.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `settings.MS_CLIENT_ID`, `settings.MS_TENANT_ID`, `settings.MS_CLIENT_SECRET`, `settings.MS_REDIRECT_URI`, `settings.FRONTEND_URL` — todos `str`
  - `settings.sso_enabled -> bool`
  - `app.core.sso_tickets.issue(token: str) -> str`
  - `app.core.sso_tickets.redeem(ticket: str) -> str | None`

- [ ] **Step 1: Criar o cofre de tickets**

Criar `backend/app/core/sso_tickets.py`:

```python
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
```

- [ ] **Step 2: Adicionar as envs ao config**

Em `backend/app/core/config.py`, dentro de `class Settings`, logo depois de `INTEGRATION_API_KEY`:

```python
    # SSO Microsoft (Entra ID). Vazias = SSO desligado.
    MS_CLIENT_ID: str = ""
    MS_TENANT_ID: str = ""
    MS_CLIENT_SECRET: str = ""
    MS_REDIRECT_URI: str = ""
    # para onde o callback devolve o navegador depois do login
    FRONTEND_URL: str = "http://localhost:5173"
```

E, junto da property `cors_origins_list`:

```python
    @property
    def sso_enabled(self) -> bool:
        return bool(
            self.MS_CLIENT_ID
            and self.MS_TENANT_ID
            and self.MS_CLIENT_SECRET
            and self.MS_REDIRECT_URI
        )
```

- [ ] **Step 3: Adicionar as dependências**

Acrescentar ao fim de `backend/requirements.txt`:

```
msal==1.31.1
httpx==0.28.1
```

- [ ] **Step 4: Documentar as envs no `.env.example`**

Acrescentar ao fim de `backend/.env.example` (valores **vazios** — o repo é público):

```
# SSO Microsoft (Entra ID) — App Registration "TaskHS", single tenant, User.Read
# Deixe vazio para desligar o login com Microsoft.
MS_CLIENT_ID=
MS_TENANT_ID=
MS_CLIENT_SECRET=
MS_REDIRECT_URI=http://localhost:8000/api/auth/microsoft/callback
FRONTEND_URL=http://localhost:5173
```

- [ ] **Step 5: Subir o backend e verificar**

```bash
docker compose up -d --build
docker compose logs --tail 30 backend
```

Esperado: sobe sem erro (o `msal` instalado, nenhum `ValidationError` do pydantic-settings).

Agora o cofre e a property, sem imprimir segredo nenhum:

```bash
docker compose exec -T backend python -c "
from app.core import sso_tickets as st
from app.core.config import settings
print('sso_enabled:', settings.sso_enabled)
t = st.issue('jwt-de-mentira')
print('resgate 1:', st.redeem(t))
print('resgate 2:', st.redeem(t))
print('inexistente:', st.redeem('nao-existe'))
"
```

Esperado:
```
sso_enabled: True
resgate 1: jwt-de-mentira
resgate 2: None
inexistente: None
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/sso_tickets.py backend/app/core/config.py backend/requirements.txt backend/.env.example
git commit -m "feat(sso): config do Entra ID e cofre de tickets de uso unico"
```

---

## Task 2: Serviço de autenticação Microsoft

**Files:**
- Create: `backend/app/services/microsoft_auth.py`

**Interfaces:**
- Consumes: `settings.MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` (Task 1).
- Produces:
  - `get_authorization_url() -> str` — **síncrona e bloqueante**, chamar com `asyncio.to_thread`
  - `exchange_code_for_token(code: str) -> str` — **síncrona e bloqueante**, chamar com `asyncio.to_thread`; devolve o access token da Microsoft; levanta `ValueError` se falhar
  - `get_user_email(access_token: str) -> str` — **async**; devolve o e-mail normalizado; levanta `ValueError` se o Graph não responder 200

Não existe `backend/app/services/`. Criar o diretório com um `__init__.py` vazio.

- [ ] **Step 1: Criar o pacote services**

```bash
mkdir -p backend/app/services && touch backend/app/services/__init__.py
```

- [ ] **Step 2: Escrever o serviço**

Criar `backend/app/services/microsoft_auth.py`:

```python
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
    resultado = _msal_app().acquire_token_by_authorization_code(
        code=code,
        scopes=SCOPES,
        redirect_uri=settings.MS_REDIRECT_URI,
    )
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
    dados = resp.json()
    email = dados.get("mail") or dados.get("userPrincipalName") or ""
    return email.lower().strip()
```

- [ ] **Step 3: Verificar que a URL de autorização sai correta**

```bash
docker compose up -d --build
docker compose exec -T backend python -c "
from urllib.parse import urlparse, parse_qs
from app.services import microsoft_auth
u = urlparse(microsoft_auth.get_authorization_url())
q = parse_qs(u.query)
print('host:', u.netloc)
print('caminho tem o tenant:', '/oauth2/v2.0/authorize' in u.path)
print('scope:', q.get('scope'))
print('redirect_uri:', q.get('redirect_uri'))
print('response_type:', q.get('response_type'))
"
```

Esperado: `host: login.microsoftonline.com`, caminho `True`, escopo contendo `User.Read`, `redirect_uri` igual ao do `.env`, `response_type: ['code']`.
(Não imprima `client_id` nem nada além disso.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/
git commit -m "feat(sso): servico de autenticacao Microsoft (msal + graph /me)"
```

---

## Task 3: Endpoints de SSO no router auth

**Files:**
- Modify: `backend/app/routers/auth.py` (imports no topo; endpoints ao fim do arquivo)

**Interfaces:**
- Consumes: `sso_tickets.issue/redeem` (Task 1), `microsoft_auth.*` (Task 2), `settings.sso_enabled`/`FRONTEND_URL` (Task 1), e o que o arquivo já usa: `create_access_token`, `decode_token`, `User`, `UserOut`, `TokenOut`, `AuditLog`, `get_actor`.
- Produces:
  - `GET /api/auth/sso/status` → `{"enabled": bool}`
  - `GET /api/auth/microsoft` → 302 para a Microsoft (503 se desligado)
  - `GET /api/auth/microsoft/callback?code=&error=` → 302 para o front
  - `POST /api/auth/sso/exchange` body `{"ticket": "..."}` → `TokenOut` (400 se o ticket não presta)

- [ ] **Step 1: Ajustar os imports do arquivo**

No topo de `backend/app/routers/auth.py`, acrescentar:

```python
import asyncio
import logging

from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.security import decode_token
from app.core import sso_tickets
from app.services import microsoft_auth

logger = logging.getLogger("audit")
```

`create_access_token` já vem no import existente de `app.core.security` — acrescentar `decode_token` a ele em vez de criar uma linha nova.

- [ ] **Step 2: Escrever os quatro endpoints**

Acrescentar ao **fim** de `backend/app/routers/auth.py`:

```python
class SsoExchangeIn(BaseModel):
    ticket: str


def _erro_login(motivo: str) -> RedirectResponse:
    """Devolve o navegador para o /login do front com o motivo na query."""
    return RedirectResponse(url=f"{settings.FRONTEND_URL.rstrip('/')}/login?erro={motivo}", status_code=302)


@router.get("/sso/status")
async def sso_status():
    """Diz ao front se deve mostrar o botão 'Entrar com Microsoft'."""
    return {"enabled": settings.sso_enabled}


@router.get("/microsoft")
async def microsoft_login():
    if not settings.sso_enabled:
        raise HTTPException(status_code=503, detail="Login com Microsoft não está configurado")
    # msal é bloqueante: fora do event loop, senão trava os SSE abertos.
    url = await asyncio.to_thread(microsoft_auth.get_authorization_url)
    return RedirectResponse(url=url, status_code=302)


@router.get("/microsoft/callback")
async def microsoft_callback(
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if not settings.sso_enabled:
        raise HTTPException(status_code=503, detail="Login com Microsoft não está configurado")
    if error or not code:
        return _erro_login("falha_microsoft")

    try:
        ms_token = await asyncio.to_thread(microsoft_auth.exchange_code_for_token, code)
        email = await microsoft_auth.get_user_email(ms_token)
    except Exception as e:
        logger.warning("SSO Microsoft: falha ao autenticar (%s)", type(e).__name__)
        return _erro_login("falha_microsoft")

    if not email:
        return _erro_login("falha_microsoft")

    resultado = await db.execute(select(User).where(User.email == email))
    user = resultado.scalar_one_or_none()
    actor = get_actor()
    ip = actor.ip[:45] if actor.ip else None
    path = actor.path[:255] if actor.path else None

    if not user or not user.is_active:
        motivo = "usuario_nao_encontrado" if not user else "usuario_inativo"
        db.add(AuditLog(
            actor_type="usuario", actor_user_id=(user.id if user else None),
            actor_name=(user.name if user else email)[:120], actor_email=email[:255],
            action="login_falhou", entity_type="sessao", entity_id=(user.id if user else None),
            entity_label=email[:255],
            summary=f"login via Microsoft recusado ({motivo}): {email}",
            ip=ip, path=path,
        ))
        await db.commit()
        return _erro_login(motivo)

    db.add(AuditLog(
        actor_type="usuario", actor_user_id=user.id, actor_name=user.name[:120],
        actor_email=user.email[:255], action="login", entity_type="sessao",
        entity_id=user.id, entity_label=user.email[:255],
        summary=f'"{user.name}" entrou no sistema via Microsoft',
        ip=ip, path=path,
    ))
    await db.commit()

    ticket = sso_tickets.issue(create_access_token(user.email))
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL.rstrip('/')}/auth/callback?ticket={ticket}",
        status_code=302,
    )


@router.post("/sso/exchange", response_model=TokenOut)
async def sso_exchange(body: SsoExchangeIn, db: AsyncSession = Depends(get_db)):
    """Troca o ticket de uso único pelo JWT. 400 (não 401) de propósito:
    o cliente HTTP do front trata 401 como sessão expirada e redireciona
    sem mensagem — aqui queremos que a tela de callback explique."""
    token = sso_tickets.redeem(body.ticket)
    email = decode_token(token) if token else None
    if not email:
        raise HTTPException(status_code=400, detail="Ticket inválido ou expirado")

    resultado = await db.execute(select(User).where(User.email == email))
    user = resultado.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Ticket inválido ou expirado")

    return TokenOut(access_token=token, user=UserOut.model_validate(user))
```

- [ ] **Step 3: Verificar que os endpoints existem e respondem**

```bash
docker compose up -d --build
sleep 3
curl -s http://localhost:8000/api/auth/sso/status
echo
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:8000/api/auth/microsoft
curl -s -X POST http://localhost:8000/api/auth/sso/exchange \
  -H 'Content-Type: application/json' -d '{"ticket":"nao-existe"}' \
  -w "\nstatus=%{http_code}\n"
```

Esperado:
- `{"enabled":true}`
- `302 https://login.microsoftonline.com/...` (a URL de autorização)
- `{"detail":"Ticket inválido ou expirado"}` com `status=400`

- [ ] **Step 4: Verificar o caminho do ticket bom**

Emitir um ticket por dentro e trocá-lo por HTTP, usando um e-mail que existe na base — pegue um sem expor senha nenhuma:

```bash
EMAIL=$(./scripts/psql-dev.sh -tAc "SELECT email FROM users WHERE is_active ORDER BY id LIMIT 1;")
TICKET=$(docker compose exec -T backend python -c "
from app.core import sso_tickets
from app.core.security import create_access_token
print(sso_tickets.issue(create_access_token('$EMAIL')))
" | tr -d '\r\n')
curl -s -X POST http://localhost:8000/api/auth/sso/exchange \
  -H 'Content-Type: application/json' -d "{\"ticket\":\"$TICKET\"}" | head -c 200
echo
curl -s -X POST http://localhost:8000/api/auth/sso/exchange \
  -H 'Content-Type: application/json' -d "{\"ticket\":\"$TICKET\"}" -w "\nstatus=%{http_code}\n"
```

Esperado: a primeira chamada devolve `{"access_token":"...","token_type":"bearer","user":{...}}`; a segunda devolve 400 (ticket queimado).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/auth.py
git commit -m "feat(sso): endpoints de login com Microsoft e troca de ticket"
```

---

## Task 4: Página de callback no frontend

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/src/pages/AuthCallbackPage.tsx`
- Modify: `frontend/src/App.tsx:33` (rota nova, junto da de `/login`)

**Interfaces:**
- Consumes: `POST /api/auth/sso/exchange` (Task 3); `api.post` e `ApiError` de `lib/api.ts`.
- Produces: `useAuth().loginWithToken(token: string, user: User) => void`; rota `/auth/callback`.

- [ ] **Step 1: Extrair a persistência no AuthContext**

Em `frontend/src/contexts/AuthContext.tsx`, acrescentar `loginWithToken` à interface:

```tsx
interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: User) => void;
  logout: () => void;
}
```

Substituir o `login` atual por estes dois (o `login` passa a delegar — a escrita no localStorage fica num lugar só):

```tsx
  const loginWithToken = useCallback((token: string, u: User) => {
    localStorage.setItem("taskhs-token", token);
    localStorage.setItem("taskhs-user", JSON.stringify(u));
    setUser(u);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ access_token: string; user: User }>("/auth/login", { email, password });
    loginWithToken(data.access_token, data.user);
  }, [loginWithToken]);
```

E incluir no value do provider:

```tsx
  return <AuthContext.Provider value={{ user, login, loginWithToken, logout }}>{children}</AuthContext.Provider>;
```

Exportar o tipo `User` (`export interface User {`) — a página de callback precisa dele.

- [ ] **Step 2: Criar a página de callback**

Criar `frontend/src/pages/AuthCallbackPage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, type User } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { APP_VERSION } from "../data/changelog";

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [erro, setErro] = useState("");
  // StrictMode roda o efeito duas vezes em dev; o ticket é de uso único e a
  // segunda tentativa queimaria em 400. Uma trava por montagem resolve.
  const jaTrocou = useRef(false);

  useEffect(() => {
    if (jaTrocou.current) return;
    jaTrocou.current = true;

    const ticket = searchParams.get("ticket");
    if (!ticket) {
      setErro("Link de autenticação inválido. Tente entrar de novo.");
      return;
    }

    api
      .post<{ access_token: string; user: User }>("/auth/sso/exchange", { ticket })
      .then(data => {
        loginWithToken(data.access_token, data.user);
        navigate("/", { replace: true });
      })
      .catch(() => {
        setErro("Não foi possível concluir o login com a Microsoft. Tente de novo.");
      });
  }, [searchParams, loginWithToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        {erro ? (
          <div className="rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-sm p-6">
            <div className="flex items-center gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-sm text-danger text-left mb-4">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {erro}
            </div>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-[0.98] transition-all duration-150"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
            <svg className="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Autenticando com a Microsoft…</p>
          </div>
        )}
        <p className="text-center text-xs text-slate-400 mt-6">
          TaskHS · Health &amp; Safety Tech · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Montar a rota**

Em `frontend/src/App.tsx`, no import junto dos outros:

```tsx
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
```

E logo abaixo da rota de `/login` (linha 33), **fora** do `ProtectedRoute`:

```tsx
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
```

- [ ] **Step 4: Verificar o build e a tela**

```bash
cd frontend && npm run build && npm run lint
```

Esperado: build passa, lint sem erro novo.

Com o `npm run dev` rodando, abrir `http://localhost:5173/auth/callback` (sem ticket): deve aparecer a mensagem de link inválido e o botão "Voltar para o login" — e o botão deve levar ao `/login`.

Depois, com um ticket de verdade (emitido como na Task 3, Step 4), abrir
`http://localhost:5173/auth/callback?ticket=<TICKET>`: deve entrar no sistema e cair no dashboard.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/pages/AuthCallbackPage.tsx frontend/src/App.tsx
git commit -m "feat(sso): pagina /auth/callback que troca o ticket pela sessao"
```

---

## Task 5: Botão na tela de login e changelog

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/data/changelog.ts`

**Interfaces:**
- Consumes: `GET /api/auth/sso/status` (Task 3), `API_BASE` de `lib/api.ts`, rota `/auth/callback` (Task 4).
- Produces: nada que outra task consuma — é a última.

- [ ] **Step 1: Ler o `?erro=` e o status do SSO**

Em `frontend/src/pages/LoginPage.tsx`, ajustar os imports:

```tsx
import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, API_BASE } from "../lib/api";
import logo from "../assets/logo.png";
import { APP_VERSION } from "../data/changelog";

const ERROS_SSO: Record<string, string> = {
  usuario_nao_encontrado: "Nenhuma conta TaskHS para este e-mail Microsoft. Fale com o administrador.",
  usuario_inativo: "Sua conta está inativa. Fale com o administrador.",
  falha_microsoft: "Falha na autenticação com a Microsoft. Tente novamente.",
};
```

Dentro do componente, depois dos `useState` existentes:

```tsx
  const [searchParams] = useSearchParams();
  const [ssoAtivo, setSsoAtivo] = useState(false);

  // Mensagem vinda do callback do SSO (o backend devolve aqui com ?erro=).
  useEffect(() => {
    const codigo = searchParams.get("erro");
    if (codigo) setError(ERROS_SSO[codigo] ?? "Não foi possível entrar. Tente novamente.");
  }, [searchParams]);

  // Sem app configurado no Azure, o botão nem aparece.
  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/sso/status")
      .then(r => setSsoAtivo(r.enabled))
      .catch(() => setSsoAtivo(false));
  }, []);
```

- [ ] **Step 2: Acrescentar o divisor e o botão**

Em `LoginPage.tsx`, logo **depois** do `</form>` e ainda dentro da `div` do card:

```tsx
            {ssoAtivo && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-border" />
                  <span className="text-xs text-slate-400 uppercase tracking-wide">ou</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-border" />
                </div>
                <a
                  href={`${API_BASE}/auth/microsoft`}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-background-elevated text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-background-surface active:scale-[0.98] transition-all duration-150"
                >
                  <svg className="w-4 h-4" viewBox="0 0 23 23" aria-hidden="true">
                    <path fill="#f25022" d="M0 0h11v11H0z" />
                    <path fill="#7fba00" d="M12 0h11v11H12z" />
                    <path fill="#00a4ef" d="M0 12h11v11H0z" />
                    <path fill="#ffb900" d="M12 12h11v11H12z" />
                  </svg>
                  Entrar com Microsoft
                </a>
              </>
            )}
```

É uma âncora, não um `button` com `fetch`: o fluxo é navegação de página inteira até a Microsoft, e XHR não segue redirect cross-origin.

- [ ] **Step 3: Entrada no changelog**

Em `frontend/src/data/changelog.ts`, **no topo** do array `CHANGELOG`:

```ts
  {
    version: "1.14.0",
    date: "2026-08-28",
    changes: [
      { kind: "novidade", text: "Agora dá para entrar no TaskHS com a conta Microsoft da empresa: na tela de login, clique em \"Entrar com Microsoft\" e use o mesmo e-mail e senha do Outlook — sem precisar decorar mais uma senha. O login por e-mail e senha continua funcionando normalmente. Só entra quem já tem usuário cadastrado no TaskHS; se o seu e-mail não estiver na lista, fale com o administrador." },
    ],
  },
```

- [ ] **Step 4: Verificar o build**

```bash
cd frontend && npm run build && npm run lint
```

Esperado: passa. O rodapé do login deve passar a mostrar `v1.14.0`.

- [ ] **Step 5: Verificação ponta a ponta (a que vale)**

Pré-requisito: no `backend/.env`, `MS_REDIRECT_URI=http://localhost:8000/api/auth/microsoft/callback` e `FRONTEND_URL=http://localhost:5173`; `docker compose up -d backend`.

1. Abrir `http://localhost:5173/login` → o botão "Entrar com Microsoft" aparece abaixo do divisor "ou".
2. Clicar → cai na tela da Microsoft → autenticar com a conta corporativa → volta e entra no sistema, com o nome certo na sidebar.
3. Conferir na barra de endereço que **em nenhum momento** apareceu `access_token=` — só `ticket=`.
4. Voltar (botão do navegador) para a URL do callback com o ticket já usado → deve aparecer a mensagem de erro com "Voltar para o login", não uma tela branca nem um logout silencioso.
5. Abrir `http://localhost:5173/login?erro=usuario_nao_encontrado` → mensagem "Nenhuma conta TaskHS para este e-mail Microsoft…".
6. Entrar como administrador e conferir em **Logs** que existe uma linha `login` com o resumo "…entrou no sistema via Microsoft".
7. Fazer logout e entrar por e-mail e senha → continua funcionando.
8. SSO desligado: comentar `MS_CLIENT_ID` no `backend/.env`, `docker compose up -d backend`
   (env muda sem rebuild),
   e conferir que `curl -s localhost:8000/api/auth/sso/status` devolve `{"enabled":false}`,
   que `curl -o /dev/null -w "%{http_code}" localhost:8000/api/auth/microsoft` devolve 503
   e que o botão some da tela de login. **Descomentar e reiniciar ao terminar.**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/data/changelog.ts
git commit -m "feat(sso): botao Entrar com Microsoft na tela de login (v1.14.0)"
```

---

## Depois do plano

Antes do merge, revisar a branch inteira e seguir a skill `superpowers:finishing-a-development-branch`.

No deploy (Easypanel), conferir que o serviço **backend** tem as cinco envs com os valores de **produção** (`MS_REDIRECT_URI` com o domínio `taskhsapi.healthsafetytech.com`, `FRONTEND_URL` com `taskhs.healthsafetytech.com`) e que `CORS_ORIGINS` inclui o domínio do front — sem isso o `POST /auth/sso/exchange` é bloqueado pelo navegador e o login trava na tela "Autenticando…".
