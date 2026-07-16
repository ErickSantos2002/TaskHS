# Acesso a quadros: vitrine aberta, porta fechada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo mundo enxerga todos os quadros da empresa, mas só entra nos que é
membro; administrador e coordenador entram em todos — com a barreira aplicada de
verdade no backend, não só na tela.

**Architecture:** Uma dependency de autorização em duas formas
(`por board_id` / `por list_id`) aplicada **no nível do router**, de modo que
todo endpoint de um router protegido — inclusive os que forem criados no futuro —
nasça trancado. Sobre essa base entram os endpoints de membros do quadro (que não
existiam) e a listagem aberta com `can_open` calculado no backend.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0 (`Mapped`/`mapped_column`),
asyncpg, Pydantic v2, React 19 + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-16-acesso-quadros-design.md`

## Global Constraints

- **Regra da tranca, definida em um lugar só:** elevado
  (`current_user.is_elevated`, i.e. administrador ou coordenador) passa; senão
  exige linha em `board_members`; senão `403` com detail exatamente
  `"Você não é membro deste quadro"`.
- **Regra de gestão de membros:** dono do quadro (`board.owner_id`) ou elevado;
  senão `403` com detail exatamente
  `"Apenas o dono do quadro ou um administrador pode gerenciar membros"`.
- **`can_open` é calculado no backend**, nunca recalculado no frontend — uma
  fonte de verdade só, senão cadeado e tranca divergem.
- **O router `integration` não é tocado** — usa `X-API-Key`, não tem usuário.
- **`GET /api/boards/stats` (`boards.py:57-85`) não é tocado.** Ele continua
  contando só os quadros em que a pessoa é membro, de propósito: é o painel
  pessoal dela. Parece incoerente com a listagem aberta e **não é** — decisão
  registrada na spec. Não "consertar".
- **`GET /api/boards/{id}` continua devolvendo `BoardOut` puro** — sem
  `can_open`/`members`. Só a listagem tem esses campos; a tela do quadro não
  desenha cadeado.
- **A ordem das rotas em `boards.py` importa:** `/boards/stats` e
  `/boards/import` estão declaradas **antes** de `/boards/{board_id}` e por isso
  vencem o roteamento. Ao mexer no arquivo, não reordenar — `stats` viraria um
  `board_id` inválido.
- **Não há suíte de testes no projeto.** Verificação é manual: `curl` +
  navegador + `npm run build`. **Não inventar comandos de teste** (sem pytest,
  sem vitest).
- **Sem migrations automáticas:** `create_all` só cria tabela que falta, não
  altera tabela existente. Mudança de schema em tabela existente = SQL manual em
  `backend/migrations/`, rodado via psql.
- **Mensagens de interface em português.**
- **Toda a implementação acontece na branch `feat/acesso-quadros`** (criada na
  Task 1), nunca direto na `main`.
- **O banco de dev é o banco de PRODUÇÃO** (Easypanel, `62.72.11.28:9874`), com
  27 contas reais. Limpar dados de teste ao final de cada task; **nunca apagar
  linhas de `audit_log`** (append-only).

## Ambiente de verificação

O backend roda em Docker na porta 8000; o frontend (Vite) na 5173. Ambos já
estão no ar. Depois de mudar código do backend:

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

**Gotcha do Vite:** operações git que reescrevem arquivos em lote (`checkout`,
`merge`) fazem o watcher perder a mudança. Depois de trocar de branch,
reiniciar o `npm run dev`.

### Tokens usados nas verificações

Rodar uma vez por sessão de terminal. Estas contas existem e as senhas estão
confirmadas (verificado em 2026-07-16):

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }

ADMIN=$(tok healthsafetyti@gmail.com admin123)            # Erick H. (id 1) — administrador, owner do quadro 20
COORD=$(tok np@healthsafetytech.com mudar123)             # Nicholson Pimentel (id 3) — coordenador
MEMBRO=$(tok comercial02@healthsafetytech.com mudar123)   # Adriana Paz (id 14) — membro comum, NÃO é membro do quadro 20
```

**Estado do banco (verificado em 2026-07-16):** existe um único quadro, id **20**
("Serviço"), cujo único membro é o usuário 1 (`owner`). Suas listas começam no id
**20**. É um quadro de teste que o Erick vai apagar depois — pode ser usado à
vontade nas verificações.

---

## File Structure

**Backend**

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `backend/app/dependencies.py` | **Modificar** — ganha as duas dependencies da tranca. É o lugar natural: já hospeda `get_current_user` e `require_integration_key`. | 1 |
| `backend/app/routers/lists.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/labels.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/automations.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/cards.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/attachments.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/reminders.py` | **Modificar** — gate no router (1 linha). | 1 |
| `backend/app/routers/boards.py` | **Modificar** — gate por endpoint (o router tem rotas sem `board_id`); membros; listagem aberta. | 1, 2, 3 |
| `backend/app/models/board.py` | **Modificar** — unique `(board_id, user_id)` em `BoardMember`. | 2 |
| `backend/migrations/004_board_members_unique.sql` | **Criar** — o unique no banco existente. | 2 |
| `backend/app/schemas/board.py` | **Modificar** — `BoardMemberOut`, `BoardListOut`. | 2, 3 |

**Frontend**

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `frontend/src/lib/api.ts` | **Modificar** — `ApiError` com `status`, para o 403 ser distinguível. | 4 |
| `frontend/src/types/index.ts` | **Modificar** — `BoardMemberOut`, `BoardListItem`. | 4 |
| `frontend/src/pages/BoardsPage.tsx` | **Modificar** — cadeado, avatares, clique bloqueado. | 4 |
| `frontend/src/pages/BoardPage.tsx` | **Modificar** — tela de sem-acesso no 403; seção Membros no modal de configurações. | 4, 5 |
| `frontend/src/data/changelog.ts` | **Modificar** — entrada v1.4.0. | 6 |
| `CLAUDE.md` | **Modificar** — a seção que diz "Autorização é mínima" fica factualmente errada. | 6 |

---

### Task 1: A tranca (backend)

O coração da mudança. Cria a barreira que nunca existiu e a aplica em todos os
routers de conteúdo de quadro.

**Files:**
- Modify: `backend/app/dependencies.py` (acrescentar ao final)
- Modify: `backend/app/routers/lists.py:12`
- Modify: `backend/app/routers/labels.py:10`
- Modify: `backend/app/routers/automations.py:12`
- Modify: `backend/app/routers/cards.py:25`
- Modify: `backend/app/routers/attachments.py:14`
- Modify: `backend/app/routers/reminders.py:11`
- Modify: `backend/app/routers/boards.py:230-233` (`get_board`), `:266-267` (`get_archived`), `:307-313` (`add_member`)

**Interfaces:**
- Consumes: `get_current_user` (já existe em `dependencies.py`); a property
  `User.is_elevated` (já existe em `models/user.py`, True para administrador e
  coordenador).
- Produces:
  - `require_board_access_by_board_id(board_id: int, current_user: User, db: AsyncSession) -> User`
  - `require_board_access_by_list_id(list_id: int, current_user: User, db: AsyncSession) -> User`

  Ambas são FastAPI dependencies: leem o path param pelo nome (`board_id` /
  `list_id`), devolvem o `User` autorizado, ou levantam `403`. As Tasks 2 e 3
  usam `require_board_access_by_board_id` como `Depends(...)` em endpoints de
  `boards.py`.

- [ ] **Step 1: Criar a branch**

```bash
cd /home/ericks/github/TaskHS && git checkout -b feat/acesso-quadros && git status --short && git branch --show-current
```
Esperado: branch `feat/acesso-quadros`, working tree limpo.

- [ ] **Step 2: Registrar o furo antes de fechar (evidência do "antes")**

Isto documenta o bug que a task corrige. Rodar com os tokens da seção
"Ambiente de verificação":

```bash
echo "MEMBRO em /boards/20/lists:"; curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:8000/api/boards/20/lists -H "Authorization: Bearer $MEMBRO"
echo "MEMBRO em /lists/20/cards:";  curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:8000/api/lists/20/cards  -H "Authorization: Bearer $MEMBRO"
```
Esperado **antes** da correção: `HTTP 200` nas duas. É exatamente o furo.

- [ ] **Step 3: Escrever as dependencies**

Acrescentar ao **final** de `backend/app/dependencies.py`:

```python
async def require_board_access_by_board_id(
    board_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Tranca dos routers cujo prefixo tem {board_id}.

    Elevado (administrador/coordenador) entra em qualquer quadro — decisão de
    produto registrada na spec: coordenador é o papel de qualidade e ver todos
    os fluxos internos é a função dele.
    """
    if current_user.is_elevated:
        return current_user
    q = await db.execute(
        select(BoardMember.id).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == current_user.id,
        )
    )
    if q.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")
    return current_user


async def require_board_access_by_list_id(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Mesma tranca, para routers cujo prefixo tem {list_id} e não {board_id}.

    Resolve lista -> quadro no próprio JOIN. Lista inexistente cai em 403 (e não
    404) para não revelar a existência de listas de quadros alheios; para o
    usuário elevado, o gate passa e o endpoint devolve o 404 normal.
    """
    if current_user.is_elevated:
        return current_user
    q = await db.execute(
        select(BoardMember.id)
        .join(ListModel, ListModel.board_id == BoardMember.board_id)
        .where(ListModel.id == list_id, BoardMember.user_id == current_user.id)
    )
    if q.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")
    return current_user
```

E acrescentar estes imports no topo do mesmo arquivo (junto dos que já existem):

```python
from app.models.board import BoardMember
from app.models.list import List as ListModel
```

Notas para quem implementa:
- `select` e `HTTPException` **já estão importados** no arquivo — não duplicar.
- `ListModel` é apelido porque `List` colidiria com o `typing.List` mental de
  quem lê; o model chama-se `List` em `app/models/list.py`.
- Não há ciclo de import: os models não importam `dependencies`.
- `Depends(get_db)` aqui **não abre uma segunda conexão** — o FastAPI cacheia a
  dependency por request, então é a mesma sessão do endpoint.

- [ ] **Step 4: Aplicar o gate nos seis routers**

Uma linha em cada. Trocar exatamente a linha do `APIRouter(...)`:

`backend/app/routers/lists.py:12`
```python
router = APIRouter(prefix="/boards/{board_id}/lists", tags=["lists"],
                   dependencies=[Depends(require_board_access_by_board_id)])
```

`backend/app/routers/labels.py:10`
```python
router = APIRouter(prefix="/boards/{board_id}/labels", tags=["labels"],
                   dependencies=[Depends(require_board_access_by_board_id)])
```

`backend/app/routers/automations.py:12`
```python
router = APIRouter(prefix="/boards/{board_id}/automations", tags=["automations"],
                   dependencies=[Depends(require_board_access_by_board_id)])
```

`backend/app/routers/cards.py:25`
```python
router = APIRouter(prefix="/lists/{list_id}/cards", tags=["cards"],
                   dependencies=[Depends(require_board_access_by_list_id)])
```

`backend/app/routers/attachments.py:14`
```python
router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/attachments", tags=["attachments"],
                   dependencies=[Depends(require_board_access_by_list_id)])
```

`backend/app/routers/reminders.py:11`
```python
router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/reminders", tags=["reminders"],
                   dependencies=[Depends(require_board_access_by_list_id)])
```

Em **cada** um desses seis arquivos, garantir o import (todos já importam
`Depends` do fastapi; falta só a função):

```python
from app.dependencies import require_board_access_by_board_id   # lists, labels, automations
from app.dependencies import require_board_access_by_list_id    # cards, attachments, reminders
```

**Por que no router e não em cada endpoint:** `cards.py` tem 19 endpoints.
Protegendo um a um, a tranca vale até alguém acrescentar o vigésimo e esquecer.
No router, o endpoint futuro já nasce trancado.

- [ ] **Step 5: Fechar os três buracos de `boards.py`**

O router `boards` tem prefixo `/boards` e contém rotas **sem** `board_id`
(`GET /boards`, `POST /boards`, `/boards/stats`, `/boards/import`), então o gate
não pode ir no router — vai endpoint a endpoint.

`backend/app/routers/boards.py:230-233` — trocar a dependency de `get_board`:
```python
@router.get("/{board_id}", response_model=BoardOut)
async def get_board(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    return await _get_board_or_404(board_id, db)
```

`backend/app/routers/boards.py:266-267` — idem em `get_archived` (manter o corpo
como está, trocar só a linha da assinatura):
```python
@router.get("/{board_id}/archived")
async def get_archived(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
```

`backend/app/routers/boards.py:307-313` — `add_member` hoje **não verifica
nada**: qualquer pessoa autenticada pode se adicionar a qualquer quadro como
`owner`. Substituir a função inteira por:
```python
@router.post("/{board_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(board_id: int, body: BoardMemberAdd, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono do quadro ou um administrador pode gerenciar membros")
    member = BoardMember(board_id=board.id, user_id=body.user_id, role=body.role)
    db.add(member)
    await db.commit()
    return {"ok": True}
```
(A validação de usuário inexistente e de membro duplicado entra na Task 2, junto
com o unique — aqui o objetivo é só fechar a autorização.)

Acrescentar o import em `boards.py`:
```python
from app.dependencies import get_current_user, require_board_access_by_board_id
```
(a linha `from app.dependencies import get_current_user` já existe — estender.)

`update_board:236` e `delete_board:248` **já** checam dono/elevado — não mexer.

- [ ] **Step 6: Subir o backend e verificar que a tranca fechou**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}` (se der erro de import, o log sai em
`docker compose logs --tail=30 backend`).

Bateria — **membro comum não-membro do quadro 20 deve levar 403 em tudo**:
```bash
for p in /api/boards/20 /api/boards/20/lists /api/boards/20/labels /api/boards/20/archived /api/boards/20/automations /api/lists/20/cards; do
  printf "%-32s -> HTTP %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8000$p" -H "Authorization: Bearer $MEMBRO")"
done
```
Esperado: **403** nas seis linhas.

Auto-adição (o furo do `add_member`):
```bash
curl -s -o /dev/null -w "auto-adicao -> HTTP %{http_code}\n" -X POST http://localhost:8000/api/boards/20/members \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"owner"}'
```
Esperado: **403**.

Admin e coordenador continuam entrando:
```bash
for t in "$ADMIN" "$COORD"; do
  for p in /api/boards/20 /api/boards/20/lists /api/lists/20/cards; do
    printf "%-24s -> HTTP %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8000$p" -H "Authorization: Bearer $t")"
  done; echo "--"
done
```
Esperado: **200** nas seis linhas.

A integração não pode ter sido afetada (usa `X-API-Key`, sem usuário):
```bash
# A chave vai por substituicao, sem ser impressa: e um segredo de producao.
curl -s -o /dev/null -w "integration -> HTTP %{http_code}\n" -X POST http://localhost:8000/api/integration/cards \
  -H "X-API-Key: $(grep INTEGRATION_API_KEY backend/.env | cut -d= -f2)" -H 'Content-Type: application/json' \
  -d '{"source":"teste-plano","external_id":"T1","board":"Serviço","list":"Aguardando Confirmação de Calibração","title":"card de teste do plano"}'
```
Esperado: **200** ou **201** (não 403).

- [ ] **Step 7: Confirmar que a auditoria pegou as tentativas**

O handler global de 403 (`main.py:52-67`) grava `acesso_negado` sozinho. Isso
não é código novo — é confirmação de que o benefício apareceu:

```bash
curl -s "http://localhost:8000/api/logs?action=acesso_negado&limit=5" -H "Authorization: Bearer $ADMIN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("total:", d["total"]); [print(" ", i["actor_name"], "|", i["path"]) for i in d["items"]]'
```
Esperado: as tentativas da Adriana aparecem, com `path` batendo com as URLs do
Step 6.

- [ ] **Step 8: Limpar o card de teste da integração**

```bash
./scripts/psql-dev.sh \
  -c "DELETE FROM cards WHERE external_source = 'teste-plano';"
```
Esperado: `DELETE 1`. **Não apagar nada de `audit_log`.**

- [ ] **Step 9: Commit**

```bash
git add backend/app/dependencies.py backend/app/routers/
git commit -m "$(cat <<'EOF'
feat(seg): tranca de membresia nos quadros

Cria require_board_access_by_board_id/by_list_id em dependencies.py e
aplica no nivel do router (lists, labels, automations, cards,
attachments, reminders), para que endpoints futuros ja nascam
trancados. Em boards.py o gate vai por endpoint, pois o router tem
rotas sem board_id.

Antes: qualquer usuario autenticado lia qualquer quadro pela URL
(GET /boards/20/lists devolvia 200 para nao-membro), e add_member nao
verificava nada — dava para se auto-adicionar como owner.

Elevado (administrador/coordenador) entra em todos os quadros, por
decisao de produto registrada na spec.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Membros do quadro (backend)

A chave da tranca. Hoje não há `GET` nem `DELETE` de membros, e o `POST` aceita
duplicata porque a tabela não tem unique.

**Files:**
- Modify: `backend/app/models/board.py:43-53` (`BoardMember`)
- Create: `backend/migrations/004_board_members_unique.sql`
- Modify: `backend/app/schemas/board.py` (acrescentar `BoardMemberOut`)
- Modify: `backend/app/routers/boards.py` (`add_member` + dois endpoints novos)

**Interfaces:**
- Consumes: `require_board_access_by_board_id` (Task 1); `_get_board_or_404`
  (já existe em `boards.py:27`).
- Produces:
  - `BoardMemberOut` (Pydantic): `{id: int, name: str, email: str, initials: str, board_role: BoardRole}`.
    **`id` é o id do USUÁRIO**, não da linha de `board_members` — é o que o
    frontend usa em `DELETE /boards/{id}/members/{user_id}`. A Task 3 reusa esse
    schema dentro de `BoardListOut.members`.
  - `GET /api/boards/{board_id}/members` → `list[BoardMemberOut]`
  - `DELETE /api/boards/{board_id}/members/{user_id}` → `204`

- [ ] **Step 1: Unique no model**

Em `backend/app/models/board.py`, estender o import do sqlalchemy da linha 2 e
acrescentar `__table_args__` em `BoardMember`:

```python
from sqlalchemy import String, ForeignKey, DateTime, Enum as SAEnum, UniqueConstraint
```

```python
class BoardMember(Base):
    __tablename__ = "board_members"
    __table_args__ = (
        UniqueConstraint("board_id", "user_id", name="board_members_board_user_uniq"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ...
```
(o resto da classe fica igual)

Isso cobre bancos novos, criados por `create_all`. O banco atual precisa do SQL
do Step 2, porque `create_all` **não altera tabela existente**.

- [ ] **Step 2: Criar a migration**

Criar `backend/migrations/004_board_members_unique.sql`:

```sql
-- Impede a mesma pessoa entrar duas vezes no mesmo quadro.
-- Roda via psql; create_all nao altera tabela existente.

-- 1) remove duplicatas pre-existentes, mantendo a linha mais antiga
DELETE FROM board_members a
 USING board_members b
 WHERE a.id > b.id
   AND a.board_id = b.board_id
   AND a.user_id  = b.user_id;

-- 2) cria a constraint (idempotente: PG nao tem ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_members_board_user_uniq'
  ) THEN
    ALTER TABLE board_members
      ADD CONSTRAINT board_members_board_user_uniq UNIQUE (board_id, user_id);
  END IF;
END $$;
```

- [ ] **Step 3: Rodar a migration**

```bash
cd /home/ericks/github/TaskHS && ./scripts/psql-dev.sh \
  -f backend/migrations/004_board_members_unique.sql
```
Esperado: `DELETE 0` e `DO`.

Conferir que a constraint existe:
```bash
./scripts/psql-dev.sh -c "\d board_members" | grep uniq
```
Esperado: uma linha citando `board_members_board_user_uniq` como UNIQUE.

- [ ] **Step 4: Schema `BoardMemberOut`**

Acrescentar em `backend/app/schemas/board.py` (depois de `BoardOut`):

```python
class BoardMemberOut(BaseModel):
    """Uma pessoa dentro de um quadro.

    `id` é o id do USUÁRIO (não o da linha de board_members): é o que a API de
    remoção recebe e o que o frontend usa como chave.
    """
    id: int
    name: str
    email: str
    initials: str
    board_role: BoardRole
```
(`BoardRole` já está importado na linha 3 do arquivo.)

- [ ] **Step 5: Os três endpoints**

Em `backend/app/routers/boards.py`, substituir o bloco de `add_member` (que a
Task 1 deixou em `:307-313`) por estes três endpoints:

```python
@router.get("/{board_id}/members", response_model=list[BoardMemberOut])
async def list_members(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    await _get_board_or_404(board_id, db)
    q = await db.execute(
        select(BoardMember, User)
        .join(User, User.id == BoardMember.user_id)
        .where(BoardMember.board_id == board_id)
        .order_by(User.name)
    )
    return [
        {"id": u.id, "name": u.name, "email": u.email, "initials": u.initials, "board_role": bm.role}
        for bm, u in q.all()
    ]


@router.post("/{board_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(board_id: int, body: BoardMemberAdd, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono do quadro ou um administrador pode gerenciar membros")

    alvo = (await db.execute(select(User).where(User.id == body.user_id, User.is_active == True))).scalar_one_or_none()
    if alvo is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    ja = (await db.execute(
        select(BoardMember.id).where(BoardMember.board_id == board_id, BoardMember.user_id == body.user_id)
    )).scalar_one_or_none()
    if ja is not None:
        raise HTTPException(status_code=409, detail="Essa pessoa já é membro do quadro")

    db.add(BoardMember(board_id=board.id, user_id=body.user_id, role=body.role))
    await db.commit()
    return {"ok": True}


@router.delete("/{board_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(board_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o dono do quadro ou um administrador pode gerenciar membros")
    if user_id == board.owner_id:
        raise HTTPException(status_code=400, detail="O dono do quadro não pode ser removido")

    membro = (await db.execute(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
    )).scalar_one_or_none()
    if membro is None:
        raise HTTPException(status_code=404, detail="Membro não encontrado")

    await db.delete(membro)
    await db.commit()
```

Estender o import de schemas no topo do arquivo (a linha já existe, acrescentar
`BoardMemberOut`):
```python
from app.schemas.board import BoardCreate, BoardUpdate, BoardOut, BoardMemberAdd, BoardMemberOut
```

Nota: **o dono não pode ser removido** — senão o quadro fica sem ninguém que
possa gerenciar membros (só um elevado destravaria).

- [ ] **Step 6: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

Listar membros (só o dono hoje):
```bash
curl -s http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN"
```
Esperado: um item, `{"id":1,"name":"Erick H.",...,"board_role":"owner"}`.

Não-membro não lê a lista:
```bash
curl -s -o /dev/null -w "membros como nao-membro -> HTTP %{http_code}\n" http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $MEMBRO"
```
Esperado: **403**.

Ciclo completo de adicionar → duplicar → remover:
```bash
echo "add:";   curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X POST http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
echo "dup:";   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
echo "agora a Adriana entra:"; curl -s -o /dev/null -w "  /boards/20/lists -> HTTP %{http_code}\n" http://localhost:8000/api/boards/20/lists -H "Authorization: Bearer $MEMBRO"
echo "usuario inexistente:"; curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":99999,"role":"member"}'
echo "remover o dono:"; curl -s -w "  HTTP %{http_code}\n" -X DELETE http://localhost:8000/api/boards/20/members/1 -H "Authorization: Bearer $ADMIN"
echo "remover a Adriana:"; curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X DELETE http://localhost:8000/api/boards/20/members/14 -H "Authorization: Bearer $ADMIN"
echo "e ela perde o acesso de novo:"; curl -s -o /dev/null -w "  /boards/20/lists -> HTTP %{http_code}\n" http://localhost:8000/api/boards/20/lists -H "Authorization: Bearer $MEMBRO"
```
Esperado, em ordem: `201` · `409` + "já é membro" · `200` · `404` +
"Usuário não encontrado" · `400` + "O dono do quadro não pode ser removido" ·
`204` · `403`.

O estado do banco volta ao original sozinho (a Adriana foi adicionada e removida).
Confirmar:
```bash
curl -s http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN"
```
Esperado: só o usuário 1.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/board.py backend/migrations/004_board_members_unique.sql backend/app/schemas/board.py backend/app/routers/boards.py
git commit -m "$(cat <<'EOF'
feat(quadros): gerir membros do quadro (GET/POST/DELETE)

Faltava tudo menos um POST sem autorizacao: nao havia como listar nem
remover membro, e nada no frontend chamava o endpoint. Sem isso a
tranca da task anterior nao tem chave.

- GET /boards/{id}/members (membro do quadro ou elevado)
- POST valida usuario existente e recusa duplicata (409)
- DELETE /boards/{id}/members/{user_id}; recusa remover o dono, senao o
  quadro fica sem quem gerencie membros
- unique (board_id, user_id) no model + migration 004 para o banco atual

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: A vitrine (backend)

`GET /boards` passa a devolver **todos** os quadros, cada um dizendo se a pessoa
pode abrir.

**Files:**
- Modify: `backend/app/schemas/board.py` (acrescentar `BoardListOut`)
- Modify: `backend/app/routers/boards.py:35-54` (`create_board`, `list_boards`)

**Interfaces:**
- Consumes: `BoardMemberOut` (Task 2).
- Produces:
  - `BoardListOut` = `BoardOut` + `can_open: bool` + `owner_name: str` + `members: list[BoardMemberBriefOut]`
  - `BoardMemberBriefOut` = `{id, name, initials}` — **sem e-mail**: a listagem é
    visível a todo mundo, então espelha o `UserBasicOut` de `/auth/users/basic`.
    O e-mail fica só no `GET /boards/{id}/members`, atrás da tranca.
  - `GET /api/boards` → `list[BoardListOut]` (todos os quadros)
  - `POST /api/boards` → `BoardListOut` (era `BoardOut`)

  A Task 4 consome esses três campos. `GET /boards/{id}` **continua**
  devolvendo `BoardOut` puro — a `BoardPage` não desenha cadeado.

- [ ] **Step 1: Schema `BoardListOut`**

Acrescentar em `backend/app/schemas/board.py`, depois de `BoardMemberOut`:

```python
class BoardListOut(BoardOut):
    """Item da listagem de quadros.

    Só a listagem tem esses campos; GET /boards/{id} segue devolvendo BoardOut,
    porque a tela do quadro não desenha cadeado.
    """
    can_open: bool
    owner_name: str
    members: list[BoardMemberBriefOut]
```

- [ ] **Step 2: Helper de serialização + listagem aberta**

Em `backend/app/routers/boards.py`, acrescentar o helper logo depois de
`_get_board_or_404` (por volta da linha 33):

```python
def _board_list_item(board: Board, user: User) -> dict:
    """Monta o item da listagem. `can_open` sai daqui — do backend, mesma regra
    da tranca em dependencies.py. Se o frontend recalculasse, cadeado e tranca
    poderiam divergir e a tela mentiria."""
    ids_membros = {m.user_id for m in board.members}
    return {
        "id": board.id,
        "title": board.title,
        "description": board.description,
        "color": board.color,
        "owner_id": board.owner_id,
        "created_at": board.created_at,
        "can_open": user.is_elevated or user.id in ids_membros,
        "owner_name": board.owner.name,
        "members": [
            {"id": m.user.id, "name": m.user.name, "email": m.user.email,
             "initials": m.user.initials, "board_role": m.role}
            for m in board.members
        ],
    }
```

Substituir `list_boards` (`:46-54`) inteiro:

```python
@router.get("", response_model=list[BoardListOut])
async def list_boards(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Todos os quadros da empresa. Quem não é membro recebe can_open=False e
    não passa da tranca se tentar abrir — ver dependencies.py."""
    result = await db.execute(
        select(Board)
        .options(
            selectinload(Board.members).selectinload(BoardMember.user),
            selectinload(Board.owner),
        )
        .order_by(Board.created_at.desc())
    )
    return [_board_list_item(b, current_user) for b in result.scalars().all()]
```

O `selectinload` evita N+1: sem ele, cada quadro dispararia queries de membros e
dono. `selectinload` já está importado na linha 6.

- [ ] **Step 3: `create_board` devolve o mesmo formato**

Substituir `create_board` (`:35-43`):

```python
@router.post("", response_model=BoardListOut, status_code=status.HTTP_201_CREATED)
async def create_board(body: BoardCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = Board(**body.model_dump(), owner_id=current_user.id)
    db.add(board)
    await db.flush()
    db.add(BoardMember(board_id=board.id, user_id=current_user.id, role=BoardRole.owner))
    await db.commit()
    await db.refresh(board)
    # Devolve BoardListOut para a listagem do frontend não precisar inventar os
    # campos ao inserir o quadro recém-criado. Quem cria é dono e único membro.
    return {
        "id": board.id,
        "title": board.title,
        "description": board.description,
        "color": board.color,
        "owner_id": board.owner_id,
        "created_at": board.created_at,
        "can_open": True,
        "owner_name": current_user.name,
        "members": [{
            "id": current_user.id, "name": current_user.name, "email": current_user.email,
            "initials": current_user.initials, "board_role": BoardRole.owner,
        }],
    }
```

Estender o import de schemas (a linha já foi mexida na Task 2):
```python
from app.schemas.board import BoardCreate, BoardUpdate, BoardOut, BoardMemberAdd, BoardMemberOut, BoardListOut
```

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

A Adriana agora **vê** o quadro, trancado:
```bash
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $MEMBRO" \
  | python3 -c 'import sys,json; [print(f"{b[\"title\"]!r} can_open={b[\"can_open\"]} dono={b[\"owner_name\"]!r} membros={len(b[\"members\"])}") for b in json.load(sys.stdin)]'
```
Esperado: `'Serviço' can_open=False dono='Erick H.' membros=1`

Admin e coordenador veem aberto:
```bash
for t in "$ADMIN" "$COORD"; do curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $t" \
  | python3 -c 'import sys,json; [print(f"  can_open={b[\"can_open\"]}") for b in json.load(sys.stdin)]'; done
```
Esperado: `can_open=True` nas duas.

E a tranca continua valendo (ver não é entrar):
```bash
curl -s -o /dev/null -w "Adriana em /boards/20/lists -> HTTP %{http_code}\n" http://localhost:8000/api/boards/20/lists -H "Authorization: Bearer $MEMBRO"
```
Esperado: **403**.

Criar quadro devolve o formato novo — e o mesmo comando já guarda o id para a
limpeza, sem precisar copiar à mão:
```bash
NOVO=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Quadro de teste do plano","color":"#0ea5e9"}' \
  | tee /dev/stderr | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "id criado: $NOVO"
```
Esperado: o JSON aparece na tela com `can_open: true`,
`owner_name: "Erick H."` e um `members` com um item; e `$NOVO` recebe o id.

Limpar o quadro de teste:
```bash
curl -s -o /dev/null -w "delete -> HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$NOVO" -H "Authorization: Bearer $ADMIN"
```
Esperado: `204`. Conferir que sobrou só o quadro 20:
```bash
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print([b["id"] for b in json.load(sys.stdin)])'
```
Esperado: `[20]`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/board.py backend/app/routers/boards.py
git commit -m "$(cat <<'EOF'
feat(quadros): listagem mostra todos os quadros, com can_open

GET /boards devolve todos os quadros da empresa; cada item traz
can_open, owner_name e members. can_open e calculado no backend, com a
mesma regra da tranca — se o frontend recalculasse, cadeado e tranca
poderiam divergir.

POST /boards passa a devolver BoardListOut para a listagem nao precisar
inventar os campos do quadro recem-criado. GET /boards/{id} segue
devolvendo BoardOut: a tela do quadro nao desenha cadeado.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A vitrine (frontend)

O cadeado na tela e a tela amigável para quem cair no quadro trancado pela URL.

**Files:**
- Modify: `frontend/src/lib/api.ts:15-30` (`request`) e `:37-50` (`upload`)
- Modify: `frontend/src/types/index.ts:13-20` (depois de `Board`)
- Modify: `frontend/src/pages/BoardsPage.tsx` (`BoardCard`, `BoardRow`, `BoardsPage`)
- Modify: `frontend/src/pages/BoardPage.tsx:1603-1618` e `:1913-1918`

**Interfaces:**
- Consumes: `GET /api/boards` → `BoardListItem[]` com `can_open`, `owner_name`,
  `members` (Task 3).
- Produces: `ApiError` (classe exportada de `api.ts`, com `.status: number`) —
  a Task 5 usa para tratar o `409` ao adicionar membro duplicado.

- [ ] **Step 1: `ApiError` em `api.ts`**

Hoje o `api.ts` só distingue `401`; qualquer outro erro vira um `Error` genérico
e a origem do problema se perde. Acrescentar a classe no topo de
`frontend/src/lib/api.ts`, logo depois da linha do `API_BASE`:

```ts
/** Erro de API que preserva o status HTTP — sem isto não dá para distinguir
 *  "não é membro" (403) de qualquer outra falha. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
```

Trocar os dois pontos que criam o erro genérico. Em `request` (`:24-27`):
```ts
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail ?? "Erro inesperado");
  }
```
Em `upload` (`:45-48`):
```ts
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail ?? "Erro no upload");
    }
```
O tratamento de `401` fica **exatamente como está** nos dois — não mexer.

- [ ] **Step 2: Tipos**

Em `frontend/src/types/index.ts`, acrescentar logo depois da interface `Board`
(que termina na linha 20):

```ts
/** Pessoa vista pelos seletores e pelos avatares da listagem.
 *  Vem de GET /auth/users/basic e de BoardListItem.members. */
export interface UserBasic {
  id: number;
  name: string;
  initials: string;
}

/** Membro de GET /boards/{id}/members — tem e-mail e papel no quadro, porque
 *  esse endpoint está atrás da tranca de membresia. NÃO é o que vem na
 *  listagem: lá os membros são `UserBasic`, sem e-mail, porque a listagem é
 *  visível a todo mundo. */
export interface BoardMemberOut extends UserBasic {
  email: string;
  board_role: "owner" | "admin" | "member" | "viewer";
}

/** Item de GET /boards. Tipo separado de `Board` porque só a listagem tem
 *  can_open — assim nenhuma tela pode ler o cadeado onde ele não existe. */
export interface BoardListItem extends Board {
  can_open: boolean;
  owner_name: string;
  members: UserBasic[];
}
```

- [ ] **Step 3: Ícones e avatares em `BoardsPage.tsx`**

Acrescentar o cadeado junto dos outros ícones (depois de `IUpload`, por volta da
linha 55-60 de `frontend/src/pages/BoardsPage.tsx`):

```tsx
const ILock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/** Avatares dos membros: mostra até 4 e resume o resto. */
function MemberAvatars({ members }: { members: UserBasic[] }) {
  if (members.length === 0) return null;
  const visiveis = members.slice(0, 4);
  const resto = members.length - visiveis.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {visiveis.map(m => (
        <div
          key={m.id}
          title={m.name}
          className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-300"
        >
          {m.initials}
        </div>
      ))}
      {resto > 0 && (
        <div className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-400">
          +{resto}
        </div>
      )}
    </div>
  );
}
```

Trocar o import de tipos da linha **5** de `frontend/src/pages/BoardsPage.tsx`
(hoje é `import type { Board } from "../types";`) **inteiro**:
```tsx
import type { BoardListItem, UserBasic } from "../types";
```

⚠️ **`Board` sai do import.** Os 8 usos de `Board` neste arquivo (linhas 279,
292, 356, 404, 460, 473, 478, 517) viram todos `BoardListItem` nos passos
seguintes, e o `tsconfig.app.json` tem **`noUnusedLocals: true`** — deixar o
`Board` importado sem uso **quebra o `npm run build`**.

- [ ] **Step 4: `CreateBoardModal` acompanha o tipo novo**

O `POST /boards` passou a devolver `BoardListOut` (Task 3), e o `handleCreated`
do Step 6 recebe `BoardListItem` — se o modal continuar tipado como `Board`, não
compila.

Em `frontend/src/pages/BoardsPage.tsx:279`, trocar a assinatura:
```tsx
function CreateBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: BoardListItem) => void }) {
```

E `:292`, trocar o tipo da resposta:
```tsx
      const board = await api.post<BoardListItem>("/boards", { title: title.trim(), description: description.trim() || null, color });
```

O `catch (err: unknown)` de `:294-295` continua funcionando: `ApiError` estende
`Error`, então `err instanceof Error` segue verdadeiro e a mensagem aparece igual.

- [ ] **Step 5: `BoardCard` trancado**

Substituir `BoardCard` (`:355-399`) inteiro:

```tsx
function BoardCard({ board, starred, onToggleStar, onClick }: {
  board: BoardListItem;
  starred: boolean;
  onToggleStar: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const trancado = !board.can_open;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === "Enter" && onClick()}
      className={cn(
        "group text-left rounded-xl bg-background-surface border border-border transition-all duration-200 overflow-hidden",
        trancado
          ? "cursor-not-allowed opacity-60 hover:opacity-80 hover:border-border"
          : "cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
      )}
    >
      <div className="h-2" style={{ backgroundColor: board.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white/80" style={{ backgroundColor: `${board.color}30` }}>
            {trancado ? <ILock /> : <IBoard />}
          </div>
          {!trancado && (
            <button
              onClick={onToggleStar}
              className={cn(
                "p-1 rounded-md transition-all duration-150",
                starred ? "text-warning opacity-100" : "text-slate-600 opacity-0 group-hover:opacity-100 hover:text-warning",
              )}
            >
              <IStar filled={starred} />
            </button>
          )}
        </div>
        <p className={cn(
          "font-semibold leading-snug mb-1 transition-colors",
          trancado ? "text-slate-400" : "text-slate-100 group-hover:text-primary",
        )}>
          {board.title}
        </p>
        {board.description && (
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{board.description}</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-3">
          <MemberAvatars members={board.members} />
          <p className="text-[11px] text-slate-600 shrink-0">
            {new Date(board.created_at).toLocaleDateString("pt-BR")}
          </p>
        </div>
      </div>
    </div>
  );
}
```

A estrela some no quadro trancado: favoritar um quadro que não abre não faz
sentido.

- [ ] **Step 6: `BoardRow` trancado**

Substituir `BoardRow` (`:403-446`) inteiro:

```tsx
function BoardRow({ board, starred, onToggleStar, onClick }: {
  board: BoardListItem;
  starred: boolean;
  onToggleStar: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const trancado = !board.can_open;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === "Enter" && onClick()}
      className={cn(
        "group w-full flex items-center gap-4 px-4 py-3 rounded-xl bg-background-surface border border-border transition-all duration-200 text-left",
        trancado
          ? "cursor-not-allowed opacity-60 hover:opacity-80"
          : "cursor-pointer hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
      )}
    >
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: board.color }} />
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white/70" style={{ backgroundColor: `${board.color}30` }}>
        {trancado ? <ILock /> : <IBoard />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          "font-semibold text-sm truncate transition-colors",
          trancado ? "text-slate-400" : "text-slate-100 group-hover:text-primary",
        )}>
          {board.title}
        </p>
        {board.description && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{board.description}</p>
        )}
      </div>
      <div className="shrink-0 hidden md:block"><MemberAvatars members={board.members} /></div>
      <p className="text-xs text-slate-600 shrink-0 hidden sm:block">
        {new Date(board.created_at).toLocaleDateString("pt-BR")}
      </p>
      {!trancado && (
        <button
          onClick={onToggleStar}
          className={cn(
            "p-1.5 rounded-md transition-all duration-150 shrink-0",
            starred ? "text-warning opacity-100" : "text-slate-600 opacity-0 group-hover:opacity-100 hover:text-warning",
          )}
        >
          <IStar filled={starred} />
        </button>
      )}
      <span className={cn("shrink-0 transition-colors", trancado ? "text-slate-700" : "text-slate-600 group-hover:text-primary")}>
        {trancado ? <ILock /> : <IArrow />}
      </span>
    </div>
  );
}
```

- [ ] **Step 7: O aviso ao clicar**

Não existe sistema de toast no projeto e não vale criar um por causa de uma
mensagem. Um aviso local, que some sozinho, resolve.

Em `BoardsPage` (`:458` em diante), acrescentar o state junto dos outros:
```tsx
  const [aviso, setAviso] = useState<string | null>(null);
```

Trocar o tipo do state de boards (`:460`):
```tsx
  const [boards, setBoards] = useState<BoardListItem[]>([]);
```
e o load (`:472-476`):
```tsx
  useEffect(() => {
    api.get<BoardListItem[]>("/boards")
      .then(setBoards)
      .finally(() => setLoading(false));
  }, []);
```

Trocar `handleCreated` (`:478-482`) — o backend agora devolve `BoardListItem`:
```tsx
  function handleCreated(board: BoardListItem) {
    setBoards(prev => [board, ...prev]);
    setShowModal(false);
    navigate(`/boards/${board.id}`);
  }
```

Acrescentar o handler do clique, logo antes de `renderBoard`:
```tsx
  /** Quadro trancado não navega: avisa com quem falar. O 403 do backend é a
   *  barreira de verdade — isto aqui é só a cortesia. */
  function abrirBoard(board: BoardListItem) {
    if (board.can_open) {
      navigate(`/boards/${board.id}`);
      return;
    }
    setAviso(`Você não é membro deste quadro. Fale com ${board.owner_name} para pedir acesso.`);
  }
```

Trocar `renderBoard` (`:517-536`):
```tsx
  function renderBoard(board: BoardListItem) {
    const starred = favorites.includes(board.id);
    return view === "grid" ? (
      <BoardCard
        key={board.id}
        board={board}
        starred={starred}
        onToggleStar={e => toggleStar(e, board.id)}
        onClick={() => abrirBoard(board)}
      />
    ) : (
      <BoardRow
        key={board.id}
        board={board}
        starred={starred}
        onToggleStar={e => toggleStar(e, board.id)}
        onClick={() => abrirBoard(board)}
      />
    );
  }
```

Acrescentar o efeito que limpa o aviso, junto dos outros hooks (depois do
`useEffect` do load):
```tsx
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);
```

E o aviso em si — acrescentar como **primeiro filho** do `<div className="flex
flex-col flex-1 min-h-0">` que abre o return da `BoardsPage` (`:539`):
```tsx
        {aviso && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-background-elevated px-4 py-3 shadow-2xl">
            <span className="text-slate-400 shrink-0"><ILock /></span>
            <p className="text-sm text-slate-200">{aviso}</p>
            <button onClick={() => setAviso(null)} className="ml-2 text-xs text-slate-500 hover:text-slate-300 shrink-0">Fechar</button>
          </div>
        )}
```

- [ ] **Step 8: Tela de sem-acesso na `BoardPage`**

Quem digitar `/boards/20` sem ser membro leva 403 do backend. Hoje o
`Promise.all` (`:1605-1617`) não tem `.catch`, então isso vira rejeição não
tratada no console e cai na tela genérica "Board não encontrado" — que mente
sobre o motivo.

Em `frontend/src/pages/BoardPage.tsx`, acrescentar o state junto dos outros
(perto de `:1546`):
```tsx
  const [semAcesso, setSemAcesso] = useState(false);
```

Trocar o `useEffect` do load (`:1603-1618`):
```tsx
  useEffect(() => {
    if (!boardId) return;
    Promise.all([
      api.get<Board>(`/boards/${boardId}`),
      api.get<BoardList[]>(`/boards/${boardId}/lists`),
      api.get<BoardLabel[]>(`/boards/${boardId}/labels`),
    ]).then(async ([b, ls, lbls]) => {
      setBoard(b);
      setLists(ls);
      setBoardLabels(lbls);
      const entries = await Promise.all(
        ls.map(l => api.get<Card[]>(`/lists/${l.id}/cards`).then(cards => [l.id, cards] as [number, Card[]]))
      );
      setCardsByList(Object.fromEntries(entries));
    }).catch(e => {
      // 403 = não é membro. Sem este catch a rejeição fica solta no console e a
      // tela diz "não encontrado", que é mentira.
      if (e instanceof ApiError && e.status === 403) setSemAcesso(true);
    }).finally(() => setLoading(false));
  }, [boardId]);
```

Acrescentar a tela, **antes** do `if (!board)` de `:1913`:
```tsx
  if (semAcesso) return (
    <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-background-elevated border border-border flex items-center justify-center text-slate-500">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <p className="text-slate-300 font-semibold">Você não é membro deste quadro</p>
      <p className="text-sm text-slate-500 max-w-sm">Peça para o dono do quadro te adicionar como membro.</p>
      <button onClick={() => navigate("/boards")} className="text-sm text-primary hover:underline mt-1">Voltar para os quadros</button>
    </div>
  );
```

Trocar o import da linha **15** de `frontend/src/pages/BoardPage.tsx`:
```tsx
import { api, ApiError } from "../lib/api";
```

- [ ] **Step 9: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro de TypeScript.

No navegador (reiniciar `npm run dev` se tiver trocado de branch):
1. Logar como **Adriana** (`comercial02@healthsafetytech.com` / `mudar123`) e ir
   em `/boards` → o quadro "Serviço" **aparece**, apagado, com cadeado e o
   avatar do Erick H.
2. Clicar nele → não navega; aparece o aviso *"Você não é membro deste quadro.
   Fale com Erick H. para pedir acesso."*, que some em 5s.
3. Digitar `/boards/20` na URL → tela "Você não é membro deste quadro", **sem**
   erro no console.
4. Logar como **coordenador** (`np@healthsafetytech.com` / `mudar123`) → o mesmo
   quadro aparece normal, abre.
5. Logar como **admin** → abre normal, sem regressão.

- [ ] **Step 10: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/lib/api.ts frontend/src/types/index.ts frontend/src/pages/BoardsPage.tsx frontend/src/pages/BoardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): cadeado nos quadros de que a pessoa nao e membro

A listagem passa a mostrar todos os quadros da empresa; os que a pessoa
nao pode abrir vem apagados, com cadeado e os avatares dos membros, e o
clique avisa com quem falar em vez de navegar.

api.ts ganha ApiError com o status HTTP: sem isso nao dava para
distinguir 403 de qualquer outra falha. Com ele, quem digita /boards/N
sem ser membro cai numa tela que diz o motivo — antes a promise rejeitava
solta no console e a tela dizia "nao encontrado", que era mentira.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tela de membros do quadro

Onde o Erick adiciona quem precisa. Sem isto a membresia só nasce criando quadro
ou importando do Trello — e a tranca fica sem chave na prática.

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:285-289` (seletor de membros do card — bug pré-existente)
- Modify: `frontend/src/pages/BoardPage.tsx:2090-2165` (modal "Configurações do board")
- Modify: `frontend/src/types/index.ts` (tipo `UserBasic`)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/boards/{id}/members` (Task 2); `ApiError`
  (Task 4); `BoardMemberOut` (Task 4).
- Consumes: **`GET /api/auth/users/basic`** — endpoint criado junto da Task 2.
  Devolve `[{id, name, initials}]` de todos os usuários ativos, ordenados por
  nome, para **qualquer pessoa autenticada**.

  ⚠️ **Não use `GET /api/auth/users` aqui.** Ele exige administrador ou
  coordenador (`get_elevated_user`, `auth.py:76`) e devolve dados de gestão
  (papel, e-mail, `is_active`, data). Um membro comum leva 403.

- [ ] **Step 0: Consertar o seletor de membros do card (bug pré-existente)**

Antes da tela nova, um bug que já está em produção: `BoardPage.tsx:287` usa o
`/auth/users` restrito para montar o seletor de membros **do card**, com
`.catch(() => {})`. Para um membro comum isso dá 403 silencioso → `allUsers`
fica `[]` → o seletor mostra **"Carregando…" para sempre** (`:583`). Ou seja,
nenhum dos 20 membros comuns consegue atribuir alguém a um card. Verificado em
2026-07-16.

Em `frontend/src/types/index.ts`, acrescentar:
```ts
/** Pessoa vista pelos seletores (membros de card, membros de quadro).
 *  Vem de GET /auth/users/basic, liberado a qualquer autenticado. */
export interface UserBasic {
  id: number;
  name: string;
  initials: string;
}
```

Em `frontend/src/pages/BoardPage.tsx`, trocar o `useEffect` de `:285-289`:
```tsx
  useEffect(() => {
    if (showMemberPicker && allUsers.length === 0) {
      api.get<UserBasic[]>("/auth/users/basic").then(setAllUsers).catch(() => {});
    }
  }, [showMemberPicker]);
```

O state `allUsers` e o `availableUsers` (`:449`) passam a ser `UserBasic[]`.
Ajuste as declarações. O `handleAddMember(u)` (`:343`) recebe o `u` e faz
`POST /lists/{list_id}/cards/{card_id}/members/{u.id}`; ele monta a lista local
de membros do card com o objeto — como `UserBasic` não tem `email`/`role`, e o
`Card.members` é `User[]`, verifique o que a UI do card realmente lê desses
objetos (`:565` em diante) e ajuste o tipo de `Card.members` para `UserBasic[]`
**apenas se** nada ler campos além de `id`/`name`/`initials`. Se algo ler mais,
mantenha `User[]` e converta no `handleAddMember`. Reporte qual caminho tomou e
por quê.

- [ ] **Step 1: State e carregamento**

Em `frontend/src/pages/BoardPage.tsx`, acrescentar junto dos states do modal de
board (perto de `:1564-1571`):

```tsx
  const [boardMembers, setBoardMembers] = useState<BoardMemberOut[]>([]);
  const [todosUsuarios, setTodosUsuarios] = useState<UserBasic[]>([]);
  const [erroMembro, setErroMembro] = useState<string | null>(null);
  const [salvandoMembro, setSalvandoMembro] = useState(false);
```

Carregar só quando o modal abre — não faz sentido buscar isso no load do quadro:

```tsx
  useEffect(() => {
    if (!showEditBoard || !boardId) return;
    api.get<BoardMemberOut[]>(`/boards/${boardId}/members`).then(setBoardMembers).catch(() => {});
    api.get<UserBasic[]>("/auth/users/basic").then(setTodosUsuarios).catch(() => {});
  }, [showEditBoard, boardId]);
```

- [ ] **Step 2: Handlers**

Acrescentar perto dos outros handlers do board (`handleSaveBoard` está por volta
de `:1769`):

```tsx
  async function handleAddBoardMember(userId: number) {
    setSalvandoMembro(true);
    setErroMembro(null);
    try {
      await api.post(`/boards/${boardId}/members`, { user_id: userId, role: "member" });
      setBoardMembers(await api.get<BoardMemberOut[]>(`/boards/${boardId}/members`));
    } catch (e) {
      setErroMembro(e instanceof ApiError ? e.message : "Não foi possível adicionar.");
    } finally {
      setSalvandoMembro(false);
    }
  }

  async function handleRemoveBoardMember(userId: number) {
    setErroMembro(null);
    try {
      await api.del(`/boards/${boardId}/members/${userId}`);
      setBoardMembers(prev => prev.filter(m => m.id !== userId));
    } catch (e) {
      setErroMembro(e instanceof ApiError ? e.message : "Não foi possível remover.");
    }
  }
```

Recarregar do servidor depois de adicionar (em vez de montar o objeto na mão)
mantém a lista igual à verdade do banco, inclusive a ordenação por nome.

- [ ] **Step 3: A seção no modal**

Em `frontend/src/pages/BoardPage.tsx`, dentro do modal "Configurações do board",
acrescentar **depois** do botão "Salvar alterações" (`:2136-2142`) e **antes** do
`</div>` que fecha o `<div className="flex-1 overflow-y-auto p-5 space-y-4">`
(`:2143`):

```tsx
                {/* ── Membros do quadro ── */}
                <div className="pt-4 border-t border-border space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">Membros do quadro</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Só os membros abrem este quadro. Administradores e coordenadores entram em todos.
                    </p>
                  </div>

                  {erroMembro && (
                    <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{erroMembro}</p>
                  )}

                  <div className="space-y-1.5">
                    {boardMembers.map(m => {
                      const ehDono = m.board_role === "owner";
                      return (
                        <div key={m.id} className="flex items-center gap-2.5 rounded-lg bg-background-elevated px-3 py-2">
                          <div className="w-7 h-7 rounded-full bg-background-surface border border-border flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                            {m.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">{m.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{m.email}</p>
                          </div>
                          {ehDono ? (
                            <span className="text-[10px] font-semibold text-slate-500 shrink-0">dono</span>
                          ) : (
                            <button
                              onClick={() => handleRemoveBoardMember(m.id)}
                              title={`Remover ${m.name}`}
                              className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                            >
                              <IX />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    // O /auth/users/basic ja devolve so usuarios ativos, ordenados por nome.
                    const disponiveis = todosUsuarios.filter(
                      u => !boardMembers.some(m => m.id === u.id)
                    );
                    if (disponiveis.length === 0) {
                      return <p className="text-[11px] text-slate-500 italic">Todo mundo já está neste quadro.</p>;
                    }
                    return (
                      <select
                        value=""
                        disabled={salvandoMembro}
                        onChange={e => { if (e.target.value) handleAddBoardMember(Number(e.target.value)); }}
                        className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                      >
                        <option value="">{salvandoMembro ? "Adicionando…" : "Adicionar membro…"}</option>
                        {disponiveis.map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
```

`IX` e `User` já estão em uso no arquivo (`IX` no header do próprio modal,
`User` no seletor de membros do card) — não reimportar.

Trocar o import de tipos da linha **16** de `frontend/src/pages/BoardPage.tsx`
(é a linha atual, com `BoardMemberOut` acrescentado no fim):
```tsx
import type { Board, BoardList, Card, Comment, Priority, Label, BoardLabel, User, Checklist, ChecklistItem, Attachment, Reminder, Automation, BoardMemberOut } from "../types";
```

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

No navegador, como **admin**:
1. Abrir o quadro 20 → **Configurações** → a seção "Membros do quadro" mostra
   `Erick H.` com o rótulo `dono` e **sem** botão de remover.
2. Adicionar `Adriana Paz` pelo select → ela aparece na lista.
3. Tentar adicionar ela de novo → ela **não** está no select (já é membro).
4. Em outra janela/aba anônima, logar como **Adriana** → `/boards` mostra o
   quadro **sem** cadeado, e ele **abre**.
5. Voltar como admin → remover a Adriana pelo `X`.
6. Na aba da Adriana, recarregar `/boards` → o cadeado **voltou**, e
   `/boards/20` cai na tela de sem-acesso.

Confirmar que o banco voltou ao estado inicial:
```bash
curl -s http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN" | python3 -m json.tool
```
Esperado: só o usuário 1 (`Erick H.`, `owner`).

- [ ] **Step 5: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/pages/BoardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): gerir membros do quadro nas Configuracoes

Antes nao havia nenhuma tela para isso: a membresia so nascia ao criar o
quadro ou importar do Trello, ambos pondo so o criador como owner. Era
por isso que o unico quadro do sistema tinha um membro so.

A lista carrega ao abrir o modal (nao no load do quadro). O dono aparece
rotulado e sem botao de remover, espelhando a regra do backend.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Changelog e CLAUDE.md

O `CLAUDE.md` documenta hoje que "Autorização é mínima… sem checar membership do
board". Depois desta branch isso fica **factualmente errado**, e um futuro
Claude leria a garantia ao contrário.

**Files:**
- Modify: `frontend/src/data/changelog.ts:15-22` (topo do array)
- Modify: `CLAUDE.md` (seção "Gotchas importantes", bullet de autorização; e a
  seção "Routers")

**Interfaces:**
- Consumes: nada. `APP_VERSION` deriva de `CHANGELOG[0]` automaticamente.

- [ ] **Step 1: Entrada no changelog**

Em `frontend/src/data/changelog.ts`, inserir como **primeiro** item do array
`CHANGELOG` (antes da entrada `1.3.1`):

```ts
  {
    version: "1.4.0",
    date: "2026-07-16",
    changes: [
      { kind: "novidade", text: "Todos os quadros da empresa agora aparecem na listagem: os que você não participa vêm com cadeado, mostrando quem são os membros e com quem falar para pedir acesso." },
      { kind: "novidade", text: "Configurações do board agora tem a seção Membros do quadro, para adicionar e remover pessoas." },
      { kind: "correcao", text: "Correção de segurança: quadros de que você não é membro agora ficam realmente inacessíveis — antes, qualquer pessoa logada conseguia abrir qualquer quadro pelo endereço e ler listas, cards e comentários." },
      { kind: "correcao", text: "Correção de segurança: apenas o dono do quadro (ou um administrador) pode gerenciar os membros — antes qualquer pessoa podia se adicionar a qualquer quadro." },
    ],
  },
```

Versão **1.4.0**: a regra do `CLAUDE.md` manda minor para novidade; há novidade
grande (a vitrine) e correções de segurança juntas.

- [ ] **Step 2: Corrigir o `CLAUDE.md`**

Em `CLAUDE.md`, na seção **"Gotchas importantes"**, substituir o bullet que
começa com `**Autorização é mínima:**` por:

```markdown
- **Autorização por membresia (desde v1.4.0):** os routers `lists`, `labels`,
  `automations` (por `board_id`) e `cards`, `attachments`, `reminders` (por
  `list_id`) têm a tranca aplicada **no nível do router** — `dependencies=[...]`
  no `APIRouter(...)`, com `require_board_access_by_board_id` /
  `require_board_access_by_list_id` ([dependencies.py](backend/app/dependencies.py)).
  Endpoint novo nesses routers **já nasce trancado**; não replicar a checagem
  dentro dos endpoints. A regra: elevado (administrador/coordenador) entra em
  qualquer quadro; senão exige linha em `board_members`; senão 403. Em
  [boards.py](backend/app/routers/boards.py) o gate vai **por endpoint**, porque
  o router `/boards` tem rotas sem `board_id` (`GET`/`POST /boards`, `/stats`,
  `/import`). Gestão de membros (`add_member`/`remove_member`) e
  `update_board`/`delete_board` exigem **dono ou elevado**. O router
  `integration` não tem usuário (usa `X-API-Key`) e fica fora disso.
```

Na seção **"Routers"**, acrescentar ao bullet de `boards` a menção aos membros —
substituir a linha:
```markdown
- `boards` → `/api/boards` (inclui `/import` SSE e `/stats`)
```
por:
```markdown
- `boards` → `/api/boards` (inclui `/import` SSE, `/stats` e os membros do
  quadro: `GET`/`POST /{id}/members`, `DELETE /{id}/members/{user_id}`).
  `GET /api/boards` lista **todos** os quadros, cada um com `can_open`,
  `owner_name` e `members` (schema `BoardListOut`); `GET /api/boards/{id}`
  devolve o `BoardOut` puro.
```

- [ ] **Step 3: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

No navegador: o rodapé da sidebar mostra **TaskHS · v1.4.0**; clicar abre o
`ChangelogModal` com a 1.4.0 no topo, marcada como "Versão atual".

- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/data/changelog.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: changelog v1.4.0 e CLAUDE.md sobre a tranca de membresia

O CLAUDE.md dizia "Autorizacao e minima: quase todo endpoint exige
apenas get_current_user, sem checar membership do board". Isso passou a
ser falso nesta branch, e um futuro Claude leria a garantia ao
contrario. Substituido pela regra real, incluindo o fato de o gate ser
de router (endpoint novo ja nasce trancado).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final da branch

Antes do review final da branch inteira, rodar a bateria completa de uma vez —
é a mesma que expôs o furo no começo, agora invertida:

```bash
cd /home/ericks/github/TaskHS
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok healthsafetyti@gmail.com admin123)
COORD=$(tok np@healthsafetytech.com mudar123)
MEMBRO=$(tok comercial02@healthsafetytech.com mudar123)

echo "== nao-membro: tudo 403 =="
for p in /api/boards/20 /api/boards/20/lists /api/boards/20/labels /api/boards/20/archived /api/boards/20/automations /api/boards/20/members /api/lists/20/cards; do
  printf "  %-34s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8000$p" -H "Authorization: Bearer $MEMBRO")"
done

echo "== nao-membro nao se auto-adiciona =="
curl -s -o /dev/null -w "  POST members: %{http_code}\n" -X POST http://localhost:8000/api/boards/20/members \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"owner"}'

echo "== mas VE o quadro, trancado =="
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $MEMBRO" \
  | python3 -c 'import sys,json; [print(f"  {b[\"title\"]!r} can_open={b[\"can_open\"]} dono={b[\"owner_name\"]!r}") for b in json.load(sys.stdin)]'

echo "== admin e coordenador: tudo 200 =="
for t in "$ADMIN" "$COORD"; do
  for p in /api/boards/20 /api/boards/20/lists /api/lists/20/cards /api/boards/20/members; do
    printf "  %-34s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8000$p" -H "Authorization: Bearer $t")"
  done; echo "  --"
done

echo "== auditoria registrou as tentativas =="
curl -s "http://localhost:8000/api/logs?action=acesso_negado&limit=3" -H "Authorization: Bearer $ADMIN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  total:", d["total"]); [print("  ", i["actor_name"], "|", i["path"]) for i in d["items"]]'
```

Esperado: sete `403` · `403` no auto-add · `can_open=False` com o quadro visível
· oito `200` para admin/coordenador · tentativas na auditoria.

```bash
cd frontend && npm run build
```
Esperado: build sem erro.

**Estado do banco ao final:** o quadro 20 deve ter **só** o usuário 1 como
membro, e não deve existir quadro nem card de teste. Conferir:
```bash
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("boards:", [b["id"] for b in json.load(sys.stdin)])'
curl -s http://localhost:8000/api/boards/20/members -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("membros do 20:", [m["id"] for m in json.load(sys.stdin)])'
```
Esperado: `boards: [20]` e `membros do 20: [1]`.

---

### Task 7: Fechar a escrita cross-board em `cards.py`

**Origem:** achado do review da Task 1, confirmado no código e **aprovado pelo Erick**
para entrar nesta branch. A tranca das Tasks 1-3 fecha **leitura**, mas quatro
caminhos de **escrita** passam por baixo dela: o gate lê o `list_id` da **URL**, e
esses endpoints aceitam o destino no **corpo** da requisição.

São bugs **pré-existentes** (não são regressão da feature) e hoje não são
exploráveis, porque ninguém é membro de quadro nenhum além do dono. Mas viram
exploráveis **exatamente quando a membresia começar a ser usada**, que é o ponto
da feature. Nenhuma outra task toca `cards.py`, então sem esta eles atravessam a
branch inteira e vão para produção — a branch chama-se "tranca de quadros" e
entregaria a porta dos fundos aberta.

**Files:**
- Modify: `backend/app/dependencies.py` (extrair a regra para uso fora de dependency)
- Modify: `backend/app/routers/cards.py` (`update_card`, `copy_card`, `remove_card_member`, `remove_label`, `add_label`)

**Interfaces:**
- Consumes: `require_board_access_by_list_id` (Task 1); `_get_card_or_404(card_id, list_id, db)` (`cards.py:83`, já existe e já levanta 404).
- Produces:
  - `user_can_access_list(list_id: int, user: User, db: AsyncSession) -> bool` — a regra crua.
  - `assert_board_access_by_list_id(list_id: int, user: User, db: AsyncSession) -> None` — levanta `403 "Você não é membro deste quadro"`. É a versão chamável **dentro** de um endpoint, para quando o destino vem no corpo.

- [ ] **Step 1: Extrair a regra, sem duplicá-la**

Em `backend/app/dependencies.py`, a lógica hoje vive dentro da dependency
`require_board_access_by_list_id`. Extraia-a para que a mesma regra sirva aos dois
usos (dependency de router e checagem dentro do endpoint) — **uma fonte de verdade
só**, como manda a restrição global.

Substitua `require_board_access_by_list_id` inteira por:

```python
async def user_can_access_list(list_id: int, user: User, db: AsyncSession) -> bool:
    """A regra crua: esta pessoa alcança o quadro desta lista?

    Elevado (administrador/coordenador) alcança qualquer um. Lista inexistente
    devolve False para não-elevado — o JOIN não acha nada — o que é o que
    queremos: não revelar a existência de listas de quadros alheios.
    """
    if user.is_elevated:
        return True
    q = await db.execute(
        select(BoardMember.id)
        .join(ListModel, ListModel.board_id == BoardMember.board_id)
        .where(ListModel.id == list_id, BoardMember.user_id == user.id)
        .limit(1)
    )
    return q.scalars().first() is not None


async def assert_board_access_by_list_id(list_id: int, user: User, db: AsyncSession) -> None:
    """A mesma tranca, para chamar DENTRO de um endpoint.

    Existe porque alguns endpoints recebem a lista de destino no CORPO da
    requisição, e a dependency de router só valida o que está na URL.
    """
    if not await user_can_access_list(list_id, user, db):
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")


async def require_board_access_by_list_id(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Tranca dos routers cujo prefixo tem {list_id}."""
    await assert_board_access_by_list_id(list_id, current_user, db)
    return current_user
```

Não mexa em `require_board_access_by_board_id`.

- [ ] **Step 2: `update_card` — o destino vem no corpo**

`backend/app/routers/cards.py`, `update_card` (~linha 118). `CardUpdate.list_id`
(`schemas/card.py:81`) é campo de corpo; o `setattr` do laço aplica ele e o
`run_card_moved_automations` dispara as automações **do quadro de destino**.

Ataque hoje: membro do quadro A faz `PATCH /lists/<lista_do_A>/cards/<card>` com
`{"list_id": <lista_do_B>}` → o gate valida a lista do A (dela) e passa → o card vai
para o quadro B e aciona as automações de lá, sem ela poder nem ler o B.

Depois de obter o `card` e o `data` (`data = body.model_dump(exclude_none=True)`),
**antes** do laço de `setattr`, acrescente:

```python
    # O destino vem no CORPO: a tranca do router so validou o list_id da URL.
    # Sem isto, um membro do quadro A move um card para o quadro B — e dispara as
    # automacoes de la — sem poder nem ler o B.
    if "list_id" in data and data["list_id"] != card.list_id:
        await assert_board_access_by_list_id(data["list_id"], current_user, db)
        destino = (await db.execute(
            select(List.id).where(List.id == data["list_id"]).limit(1)
        )).scalars().first()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
```

**A ordem importa:** a checagem de acesso vem **antes** da de existência. Invertida,
um não-membro distinguiria "lista não existe" (404) de "lista existe mas é de outro
quadro" (403) e enumeraria listas alheias. Como está, o não-membro leva 403 nos dois
casos; só o elevado chega a ver o 404.

- [ ] **Step 3: `copy_card` — mesma forma, via `target_list_id`**

`cards.py`, `copy_card` (~linha 148). `target_list_id = body.target_list_id or list_id`
(~linha 152) entra sem nenhuma checagem.

Logo **depois** da linha que calcula `target_list_id` e **antes** de qualquer uso
dela, acrescente:

```python
    if target_list_id != list_id:
        # Mesmo buraco do update_card: destino no corpo, gate so na URL.
        await assert_board_access_by_list_id(target_list_id, current_user, db)
        destino = (await db.execute(
            select(List.id).where(List.id == target_list_id).limit(1)
        )).scalars().first()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
```

- [ ] **Step 4: `remove_card_member` — não amarra o card à lista**

`cards.py`, `remove_card_member` (~linha 253). Ao contrário dos endpoints irmãos,
esta função **não** chama `_get_card_or_404`: ela seleciona `CardMember` só por
`card_id` + `user_id`, então o `list_id` da URL não restringe nada.

Ataque hoje: `DELETE /lists/<lista_do_A>/cards/<card_do_B>/members/<user>` → o gate
valida a lista do A e passa → remove o membro de um card do quadro B.

Acrescente a primeira linha do corpo, como os irmãos já fazem:

```python
    await _get_card_or_404(card_id, list_id, db)
```

- [ ] **Step 5: `remove_label` — idêntico**

`cards.py`, `remove_label` (~linha 277). Mesmo problema: seleciona `CardLabel` por
`card_id` + `label_id`, sem escopo de lista.

Acrescente a primeira linha do corpo:

```python
    await _get_card_or_404(card_id, list_id, db)
```

- [ ] **Step 6: `add_label` — a etiqueta pode ser de outro quadro**

`cards.py`, `add_label` (~linha 266). Ele **chama** `_get_card_or_404` (bom), mas
nada amarra `body.label_id` a uma etiqueta **do quadro do card**.

Vazamento hoje: a pessoa põe uma etiqueta do quadro B num card **dela** e depois lê o
próprio card — `_card_to_dict` devolve `{"label": <nome da etiqueta do B>, "color": ...}`.
Enumerando `label_id`, ela lê nome e cor de todas as etiquetas de todos os quadros,
através da tranca.

Depois do `_get_card_or_404` e **antes** do `existing`, acrescente:

```python
    # A etiqueta tem que ser do MESMO quadro do card; senao da para colar uma
    # etiqueta de outro quadro no proprio card e ler nome/cor dela de volta.
    etiqueta = (await db.execute(
        select(BoardLabel.id)
        .join(List, List.board_id == BoardLabel.board_id)
        .where(BoardLabel.id == body.label_id, List.id == list_id)
        .limit(1)
    )).scalars().first()
    if etiqueta is None:
        raise HTTPException(status_code=404, detail="Etiqueta não encontrada neste quadro")
```

`BoardLabel` e `List` já estão importados em `cards.py` (linhas 8 e 9).

- [ ] **Step 7: Acrescentar o import em `cards.py`**

A linha 17 já é `from app.dependencies import get_current_user, require_board_access_by_list_id`.
Estenda:

```python
from app.dependencies import get_current_user, require_board_access_by_list_id, assert_board_access_by_list_id
```

- [ ] **Step 8: Verificar**

```bash
docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

Esta verificação precisa de **dois quadros** e de alguém que seja membro de um só —
essa é a configuração que expõe o furo. Monte, ataque, e desmonte:

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok healthsafetyti@gmail.com admin123)
MEMBRO=$(tok comercial02@healthsafetytech.com mudar123)   # Adriana, user 14

# Quadro A: da Adriana (ela cria, entao e dona e membro)
A=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $MEMBRO" \
  -H 'Content-Type: application/json' -d '{"title":"zzz A da Adriana","color":"#0ea5e9"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
LA=$(curl -s -X POST "http://localhost:8000/api/boards/$A/lists" -H "Authorization: Bearer $MEMBRO" \
  -H 'Content-Type: application/json' -d '{"title":"lista A"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
CA=$(curl -s -X POST "http://localhost:8000/api/lists/$LA/cards" -H "Authorization: Bearer $MEMBRO" \
  -H 'Content-Type: application/json' -d '{"title":"card da Adriana"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Quadro B: do admin. A Adriana NAO e membro.
B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"title":"zzz B do admin","color":"#ef4444"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
LB=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"title":"lista B"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
CB=$(curl -s -X POST "http://localhost:8000/api/lists/$LB/cards" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"title":"card do admin"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
EB=$(curl -s -X POST "http://localhost:8000/api/boards/$B/labels" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"name":"SEGREDO DO QUADRO B","color":"#ef4444"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

echo "A=$A LA=$LA CA=$CA | B=$B LB=$LB CB=$CB EB=$EB"
echo
echo "1) mover card DELA para a lista do B (Step 2):"
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 403)\n" -X PATCH "http://localhost:8000/api/lists/$LA/cards/$CA" \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d "{\"list_id\": $LB}"

echo "2) copiar card DELA para a lista do B (Step 3):"
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 403)\n" -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/copy" \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d "{\"target_list_id\": $LB}"

echo "3) remover membro de um card DO B, pela lista dela (Step 4):"
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 404)\n" -X DELETE "http://localhost:8000/api/lists/$LA/cards/$CB/members/1" \
  -H "Authorization: Bearer $MEMBRO"

echo "4) remover etiqueta de um card DO B, pela lista dela (Step 5):"
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 404)\n" -X DELETE "http://localhost:8000/api/lists/$LA/cards/$CB/labels/$EB" \
  -H "Authorization: Bearer $MEMBRO"

echo "5) colar etiqueta do B no card DELA (Step 6):"
curl -s -w "   <- HTTP %{http_code}  (esperado 404)\n" -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/labels" \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d "{\"label_id\": $EB}"

echo "6) NAO houve regressao — ela ainda mexe no quadro dela:"
curl -s -o /dev/null -w "   mover dentro do A: HTTP %{http_code}  (esperado 200)\n" -X PATCH "http://localhost:8000/api/lists/$LA/cards/$CA" \
  -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d '{"title":"card renomeado pela dona"}'

echo "7) o admin (elevado) continua passando em tudo:"
curl -s -o /dev/null -w "   admin move card do B: HTTP %{http_code}  (esperado 200)\n" -X PATCH "http://localhost:8000/api/lists/$LB/cards/$CB" \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"admin renomeou"}'

echo
echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga A: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$A" -H "Authorization: Bearer $ADMIN"
curl -s -o /dev/null -w "   apaga B: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado: `403`, `403`, `404`, `404`, `404`, `200`, `200`, e ao final
`boards restantes: [20]`.

**Se algum dos cinco primeiros devolver `200`, o furo continua aberto** — investigue
e reporte, não maquie.

- [ ] **Step 9: Commit**

```bash
git add backend/app/dependencies.py backend/app/routers/cards.py
git commit -m "$(cat <<'EOF'
fix(seg): fecha a escrita cross-board em cards.py

A tranca das tasks anteriores fecha leitura, mas o gate le o list_id da
URL e estes endpoints aceitam o destino no CORPO — entao um membro do
quadro A escrevia no quadro B sem poder nem ler o B:

- update_card: {"list_id": <lista do B>} movia o card e ainda disparava
  as automacoes do B
- copy_card: idem via target_list_id
- remove_card_member e remove_label: nao amarravam o card a lista do
  path (nao chamavam _get_card_or_404 como os endpoints irmaos)
- add_label: nao validava que a etiqueta e do quadro do card, o que
  permitia ler nome/cor de etiqueta de qualquer quadro

Todos pre-existentes, mas so viram explorateis quando a membresia comeca
a ser usada — que e o ponto desta branch.

A regra continua tendo uma fonte so: user_can_access_list/
assert_board_access_by_list_id em dependencies.py, de onde a dependency
de router tambem passa a derivar.

Nas checagens, o acesso vem antes da existencia: invertido, um nao-membro
distinguiria "lista nao existe" de "lista de outro quadro" e enumeraria.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
