# Integração — arquivar card via upsert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que sistemas externos arquivem/desarquivem um card pelo upsert da integração, enviando um campo opcional `archived` (para "OS cancelada → arquivar card").

**Architecture:** Adiciona o campo opcional `archived` ao schema `IntegrationCardIn` e aplica em um ponto só (`_apply_updates`, que cobre update normal + recuperação de corrida) e no caminho de criação do `POST /api/integration/cards`.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0, Pydantic v2; frontend só para o changelog.

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-06-26-integracao-arquivar-design.md` — seguir à risca.
- **Sem suíte de testes** (CLAUDE.md). Verificação = curl + `npm run build`. NÃO criar pytest.
- **Backend roda em Docker** (`taskhs-backend-1`). Rebuild: `docker compose up -d --build`; esperar health: `until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done`.
- **`archived` é ortogonal** ao board/lista/move: um card arquivado ainda tem `list_id`. `list` continua obrigatório no payload.
- **Semântica:** `archived: true` arquiva, `false` desarquiva, **omitido não altera**; card novo nasce `false` (ou `true` se enviado).
- **Banco remoto de produção** — limpar dados de teste criados na verificação.
- **`backend/.env`** tem a key de teste `INTEGRATION_API_KEY=test-integration-key-123` (gitignored) — usar nos curls; não commitar `.env`.
- **Convenção de changelog (CLAUDE.md):** fecha com entrada nova em `frontend/src/data/changelog.ts`.
- **Tudo em pt-BR.** Commits terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Campo `archived` no upsert

**Files:**
- Modify: `backend/app/schemas/integration.py` (campo no `IntegrationCardIn`)
- Modify: `backend/app/routers/integration.py` (`_apply_updates` + caminho de create)

**Interfaces:**
- Produces: `IntegrationCardIn.archived: bool | None`; upsert passa a aplicar `archived`.

- [ ] **Step 1: Adicionar o campo ao schema**

Em `backend/app/schemas/integration.py`, na classe `IntegrationCardIn`, adicionar o campo (após `priority`):
```python
    archived: bool | None = None
```
O resultado da classe fica:
```python
class IntegrationCardIn(BaseModel):
    source: str
    external_id: str
    board: str
    list: str
    title: str
    description: str | None = None
    due_date: date | None = None
    priority: Priority | None = None
    archived: bool | None = None
```

- [ ] **Step 2: Aplicar no update (`_apply_updates`)**

Em `backend/app/routers/integration.py`, na função `_apply_updates`, adicionar o tratamento de `archived` logo após o bloco de `priority` e antes do bloco de move de lista. O corpo passa a ser:
```python
async def _apply_updates(card: Card, body: IntegrationCardIn, sent: dict, lst: "List", db: AsyncSession) -> None:
    """Apply upsert fields to an existing card (shared by normal update and IntegrityError recovery)."""
    card.title = body.title
    if "description" in sent:
        card.description = body.description
    if "due_date" in sent:
        card.due_date = body.due_date
    if "priority" in sent and body.priority is not None:
        card.priority = body.priority
    if "archived" in sent:
        card.archived = body.archived
    if card.list_id != lst.id:
        card.list_id = lst.id
        card.position = await _last_position(db, lst.id)
```

- [ ] **Step 3: Aplicar no create**

Em `backend/app/routers/integration.py`, dentro de `upsert_card`, no ramo `if card is None:`, adicionar `archived=body.archived or False,` ao construtor do `Card`. O bloco fica:
```python
        card = Card(
            list_id=lst.id,
            title=body.title,
            description=body.description,
            due_date=body.due_date,
            priority=body.priority or Priority.medium,
            position=await _last_position(db, lst.id),
            external_source=body.source,
            external_id=body.external_id,
            archived=body.archived or False,
        )
```

- [ ] **Step 4: Rebuildar e verificar (curl)**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
KEY=$(grep '^INTEGRATION_API_KEY=' backend/.env | cut -d= -f2-)
B="ZZ Arquivar Teste $(date +%s)"
# (a) create normal -> archived false
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"arqtest\",\"external_id\":\"a1\",\"board\":\"$B\",\"list\":\"Ativas\",\"title\":\"OS a1\"}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("create archived=",c["archived"])'
# (b) upsert archived:true -> arquiva (mesmo id)
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"arqtest\",\"external_id\":\"a1\",\"board\":\"$B\",\"list\":\"Ativas\",\"title\":\"OS a1\",\"archived\":true}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("after true archived=",c["archived"])'
# (c) upsert SEM archived -> nao muda (continua true)
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"arqtest\",\"external_id\":\"a1\",\"board\":\"$B\",\"list\":\"Ativas\",\"title\":\"OS a1 editada\"}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("after omit archived=",c["archived"],"title=",c["title"])'
# (d) upsert archived:false -> desarquiva
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"arqtest\",\"external_id\":\"a1\",\"board\":\"$B\",\"list\":\"Ativas\",\"title\":\"OS a1\",\"archived\":false}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("after false archived=",c["archived"])'
# (e) create novo ja arquivado
curl -s -X POST http://localhost:8000/api/integration/cards -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d "{\"source\":\"arqtest\",\"external_id\":\"a2\",\"board\":\"$B\",\"list\":\"Ativas\",\"title\":\"OS a2\",\"archived\":true}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("create archived true ->",c["archived"])'
echo "BOARD=$B (limpar depois)"
```
Expected: (a) `create archived= False`; (b) `after true archived= True`; (c) `after omit archived= True title= OS a1 editada`; (d) `after false archived= False`; (e) `create archived true -> True`.

Limpeza: apagar o board de teste. Descobrir o id no banco e apagar via API admin:
```bash
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select id from boards where title like 'ZZ Arquivar Teste%'\"))
        print([x[0] for x in r.fetchall()])
asyncio.run(main())
"
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"$TASKHS_ADMIN_EMAIL\",\"password\":\"$TASKHS_ADMIN_PW\"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# DELETE /api/boards/<id> para cada id retornado, com o token
```
Confirmar que não sobrou board `ZZ Arquivar Teste%` no banco.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/integration.py backend/app/routers/integration.py
git commit -m "feat(integracao): campo archived no upsert (arquivar/desarquivar card)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Documentação + changelog

**Files:**
- Modify: `docs/integration.md` (campo na tabela + nota cancelar→arquivar + pseudo-código)
- Modify: `frontend/src/data/changelog.ts` (entrada v1.1.1)

**Interfaces:**
- Consumes: o campo `archived` implementado na Task 1.

- [ ] **Step 1: Documentar o campo na tabela do upsert**

Em `docs/integration.md`, na seção **3.1**, na tabela "Corpo (campos)", adicionar uma linha após `priority`:
```markdown
| `archived` | bool \| null | — | `true` arquiva o card (some do quadro), `false` desarquiva. Omitido = não altera. |
```

- [ ] **Step 2: Nota cancelar→arquivar**

Em `docs/integration.md`, na seção **3.2** (`DELETE`), ajustar a frase sobre cancelar/finalizar para apontar o arquivamento. Substituir:
```markdown
Para quando a entidade externa é **excluída**. **Cancelar/finalizar não usa este
endpoint** — basta mandar outra `list` no upsert (ex.: `"Cancelada"`).
```
por:
```markdown
Para quando a entidade externa é **excluída** de vez. **Cancelar não usa este
endpoint** — mande um upsert com `"archived": true` para **arquivar** o card (some
do quadro, fica em "Arquivados"); reative com `"archived": false`. Mudança de
fase/status continua sendo só outra `list` no upsert.
```

- [ ] **Step 3: Atualizar o pseudo-código do GestorHS**

Em `docs/integration.md`, na seção **6**, no `payload` da função `espelhar_os_no_taskhs`, adicionar a linha de `archived` (uma OS na fase Cancelada vira card arquivado). Adicionar, após a linha de `priority`, dentro do dict `payload`:
```python
        "archived": os.fase == 9,   # 9 = Cancelada → arquiva o card
```

- [ ] **Step 4: Entrada de changelog v1.1.1**

Em `frontend/src/data/changelog.ts`, adicionar como **primeiro** item do array `CHANGELOG` (antes da v1.1.0):
```ts
  {
    version: "1.1.1",
    date: "2026-06-26",
    changes: [
      { kind: "melhoria", text: "Integração: sistemas externos podem arquivar/desarquivar um card (ex.: OS cancelada no GestorHS arquiva o card)." },
    ],
  },
```

- [ ] **Step 5: Build do frontend**

Run (de `frontend/`): `npm run build`
Expected: PASSA (a versão exibida passa a ser `1.1.1`).

- [ ] **Step 6: Commit**

```bash
git add docs/integration.md frontend/src/data/changelog.ts
git commit -m "docs(integracao): documenta archived + changelog v1.1.1

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas finais

- Após as 2 tasks: revisão final de branch → **finishing-a-development-branch** (merge na `main` + push).
- Nada a fazer no banco (a coluna `archived` já existe). Nada a fazer no deploy além do código novo.
