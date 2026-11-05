# Token de agente do HS.OS — plano de implementação

> **Para quem executa:** use superpowers:subagent-driven-development. Os passos têm checkbox (`- [ ]`).

**Objetivo:** o TaskHS aceita o JWT EdDSA do HS.OS como a própria pessoa, recusa esse token nas rotas de gestão e ganha o `GET /api/cards/minhas`.

**Arquitetura:** a função pura `validar_token_de_agente` fica em `app/core/agente.py` e é coberta por pytest sem banco. O `get_current_user` escolhe o caminho pelo `iss` não verificado. A dependência `bloquear_token_de_agente` dá 403 e é pendurada nas rotas de gestão e dentro de `get_admin_user`/`get_elevated_user`. O endpoint de "minhas tarefas" ganha um router próprio.

**Stack:** FastAPI async, SQLAlchemy 2.0, PyJWT (EdDSA) + cryptography, pytest só para o token.

**Spec:** `docs/superpowers/specs/2026-11-05-token-de-agente-hsos-design.md`. Leia antes de começar.

## Restrições globais

- O repo é **PÚBLICO**: nunca escreva credencial, chave privada, `DATABASE_URL` ou senha em arquivo versionado. Chave de teste só gerada em tempo de execução.
- **Dev = banco de produção:** na verificação manual, só GET (e o POST de `/auth/login`, que é recusado com 403 antes de tocar no banco). Nada de escrita.
- O token HS256 normal continua **exatamente** como está.
- Env: `HSOS_AGENTE_CHAVE_PUBLICA`; `iss="hsos"`; `aud="taskhs"`; algoritmo `EdDSA`.
- Mensagens de erro em português: 401 `"Token de agente inválido"`; 403 `"Ação não permitida para o agente"`.
- `app/core/agente.py` **não importa** `app.core.config` nem nada do banco, para o pytest rodar sem `.env`.
- Sem suíte além de `backend/tests/test_token_agente.py`. O build do front (`npm run build`) precisa passar depois do changelog.

## Foco do review

- Bearer com `iss=hsos` que não seja um JWT válido (lixo base64, sem payload) → 401, nunca 500.
- Env com a chave vazia ou com PEM malformado → 401 no token de agente, nunca 500 e nunca aceitar.
- `alg` trocado no cabeçalho (ex.: HS256 assinado com a chave pública como segredo) → 401, porque `algorithms=["EdDSA"]` é fixo.
- Token de agente com `sub` de usuário inativo ou inexistente → 401.
- `/cards/minhas` para um não-elevado nunca devolve card de quadro em que ele não é membro, mesmo sendo membro do card.

---

### Task 1: validação do token e entrada como a pessoa

**Arquivos:**
- Criar: `backend/app/core/agente.py`, `backend/tests/__init__.py` (vazio), `backend/tests/test_token_agente.py`, `backend/requirements-dev.txt` (`-r requirements.txt` + `pytest==8.3.4`)
- Modificar: `backend/requirements.txt` (somar `PyJWT[crypto]==2.15.1` e `cryptography==45.0.7`, as versões que já estão no container), `backend/app/core/config.py` (`HSOS_AGENTE_CHAVE_PUBLICA: str = ""`), `backend/.env.example` (a variável vazia, com comentário), `backend/app/dependencies.py` (`get_current_user`), `backend/app/audit_context.py` (`Actor.via`), `backend/app/audit.py` (sufixo no summary)

**Interfaces:**
- Produz: `class TokenDeAgenteInvalido(Exception)`; `eh_token_de_agente(token: str) -> bool` (payload sem verificar, `iss == "hsos"`; token ilegível → `False`); `validar_token_de_agente(token: str, chave_pem: str) -> tuple[str, str]` → `(email, bot)` ou lança `TokenDeAgenteInvalido`; `set_actor_via(via: str | None) -> None` em `audit_context.py`.

- [ ] **Passo 1: criar a venv local e escrever os testes que falham**

`python3 -m venv backend/.venv && backend/.venv/bin/pip install -q -r backend/requirements-dev.txt` (se algum pacote do requirements não compilar no Python local, instale só `PyJWT[crypto] cryptography pytest`; o teste só precisa deles).

Uma fixture gera um par `Ed25519PrivateKey.generate()` e devolve o PEM público. O helper `emitir(**sobrescreve)` assina com `jwt.encode(..., algorithm="EdDSA")` o payload base `{iss:"hsos", aud:"taskhs", sub:"fulano@healthsafetytech.com", act:{sub:"erick-bot"}, iat, exp: agora+300, jti}`. Os testes:
- `test_token_valido_devolve_email_e_bot` → `== ("fulano@healthsafetytech.com", "erick-bot")`
- `test_aud_errado`, `test_vencido` (exp = agora−10), `test_iss_errado` (`"outro"`), `test_chave_errada` (assinado com outro par), `test_sem_exp` (sem a chave `exp`), `test_sem_act` → `pytest.raises(TokenDeAgenteInvalido)`
- `test_chave_vazia` (`chave_pem=""`) e `test_chave_malformada` (`"lixo"`) → `TokenDeAgenteInvalido`
- `test_hs256_com_chave_publica_como_segredo` (assinado em HS256 usando o PEM como segredo) → `TokenDeAgenteInvalido`
- `test_chave_com_barra_n_escapado` (PEM com `"\n"` trocado por `"\\n"`) → válido
- `test_eh_token_de_agente`: `True` para o token de agente; `False` para um HS256 com `{"sub": "x"}`; `False` para `"lixo"` e para `""`.

- [ ] **Passo 2: rodar** `cd backend && .venv/bin/python -m pytest tests -q`. Esperado: falha de import (`app.core.agente` ainda não existe).

- [ ] **Passo 3: implementar `app/core/agente.py`**

Use PyJWT: `jwt.decode(token, chave, algorithms=["EdDSA"], audience="taskhs", issuer="hsos", options={"require": ["exp", "sub", "iss", "aud"]})`. A chave passa antes por `.replace("\\n", "\n").strip()`. Qualquer `jwt.PyJWTError`, `ValueError` ou `TypeError` vira `TokenDeAgenteInvalido`. `act.sub` precisa ser string não vazia, e `sub` também. `eh_token_de_agente` usa `jwt.decode(token, options={"verify_signature": False})` dentro de `try` e só devolve `True` para `isinstance(dict)` com `iss == "hsos"`.

- [ ] **Passo 4: rodar os testes.** Esperado: todos passam.

- [ ] **Passo 5: ligar no `get_current_user`**

Com `eh_token_de_agente(token)`: chamar `validar_token_de_agente(token, settings.HSOS_AGENTE_CHAVE_PUBLICA)`. `TokenDeAgenteInvalido` vira 401 `"Token de agente inválido"`. Buscar `User.email == email, User.is_active == True` (sem lower); se não achar, 401. Depois `set_actor_identity("usuario", ...)`, `set_actor_via(bot)` e `logger.info("token de agente: %s via %s", email, bot)` (logger `taskhs.agente`). Sem agente, o código de hoje fica intacto.

`Actor` ganha `via: str | None = None`. Em `_audit_after_flush`, `summary` passa a ser `f"{summary} (via {actor.via})"` quando `actor.via` existe e `summary` não é `None`.

- [ ] **Passo 6: rebuild e fumaça** `docker compose up -d --build`, depois `curl -s localhost:8000/api/health`. Esperado: ok. Um Bearer `iss=hsos` qualquer em `GET /api/auth/me` leva 401 (a env está vazia no local).

- [ ] **Passo 7: commit** `feat(auth): aceitar token de agente do HS.OS (EdDSA)`.

### Task 2: recusar o agente nas rotas de gestão

**Arquivos:**
- Modificar: `backend/app/dependencies.py`, `backend/app/routers/auth.py`, `backend/app/routers/boards.py`, `backend/app/routers/automations.py`

**Interfaces:**
- Consome: `eh_token_de_agente` (Task 1).
- Produz: `async def bloquear_token_de_agente(request: Request) -> None` em `dependencies.py`. Lê `Authorization: Bearer <t>` (case-insensitive no esquema); sem cabeçalho, segue; com `eh_token_de_agente(t)`, dá 403 `"Ação não permitida para o agente"`.

- [ ] **Passo 1: implementar a dependência.**
- [ ] **Passo 2: aplicar exatamente onde a spec manda** ("Onde o agente é recusado"):
  - `auth.py`: `dependencies=[Depends(bloquear_token_de_agente)]` no decorador de `register`, `login`, `PATCH /me`, `POST/DELETE /me/avatar`, `/sso/status`, `/microsoft`, `/microsoft/callback` e `/sso/exchange`. **Não** em `GET /me` nem em `GET /users/basic`.
  - `get_admin_user` e `get_elevated_user`: recebem `request: Request` e chamam `await bloquear_token_de_agente(request)` **antes** da checagem de papel (o agente de um admin também leva 403).
  - `automations.py`: soma a dependência no `dependencies=[...]` do `APIRouter`.
  - `boards.py`: nos decoradores de `POST ""`, `POST /import`, `PATCH /{id}`, `PUT /{id}/done-lists`, `PUT /{id}/list-setores`, `POST /{id}/archive`, `POST /{id}/unarchive`, `DELETE /{id}`, `POST /{id}/members` e `DELETE /{id}/members/{user_id}`.
- [ ] **Passo 3: verificar** com `docker compose up -d --build` e um token de agente qualquer (`iss=hsos`, sem assinatura válida): `POST /api/auth/login` (corpo qualquer), `GET /api/auth/users`, `GET /api/boards/1/automations` e `PATCH /api/boards/1` → **403**; `GET /api/auth/me` → **401** (passa pelo caminho de validação e falha na assinatura, o que prova que não foi bloqueado). Sem token, `POST /api/auth/login` com credencial errada → 401 como hoje.
- [ ] **Passo 4: commit** `feat(auth): recusar token de agente nas rotas de gestão`.

### Task 3: `GET /api/cards/minhas` + changelog

**Arquivos:**
- Criar: `backend/app/routers/minhas.py`, `backend/app/schemas/minhas.py`
- Modificar: `backend/app/main.py` (`include_router`), `frontend/src/data/changelog.ts`

**Interfaces:**
- Produz: `GET /api/cards/minhas?abertas=true` → `list[MinhaTarefaOut]`, com `MinhaTarefaOut = {id:int, title:str, board_id:int, board_title:str, list_id:int, list_title:str, due_date:date|None, due_date_completed:bool, priority:str, done:bool}`.

- [ ] **Passo 1: implementar** uma única query (JOIN `Card`→`ListModel`→`Board`, `EXISTS` em `CardMember` do usuário). Para não-elevado, também `EXISTS` em `BoardMember(board_id, user_id)`. Filtros, ordem e limite exatamente como na seção "`GET /api/cards/minhas`" da spec. Prioridade em ordem: `case` critical=0, high=1, medium=2, low=3. Usar `get_current_user`, **não** os gates de lista. Antes, conferir em `main.py` que nenhuma rota `/cards/...` existente conflita.
- [ ] **Passo 2: verificar** (leitura, banco de produção): com um token HS256 do admin `healthsafetyti@gmail.com` gerado dentro do container (`docker compose exec -T backend python -c "from app.core.security import create_access_token; print(create_access_token('healthsafetyti@gmail.com'))"`; **não** usar `/auth/login`, que grava audit no banco de produção), `GET /api/cards/minhas` e `?abertas=false` → 200 com o formato acima, e `abertas=false` devolve ≥ do que `abertas=true`. Comparar a contagem com `./scripts/psql-dev.sh` (cards vivos do usuário em `card_members`).
- [ ] **Passo 3: changelog** com `version: "2.13.0"`, `date: "2026-11-05"`. Uma `novidade`: assistentes do HS.OS podem consultar e trabalhar nos cards em nome da pessoa, sem acesso a gestão. Uma `novidade`: endpoint de "minhas tarefas" para integrações. Depois `cd frontend && npm run build`, que precisa passar.
- [ ] **Passo 4: commit** `feat(cards): GET /cards/minhas + changelog v2.13.0`.
