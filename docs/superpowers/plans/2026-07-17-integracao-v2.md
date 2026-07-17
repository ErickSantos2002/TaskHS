# Integração v2: id em vez de nome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A API de integração recebe `list_id` em vez dos nomes do quadro e da lista, e
deixa de criar quadro ou lista sozinha — trocando um fantasma silencioso por um 404 alto.

**Architecture:** `_ensure_board`/`_ensure_list` morrem; a lista é resolvida por id ou dá
404. Junto, o upsert passa a respeitar a invariante de membros ao mover um card entre
quadros (o mesmo filtro que o `update_card` já faz), e o `delete_list` para de dar 500.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0, Pydantic v2.

**Spec:** `docs/superpowers/specs/2026-07-17-integracao-v2-design.md`

## Global Constraints

- **O contrato novo:** `IntegrationCardIn` recebe **`list_id: int`**. Os campos `board` e
  `list` (nomes) **somem**. Nada de `board_id`: o `list_id` já determina o quadro
  (`List.board_id`), e pedir os dois abriria a chance de um par inconsistente.
- **A integração NUNCA cria quadro ou lista.** `list_id` que não existe → `404` com
  detail exatamente `"Lista não encontrada"`. Era o "cria sozinho" que gerava fantasma.
- **Ao excluir tipo auditado, use o ORM (`await db.delete(obj)`), NUNCA bulk delete
  (`sql_delete`).** O `audit.py` captura exclusões lendo `session.deleted`, que bulk
  delete não popula — a exclusão some do log em silêncio. `CardMember`, `Reminder` e
  `CardLabel` são auditados. Isso já mordeu duas vezes neste projeto.
- **Mover dentro do mesmo quadro não filtra ninguém.**
- **A invariante:** quem está em `card_members` de um card é membro (`board_members`) do
  quadro daquele card.
- Mensagens em português.
- **Sem migrations:** nenhuma mudança de schema.
- **Não há suíte de testes** (nem pytest, nem no front) — deliberado, está no
  `CLAUDE.md`. Verificação é manual por `curl`. **Não inventar comandos de teste.**
- **Toda a implementação na branch `feat/integracao-v2`** (criada na Task 1).

## ⚠️ Segurança e ambiente

**Este repositório é PÚBLICO** (`github.com/ErickSantos2002/TaskHS`) e sofreu dois
vazamentos de credencial em 2026-07-16, ambos limpos. Não repita:

- **Senhas:** de `backend/.env.dev-users` (gitignorado):
  ```bash
  cd /home/ericks/github/TaskHS
  set -a; source backend/.env.dev-users; set +a
  ```
  Use `$TASKHS_ADMIN_EMAIL`/`$TASKHS_ADMIN_PW`, `$TASKHS_MEMBRO_*`, `$TASKHS_COORD_*`.
- **SQL:** `./scripts/psql-dev.sh`. **Nunca** `psql` com senha inline.
- **A chave da integração** vem do `.env` por substituição, **nunca impressa**:
  ```bash
  KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
  curl ... -H "X-API-Key: $KEY"
  ```
- **Nunca** escrever senha/chave em arquivo, doc, relatório, commit ou terminal.

**O banco de dev é o de PRODUÇÃO, e produção está no ar.** A listagem mostra **todos** os
quadros para todo mundo: prefixar tudo com `zzz` e apagar na hora. **NUNCA apagar linhas
de `audit_log`.**

**`docker compose restart backend` NÃO aplica mudança de código** (o código é copiado na
imagem via `COPY . .`). Sempre:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

**Não reiniciar o Vite** (porta 5173) — é do usuário. Este plano é só backend + docs.

**Os 3 cards de `external_source='gestorhs'` que já existem em produção NÃO podem ser
afetados** — eles são achados por `(source, external_id)`, que não muda. Confira ao final.

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `backend/app/schemas/integration.py` | **Modificar** — `board`/`list` → `list_id`. | 1 |
| `backend/app/routers/integration.py` | **Modificar** — mata o `_ensure_*`, resolve por id, e respeita a invariante no movimento. | 1, 2 |
| `backend/app/core/config.py` | **Modificar** — `INTEGRATION_OWNER_ID` fica órfão. | 1 |
| `backend/app/routers/lists.py` | **Modificar** — `delete_list` limpa as pontas. | 3 |
| `docs/integration.md` | **Modificar** — o guia vira v2. | 4 |
| `frontend/src/data/changelog.ts` | **Modificar** — v1.6.0. | 4 |

---

### Task 1: O contrato — `list_id`, e o fim do "cria sozinho"

**Files:**
- Modify: `backend/app/schemas/integration.py:6-15` (`IntegrationCardIn`)
- Modify: `backend/app/routers/integration.py:20-42` (remover), `:52-65`, `:68-104`
- Modify: `backend/app/core/config.py:14` (`INTEGRATION_OWNER_ID`)

**Interfaces:**
- Consumes: `require_integration_key` (já é dependency do router); `_card_options`,
  `_card_to_dict` (de `app.routers.cards`, já importados).
- Produces: o contrato `{"source", "external_id", "list_id", "title", ...}`. A Task 2
  acrescenta o filtro da invariante ao `_apply_updates`; a Task 4 documenta este contrato.

- [ ] **Step 1: Criar a branch**

```bash
cd /home/ericks/github/TaskHS && git checkout main && git pull && git checkout -b feat/integracao-v2 && git branch --show-current && git status --short && echo "(limpo)"
```
Esperado: branch `feat/integracao-v2`, working tree limpo.

- [ ] **Step 2: Registrar o fantasma antes de matá-lo (a evidência do "antes")**

Isto documenta o bug que a task corrige. Rodar **antes** de mexer no código:

```bash
cd /home/ericks/github/TaskHS
KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
echo "quantos quadros existem AGORA:"
./scripts/psql-dev.sh -t -c "SELECT '  '||count(*) FROM boards;"
echo "upsert com um nome de quadro que NAO existe:"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"zzz-fantasma","external_id":"F1","board":"zzz QUADRO QUE NAO EXISTE","list":"zzz lista","title":"zzz card"}'
echo "e agora?"
./scripts/psql-dev.sh -c "SELECT id, title FROM boards WHERE title LIKE 'zzz%';"
```
Esperado **antes** da correção: `200` e um quadro `zzz QUADRO QUE NAO EXISTE` **criado do
nada** — o fantasma. Cole a saída real.

Limpe já:
```bash
./scripts/psql-dev.sh -t -c "SELECT id FROM boards WHERE title LIKE 'zzz%';" | tr -d ' ' | grep -E '^[0-9]+$' | while read b; do
  set -a; source backend/.env.dev-users; set +a
  A=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$TASKHS_ADMIN_EMAIL\",\"password\":\"$TASKHS_ADMIN_PW\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
  curl -s -o /dev/null -w "  apaga o quadro $b: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$b" -H "Authorization: Bearer $A"
done
```

- [ ] **Step 3: O schema**

Em `backend/app/schemas/integration.py`, substituir `IntegrationCardIn` (`:6-15`):

```python
class IntegrationCardIn(BaseModel):
    source: str
    external_id: str
    # list_id, e nao os nomes do quadro e da lista: o nome fazia a integracao CRIAR um
    # quadro fantasma em silencio quando o titulo nao batia (renomear "Servico" na tela
    # bastava). Ja aconteceu: a auditoria registra a integracao criando a lista
    # "Recebido" num board_id=29. Com id, o erro e um 404 na cara do chamador.
    # So o list_id: ele ja determina o quadro (List.board_id), e pedir board_id junto
    # abriria a chance de mandar um par inconsistente.
    list_id: int
    title: str
    description: str | None = None
    due_date: date | None = None
    priority: Priority | None = None
    archived: bool | None = None
```

`IntegrationCardRef` (`:18-20`) **não muda** — `DELETE /integration/cards` continua achando
o card por `(source, external_id)`.

- [ ] **Step 4: Matar o `_ensure_*` e resolver por id**

Em `backend/app/routers/integration.py`:

**(a)** Apagar `_ensure_board` (`:20-28`) e `_ensure_list` (`:31-42`) inteiras.

**(b)** Acrescentar, no lugar delas:

```python
async def _get_list_or_404(db: AsyncSession, list_id: int) -> List:
    """A lista tem que existir. A integracao NUNCA cria quadro nem lista.

    Era o "cria sozinho" que gerava fantasma: um titulo que nao batia fazia um quadro
    novo nascer em silencio, e as OS caiam nele. Agora o erro e alto e imediato.
    """
    lst = (await db.execute(select(List).where(List.id == list_id))).scalar_one_or_none()
    if lst is None:
        raise HTTPException(status_code=404, detail="Lista não encontrada")
    return lst
```

**(c)** Em `upsert_card` (`:68-73`), trocar as duas linhas de resolução:
```python
    set_actor_identity("integracao", None, body.source, None)
    sent = body.model_dump(exclude_unset=True)
    lst = await _get_list_or_404(db, body.list_id)
```
(a linha `board = await _ensure_board(...)` some; `board` não é usado em mais nada —
confirme com um grep antes de apagar.)

**(d)** Os imports que ficam órfãos: `Board` (`:8`) e `settings` (`:7`) eram usados só
pelo `_ensure_board`. Confirme com `grep -n "Board\|settings" backend/app/routers/integration.py`
e remova os que sobrarem sem uso. `HTTPException` já está importado (`:1`).

- [ ] **Step 5: `INTEGRATION_OWNER_ID` fica órfão**

Ele existia só para ser dono do quadro que a integração criava sozinha. Confirme:
```bash
grep -rn "INTEGRATION_OWNER_ID" backend/ --include=*.py
```
Esperado após o Step 4: **só** a definição em `backend/app/core/config.py:14`.

Remova a linha do `config.py` e, se existir, a entrada correspondente em
`backend/.env.example`. **Não** mexa em `backend/.env` (é local, gitignorado) — a env
sobrando lá é inofensiva, o pydantic-settings ignora chave desconhecida. Confirme que
ignora: se o backend não subir depois disso, reverta e reporte.

- [ ] **Step 6: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}` (se o pydantic-settings reclamar do `.env`, é o Step 5 — reporte).

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz v2"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"lista A"}' | jid)
L2=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"lista B"}' | jid)

echo "1) criar card com list_id valido (esperado 200):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-v2\",\"external_id\":\"OS1\",\"list_id\":$L,\"title\":\"zzz OS 1\"}"

echo "2) upsert do MESMO (source, external_id) — atualiza, nao duplica:"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-v2\",\"external_id\":\"OS1\",\"list_id\":$L2,\"title\":\"zzz OS 1 atualizada\"}"
./scripts/psql-dev.sh -t -c "SELECT '   cards com esse external_id: '||count(*) FROM cards WHERE external_source='zzz-v2' AND external_id='OS1';"
./scripts/psql-dev.sh -t -c "SELECT '   esta na lista: '||l.title FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.external_source='zzz-v2';"

echo "3) list_id INEXISTENTE (esperado 404, e NENHUM quadro/lista criado):"
ANTES_B=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM boards;" | tr -d ' ')
ANTES_L=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM lists;" | tr -d ' ')
curl -s -w "   <- HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"zzz-v2","external_id":"OS9","list_id":999999,"title":"zzz nao deve nascer"}'
DEPOIS_B=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM boards;" | tr -d ' ')
DEPOIS_L=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM lists;" | tr -d ' ')
echo "   quadros: $ANTES_B -> $DEPOIS_B  |  listas: $ANTES_L -> $DEPOIS_L   (os dois tem que ficar IGUAIS)"

echo "4) o payload ANTIGO (com nome) e recusado (esperado 422):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"zzz-v2","external_id":"OS8","board":"zzz v2","list":"lista A","title":"zzz antigo"}'

echo "5) DELETE /integration/cards continua funcionando (esperado 204):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"source":"zzz-v2","external_id":"OS1"}'

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga o quadro: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

**Esperado:** `200` · `200` + **1** card, na `lista B` · `404` **"Lista não encontrada"**
com os contadores de quadros e listas **inalterados** (é o teste central: o fantasma
morreu) · `422` no payload antigo · `204` · `boards restantes: [20]`.

**Se o contador de quadros ou listas subir no passo 3, o `_ensure_*` não morreu** —
investigue e reporte, não maquie.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/integration.py backend/app/routers/integration.py backend/app/core/config.py backend/.env.example
git commit -m "$(cat <<'EOF'
feat(integracao)!: list_id em vez dos nomes do quadro e da lista

_ensure_board procurava o quadro pelo TITULO vindo do corpo e, se nao
achasse, CRIAVA um quadro novo em silencio (o _ensure_list, idem). Bastava
renomear "Servico" na tela para o proximo card do GestorHS criar um quadro
fantasma e as OS caírem la, sem erro nenhum. Nao e hipotese: a auditoria
registra a integracao criando a lista "Recebido" num board_id=29 que hoje
nao existe.

O argumento nao e que nome e fragil — e que o modo de falha do nome e
silencioso e destrutivo, enquanto o do id e um 404 na primeira tentativa.

So list_id: ele ja determina o quadro (List.board_id), e pedir board_id
junto abriria a chance de um par inconsistente.

INTEGRATION_OWNER_ID fica orfao (existia so para ser dono do quadro que
nascia sozinho) e sai do config.

BREAKING: o payload sai de {"board": "...", "list": "..."} para
{"list_id": N}. O GestorHS precisa ser ajustado. Os cards ja criados nao
sao afetados: sao achados por (source, external_id), que nao muda.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: A invariante no movimento entre quadros

Trocar nome por id **não** conserta isto: `_apply_updates` move o card quando a lista
difere, e o destino pode ser outro quadro — levando `CardMember`, `Reminder` e `CardLabel`
junto. É o mesmo furo que o `update_card` já fechou.

**Files:**
- Modify: `backend/app/routers/integration.py:52-65` (`_apply_updates`)

**Interfaces:**
- Consumes: `_get_list_or_404(db, list_id)` (Task 1).
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Registrar o furo antes de fechar**

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
MID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_MEMBRO_EMAIL';" | tr -d ' ')

# Quadro A: admin + o membro.  Quadro B: so o admin.
QA=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz inv A"}' | jid)
LA=$(curl -s -X POST "http://localhost:8000/api/boards/$QA/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"la"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$QA/members" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"user_id\":$MID,\"role\":\"member\"}"
QB=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz inv B"}' | jid)
LB=$(curl -s -X POST "http://localhost:8000/api/boards/$QB/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"lb"}' | jid)

# card no A, com o membro atribuido
curl -s -o /dev/null -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-inv\",\"external_id\":\"X1\",\"list_id\":$LA,\"title\":\"zzz viajante\"}"
CID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM cards WHERE external_source='zzz-inv';" | tr -d ' ')
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CID/members/$MID" -H "Authorization: Bearer $A"
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CID/members/1" -H "Authorization: Bearer $A"

echo "no card, antes:"; ./scripts/psql-dev.sh -t -c "SELECT '   '||string_agg(u.name, ', ') FROM card_members cm JOIN users u ON u.id=cm.user_id WHERE cm.card_id=$CID;"
echo "upsert movendo o card pro quadro B (o membro NAO e de la):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-inv\",\"external_id\":\"X1\",\"list_id\":$LB,\"title\":\"zzz viajante\"}"
echo "no card, depois:"; ./scripts/psql-dev.sh -t -c "SELECT '   '||string_agg(u.name, ', ') FROM card_members cm JOIN users u ON u.id=cm.user_id WHERE cm.card_id=$CID;"
echo "   ^ ANTES da correcao, o membro continua la — no quadro B, do qual ele nao e membro. Esse e o furo."
echo "guarde estes ids para o Step 3: QA=$QA LA=$LA QB=$QB LB=$LB CID=$CID MID=$MID"
```
Cole a saída real. **Antes** da correção, o membro sobrevive ao movimento.

Limpe os dois quadros:
```bash
for q in $QA $QB; do curl -s -o /dev/null -w "   apaga $q: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$q" -H "Authorization: Bearer $A"; done
```

- [ ] **Step 2: Fechar**

Em `backend/app/routers/integration.py`, substituir `_apply_updates` (`:52-65`) inteira:

```python
async def _apply_updates(card: Card, body: IntegrationCardIn, sent: dict, lst: "List", db: AsyncSession) -> None:
    """Aplica os campos do upsert num card que ja existe.

    Compartilhada pelo update normal e pela recuperacao do IntegrityError.
    """
    card.title = body.title
    if "description" in sent:
        card.description = body.description
    if "due_date" in sent:
        card.due_date = body.due_date
    if "priority" in sent and body.priority is not None:
        card.priority = body.priority
    if "archived" in sent and body.archived is not None:
        card.archived = body.archived

    if card.list_id != lst.id:
        quadro_origem = (await db.execute(
            select(List.board_id).where(List.id == card.list_id)
        )).scalar_one_or_none()
        card.list_id = lst.id
        card.position = await _last_position(db, lst.id)

        # Card movido para OUTRO quadro: os CardMember/Reminder/CardLabel viajam junto
        # com ele. Trocar nome por id nao consertou isto — e o mesmo furo que o
        # update_card (routers/cards.py) fecha, pela porta da integracao.
        if quadro_origem is not None and quadro_origem != lst.board_id:
            membros_do_destino = (
                select(BoardMember.user_id).where(BoardMember.board_id == lst.board_id)
            )
            # Via ORM, nunca bulk delete: CardMember/Reminder/CardLabel sao auditados, e
            # o audit.py le session.deleted no before_flush — bulk delete nao popula
            # isso e a exclusao sumiria do log em silencio. Ja aconteceu duas vezes aqui.
            membros_fora = (await db.execute(
                select(CardMember).where(
                    CardMember.card_id == card.id,
                    CardMember.user_id.notin_(membros_do_destino),
                )
            )).scalars().all()
            for cm in membros_fora:
                await db.delete(cm)

            lembretes_fora = (await db.execute(
                select(Reminder).where(
                    Reminder.card_id == card.id,
                    Reminder.user_id.notin_(membros_do_destino),
                )
            )).scalars().all()
            for r in lembretes_fora:
                await db.delete(r)

            etiquetas_do_destino = (
                select(BoardLabel.id).where(BoardLabel.board_id == lst.board_id)
            )
            etiquetas_fora = (await db.execute(
                select(CardLabel).where(
                    CardLabel.card_id == card.id,
                    CardLabel.label_id.notin_(etiquetas_do_destino),
                )
            )).scalars().all()
            for cl in etiquetas_fora:
                await db.delete(cl)
```

`quadro_origem` é lido **antes** do `card.list_id = lst.id`, senão já seria o do destino.

Acrescentar os imports que faltarem no topo do arquivo:
```python
from app.models.board import BoardMember, BoardLabel
from app.models.card import Card, CardMember, CardLabel, Priority
```
(a linha de `app.models.card` já existe com `Card, Priority` — estenda. A de
`app.models.board` pode ter sumido no Step 4 da Task 1 — recrie com o que é preciso.)
`Reminder` já está importado (`:12`).

- [ ] **Step 3: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

Monte de novo o cenário do Step 1 (dois quadros, o membro só no A) e repita o movimento:

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
MID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_MEMBRO_EMAIL';" | tr -d ' ')

QA=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz inv A"}' | jid)
LA=$(curl -s -X POST "http://localhost:8000/api/boards/$QA/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"la"}' | jid)
LA2=$(curl -s -X POST "http://localhost:8000/api/boards/$QA/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"la2"}' | jid)
EA=$(curl -s -X POST "http://localhost:8000/api/boards/$QA/labels" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"name":"SO-DO-A","color":"#ef4444"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$QA/members" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"user_id\":$MID,\"role\":\"member\"}"
QB=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz inv B"}' | jid)
LB=$(curl -s -X POST "http://localhost:8000/api/boards/$QB/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"lb"}' | jid)

curl -s -o /dev/null -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-inv\",\"external_id\":\"X1\",\"list_id\":$LA,\"title\":\"zzz viajante\"}"
CID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM cards WHERE external_source='zzz-inv';" | tr -d ' ')
for u in 1 $MID; do curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CID/members/$u" -H "Authorization: Bearer $A"; done
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CID/labels" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"label_id\": $EA}"

estado() { ./scripts/psql-dev.sh -t -c "SELECT '   membros: '||coalesce(string_agg(u.name, ', '),'(nenhum)') FROM card_members cm JOIN users u ON u.id=cm.user_id WHERE cm.card_id=$CID;"; ./scripts/psql-dev.sh -t -c "SELECT '   etiquetas: '||coalesce(string_agg(bl.name, ', '),'(nenhuma)') FROM card_labels cl JOIN board_labels bl ON bl.id=cl.label_id WHERE cl.card_id=$CID;"; }

echo "1) estado inicial (2 membros, 1 etiqueta):"; estado
echo "2) mover DENTRO do quadro A (nao pode filtrar ninguem):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-inv\",\"external_id\":\"X1\",\"list_id\":$LA2,\"title\":\"zzz viajante\"}"
estado
echo "3) mover para o quadro B (o membro e a etiqueta do A tem que sair):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"source\":\"zzz-inv\",\"external_id\":\"X1\",\"list_id\":$LB,\"title\":\"zzz viajante\"}"
estado
echo "4) a exclusao foi auditada? (ORM, nao bulk):"
./scripts/psql-dev.sh -c "SELECT actor_name, action, entity_type, summary FROM audit_log WHERE card_id=$CID AND action='excluir' ORDER BY id DESC LIMIT 3;"

echo "LIMPEZA:"
for q in $QA $QB; do curl -s -o /dev/null -w "   apaga $q: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$q" -H "Authorization: Bearer $A"; done
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

**Esperado:**
1. `membros: Adriana Paz, Erick H.` · `etiquetas: SO-DO-A`
2. `200`, e **os dois membros e a etiqueta continuam** — mover no mesmo quadro não filtra
3. `200`, e sobra **só `Erick H.`** (o admin, que é membro do B) e `etiquetas: (nenhuma)`
4. o log mostra `excluir | membro_card` e `excluir | etiqueta_card`, com ator `zzz-inv`
- `boards restantes: [20]`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/integration.py
git commit -m "$(cat <<'EOF'
fix(integracao): mover card entre quadros tira quem nao e do destino

Trocar nome por id nao consertou isto: _apply_updates move o card quando
a lista difere, e o destino pode ser outro quadro — levando CardMember,
Reminder e CardLabel junto. Era o quarto caminho que quebrava a
invariante "atribuido a um card => membro do quadro", e o unico que
sobrava depois da v1.4.1: o integration.py nao aparecia nem uma vez
naquela spec nem naquele plano.

Mesmo filtro do update_card, e via ORM (nao bulk delete) para a exclusao
nao sumir do audit_log em silencio.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `delete_list` para de dar 500

**Files:**
- Modify: `backend/app/routers/lists.py:49-54` (`delete_list`)

**Interfaces:**
- Consumes: `_get_list_or_404(list_id, board_id, db)` (`lists.py:15`, já existe).
- Produces: nada.

- [ ] **Step 1: Registrar o 500**

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz del"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz card"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C/reminders" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"remind_at":"2030-01-01T12:00:00Z"}'
echo "apagar a lista cujo card tem lembrete:"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q/lists/$L" -H "Authorization: Bearer $A"
echo "   ^ ANTES da correcao: 500"
curl -s -o /dev/null -w "   limpeza: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
```
Cole a saída real. Esperado **antes**: `500`.

- [ ] **Step 2: Limpar as pontas**

`delete_board` (`boards.py:295-302`) já resolve isso; `delete_list` só limpava
`Automation`. Substituir `delete_list` (`lists.py:49-54`) inteiro:

```python
@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    lst = await _get_list_or_404(list_id, board_id, db)
    await db.execute(sql_delete(Automation).where(Automation.trigger_list_id == list_id))
    # Reminder/ReminderSent/Notification apontam para card_id mas nao tem cascade no ORM
    # nem no banco (as FKs para cards sao NO ACTION), entao apagar a lista com um card
    # que tenha lembrete estourava FK -> 500. Mesmo padrao do delete_board.
    card_ids = (await db.execute(select(Card.id).where(Card.list_id == list_id))).scalars().all()
    if card_ids:
        await db.execute(sql_delete(Reminder).where(Reminder.card_id.in_(card_ids)))
        await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id.in_(card_ids)))
        await db.execute(sql_delete(Notification).where(Notification.card_id.in_(card_ids)))
    await db.delete(lst)
    await db.commit()
```

**Sobre o bulk delete aqui:** é o mesmo padrão do `delete_board`, e é a exceção que o
`audit.py` concede explicitamente (veja o comentário ao lado do `ENTITY_TYPES`): o pai
(`List`) é auditado e os filhos são consequência óbvia da exclusão dele. `Notification`
e `ReminderSent` nem são tipos auditados. **Não** troque por ORM aqui.

Imports: `lists.py` **já tem** `select`, `delete as sql_delete` (linha 3), `List`, `Card`,
`User` e `Automation`. Faltam exatamente **três** — acrescente:
```python
from app.models.reminder import Reminder, ReminderSent
from app.models.notification import Notification
```
(verificado em 2026-07-17; se o arquivo divergir disso, reporte antes de mexer)

- [ ] **Step 3: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz del2"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz card"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C/reminders" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"remind_at":"2030-01-01T12:00:00Z"}'

echo "1) apagar a lista cujo card tem lembrete (esperado 204, era 500):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q/lists/$L" -H "Authorization: Bearer $A"
echo "2) as pontas foram limpas (esperado 0 e 0):"
./scripts/psql-dev.sh -t -c "SELECT '   lembretes orfaos: '||count(*) FROM reminders WHERE card_id=$C;"
./scripts/psql-dev.sh -t -c "SELECT '   cards da lista: '||count(*) FROM cards WHERE list_id=$L;"
echo "3) apagar lista SEM lembrete continua funcionando (esperado 204):"
L2=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l2"}' | jid)
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q/lists/$L2" -H "Authorization: Bearer $A"
echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga o quadro: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```
Esperado: `204` (**era 500**) · `0` e `0` · `204` · `boards restantes: [20]`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/lists.py
git commit -m "$(cat <<'EOF'
fix(listas): delete_list dava 500 se o card tivesse lembrete

Reminder/ReminderSent/Notification apontam para card_id mas nao tem
cascade no ORM nem no banco (as FKs para cards sao NO ACTION). O
delete_list limpava so Automation, entao apagar uma lista com card que
tivesse lembrete estourava a FK.

E o irmao do 500 que ja prendeu um quadro em producao, e agora que os
lembretes sao usados de verdade, estava alcancavel. Mesmo padrao do
delete_board.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: O guia v2 e o changelog

**Files:**
- Modify: `docs/integration.md` (descreve o payload com nome em 7 lugares)
- Modify: `frontend/src/data/changelog.ts` (topo do array `CHANGELOG`)

**Interfaces:**
- Consumes: o contrato definido na Task 1.

- [ ] **Step 1: O guia**

`docs/integration.md` é **o contrato que o outro lado lê** — deixá-lo desatualizado é pior
do que não tê-lo. Leia o arquivo inteiro e atualize **tudo** que descreve o payload:

- a tabela de campos: `board` e `list` saem; entra **`list_id` (int, obrigatório)** — "o
  id da lista onde o card deve ficar; o quadro é deduzido dela"
- **todos** os exemplos de `curl`/JSON
- o pseudo-código do GestorHS
- a seção de erros: acrescentar **`404 Lista não encontrada`** — o id não existe
- a seção de comportamento: **a integração não cria mais quadro nem lista**; elas têm que
  existir no TaskHS

Acrescente, perto do topo, uma seção curta explicando **como descobrir o `list_id`** — é a
primeira pergunta de quem for integrar:

```markdown
## Como descobrir o `list_id`

Abra o quadro no TaskHS e use a API, com o seu token de usuário:

​```bash
curl -s https://taskhsapi.healthsafetytech.com/api/boards \
  -H "Authorization: Bearer $SEU_TOKEN"          # acha o id do quadro

curl -s https://taskhsapi.healthsafetytech.com/api/boards/<BOARD_ID>/lists \
  -H "Authorization: Bearer $SEU_TOKEN"          # id e título de cada lista
​```

Anote os ids no seu lado. Eles não mudam quando alguém renomeia a lista na tela — é
justamente por isso que a v2 usa id.
```

E uma nota de migração, porque o guia v1 está publicado:

```markdown
## Mudou na v2 (2026-07-17)

O payload usava os **nomes** do quadro e da lista. Agora usa **`list_id`**.

Por quê: com nome, um título que não batesse fazia a API **criar um quadro novo em
silêncio**, e os cards passavam a cair nele — bastava alguém renomear a lista na tela.
Aconteceu de verdade. Com id, um id errado devolve **404** na primeira tentativa.

O que muda no seu lado:

| v1 | v2 |
|---|---|
| `{"board": "Serviço", "list": "Recebido", ...}` | `{"list_id": 42, ...}` |
| quadro/lista criados sozinhos se não existissem | **têm que existir** → senão `404` |

Os cards já criados não são afetados: eles são achados por `(source, external_id)`, que
não mudou.
```

**Não invente o texto ao redor** — o guia tem 320 linhas e uma voz própria. Leia,
mantenha o estilo, e mude só o que o contrato exige. **Reporte** se achar alguma seção que
o plano não previu.

⚠️ **Nenhuma credencial no guia** — nem chave de integração, nem senha, nem a URL completa
do banco. O repositório é público.

- [ ] **Step 2: O changelog**

Inserir como **primeiro** item do array `CHANGELOG` em `frontend/src/data/changelog.ts`:

```ts
  {
    version: "1.6.0",
    date: "2026-07-17",
    changes: [
      { kind: "melhoria", text: "A integração com outros sistemas (GestorHS) agora identifica a lista pelo id, não pelo nome. Antes, renomear uma lista fazia os cards passarem a cair num quadro novo criado em silêncio; agora o sistema avisa na hora que o id não existe." },
      { kind: "correcao", text: "Excluir uma lista cujo cartão tivesse lembrete dava erro. Agora funciona." },
    ],
  },
```

Versão **1.6.0**: quebra de contrato de uma API pública (a regra do `CLAUDE.md` manda
minor para melhoria; a quebra é do contrato externo, não da interface).

- [ ] **Step 3: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

```bash
cd /home/ericks/github/TaskHS
echo "=== sobrou alguma mencao ao payload antigo no guia? ==="
grep -nE '"board"|"list"[^_]' docs/integration.md
echo "(vazio = o guia foi todo migrado)"
echo "=== e credencial? ==="
grep -nE "admin123|mudar123|PGPASSWORD|62\.72\.|INTEGRATION_API_KEY=" docs/integration.md
echo "(vazio = limpo)"
```

No navegador: o rodapé da sidebar mostra **TaskHS · v1.6.0**.

- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/TaskHS
git add docs/integration.md frontend/src/data/changelog.ts
git commit -m "$(cat <<'EOF'
docs: guia de integracao v2 e changelog v1.6.0

O guia e o contrato que o outro lado le — deixa-lo descrevendo o payload
antigo seria pior do que nao te-lo. Ganhou tambem "como descobrir o
list_id" (a primeira pergunta de quem for integrar) e a nota do que mudou
da v1, com o porque.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final da branch

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
set -a; source backend/.env.dev-users; set +a
KEY=$(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

echo "1) o fantasma morreu — list_id inexistente nao cria nada:"
B1=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM boards;" | tr -d ' '); L1=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM lists;" | tr -d ' ')
curl -s -w "   <- HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"zzz-f","external_id":"F","list_id":999999,"title":"zzz"}'
B2=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM boards;" | tr -d ' '); L2=$(./scripts/psql-dev.sh -t -c "SELECT count(*) FROM lists;" | tr -d ' ')
echo "   quadros: $B1 -> $B2 | listas: $L1 -> $L2  (tem que ficar iguais)"

echo "2) o payload antigo e recusado:"
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 422)\n" -X POST http://localhost:8000/api/integration/cards -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"zzz-f","external_id":"F","board":"x","list":"y","title":"zzz"}'

echo "3) os 3 cards do GestorHS que ja existiam continuam intactos:"
./scripts/psql-dev.sh -c "SELECT c.id, c.external_id, l.title AS lista FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.external_source='gestorhs' ORDER BY c.id;"

echo "4) estado final:"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards:", [b["id"] for b in json.load(sys.stdin)])'
./scripts/psql-dev.sh -t -c "SELECT '   audit_log: min='||min(id)||' count='||count(*) FROM audit_log;"
```

Esperado: `404` com os contadores **inalterados** · `422` no payload antigo · os **3**
cards do GestorHS nas listas de sempre (`📮Correios`, `💰 Financeiro`,
`🚚 Expedição (Preparando para Envio)`) · `boards: [20]` · `audit_log` sem buraco novo.

```bash
cd frontend && npm run build
```
Esperado: build sem erro.
