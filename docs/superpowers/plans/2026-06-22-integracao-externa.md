# Integração externa (espelhamento de cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor no TaskHS uma API genérica de integração que permite a sistemas externos (começando pelo GestorHS) criar/atualizar/mover/remover cards via upsert idempotente, autenticada por API key.

**Architecture:** Endpoints `/api/integration/*` protegidos por `X-API-Key`. `Card` ganha `external_source`+`external_id` (únicos juntos) como vínculo. `POST /api/integration/cards` faz upsert por `(source, external_id)`, criando board/lista por nome se faltarem. `DELETE` remove por `(source, external_id)`. Contrato documentado em `docs/integration.md`.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0, asyncpg, pydantic-settings. Frontend só para a entrada de changelog.

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-06-22-integracao-externa-design.md` — seguir à risca.
- **Sem suíte de testes** (CLAUDE.md). Verificação = curl + inspeção do banco + `npm run build` (changelog). NÃO criar pytest.
- **Backend roda em Docker** (`taskhs-backend-1`). Rebuild: `docker compose up -d --build`; esperar health: `until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done`.
- **`create_all` NÃO altera tabelas existentes.** A tabela `cards` já existe → as colunas novas exigem **migração SQL manual** aplicada no banco remoto (via `docker compose exec`).
- **Banco remoto de produção** (Easypanel). Limpar dados de teste (cards/boards/listas criados na verificação).
- **Autorização:** os endpoints de integração usam **só** `require_integration_key` (nunca `get_current_user`).
- **Deletar um card limpa `Notification`/`Reminder`/`ReminderSent` por `card_id`** — exatamente como o `delete_card` atual. **NÃO** deletar `Automation` (automações referenciam `trigger_list_id`/`board_id`, nunca `card_id`). *(O spec §4 mencionou "automations" por engano; o correto é não tocar nelas ao apagar um card.)*
- **Mover/criar card pela integração NÃO dispara o loop de automações** (escreve `card.list_id` direto, sem passar pelo `update_card`) — comportamento desejado no v1.
- **Convenção de changelog (CLAUDE.md):** a feature fecha com uma entrada nova em `frontend/src/data/changelog.ts`.
- **Tudo em pt-BR.** Login admin p/ obter dados de teste: `healthsafetyti@gmail.com` / `admin123` (token em `access_token`).
- **Commits** terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Vínculo externo no `Card` + migração

**Files:**
- Modify: `backend/app/models/card.py` (colunas + `__table_args__`)
- Modify: `backend/app/routers/cards.py` (`_card_to_dict` expõe os campos)
- Create: `backend/migrations/002_card_external_ref.sql`

**Interfaces:**
- Produces: `Card.external_source: str | None`, `Card.external_id: str | None`, unique `uq_card_external (external_source, external_id)`.

- [ ] **Step 1: Adicionar as colunas ao model**

Em `backend/app/models/card.py`: garantir `UniqueConstraint` no import do sqlalchemy (linha 3 já importa vários nomes — adicionar `UniqueConstraint`):
```python
from sqlalchemy import String, ForeignKey, Float, DateTime, Date, Text, Boolean, Enum as SAEnum, Integer, UniqueConstraint
```
Na classe `Card`, logo após `__tablename__ = "cards"`, adicionar:
```python
    __table_args__ = (UniqueConstraint("external_source", "external_id", name="uq_card_external"),)
```
E, junto às outras colunas (após `archived`), adicionar:
```python
    external_source: Mapped[str | None] = mapped_column(String(50))
    external_id: Mapped[str | None] = mapped_column(String(100))
```

- [ ] **Step 2: Expor no `_card_to_dict`**

Em `backend/app/routers/cards.py`, no dict retornado por `_card_to_dict`, adicionar (após `"archived": card.archived,`):
```python
        "external_source": card.external_source,
        "external_id": card.external_id,
```

- [ ] **Step 3: Criar o arquivo de migração**

`backend/migrations/002_card_external_ref.sql`:
```sql
-- Vínculo de cards com entidades de sistemas externos (integração).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
-- Um card por (source, external_id). NULLs múltiplos são permitidos (cards normais).
ALTER TABLE cards ADD CONSTRAINT uq_card_external UNIQUE (external_source, external_id);
```

- [ ] **Step 4: Rebuildar e aplicar a migração no banco**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import engine
async def main():
    async with engine.begin() as conn:
        await conn.execute(text('ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_source VARCHAR(50)'))
        await conn.execute(text('ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_id VARCHAR(100)'))
        try:
            await conn.execute(text('ALTER TABLE cards ADD CONSTRAINT uq_card_external UNIQUE (external_source, external_id)'))
        except Exception as e:
            print('constraint (ok se já existia):', e)
asyncio.run(main())
print('migração aplicada')
"
```
Expected: imprime `migração aplicada` (a linha de constraint pode avisar se já existia — ok).

- [ ] **Step 5: Verificar colunas + regressão**

```bash
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select column_name from information_schema.columns where table_name='cards' and column_name like 'external%' order by column_name\"))
        print([row[0] for row in r.fetchall()])
asyncio.run(main())
"
```
Expected: `['external_id', 'external_source']`.
Regressão: o login e a listagem de cards de um board continuam funcionando (o `_card_to_dict` agora inclui os dois campos):
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# pegar um list_id qualquer e listar cards — deve retornar 200 com external_source/external_id (null) nos cards
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json;b=json.load(sys.stdin);print("boards ok:",len(b))'
```
Expected: `boards ok: N` (sem erro 500).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/card.py backend/app/routers/cards.py backend/migrations/002_card_external_ref.sql
git commit -m "feat(integracao): vínculo externo no Card (external_source/external_id) + migração

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Config (API key) + dependency + schemas

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/app/dependencies.py`
- Create: `backend/app/schemas/integration.py`

**Interfaces:**
- Produces: `settings.INTEGRATION_API_KEY: str`, `settings.INTEGRATION_OWNER_ID: int`; dependency `require_integration_key`; schemas `IntegrationCardIn`, `IntegrationCardRef`.

- [ ] **Step 1: Envs no config**

Em `backend/app/core/config.py`, na classe `Settings`, após `CORS_ORIGINS`:
```python
    # integração externa (espelhamento de cards via API key)
    INTEGRATION_API_KEY: str = ""
    INTEGRATION_OWNER_ID: int = 1
```

- [ ] **Step 2: Documentar no `.env.example`**

Em `backend/.env.example`, adicionar ao final:
```
# Integração externa (espelhamento de cards). Gere com: openssl rand -hex 32
# Vazio = integração desligada (endpoints /api/integration respondem 401).
INTEGRATION_API_KEY=
# Usuário (id) dono dos boards criados automaticamente pela integração.
INTEGRATION_OWNER_ID=1
```

- [ ] **Step 3: Dependency da API key**

Em `backend/app/dependencies.py`, adicionar (o import de `Header` no topo e a função ao final):
```python
from fastapi import Header
```
```python
async def require_integration_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    from app.core.config import settings
    if not settings.INTEGRATION_API_KEY or x_api_key != settings.INTEGRATION_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key inválida")
```

- [ ] **Step 4: Schemas da integração**

`backend/app/schemas/integration.py`:
```python
from datetime import date
from pydantic import BaseModel
from app.models.card import Priority


class IntegrationCardIn(BaseModel):
    source: str
    external_id: str
    board: str
    list: str
    title: str
    description: str | None = None
    due_date: date | None = None
    priority: Priority | None = None


class IntegrationCardRef(BaseModel):
    source: str
    external_id: str
```

- [ ] **Step 5: Rebuildar e verificar import limpo**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
docker compose exec -T backend python -c "
from app.core.config import settings
from app.dependencies import require_integration_key
from app.schemas.integration import IntegrationCardIn, IntegrationCardRef
print('owner', settings.INTEGRATION_OWNER_ID, '| key set:', bool(settings.INTEGRATION_API_KEY))
print('schemas ok')
"
```
Expected: imprime `owner 1 | key set: False` (a key ainda não foi setada no `.env`) e `schemas ok`, sem erro de import.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/config.py backend/.env.example backend/app/dependencies.py backend/app/schemas/integration.py
git commit -m "feat(integracao): config da API key + dependency + schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Router de integração (upsert + delete)

**Files:**
- Create: `backend/app/routers/integration.py`
- Modify: `backend/app/main.py` (import + include_router)
- Modify (local, não commitado): `backend/.env` (setar `INTEGRATION_API_KEY` para testar)

**Interfaces:**
- Consumes: `require_integration_key`, `IntegrationCardIn`/`IntegrationCardRef` (Task 2); `Card.external_*` (Task 1); `_card_options`/`_card_to_dict` de `routers/cards.py`.
- Produces: `POST /api/integration/cards` (upsert), `DELETE /api/integration/cards` (remoção).

- [ ] **Step 1: Criar o router**

`backend/app/routers/integration.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from app.database import get_db
from app.dependencies import require_integration_key
from app.core.config import settings
from app.models.board import Board
from app.models.list import List
from app.models.card import Card, Priority
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.schemas.integration import IntegrationCardIn, IntegrationCardRef
from app.routers.cards import _card_options, _card_to_dict

router = APIRouter(prefix="/integration", tags=["integration"], dependencies=[Depends(require_integration_key)])


async def _ensure_board(db: AsyncSession, name: str) -> Board:
    board = (await db.execute(
        select(Board).where(Board.title == name).order_by(Board.id).limit(1)
    )).scalar_one_or_none()
    if board is None:
        board = Board(title=name, owner_id=settings.INTEGRATION_OWNER_ID)
        db.add(board)
        await db.flush()
    return board


async def _ensure_list(db: AsyncSession, board_id: int, name: str) -> List:
    lst = (await db.execute(
        select(List).where(List.board_id == board_id, List.title == name).order_by(List.id).limit(1)
    )).scalar_one_or_none()
    if lst is None:
        last = (await db.execute(
            select(List.position).where(List.board_id == board_id).order_by(List.position.desc()).limit(1)
        )).scalar_one_or_none()
        lst = List(board_id=board_id, title=name, position=(last or 0) + 1)
        db.add(lst)
        await db.flush()
    return lst


async def _last_position(db: AsyncSession, list_id: int) -> float:
    last = (await db.execute(
        select(Card.position).where(Card.list_id == list_id).order_by(Card.position.desc()).limit(1)
    )).scalar_one_or_none()
    return (last or 0.0) + 65536.0


@router.post("/cards")
async def upsert_card(body: IntegrationCardIn, db: AsyncSession = Depends(get_db)):
    sent = body.model_dump(exclude_unset=True)
    board = await _ensure_board(db, body.board)
    lst = await _ensure_list(db, board.id, body.list)
    card = (await db.execute(
        select(Card).where(Card.external_source == body.source, Card.external_id == body.external_id)
    )).scalar_one_or_none()
    if card is None:
        card = Card(
            list_id=lst.id,
            title=body.title,
            description=body.description,
            due_date=body.due_date,
            priority=body.priority or Priority.medium,
            position=await _last_position(db, lst.id),
            external_source=body.source,
            external_id=body.external_id,
        )
        db.add(card)
    else:
        card.title = body.title
        if "description" in sent:
            card.description = body.description
        if "due_date" in sent:
            card.due_date = body.due_date
        if "priority" in sent and body.priority is not None:
            card.priority = body.priority
        if card.list_id != lst.id:
            card.list_id = lst.id
            card.position = await _last_position(db, lst.id)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.delete("/cards", status_code=status.HTTP_204_NO_CONTENT)
async def delete_external_card(body: IntegrationCardRef, db: AsyncSession = Depends(get_db)):
    card = (await db.execute(
        select(Card).where(Card.external_source == body.source, Card.external_id == body.external_id)
    )).scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    cid = card.id
    await db.execute(sql_delete(Notification).where(Notification.card_id == cid))
    await db.execute(sql_delete(Reminder).where(Reminder.card_id == cid))
    await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id == cid))
    await db.delete(card)
    await db.commit()
```

- [ ] **Step 2: Registrar no `main.py`**

Em `backend/app/main.py`, adicionar `integration` ao import dos routers:
```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders, automations, integration
```
E o include (junto dos outros):
```python
app.include_router(integration.router, prefix="/api")
```

- [ ] **Step 3: Setar uma key de teste e rebuildar**

Adicionar ao `backend/.env` (arquivo local, **não** versionado) uma key de teste e rebuildar para o backend carregá-la:
```bash
echo 'INTEGRATION_API_KEY=test-integration-key-123' >> backend/.env
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
```

- [ ] **Step 4: Verificar autenticação + upsert + move + delete (curl)**

```bash
KEY='test-integration-key-123'
B='Ordens de Serviço (teste integração)'   # board descartável p/ limpar depois
# (a) sem key -> 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -d "{\"source\":\"gestorhs\",\"external_id\":\"t1\",\"board\":\"$B\",\"list\":\"Recebido\",\"title\":\"OS t1\"}"
# (b) key errada -> 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H 'X-API-Key: errada' -d "{\"source\":\"gestorhs\",\"external_id\":\"t1\",\"board\":\"$B\",\"list\":\"Recebido\",\"title\":\"OS t1\"}"
# (c) upsert cria board+lista+card -> 200
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"gestorhs\",\"external_id\":\"t1\",\"board\":\"$B\",\"list\":\"Recebido\",\"title\":\"OS t1 · Cliente X\",\"due_date\":\"2030-01-01\",\"priority\":\"high\"}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("criado id",c["id"],"list",c["list_id"],"prio",c["priority"])'
# (d) upsert de novo mudando a lista -> MOVE (mesmo id), nova lista
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"gestorhs\",\"external_id\":\"t1\",\"board\":\"$B\",\"list\":\"Laboratório\",\"title\":\"OS t1 · Cliente X\"}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("apos move id",c["id"],"list",c["list_id"])'
# (e) prioridade inválida -> 422
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"gestorhs\",\"external_id\":\"t2\",\"board\":\"$B\",\"list\":\"Recebido\",\"title\":\"x\",\"priority\":\"urgentissimo\"}"
# (f) delete existente -> 204 ; inexistente -> 404
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d '{"source":"gestorhs","external_id":"t1"}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d '{"source":"gestorhs","external_id":"nao-existe"}'
```
Expected: (a) `401`; (b) `401`; (c) `criado id … list … prio Priority.high`; (d) `apos move id <mesmo id> list <id diferente>`; (e) `422`; (f) `204` depois `404`.

Limpeza: apagar o board de teste e seus cards/listas (via API admin ou SQL). Ex.: descobrir o board pelo título e `DELETE /api/boards/{id}` com o token admin:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;[print(b['id'],b['title']) for b in json.load(sys.stdin)]"
# DELETE /api/boards/<id_do_board_de_teste> com o token
```
Confirmar que o board de teste foi removido.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/integration.py backend/app/main.py
git commit -m "feat(integracao): endpoints upsert e delete de cards externos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Documentação do contrato + changelog

**Files:**
- Create: `docs/integration.md`
- Modify: `frontend/src/data/changelog.ts` (entrada v1.1.0)

**Interfaces:**
- Consumes: o contrato implementado nas Tasks 1–3.

- [ ] **Step 1: Documento de contrato**

`docs/integration.md`:
```markdown
# Integração externa — espelhamento de cards

Sistemas externos (ex.: GestorHS) podem criar/atualizar/remover cards no TaskHS.
O TaskHS é um **espelho**: o sistema externo é o dono da verdade e envia o
**estado atual completo** da entidade a cada mudança (upsert idempotente).

## Autenticação

Header `X-API-Key: <chave>`. A chave fica na env `INTEGRATION_API_KEY` do
backend do TaskHS (vazia = integração desligada → 401). Use HTTPS em produção.

## `POST /api/integration/cards` — criar/atualizar/mover

Identidade do card = par `(source, external_id)`. O board e a lista são
resolvidos **por nome** (criados se não existirem). Se o card já existe e a
lista mudou, ele é **movido**.

Campos: `source`*, `external_id`*, `board`*, `list`*, `title`* (obrigatórios);
`description`, `due_date` (ISO `YYYY-MM-DD`), `priority`
(`critical|high|medium|low`, default `medium`) opcionais. Campos opcionais
omitidos não sobrescrevem o valor atual; envie `null` para limpar.

```bash
curl -X POST https://<taskhs>/api/integration/cards \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{
    "source": "gestorhs",
    "external_id": "1234",
    "board": "Ordens de Serviço",
    "list": "Laboratório",
    "title": "OS #1234 · Cliente X · Bafômetro SN-987",
    "description": "Calibração — chegada 22/06.",
    "due_date": "2026-07-10",
    "priority": "high"
  }'
```
Resposta `200`: o card serializado (inclui `id`, `list_id`, `external_source`, `external_id`).

## `DELETE /api/integration/cards` — remover

Para quando a entidade externa é excluída. Cancelar/finalizar **não** usa este
endpoint — basta enviar outra `list` no upsert (ex.: "Cancelada").

```bash
curl -X DELETE https://<taskhs>/api/integration/cards \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{ "source": "gestorhs", "external_id": "1234" }'
```
Resposta `204` (ou `404` se não houver card vinculado).

## Exemplo de mapa fase→lista (GestorHS — regra vive no GestorHS)

| Fase da OS (GestorHS) | `list` enviada |
|---|---|
| Recebido | Recebido |
| Laboratório | Laboratório |
| Pós-Vendas | Pós-Vendas |
| Preparando Retorno | Preparando Retorno |
| Finalizada | Finalizada |
| Cancelada | Cancelada |

O GestorHS chama o upsert ao abrir a OS e a cada avanço de fase/atualização,
enviando a `list` correspondente à fase atual. Recomenda-se best-effort
(logar falhas); como o upsert é idempotente, a próxima atualização reconcilia.
```

- [ ] **Step 2: Entrada de changelog v1.1.0**

Em `frontend/src/data/changelog.ts`, adicionar como **primeiro** item do array `CHANGELOG` (antes da v1.0.1):
```ts
  {
    version: "1.1.0",
    date: "2026-06-22",
    changes: [
      { kind: "novidade", text: "Integração com sistemas externos: o GestorHS (e outros) podem abrir e atualizar cards automaticamente via API." },
    ],
  },
```

- [ ] **Step 3: Build do frontend**

Run (de `frontend/`): `npm run build`
Expected: PASSA (a versão exibida passa a ser `1.1.0`).

- [ ] **Step 4: Commit**

```bash
git add docs/integration.md frontend/src/data/changelog.ts
git commit -m "docs(integracao): contrato da API + changelog v1.1.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas finais

- Após as 4 tasks: revisão final de branch (subagent-driven → final code review) e **finishing-a-development-branch** (merge na `main` + push).
- **Deploy (Easypanel):** setar `INTEGRATION_API_KEY` (e, se preciso, `INTEGRATION_OWNER_ID`) nas envs do backend em produção, e rodar a migração `002_card_external_ref.sql` no banco de produção (o mesmo banco remoto já recebeu a migração durante a Task 1, já que dev=prod hoje — confirmar).
- A `INTEGRATION_API_KEY` de teste adicionada ao `backend/.env` local deve ser trocada por uma real (gerada com `openssl rand -hex 32`) quando for ligar o GestorHS de verdade.
