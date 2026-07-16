# Membros de card: quem está no card está no quadro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estabelecer a invariante **atribuído a um card ⇒ membro do quadro**, para
que notificação e lembrete nunca entreguem o título de um card que a pessoa não
consegue abrir.

**Architecture:** Três caminhos quebram a invariante e cada um ganha sua peça —
atribuir (valida na escrita), remover do quadro (limpa, com aviso) e mover card entre
quadros (tira quem não é do destino). Uma quarta peça é a rede: o loop de lembretes
filtra por membresia, porque é o único lugar que **empurra** título de card para as
pessoas.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), asyncpg,
Pydantic v2, React 19 + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-16-membros-de-card-design.md`

## Global Constraints

- **A invariante:** quem está em `card_members` de um card é membro (`board_members`)
  do quadro daquele card. Nenhum caminho pode deixá-la falsa.
- **Mensagens exatas** (detail do backend, em português):
  - atribuir não-membro → `403` · `"Essa pessoa não é membro deste quadro"`
  - atribuir usuário inexistente/inativo → `404` · `"Usuário não encontrado"`
- **O filtro do loop de lembretes NÃO consulta `is_elevated`.** De propósito: um
  administrador alcança qualquer quadro pela tranca, mas só recebe lembrete se estiver
  **atribuído** ao card — e para ser atribuído precisa ser membro (regra 1). Não há
  caso especial. Não "conserte" isso.
- `assigned_cards` conta **todos** os cards do quadro em que a pessoa está atribuída,
  **inclusive arquivados** — porque a remoção afeta todos, e o aviso tem que dizer a
  verdade sobre o que vai acontecer.
- **Sem migrations:** nenhuma mudança de schema nesta branch. `card_members` está
  **vazia** no banco (verificado em 2026-07-16) — a invariante nasce limpa, sem
  backfill.
- **Não há suíte de testes** no projeto (nem pytest, nem no front) — é deliberado e
  está no `CLAUDE.md`. Verificação é manual: `curl` + navegador + `npm run build`.
  **Não inventar comandos de teste.**
- **Toda a implementação na branch `feat/membros-de-card`** (criada na Task 1), nunca
  direto na `main`.
- Mensagens de interface em português.

## ⚠️ O banco é o de PRODUÇÃO, e produção está DEPLOYADA

`backend/.env` aponta para `62.72.11.28:9874`, o mesmo banco de
`https://taskhs.healthsafetytech.com`, que está **no ar** desde 2026-07-16 com 27
contas reais. O Erick optou conscientemente por seguir assim.

Duas consequências que mudam como se testa:

1. **A listagem da v1.4.0 mostra TODOS os quadros para TODO MUNDO.** Quadro de teste
   aparece para a empresa inteira enquanto existir. Prefixar todo dado de teste com
   `zzz` e **apagar imediatamente** ao final de cada task.
2. **Esta branch dispara notificações de verdade.** Atribuir alguém a um card põe uma
   notificação no sino dela. Usar a Adriana Paz (`comercial02@`) como cobaia e limpar
   os quadros de teste — apagar o quadro apaga as notificações junto (`delete_board`
   limpa `notifications`/`reminders`/`reminder_sent`).

**NUNCA apagar linhas de `audit_log`** — é append-only, é a auditoria do sistema.

## Ambiente de verificação

Backend em Docker na porta 8000, frontend (Vite) na 5173, ambos no ar.

**`docker compose restart backend` NÃO aplica mudança de código** — o código é copiado
para a imagem no build (`COPY . .`), sem bind-mount do fonte. Sempre:

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

**Não reiniciar o Vite** (porta 5173) — é do usuário. Para validar o front:
`cd frontend && npm run build`.

**Gotcha do Vite:** `git checkout`/`git merge` fazem o watcher perder a mudança.
Depois de trocar de branch, reiniciar o `npm run dev`.

### Tokens (senhas confirmadas)

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }

ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")            # Erick H. (id 1) — administrador
COORD=$(tok "$TASKHS_COORD_EMAIL" "$TASKHS_COORD_PW")             # Nicholson Pimentel (id 3) — coordenador
MEMBRO=$(tok "$TASKHS_MEMBRO_EMAIL" "$TASKHS_MEMBRO_PW")   # Adriana Paz (id 14) — membro comum
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
```

**Estado do banco (verificado 2026-07-16):** um único quadro, id **20** ("Serviço"),
com um único membro (`user_id=1`, `owner`). `card_members` **vazia**.

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `backend/app/routers/cards.py` | **Modificar** — `add_card_member` valida a invariante; `update_card` limpa ao mover entre quadros. | 1, 3 |
| `backend/app/routers/boards.py` | **Modificar** — `list_members` traz `assigned_cards`; `remove_member` limpa. | 2 |
| `backend/app/schemas/board.py` | **Modificar** — `BoardMemberOut.assigned_cards`. | 2 |
| `backend/app/reminders.py` | **Modificar** — a rede: filtra por membresia nos dois caminhos. | 4 |
| `frontend/src/pages/BoardPage.tsx` | **Modificar** — seletor do card usa membros do quadro; confirmação na remoção. | 5 |
| `frontend/src/types/index.ts` | **Modificar** — `BoardMemberOut.assigned_cards`. | 5 |
| `frontend/src/data/changelog.ts` | **Modificar** — v1.4.1. | 6 |

---

### Task 1: A regra na escrita (`add_card_member`)

O ponto onde a invariante nasce.

**Files:**
- Modify: `backend/app/routers/cards.py:251-267` (`add_card_member`)

**Interfaces:**
- Consumes: `_get_card_or_404(card_id, list_id, db)` (`cards.py:83`, já existe, levanta
  `404 "Card não encontrado"`); `List` e `User` já importados (`cards.py:9` e `:12`).
- Produces: nada que outras tasks consumam — mas as Tasks 3, 4 e 5 dependem da
  invariante que esta task passa a garantir.

- [ ] **Step 1: Criar a branch**

```bash
cd /home/ericks/github/TaskHS && git checkout main && git pull && git checkout -b feat/membros-de-card && git branch --show-current && git status --short && echo "(limpo)"
```
Esperado: branch `feat/membros-de-card`, working tree limpo.

- [ ] **Step 2: Registrar o furo antes de fechar (a evidência do "antes")**

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

# quadro do admin; a Adriana (14) NAO e membro
B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t1 antes"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card"}' | jid)

echo "atribuir a Adriana (nao-membro):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/14" -H "Authorization: Bearer $ADMIN"
echo "atribuir usuario inexistente:"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/99999" -H "Authorization: Bearer $ADMIN"

curl -s -o /dev/null -w "limpeza: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
```
Esperado **antes** da correção: `201` (o furo — atribuiu quem não é do quadro) e `500`
(a FK estourando com o usuário inexistente). Cole a saída real.

- [ ] **Step 3: Validar na escrita**

Substituir `add_card_member` (`cards.py:251-267`) inteiro:

```python
@router.post("/{card_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)

    lst = (await db.execute(select(List).where(List.id == list_id))).scalar_one_or_none()
    board_id = lst.board_id if lst else None

    alvo = (await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )).scalar_one_or_none()
    if alvo is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # A invariante desta branch: quem esta no card esta no quadro. Sem isto, a
    # pessoa recebe notificacao e lembrete com o TITULO de um card que ela nao
    # consegue abrir.
    eh_membro = (await db.execute(
        select(BoardMember.id)
        .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
        .limit(1)
    )).scalars().first() is not None
    if not eh_membro:
        raise HTTPException(status_code=403, detail="Essa pessoa não é membro deste quadro")

    ja = (await db.execute(
        select(CardMember.id).where(CardMember.card_id == card_id, CardMember.user_id == user_id).limit(1)
    )).scalars().first()
    if ja is not None:
        return {"ok": True}

    db.add(CardMember(card_id=card_id, user_id=user_id))
    if user_id != current_user.id:
        db.add(Notification(
            user_id=user_id,
            type="card_member",
            message=f"Você foi adicionado ao card \"{card.title}\" por {current_user.name}.",
            card_id=card_id,
            board_id=board_id,
        ))
    await db.commit()
    return {"ok": True}
```

Notas para quem implementa:
- O `ja is not None → return {"ok": True}` é idempotência: `card_members` **não** tem
  unique, então dois cliques criariam duas linhas e **duas** notificações. O padrão de
  devolver `{"ok": True}` em vez de `409` já existe no arquivo — veja `add_label`
  (`cards.py:~288`), que faz exatamente isso. Siga-o.
- `board_id` é resolvido **antes** da checagem, porque a checagem precisa dele. A
  `Notification` já usava esse mesmo `lst.board_id` — agora ele é calculado uma vez só,
  no topo, em vez de dentro do `if`.
- Acrescentar `BoardMember` ao import de models do board. A linha `cards.py:8` é
  `from app.models.board import BoardLabel` → passa a ser:
  ```python
  from app.models.board import BoardLabel, BoardMember
  ```
- `Notification` já está importado (`cards.py:10`).

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t1 depois"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card"}' | jid)

echo "1) atribuir a Adriana (NAO e membro do quadro):"
curl -s -w "   <- HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/14" -H "Authorization: Bearer $ADMIN"

echo "2) atribuir usuario inexistente:"
curl -s -w "   <- HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/99999" -H "Authorization: Bearer $ADMIN"

echo "3) tornar a Adriana membro do quadro e atribuir de novo:"
curl -s -o /dev/null -w "   add membro: HTTP %{http_code}\n" -X POST "http://localhost:8000/api/boards/$B/members" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
curl -s -o /dev/null -w "   atribuir:   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/14" -H "Authorization: Bearer $ADMIN"

echo "4) atribuir a MESMA pessoa de novo (idempotencia — nao pode duplicar):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/14" -H "Authorization: Bearer $ADMIN"
curl -s "http://localhost:8000/api/lists/$L/cards/$C" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("   membros no card:", [m["name"] for m in d["members"]])'

echo "5) a Adriana recebeu UMA notificacao (nao duas):"
MEMBRO=$(tok "$TASKHS_MEMBRO_EMAIL" "$TASKHS_MEMBRO_PW")
curl -s http://localhost:8000/api/notifications -H "Authorization: Bearer $MEMBRO" | python3 -c 'import sys,json; d=json.load(sys.stdin); n=[x for x in d if x.get("type")=="card_member"]; print("   notificacoes card_member:", len(n)); [print("   ->", x["message"]) for x in n[:3]]'

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga o quadro: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado: `403` + `"Essa pessoa não é membro deste quadro"` · `404` +
`"Usuário não encontrado"` (**não** 500) · `201`+`201` · `201` com **um** membro no
card · **1** notificação · `boards restantes: [20]`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/cards.py
git commit -m "$(cat <<'EOF'
feat(cards): so membros do quadro podem ser atribuidos a um card

add_card_member nao validava nada: dava para atribuir qualquer pessoa da
empresa a qualquer card. Ela recebia notificacao com o TITULO do card e
passava a receber lembrete de vencimento indefinidamente — de um quadro
que nao consegue abrir.

Tambem nao validava que o usuario existe: user_id inexistente estourava
a FK em 500. Agora e 404.

E ficou idempotente: card_members nao tem unique, entao dois cliques
criavam duas linhas e DUAS notificacoes. Segue o padrao do add_label, que
devolve ok em vez de 409.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Remoção do quadro limpa e avisa

**Files:**
- Modify: `backend/app/schemas/board.py:34-44` (`BoardMemberOut`)
- Modify: `backend/app/routers/boards.py:347-359` (`list_members`)
- Modify: `backend/app/routers/boards.py:390-405` (`remove_member`)

**Interfaces:**
- Consumes: `_get_board_or_404(board_id, db)` (`boards.py:27`);
  `require_board_access_by_board_id` (dependency já usada em `list_members`).
- Produces:
  - `BoardMemberOut` ganha `assigned_cards: int` — quantos cards **daquele quadro** a
    pessoa ocupa, arquivados inclusive. A Task 5 lê esse campo para decidir se pede
    confirmação.
  - `DELETE /boards/{id}/members/{user_id}` passa a apagar `CardMember` e `Reminder`
    da pessoa nos cards daquele quadro, na mesma transação.

- [ ] **Step 1: `assigned_cards` no schema**

Em `backend/app/schemas/board.py`, acrescentar o campo em `BoardMemberOut` (que hoje
termina em `board_role: BoardRole`):

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
    assigned_cards: int
```

`assigned_cards` conta **todos** os cards do quadro em que a pessoa está atribuída,
arquivados inclusive — porque a remoção afeta todos, e o aviso da tela precisa dizer a
verdade sobre o que vai acontecer.

- [ ] **Step 2: `list_members` traz a contagem, sem N+1**

Substituir `list_members` (`boards.py:347-359`) inteiro:

```python
@router.get("/{board_id}/members", response_model=list[BoardMemberOut])
async def list_members(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_board_access_by_board_id)):
    await _get_board_or_404(board_id, db)

    # Quantos cards DESTE quadro cada pessoa ocupa. Subquery agregada: uma query
    # a mais no total, nao uma por membro.
    atribuidos = (
        select(CardMember.user_id.label("user_id"), func.count(CardMember.id).label("n"))
        .join(Card, Card.id == CardMember.card_id)
        .join(List, List.id == Card.list_id)
        .where(List.board_id == board_id)
        .group_by(CardMember.user_id)
        .subquery()
    )

    q = await db.execute(
        select(BoardMember, User, func.coalesce(atribuidos.c.n, 0))
        .join(User, User.id == BoardMember.user_id)
        .outerjoin(atribuidos, atribuidos.c.user_id == BoardMember.user_id)
        .where(BoardMember.board_id == board_id)
        .order_by(User.name)
    )
    return [
        {"id": u.id, "name": u.name, "email": u.email, "initials": u.initials,
         "board_role": bm.role, "assigned_cards": n}
        for bm, u, n in q.all()
    ]
```

`func`, `Card`, `CardMember` e `List` já estão importados em `boards.py` (linhas 4, 11
e 9 — confira e só acrescente o que faltar).

- [ ] **Step 3: `remove_member` limpa as pontas soltas**

Substituir `remove_member` (`boards.py:390-405`) inteiro:

```python
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

    # Mantem a invariante: quem nao alcanca o quadro nao pode figurar nos cards
    # dele. Sem esta limpeza, a pessoa sai do quadro mas continua recebendo
    # lembrete com o titulo dos cards em que ficou pendurada.
    cards_do_quadro = (
        select(Card.id).join(List, List.id == Card.list_id).where(List.board_id == board_id)
    )
    await db.execute(
        sql_delete(CardMember).where(
            CardMember.user_id == user_id, CardMember.card_id.in_(cards_do_quadro)
        )
    )
    await db.execute(
        sql_delete(Reminder).where(
            Reminder.user_id == user_id, Reminder.card_id.in_(cards_do_quadro)
        )
    )

    await db.delete(membro)
    await db.commit()
```

Notas:
- Tudo na **mesma transação** do `db.delete(membro)`: ou sai tudo, ou não sai nada.
- `sql_delete` é o apelido de `sqlalchemy.delete` já usado em `boards.py` (import da
  linha 4: `from sqlalchemy import select, func, and_, delete as sql_delete`).
  `Reminder` já está importado (`boards.py:13`).
- **Não** apagar `ReminderSent`: ela é a tabela de dedup, não entrega nada a ninguém.
  Apagá-la faria os lembretes serem reenviados se a pessoa voltasse ao quadro.
- **Não** apagar `Notification`: as que já chegaram são histórico do sino dela; a partir
  daqui é que param de vir. (E o deep link cai na tela de sem-acesso, que é honesta.)

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
MEMBRO=$(tok "$TASKHS_MEMBRO_EMAIL" "$TASKHS_MEMBRO_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t2"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C1=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card 1"}' | jid)
C2=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card 2"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$B/members" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C1/members/14" -H "Authorization: Bearer $ADMIN"
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C2/members/14" -H "Authorization: Bearer $ADMIN"
# um lembrete pessoal da Adriana no card 1
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C1/reminders" -H "Authorization: Bearer $MEMBRO" -H 'Content-Type: application/json' -d '{"remind_at":"2030-01-01T12:00:00Z"}'

echo "1) assigned_cards conta certo (esperado: Adriana 2, Erick 0):"
curl -s "http://localhost:8000/api/boards/$B/members" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; [print("  ", m["name"], "->", m["assigned_cards"]) for m in json.load(sys.stdin)]'

echo "2) o lembrete dela existe antes da remocao:"
curl -s "http://localhost:8000/api/lists/$L/cards/$C1/reminders" -H "Authorization: Bearer $MEMBRO" | python3 -c 'import sys,json; print("   lembretes:", len(json.load(sys.stdin)))'

echo "3) remover a Adriana do quadro:"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B/members/14" -H "Authorization: Bearer $ADMIN"

echo "4) ela sumiu dos DOIS cards:"
for c in $C1 $C2; do curl -s "http://localhost:8000/api/lists/$L/cards/$c" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("   card", d["id"], "-> membros:", [m["name"] for m in d["members"]])'; done

echo "5) o lembrete pessoal dela sumiu (0 linhas):"
./scripts/psql-dev.sh -t -c "SELECT count(*) FROM reminders r JOIN cards c ON c.id=r.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=$B AND r.user_id=14;"

echo "6) o dono continua protegido:"
curl -s -w "   <- HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B/members/1" -H "Authorization: Bearer $ADMIN"

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga o quadro: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado: `Adriana -> 2`, `Erick H. -> 0` · `lembretes: 1` · `204` · os dois cards com
`membros: []` · `0` lembretes · `400` "O dono do quadro não pode ser removido" ·
`boards restantes: [20]`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/board.py backend/app/routers/boards.py
git commit -m "$(cat <<'EOF'
feat(quadros): remover membro limpa os cards e lembretes dele no quadro

Sem isto a pessoa saia do quadro mas continuava pendurada nos cards e
recebendo lembrete com o titulo deles — de um quadro que ela nao abre
mais. Tudo na mesma transacao da remocao.

BoardMemberOut ganha assigned_cards (subquery agregada, sem N+1) para a
tela poder avisar quantos cards a remocao vai afetar antes de confirmar.
Conta arquivados tambem: a remocao afeta todos, entao o numero tem que
dizer a verdade.

Nao apaga ReminderSent (e dedup, nao entrega nada) nem as Notification ja
recebidas (sao historico do sino dela).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mover **e copiar** card entre quadros tira quem não é do destino

O terceiro caminho que quebra a invariante — e o menos óbvio: os `CardMember` **viajam
junto com o card**. Vale para os **dois** endpoints que levam um card para outro quadro:
`update_card` (mover) e `copy_card` (copiar).

> **Por que o `copy_card` está aqui:** ele não estava na spec nem na versão original
> deste plano — descoberto pelo review da Task 1, que perguntou "sobrou algum caminho
> que crie `CardMember` sem passar pela validação?". `copy_card` (`cards.py:190-191`)
> faz `db.add(CardMember(card_id=new_card.id, user_id=m.user_id))` para cada membro do
> original, e aceita `target_list_id` no **corpo**. O
> `assert_board_access_by_list_id` da linha `:165` valida o acesso de **quem copia**,
> não a membresia de **quem é copiado**. É o mesmo furo do mover, pela porta do copiar.

**Files:**
- Modify: `backend/app/routers/cards.py:117-143` (`update_card`)
- Modify: `backend/app/routers/cards.py:~190-191` (`copy_card`, o laço de membros)

**Interfaces:**
- Consumes: `assert_board_access_by_list_id(list_id, user, db)` (de
  `app.dependencies`, já importado em `cards.py:17`), que a v1.4.0 já chama nesse mesmo
  bloco; `BoardMember` (importado na Task 1).
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Limpar no movimento**

Em `backend/app/routers/cards.py`, no `update_card`. O bloco de hoje é:

```python
    if "list_id" in data and data["list_id"] != card.list_id:
        await assert_board_access_by_list_id(data["list_id"], current_user, db)
        destino = (await db.execute(
            select(List.id).where(List.id == data["list_id"]).limit(1)
        )).scalars().first()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
    old_list_id = card.list_id
    for k, v in data.items():
        setattr(card, k, v)
    new_list_id = card.list_id
    if old_list_id != new_list_id:
        await run_card_moved_automations(db, card, old_list_id, new_list_id)
    await db.commit()
    return _card_to_dict(card)
```

Trocar por (a mudança é o `quadro_origem`/`quadro_destino` e o bloco de limpeza):

```python
    quadro_destino = None
    if "list_id" in data and data["list_id"] != card.list_id:
        await assert_board_access_by_list_id(data["list_id"], current_user, db)
        destino = (await db.execute(
            select(List).where(List.id == data["list_id"]).limit(1)
        )).scalar_one_or_none()
        if destino is None:
            raise HTTPException(status_code=404, detail="Lista de destino não encontrada")
        quadro_destino = destino.board_id

    quadro_origem = (await db.execute(
        select(List.board_id).where(List.id == card.list_id)
    )).scalar_one_or_none()

    old_list_id = card.list_id
    for k, v in data.items():
        setattr(card, k, v)
    new_list_id = card.list_id

    # Card movido para OUTRO quadro: os CardMember viajam junto com ele, entao
    # gente do quadro de origem cairia num quadro de que nao e membro. Nem a
    # validacao do add_card_member nem a limpeza do remove_member pegam este
    # caminho — ele so existe aqui.
    if quadro_destino is not None and quadro_destino != quadro_origem:
        membros_do_destino = (
            select(BoardMember.user_id).where(BoardMember.board_id == quadro_destino)
        )
        await db.execute(
            sql_delete(CardMember).where(
                CardMember.card_id == card.id,
                CardMember.user_id.notin_(membros_do_destino),
            )
        )
        await db.execute(
            sql_delete(Reminder).where(
                Reminder.card_id == card.id,
                Reminder.user_id.notin_(membros_do_destino),
            )
        )

    if old_list_id != new_list_id:
        await run_card_moved_automations(db, card, old_list_id, new_list_id)
    await db.commit()
    return _card_to_dict(card)
```

Notas:
- `quadro_origem` é lido **antes** do `setattr`, senão já seria o do destino.
- A limpeza roda **antes** de `run_card_moved_automations` de propósito: as automações
  fecham a transação com um flush próprio, e a limpeza tem que estar dentro do mesmo
  movimento.
- Mover dentro do **mesmo** quadro (o caso comum do drag & drop) não dispara nada:
  `quadro_destino == quadro_origem`.
- `select(List.id)` virou `select(List)` porque agora precisamos do `board_id` do
  destino. `scalars().first()` virou `scalar_one_or_none()`.
- Acrescentar os imports que faltarem em `cards.py`: `Reminder` já está (`cards.py:11`),
  `sql_delete` já está (`cards.py:3`: `from sqlalchemy import select, delete as sql_delete`),
  `BoardMember` veio na Task 1.

- [ ] **Step 1b: `copy_card` — o mesmo furo, pela porta do copiar**

Em `backend/app/routers/cards.py`, no `copy_card`, o laço de hoje (~linha 190) é:

```python
    for m in _to_list(original.members):
        db.add(CardMember(card_id=new_card.id, user_id=m.user_id))
```

Copiar um card para outro quadro leva as pessoas do quadro de origem junto. Trocar por:

```python
    # Copiar para OUTRO quadro nao pode levar junto quem nao e membro de la — o
    # assert_board_access_by_list_id acima valida quem COPIA, nao quem e copiado.
    membros_do_destino = set((await db.execute(
        select(BoardMember.user_id)
        .join(List, List.board_id == BoardMember.board_id)
        .where(List.id == target_list_id)
    )).scalars().all())
    for m in _to_list(original.members):
        if m.user_id in membros_do_destino:
            db.add(CardMember(card_id=new_card.id, user_id=m.user_id))
```

A query resolve `lista de destino → quadro → membros` de uma vez. Quando o destino é o
**mesmo** quadro (o caso comum), todos os membros do card já são membros do quadro pela
invariante da Task 1, então ninguém é filtrado — nenhuma mudança de comportamento.

- [ ] **Step 2: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

Precisa de dois quadros e de alguém que seja membro só de um:

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

# Quadro A: admin + Adriana. Quadro B: so o admin.
A=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t3 A"}' | jid)
LA=$(curl -s -X POST "http://localhost:8000/api/boards/$A/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"la"}' | jid)
LA2=$(curl -s -X POST "http://localhost:8000/api/boards/$A/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"la2"}' | jid)
CA=$(curl -s -X POST "http://localhost:8000/api/lists/$LA/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card viajante"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$A/members" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/members/14" -H "Authorization: Bearer $ADMIN"
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/members/1" -H "Authorization: Bearer $ADMIN"

B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t3 B"}' | jid)
LB=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"lb"}' | jid)

echo "1) o card comeca com Adriana + Erick:"
curl -s "http://localhost:8000/api/lists/$LA/cards/$CA" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   ", [m["name"] for m in json.load(sys.stdin)["members"]])'

echo "2) mover DENTRO do quadro A (caso comum — nao pode tirar ninguem):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X PATCH "http://localhost:8000/api/lists/$LA/cards/$CA" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"list_id\": $LA2}"
curl -s "http://localhost:8000/api/lists/$LA2/cards/$CA" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   ", [m["name"] for m in json.load(sys.stdin)["members"]])'

echo "3) COPIAR para o quadro B (a Adriana nao e membro de la — nao pode ir junto):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$LA2/cards/$CA/copy" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"target_list_id\": $LB}"
curl -s "http://localhost:8000/api/lists/$LB/cards" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("   copia no B ->", [m["name"] for m in d[0]["members"]] if d else "nenhum card")'

echo "3b) COPIAR dentro do proprio quadro A (nao pode filtrar ninguem):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$LA2/cards/$CA/copy" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{}'
curl -s "http://localhost:8000/api/lists/$LA2/cards" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("   copias no A ->", [sorted(m["name"] for m in c["members"]) for c in d])'

echo "4) mover para o quadro B (a Adriana nao e membro de la — tem que sair):"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X PATCH "http://localhost:8000/api/lists/$LA2/cards/$CA" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"list_id\": $LB}"
curl -s "http://localhost:8000/api/lists/$LB/cards/$CA" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   ", [m["name"] for m in json.load(sys.stdin)["members"]])'

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga A: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$A" -H "Authorization: Bearer $ADMIN"
curl -s -o /dev/null -w "   apaga B: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado, em ordem:
- `['Adriana Paz', 'Erick H.']` — o card comeca com os dois
- `200` e **os dois continuam** — mover dentro do mesmo quadro nao tira ninguem
- a copia no quadro B tem **so** `['Erick H.']` — a Adriana nao foi junto
- as copias dentro do A tem **os dois** — copiar no mesmo quadro nao filtra ninguem
- `200` e o card movido para o B sobra com **so** `['Erick H.']`
- `boards restantes: [20]`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/cards.py
git commit -m "$(cat <<'EOF'
feat(cards): mover card entre quadros tira quem nao e do destino

Terceiro caminho que quebra a invariante, e o menos obvio: os CardMember
viajam JUNTO com o card. Um admin move um card do quadro A para o B, e as
pessoas do A que estavam nele caem no B sem serem membros de la — nem a
validacao do add_card_member nem a limpeza do remove_member pegam isso.

Mover dentro do mesmo quadro (o drag & drop de todo dia) nao dispara
nada. A limpeza roda antes das automacoes, na mesma transacao do
movimento.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A rede — o loop de lembretes filtra por membresia

**Files:**
- Modify: `backend/app/reminders.py:24-82` (`run_reminder_cycle`)

**Interfaces:**
- Consumes: `_board_id_for_card(db, list_id)` (`reminders.py:19`, já existe).
- Produces: `_eh_membro_do_quadro(db, board_id, user_id) -> bool` — helper local.

- [ ] **Step 1: O helper**

Em `backend/app/reminders.py`, acrescentar depois de `_board_id_for_card` (linha ~22):

```python
async def _eh_membro_do_quadro(db, board_id: int | None, user_id: int) -> bool:
    """Membresia crua, SEM passe de elevado — de propósito.

    Um administrador alcança qualquer quadro pela tranca, mas só recebe lembrete
    se estiver ATRIBUÍDO ao card; e para ser atribuído precisa ser membro
    (add_card_member valida). Não há caso especial aqui.

    Esta é a rede: as regras de escrita já mantêm a invariante, mas o loop é o
    único lugar que EMPURRA título de card para as pessoas. Se a invariante furar
    por qualquer caminho, aqui o custo é zero em vez de vazamento.
    """
    if board_id is None:
        return False
    q = await db.execute(
        select(BoardMember.id)
        .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
        .limit(1)
    )
    return q.scalars().first() is not None
```

Acrescentar o import no topo do arquivo, junto dos outros models:
```python
from app.models.board import BoardMember
```

- [ ] **Step 2: Filtrar os lembretes manuais**

Em `reminders.py`, o bloco de hoje (linhas ~29-42) é:

```python
        # --- manual reminders due ---
        due = (await db.execute(
            select(Reminder).where(Reminder.remind_at <= now, Reminder.fired == False)
        )).scalars().all()
        for r in due:
            card = (await db.execute(select(Card).where(Card.id == r.card_id))).scalar_one_or_none()
            if card is not None:
                board_id = await _board_id_for_card(db, card.list_id)
                db.add(Notification(
                    user_id=r.user_id, type="reminder_manual",
                    message=f'Lembrete: "{card.title}"', card_id=card.id, board_id=board_id,
                ))
            r.fired = True
        await db.commit()
```

Trocar por:

```python
        # --- manual reminders due ---
        due = (await db.execute(
            select(Reminder).where(Reminder.remind_at <= now, Reminder.fired == False)
        )).scalars().all()
        for r in due:
            card = (await db.execute(select(Card).where(Card.id == r.card_id))).scalar_one_or_none()
            if card is not None:
                board_id = await _board_id_for_card(db, card.list_id)
                if await _eh_membro_do_quadro(db, board_id, r.user_id):
                    db.add(Notification(
                        user_id=r.user_id, type="reminder_manual",
                        message=f'Lembrete: "{card.title}"', card_id=card.id, board_id=board_id,
                    ))
            # fired=True mesmo quando nao notifica: o horario ja passou. Sem isto,
            # o lembrete ficaria na fila e dispararia no dia em que a pessoa
            # voltasse ao quadro — semanas depois, sem contexto nenhum.
            r.fired = True
        await db.commit()
```

- [ ] **Step 3: Filtrar os lembretes automáticos**

Em `reminders.py`, o bloco de hoje (linhas ~62-66) é:

```python
            members = (await db.execute(select(CardMember).where(CardMember.card_id == card.id))).scalars().all()
            if not members:
                continue
            board_id = await _board_id_for_card(db, card.list_id)
            for m in members:
```

Trocar por (repare que o `board_id` sobe para **antes** da query, porque a query passa
a precisar dele):

```python
            board_id = await _board_id_for_card(db, card.list_id)
            # So notifica quem e membro do quadro. O JOIN faz o filtro no banco,
            # em vez de trazer todo mundo e descartar depois.
            members = (await db.execute(
                select(CardMember)
                .join(BoardMember, BoardMember.user_id == CardMember.user_id)
                .where(CardMember.card_id == card.id, BoardMember.board_id == board_id)
            )).scalars().all()
            if not members:
                continue
            for m in members:
```

Nota: se `board_id` for `None` (lista órfã), o `where` não casa e `members` fica vazio →
`continue`. Silencioso e seguro.

- [ ] **Step 4: Verificar — este é o teste que prova a rede**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

O cenário precisa de um `CardMember` **órfão** — a invariante furada por um caminho que
não previmos. Como as Tasks 1-3 fecharam os caminhos conhecidos, ele entra direto no
banco:

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
ONTEM=$(date -u -d 'yesterday' +%Y-%m-%d)

# Quadro so do admin (Adriana NAO e membro). Card vencido ontem.
B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t4"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"title\":\"zzz CARD SECRETO\",\"due_date\":\"$ONTEM\"}" | jid)

# o admin (membro legitimo) atribuido ao card
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/1" -H "Authorization: Bearer $ADMIN"

# a Adriana (14) entra a FORCA, direto no banco: e a invariante furada
./scripts/psql-dev.sh -c \
  "INSERT INTO card_members (card_id, user_id) VALUES ($C, 14);"

echo "quem esta no card agora (a Adriana esta pendurada, sem ser membro do quadro):"
./scripts/psql-dev.sh -t -c \
  "SELECT u.name FROM card_members cm JOIN users u ON u.id=cm.user_id WHERE cm.card_id=$C;"

echo "rodando o ciclo de lembretes a mao:"
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())" && echo "   ok"

echo "quem recebeu notificacao deste card (esperado: SO o Erick H.):"
./scripts/psql-dev.sh -c \
  "SELECT u.name, n.message FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.card_id=$C;"

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga o quadro: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado:
- o card tem **Erick H. e Adriana Paz** pendurados
- depois do ciclo, `notifications` tem **só o Erick H.**, com `"zzz CARD SECRETO" está atrasado`
- **nenhuma linha da Adriana** — ela está no card, mas não é membro do quadro
- `boards restantes: [20]`

Se a Adriana aparecer, **a rede não pegou** — investigue e reporte, não maquie.

O `delete_board` limpa `notifications`/`reminders`/`reminder_sent` do quadro, então a
limpeza fecha tudo.

- [ ] **Step 5: Commit**

```bash
git add backend/app/reminders.py
git commit -m "$(cat <<'EOF'
fix(lembretes): so notifica quem e membro do quadro

O loop buscava CardMember sem nenhum filtro de quadro, e os lembretes
pessoais disparavam sem checar nada. Quem ficasse pendurado num card
recebia o TITULO dele para sempre — de um quadro que nao consegue abrir.

Esta e a rede, nao a defesa principal: as regras de escrita ja mantem a
invariante. Mas o loop e o unico lugar que EMPURRA titulo de card para as
pessoas, e a branch anterior encontrou 11 caminhos de furo que ninguem
tinha previsto. Aqui o custo de um furo futuro passa a ser zero.

Nao consulta is_elevated de proposito: um admin alcanca qualquer quadro,
mas so recebe lembrete se estiver atribuido — e para isso precisa ser
membro. Sem caso especial.

Lembrete manual de nao-membro e marcado como fired mesmo sem notificar: o
horario ja passou, e deixa-lo na fila faria disparar semanas depois, se a
pessoa voltasse ao quadro.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: O seletor do card e a confirmação na remoção

**Files:**
- Modify: `frontend/src/types/index.ts` (`BoardMemberOut`)
- Modify: `frontend/src/pages/BoardPage.tsx:133-143` (props do `CardDetailModal`)
- Modify: `frontend/src/pages/BoardPage.tsx:285-289` (o seletor)
- Modify: `frontend/src/pages/BoardPage.tsx:2164-2174` (instanciação do modal)
- Modify: `frontend/src/pages/BoardPage.tsx` (seção "Membros do quadro", ~2240-2300)

**Interfaces:**
- Consumes: `GET /boards/{id}/members` → `BoardMemberOut[]` com o campo novo
  `assigned_cards: number` (Task 2); `ApiError` (de `../lib/api`, tem `.status`).

- [ ] **Step 1: O tipo**

Em `frontend/src/types/index.ts`, `BoardMemberOut` ganha o campo:

```ts
export interface BoardMemberOut extends UserBasic {
  email: string;
  board_role: "owner" | "admin" | "member" | "viewer";
  /** Quantos cards DESTE quadro a pessoa ocupa (arquivados inclusive).
   *  Remover do quadro tira ela de todos — daí a confirmação. */
  assigned_cards: number;
}
```

- [ ] **Step 2: O seletor do card passa a listar os membros do quadro**

Hoje o seletor oferece as 27 pessoas da empresa, e a partir da Task 1 o backend recusa
26 delas. Os dois lados têm que andar juntos.

`CardDetailModal` não recebe o `boardId`. Em `frontend/src/pages/BoardPage.tsx:133-143`,
acrescentar a prop:

```tsx
function CardDetailModal({ card, boardId, listTitle, lists, boardLabels, currentUser, onClose, onCardUpdate, onCardDelete, onCardCopy }: {
  card: Card;
  boardId: number;
  listTitle: string;
  lists: BoardList[];
  boardLabels: BoardLabel[];
  currentUser: { id: number; is_admin: boolean; role: "administrador" | "coordenador" | "membro" } | null;
  onClose: () => void;
  onCardUpdate: (updated: Partial<Card> & { id: number }) => void;
  onCardDelete: (cardId: number) => void;
  onCardCopy: (newCard: Card) => void;
}) {
```

Passar na instanciação (`:2164-2174`), logo depois de `card={selectedCard}`:

```tsx
          boardId={boardId}
```

E trocar o `useEffect` do seletor (`:285-289`):

```tsx
  useEffect(() => {
    if (showMemberPicker && allUsers.length === 0) {
      // Membros do QUADRO, nao as 27 pessoas da empresa: so eles podem ser
      // atribuidos (o backend recusa o resto com 403).
      api.get<BoardMemberOut[]>(`/boards/${boardId}/members`).then(setAllUsers).catch(() => {});
    }
  }, [showMemberPicker, boardId]);
```

O state `allUsers` (`:153`) e o `availableUsers` (`:449`) são `UserBasic[]` hoje.
`BoardMemberOut` **estende** `UserBasic`, então atribuir `BoardMemberOut[]` a
`UserBasic[]` compila sem mudar as declarações. Deixe como está — a UI do seletor só lê
`id`/`name`/`initials`.

`BoardMemberOut` já está no import de tipos da linha 16 do arquivo (por causa da seção
de membros do quadro) — confira.

- [ ] **Step 2b: O clique do seletor não pode mais falhar em silêncio**

`handleAddMember` (`:342-350`) termina em `catch {}`. Isso era inofensivo enquanto
`add_card_member` aceitava qualquer pessoa; a partir da Task 1 ele devolve **403**
`"Essa pessoa não é membro deste quadro"`, e o clique passaria a falhar sem dizer nada.

Acontece de verdade numa corrida estreita mas real: alguém é removido do quadro
enquanto o seletor está aberto na tela de outra pessoa.

Acrescentar o state junto dos outros do `CardDetailModal`:
```tsx
  const [erroMembroCard, setErroMembroCard] = useState<string | null>(null);
```

Trocar `handleAddMember` (`:342-350`):
```tsx
  async function handleAddMember(user: UserBasic) {
    setErroMembroCard(null);
    try {
      await api.post(`/lists/${card.list_id}/cards/${card.id}/members/${user.id}`, {});
      const updated = [...members, user];
      setMembers(updated);
      onCardUpdate({ id: card.id, members: updated });
      setShowMemberPicker(false);
    } catch (e) {
      // O backend recusa quem nao e membro do quadro. Sem isto, o clique nao faz
      // nada e a pessoa nao sabe por que.
      setErroMembroCard(e instanceof ApiError ? e.message : "Não foi possível adicionar.");
    }
  }
```

E mostrar o erro dentro do dropdown do seletor. No bloco de `:581-583`, que hoje é:
```tsx
                      <div className="absolute top-full left-0 mt-1 z-20 w-52 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                        {availableUsers.length === 0 ? (
                          <p className="text-xs text-slate-500 p-3 text-center">{allUsers.length === 0 ? "Carregando…" : "Todos já adicionados"}</p>
```
trocar por:
```tsx
                      <div className="absolute top-full left-0 mt-1 z-20 w-52 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                        {erroMembroCard && (
                          <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2">{erroMembroCard}</p>
                        )}
                        {availableUsers.length === 0 ? (
                          <p className="text-xs text-slate-500 p-3 text-center">{allUsers.length === 0 ? "Carregando…" : "Todos já adicionados"}</p>
```

Limpar o erro ao fechar o seletor — no ponto onde `setShowMemberPicker(false)` já é
chamado pelo clique fora, ou simplesmente resetar ao abrir. Escolha o caminho que já
existir no arquivo e reporte qual foi.

`ApiError` precisa estar no import da linha 15 (`import { api, ApiError } from "../lib/api";`)
— ele já está, por causa da tela de sem-acesso. Confira.

**Nota honesta sobre o "Carregando…":** o `.catch(() => {})` do Step 2 mantém um defeito
conhecido — se o GET falhar por 500/rede, o dropdown fica em "Carregando…" para sempre,
porque `allUsers.length === 0` significa tanto "ainda não chegou" quanto "falhou". Isso
é dívida registrada da branch anterior e **não** entra aqui: consertar exige separar os
estados (como a seção de membros do quadro já faz) e não é o objeto desta task. Deixe
como está.

- [ ] **Step 3: A confirmação na remoção**

Na seção "Membros do quadro" do modal de Configurações, o botão `X` hoje chama
`handleRemoveBoardMember(m.id)` direto. Passa a pedir confirmação quando a pessoa
ocupa cards.

Acrescentar o state junto dos outros da seção de membros (perto de `membrosLoading`):

```tsx
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<BoardMemberOut | null>(null);
```

Resetar junto dos outros quando o modal abre — no `useEffect` que carrega os membros e
no `openEditBoard`, acrescentar:

```tsx
    setConfirmandoRemocao(null);
```

Trocar o `onClick` do `X` para:

```tsx
                            <button
                              onClick={() => (m.assigned_cards > 0 ? setConfirmandoRemocao(m) : handleRemoveBoardMember(m.id))}
                              disabled={mutandoMembro}
                              title={`Remover ${m.name}`}
                              className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-50"
                            >
                              <IX />
                            </button>
```

E acrescentar o painel de confirmação logo **depois** da lista de membros (antes do
`<select>` de adicionar):

```tsx
                  {confirmandoRemocao && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                      <p className="text-xs text-slate-200">
                        <strong className="font-semibold">{confirmandoRemocao.name}</strong> está em{" "}
                        {confirmandoRemocao.assigned_cards} card{confirmandoRemocao.assigned_cards !== 1 ? "s" : ""} deste quadro.
                        Remover vai tirá-la deles e apagar os lembretes pessoais dela aqui.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmandoRemocao(null)}
                          className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium text-slate-400 hover:bg-background-elevated transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => { const alvo = confirmandoRemocao; setConfirmandoRemocao(null); handleRemoveBoardMember(alvo.id); }}
                          disabled={mutandoMembro}
                          className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {mutandoMembro ? "Removendo…" : "Remover mesmo assim"}
                        </button>
                      </div>
                    </div>
                  )}
```

Segue o padrão da "Zona de perigo" que já existe no mesmo modal (confirmação inline, não
um `window.confirm`).

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro de TypeScript. **Atenção ao `noUnusedLocals`/`noUnusedParameters`**
do `tsconfig.app.json` — variável sem uso quebra o build.

**Não reinicie o Vite** (porta 5173) — é do usuário.

No navegador, como admin (`healthsafetyti@gmail.com` / (senha em `backend/.env.dev-users`)). Monte o cenário
por curl e olhe a tela:

```bash
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz t5"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"card"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$B/members" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
echo "quadro de teste: $B  (abra http://localhost:5173/boards/$B)"
```

**A. O seletor só oferece os membros do quadro:** abrir o card → botão de membros → a
lista mostra **só Erick H. e Adriana Paz** (os dois membros), **não** as 27 pessoas.

**B. Atribuir funciona:** escolher a Adriana → ela aparece no card.

**C. A confirmação aparece:** Configurações → Membros → a Adriana tem o `X`; clicar →
aparece o painel vermelho *"Adriana Paz está em 1 card deste quadro. Remover vai tirá-la
deles e apagar os lembretes pessoais dela aqui."* com Cancelar / Remover mesmo assim.

**D. Cancelar não remove:** clicar em Cancelar → o painel some, a Adriana continua na
lista.

**E. Confirmar remove e limpa:** clicar em "Remover mesmo assim" → ela sai da lista;
reabrir o card → ela **não** está mais nos membros do card.

**F. Sem cards atribuídos, não pede confirmação:** adicionar a Adriana de novo ao quadro
(sem atribuir a card nenhum) → o `X` remove direto, sem painel.

**LIMPEZA** (obrigatória — a listagem mostra esse quadro para a empresa inteira):
```bash
curl -s -o /dev/null -w "apaga o quadro: HTTP %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```
Esperado: `204` e `boards restantes: [20]`.

- [ ] **Step 5: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/types/index.ts frontend/src/pages/BoardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): seletor do card lista os membros do quadro; remocao avisa

O seletor oferecia as 27 pessoas da empresa. Com a regra nova, o backend
recusa 26 delas — a UI estava oferecendo o que o backend recusa. Agora
lista os membros do quadro (CardDetailModal ganha a prop boardId).

E remover alguem do quadro passa a avisar quantos cards ela ocupa antes,
porque a remocao tira ela de todos e apaga os lembretes pessoais dela ali
— e readicionar nao devolve. Confirmacao inline, no padrao da Zona de
perigo do mesmo modal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Changelog v1.4.1

**Files:**
- Modify: `frontend/src/data/changelog.ts` (topo do array `CHANGELOG`)

**Interfaces:**
- Consumes: nada. `APP_VERSION` deriva de `CHANGELOG[0]` automaticamente.

- [ ] **Step 1: A entrada**

Inserir como **primeiro** item do array `CHANGELOG`, antes da entrada `1.4.0`:

```ts
  {
    version: "1.4.1",
    date: "2026-07-16",
    changes: [
      { kind: "correcao", text: "Só quem é membro do quadro pode ser atribuído a um card — como no Trello. Antes dava para atribuir qualquer pessoa da empresa, e ela recebia notificação e lembretes de um card que não conseguia abrir." },
      { kind: "correcao", text: "Remover alguém de um quadro agora tira essa pessoa dos cards dela ali e apaga os lembretes pessoais dela no quadro. A tela avisa quantos cards serão afetados antes de confirmar." },
      { kind: "correcao", text: "Mover um cartão para outro quadro agora tira dele quem não é membro do quadro de destino." },
    ],
  },
```

Versão **1.4.1**: são correções (a regra do `CLAUDE.md` manda patch para correção); não
há funcionalidade nova visível.

- [ ] **Step 2: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

No navegador: o rodapé da sidebar mostra **TaskHS · v1.4.1**; clicar abre o
`ChangelogModal` com a 1.4.1 no topo, marcada como "Versão atual".

- [ ] **Step 3: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/data/changelog.ts
git commit -m "$(cat <<'EOF'
docs: changelog v1.4.1 — quem esta no card esta no quadro

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final da branch

Com todas as tasks fechadas, a invariante tem que valer nos quatro caminhos de uma vez:

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
ADMIN=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
ONTEM=$(date -u -d 'yesterday' +%Y-%m-%d)

A=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz final A"}' | jid)
LA=$(curl -s -X POST "http://localhost:8000/api/boards/$A/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"la"}' | jid)
CA=$(curl -s -X POST "http://localhost:8000/api/lists/$LA/cards" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"title\":\"zzz card final\",\"due_date\":\"$ONTEM\"}" | jid)
B=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"zzz final B"}' | jid)
LB=$(curl -s -X POST "http://localhost:8000/api/boards/$B/lists" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"title":"lb"}' | jid)

echo "1) atribuir nao-membro (esperado 403):"
curl -s -o /dev/null -w "   %{http_code}\n" -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/members/14" -H "Authorization: Bearer $ADMIN"
echo "2) atribuir inexistente (esperado 404, nao 500):"
curl -s -o /dev/null -w "   %{http_code}\n" -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/members/99999" -H "Authorization: Bearer $ADMIN"
echo "3) virou membro -> atribuir (esperado 201):"
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$A/members" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"user_id":14,"role":"member"}'
curl -s -o /dev/null -w "   %{http_code}\n" -X POST "http://localhost:8000/api/lists/$LA/cards/$CA/members/14" -H "Authorization: Bearer $ADMIN"
echo "4) assigned_cards (esperado Adriana 1):"
curl -s "http://localhost:8000/api/boards/$A/members" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; [print("  ", m["name"], m["assigned_cards"]) for m in json.load(sys.stdin)]'
echo "5) mover para o quadro B (a Adriana nao e de la — tem que sair):"
curl -s -o /dev/null -X PATCH "http://localhost:8000/api/lists/$LA/cards/$CA" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"list_id\": $LB}"
curl -s "http://localhost:8000/api/lists/$LB/cards/$CA" -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   membros:", [m["name"] for m in json.load(sys.stdin)["members"]])'
echo "6) a rede: CardMember orfao nao recebe lembrete:"
./scripts/psql-dev.sh -q -c "INSERT INTO card_members (card_id, user_id) VALUES ($CA, 14);"
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())" >/dev/null && echo "   ciclo rodou"
./scripts/psql-dev.sh -t -c \
  "SELECT '   notificou: '||u.name FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.card_id=$CA;"

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga A: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$A" -H "Authorization: Bearer $ADMIN"
curl -s -o /dev/null -w "   apaga B: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$B" -H "Authorization: Bearer $ADMIN"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
./scripts/psql-dev.sh -t -c "SELECT '   card_members restantes: '||count(*) FROM card_members;"
```

Esperado: `403` · `404` · `201` · `Adriana Paz 1` · `membros: ['Erick H.']` ·
**nenhuma** notificação para a Adriana · `boards restantes: [20]` ·
`card_members restantes: 0`.

```bash
cd frontend && npm run build
```
Esperado: build sem erro.
