# Menções em comentários (@) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digitar `@` num comentário abre a lista de pessoas do quadro; escolher uma
insere a menção; a pessoa recebe uma notificação de que foi marcada.

**Architecture:** O corpo do comentário guarda `@[Nome](id)` — sem tabela nova. O
backend **extrai os ids e valida cada um contra `board_members`** antes de notificar,
porque o corpo vem do cliente. O frontend oferece só os membros do quadro no seletor e
renderiza o token como chip.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0, Pydantic v2, React 19 + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-17-mencoes-em-comentarios-design.md`

## Global Constraints

- **Formato do token, exato:** `@[Nome da Pessoa](14)` — nome entre colchetes, id do
  **usuário** entre parênteses. Regex canônica, **a do backend** (`app/mentions.py`):
  `@\[([^\]\n]{1,120})\]\((\d+)\)`. O teto de 120 é o do `User.name`
  (`models/user.py`: `String(120)`) — o mesmo limite dos dois lados, de propósito: com
  um teto menor, um nome longo geraria um token que o backend ignoraria em silêncio.
  O teto (em vez de `+`) é o que impede a varredura quadrática que travava o event loop.
- **A validação no backend é obrigatória e é o coração da feature.** O corpo vem do
  cliente: sem validar os ids contra `board_members` do quadro do card, qualquer pessoa
  forja `@[Quem Quiser](99)` e o sistema entrega ao usuário 99 uma notificação com o
  texto que ela escolher, de um quadro que ele não abre. Id que não passa é **ignorado
  em silêncio** (o texto do comentário fica como foi escrito; só não há notificação).
- **Marcar NÃO adiciona a pessoa ao card.** Marcar é "olha isso", atribuir é "isso é
  seu". Nenhum `CardMember` é criado por esta feature.
- **Tipo de notificação novo:** `card_mention`, com a mensagem exatamente
  `{autor} mencionou você em "{título do card}": {trecho}`.
- **Sem notificação dupla:** quem é mencionado **e** é membro do card recebe **só** a de
  menção. O `card_comment` continua indo para os membros do card **não** mencionados.
- **Mencionar a si mesmo não notifica** — espelha a guarda `m.user_id != current_user.id`
  que já existe no `card_comment`.
- **A notificação é texto puro:** o token `@[Nome](14)` vira `@Nome` no trecho, nos
  **dois** tipos de notificação. Sem isso o sino mostraria `oi @[Adriana Paz](14) veja`.
- Mensagens de interface em português.
- **Sem migrations:** nenhuma mudança de schema. `Notification.type` é string livre.
- **Não há suíte de testes** (nem pytest, nem no front) — deliberado, está no
  `CLAUDE.md`. Verificação é manual: `curl` + navegador + `npm run build`. **Não inventar
  comandos de teste.**
- **Toda a implementação na branch `feat/mencoes-comentarios`** (criada na Task 1).

## ⚠️ Segurança e ambiente — leia antes de rodar qualquer coisa

**Este repositório é PÚBLICO** (`github.com/ErickSantos2002/TaskHS`) e sofreu **dois
vazamentos de credencial em 2026-07-16** (a senha do banco de produção e as senhas de
login de contas reais, ambas públicas desde junho). Ambos limpos. Não repita:

- **Senhas das baterias:** de `backend/.env.dev-users` (gitignorado). Antes de testar:
  ```bash
  cd /home/ericks/github/TaskHS
  set -a; source backend/.env.dev-users; set +a
  ```
  Use `$TASKHS_ADMIN_EMAIL`/`$TASKHS_ADMIN_PW`, `$TASKHS_COORD_*`, `$TASKHS_MEMBRO_*`.
- **SQL:** `./scripts/psql-dev.sh` (lê do `.env`, gitignorado). **Nunca** `psql` com
  senha inline.
- **Nunca** escrever senha em arquivo, doc, relatório, commit ou saída de terminal.

**O banco de dev é o de PRODUÇÃO, e produção está no ar** (`taskhs.healthsafetytech.com`,
27 contas reais). A listagem mostra **todos** os quadros para **todo mundo**: quadro de
teste aparece para a empresa inteira enquanto existir. Prefixar tudo com `zzz` e apagar
na hora. **Esta feature dispara notificação de verdade** no sino das pessoas — apagar o
quadro leva as notificações junto.

**NUNCA apagar linhas de `audit_log`** — append-only, decisão do dono, vale inclusive
para os registros dos próprios testes.

**`docker compose restart backend` NÃO aplica mudança de código** (o código é copiado na
imagem via `COPY . .`, sem bind-mount). Sempre:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

**Não reiniciar o Vite** (porta 5173) — é do usuário. Para validar o front:
`cd frontend && npm run build`.

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `backend/app/mentions.py` | **Criar** — a regex, extrair os ids alegados, e limpar o token para texto puro. Arquivo próprio porque é lógica de texto pura, sem I/O: dá para ler e conferir isolado, e o `cards.py` já é grande. | 1 |
| `backend/app/routers/cards.py` | **Modificar** — `add_comment` valida os ids e notifica. | 1 |
| `frontend/src/pages/BoardPage.tsx` | **Modificar** — o seletor `@` no textarea (Task 2) e o chip na renderização (Task 3). | 2, 3 |
| `frontend/src/data/changelog.ts` | **Modificar** — v1.5.0. | 4 |

---

### Task 1: O backend — extrair, validar, notificar

O coração da feature. Sem a validação, isto é um vazamento, não uma funcionalidade.

**Files:**
- Create: `backend/app/mentions.py`
- Modify: `backend/app/routers/cards.py:301-330` (`add_comment`)

**Interfaces:**
- Consumes: `_get_card_or_404(card_id, list_id, db)` (`cards.py:83`); `BoardMember`,
  `CardMember`, `Notification`, `List` — todos já importados em `cards.py`.
- Produces:
  - `ids_mencionados(texto: str) -> set[int]` — os ids que o corpo **alega** mencionar.
  - `texto_para_notificacao(texto: str) -> str` — troca `@[Nome](id)` por `@Nome`.
  - Notificação de tipo `card_mention`. A Task 2 e a Task 3 dependem do formato do token
    definido aqui (`@[Nome](id)`), não do código.

- [ ] **Step 1: Criar a branch**

```bash
cd /home/ericks/github/TaskHS && git checkout main && git pull && git checkout -b feat/mencoes-comentarios && git branch --show-current && git status --short && echo "(limpo)"
```
Esperado: branch `feat/mencoes-comentarios`, working tree limpo.

- [ ] **Step 2: O módulo de menções**

Criar `backend/app/mentions.py`:

```python
"""Menções em comentários: @[Nome da Pessoa](14).

Texto puro, sem I/O — de propósito. Quem valida os ids contra o banco é o
router; aqui só se sabe o que o texto ALEGA.
"""
import re

# @[Nome da Pessoa](14) — nome entre colchetes, id do usuario entre parenteses.
# O nome vai no token (e nao so o id) porque o comentario mostra o nome da epoca
# em que foi escrito: e o registro do que a pessoa disse, nao uma versao reescrita
# depois. O id vai junto porque os nomes deste sistema tem espaco — "@Adriana Paz
# Silva" seria ambiguo, e dois "Adriana" seriam indistinguiveis.
MENCAO_RE = re.compile(r"@\[([^\]]+)\]\((\d+)\)")


def ids_mencionados(texto: str) -> set[int]:
    """Ids que o texto ALEGA mencionar.

    ALEGA é a palavra: o corpo do comentário vem do cliente. Quem chama TEM que
    validar cada id contra board_members antes de notificar — senão dá para forjar
    @[Quem Quiser](99) e entregar ao usuário 99 uma notificação com o texto que o
    autor escolher, de um quadro que ele não abre.
    """
    return {int(m.group(2)) for m in MENCAO_RE.finditer(texto)}


def texto_para_notificacao(texto: str) -> str:
    """Troca @[Nome](14) por @Nome.

    A notificação do sino é texto puro: sem isto ela mostraria
    'oi @[Adriana Paz](14) veja isso'.
    """
    return MENCAO_RE.sub(lambda m: f"@{m.group(1)}", texto)
```

- [ ] **Step 3: `add_comment` valida e notifica**

Em `backend/app/routers/cards.py`, substituir `add_comment` (`:301-330`) inteiro:

```python
@router.post("/{card_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(list_id: int, card_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
    lst = await db.execute(select(List).where(List.id == list_id))
    lst_obj = lst.scalar_one_or_none()
    board_id = lst_obj.board_id if lst_obj else None

    # O trecho do sino e texto puro: sem isto ele mostraria "@[Adriana Paz](14)".
    limpo = texto_para_notificacao(body.body)
    trecho = f"{limpo[:80]}{'…' if len(limpo) > 80 else ''}"

    # O corpo vem do CLIENTE. Sem validar contra board_members, alguem forja
    # @[Quem Quiser](99) e o sistema entrega ao usuario 99 uma notificacao com o
    # texto que o autor escolher, de um quadro que ele nao abre. Id que nao passa
    # e ignorado: o texto do comentario fica como foi escrito, so nao notifica.
    alegados = ids_mencionados(body.body)
    mencionados: set[int] = set()
    if alegados:
        mencionados = set((await db.execute(
            select(BoardMember.user_id).where(
                BoardMember.board_id == board_id,
                BoardMember.user_id.in_(alegados),
            )
        )).scalars().all())
    mencionados.discard(current_user.id)   # mencionar a si mesmo nao notifica

    for uid in sorted(mencionados):
        db.add(Notification(
            user_id=uid,
            type="card_mention",
            message=f"{current_user.name} mencionou você em \"{card.title}\": {trecho}",
            card_id=card_id,
            board_id=board_id,
        ))

    # So notifica quem e membro do quadro: a notificacao leva o titulo do card e um
    # trecho do comentario. Mesma rede do loop de lembretes — se a invariante furar
    # por um caminho imprevisto, aqui o custo e zero em vez de vazamento.
    members_result = await db.execute(
        select(CardMember)
        .join(BoardMember, BoardMember.user_id == CardMember.user_id)
        .where(CardMember.card_id == card_id, BoardMember.board_id == board_id)
    )
    for m in members_result.scalars().all():
        # Quem foi mencionado ja recebeu a notificacao de mencao, que e a mais
        # especifica — nao mandar as duas.
        if m.user_id != current_user.id and m.user_id not in mencionados:
            db.add(Notification(
                user_id=m.user_id,
                type="card_comment",
                message=f"{current_user.name} comentou em \"{card.title}\": {trecho}",
                card_id=card_id,
                board_id=board_id,
            ))
    await db.commit()
    result = await db.execute(
        select(CardComment).where(CardComment.id == comment.id).options(selectinload(CardComment.author))
    )
    return result.scalar_one()
```

Notas para quem implementa:
- Repare que o `card_comment` **também** passou a usar o `trecho` limpo — antes ele
  montava a mensagem com `body.body[:80]` cru, e passaria a mostrar o token.
- `sorted(mencionados)` só para a ordem das notificações ser determinística (o `set` não
  tem ordem) — facilita conferir a saída da bateria.
- Acrescentar o import no topo de `cards.py`:
  ```python
  from app.mentions import ids_mencionados, texto_para_notificacao
  ```

- [ ] **Step 4: Verificar**

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
```
Esperado: `{"status":"ok"}`

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }

# ids das cobaias, pelo e-mail (nunca hardcode)
MID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_MEMBRO_EMAIL';" | tr -d ' ')
CID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_COORD_EMAIL';" | tr -d ' ')
echo "membro=$MID coordenador=$CID"

Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz mencoes"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz CARD"}' | jid)

# o MEMBRO e do quadro E do card. O COORDENADOR NAO e membro deste quadro.
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$Q/members" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"user_id\":$MID,\"role\":\"member\"}"
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/$MID" -H "Authorization: Bearer $A"

notis() { ./scripts/psql-dev.sh -c "SELECT u.name, n.type, left(n.message, 60) AS msg FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.card_id=$C ORDER BY n.id;"; }

echo "=== 1) mencionar o MEMBRO (que tambem e membro do card): UMA notificacao, do tipo card_mention ==="
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"body\":\"olha isso @[Fulano](${MID}) por favor\"}"
notis

echo "=== 2) FORJAR mencao a NAO-MEMBRO do quadro (o teste central): NENHUMA notificacao pra ele ==="
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"body\":\"segredo @[Invasor](${CID})\"}"
./scripts/psql-dev.sh -t -c "SELECT '   notificacoes para o nao-membro: '||count(*) FROM notifications WHERE card_id=$C AND user_id=$CID;"

echo "=== 3) FORJAR id inexistente: nenhuma notificacao, sem 500 ==="
curl -s -o /dev/null -w "   HTTP %{http_code}  (esperado 201)\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"body":"@[Ninguem](99999) oi"}'

echo "=== 4) o autor menciona a SI MESMO: nao notifica ==="
AID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_ADMIN_EMAIL';" | tr -d ' ')
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"body\":\"nota pra mim @[Eu](${AID})\"}"
./scripts/psql-dev.sh -t -c "SELECT '   notificacoes para o proprio autor: '||count(*) FROM notifications WHERE card_id=$C AND user_id=$AID;"

echo "=== 5) comentario SEM mencao: o membro do card recebe card_comment, como antes ==="
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"body":"comentario simples sem mencao"}'

echo "=== 6) o resumo por tipo ==="
./scripts/psql-dev.sh -c "SELECT u.name, n.type, count(*) FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.card_id=$C GROUP BY 1,2 ORDER BY 1,2;"

echo "=== 7) o sino nao mostra o token cru ==="
./scripts/psql-dev.sh -c "SELECT left(message, 70) AS msg FROM notifications WHERE card_id=$C ORDER BY id LIMIT 2;"

echo "=== LIMPEZA ==="
curl -s -o /dev/null -w "   apaga o quadro: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

**Esperado:**
1. o membro recebe **uma** notificação, tipo **`card_mention`** (e **não** um
   `card_comment` junto)
2. `notificacoes para o nao-membro: 0` — **este é o teste central**
3. `201`, sem 500
4. `notificacoes para o proprio autor: 0`
5. o membro do card recebe `card_comment`
6. o resumo: o membro com `card_mention` **1** e `card_comment` **4**; o não-membro e o
   autor **ausentes**.
   (Os 4: os passos 2, 3, 4 e 5 são todos comentários, e em nenhum deles o membro é
   mencionado — então ele recebe o `card_comment` de cada um. Só o passo 1 o menciona, e
   lá ele recebe a de menção **em vez** da de comentário.)
7. as mensagens mostram `@Fulano`, **nunca** `@[Fulano](14)`
- `boards restantes: [20]`

**Se o não-membro receber qualquer notificação, o fix não pegou** — investigue e reporte
o que realmente aconteceu, não maquie e não ajuste o teste.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mentions.py backend/app/routers/cards.py
git commit -m "$(cat <<'EOF'
feat(comentarios): mencionar pessoas com @

O corpo guarda @[Nome](id) e o backend VALIDA cada id contra
board_members antes de notificar. A validacao e o coracao disto, nao um
detalhe: o corpo vem do cliente, e sem ela alguem forja @[Quem Quiser](99)
e o sistema entrega ao usuario 99 uma notificacao com o texto que o autor
escolher, de um quadro que ele nao abre.

Id que nao passa e ignorado em silencio — o texto do comentario fica como
foi escrito, so nao gera notificacao.

Quem e mencionado E membro do card recebe so a de mencao (a mais
especifica), nao as duas. Mencionar a si mesmo nao notifica, espelhando a
guarda que ja existia.

O trecho do sino passa pelo texto_para_notificacao nos DOIS tipos: sem
isso o sino mostraria 'oi @[Adriana Paz](14) veja isso'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: O seletor `@` no campo de comentário

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:944-953` (o `textarea`) e os states/handlers
  do `CardDetailModal`

**Interfaces:**
- Consumes: `GET /boards/{boardId}/members` → `BoardMemberOut[]`. **Já existe e já é
  usado neste componente**: o `CardDetailModal` recebe a prop `boardId` (`:135`) e
  carrega os membros em `allUsers` (`:154`, `:288-293`) quando o seletor de membros do
  card abre. Reaproveite — não crie um segundo estado.
- Produces: insere o token `@[Nome](id)` no corpo. A Task 3 renderiza esse mesmo formato.

- [ ] **Step 1: Carregar os membros também quando o `@` abre**

Hoje o `useEffect` de `:288-293` só carrega quando `showMemberPicker` abre. Acrescentar o
state da menção junto dos outros do `CardDetailModal`:

```tsx
  const [mencaoQuery, setMencaoQuery] = useState<string | null>(null);
  const comentarioRef = useRef<HTMLTextAreaElement>(null);
```

E estender a condição do `useEffect` existente (`:288-293`) para carregar nos dois casos:

```tsx
  useEffect(() => {
    if ((showMemberPicker || mencaoQuery !== null) && allUsers.length === 0) {
      // Membros do QUADRO, nao as 27 pessoas da empresa: so eles podem ser
      // atribuidos (o backend recusa o resto com 403) e so eles podem ser
      // mencionados (o backend ignora os demais).
      api.get<BoardMemberOut[]>(`/boards/${boardId}/members`).then(setAllUsers).catch(() => {});
    }
  }, [showMemberPicker, mencaoQuery, boardId]);
```

- [ ] **Step 2: Detectar o `@` enquanto digita**

Acrescentar, junto dos outros handlers do `CardDetailModal`:

```tsx
  // O @ vale enquanto nao houver espaco depois dele — "@adri" abre o seletor,
  // "@adri " (com espaco) fecha. `[^\s@[\]]*` tambem impede casar dentro de um
  // token ja inserido, @[Nome](14).
  const MENCAO_DIGITANDO = /@([^\s@[\]]*)$/;

  function onChangeComentario(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const texto = e.target.value;
    setCommentBody(texto);
    const caret = e.target.selectionStart ?? texto.length;
    const m = MENCAO_DIGITANDO.exec(texto.slice(0, caret));
    setMencaoQuery(m ? m[1] : null);
  }

  function inserirMencao(p: UserBasic) {
    const el = comentarioRef.current;
    const caret = el?.selectionStart ?? commentBody.length;
    const antes = commentBody.slice(0, caret).replace(MENCAO_DIGITANDO, `@[${p.name}](${p.id}) `);
    const depois = commentBody.slice(caret);
    setCommentBody(antes + depois);
    setMencaoQuery(null);
    // devolve o foco e poe o cursor logo depois do token inserido
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(antes.length, antes.length);
    });
  }

  const mencaoCandidatos =
    mencaoQuery === null
      ? []
      : allUsers.filter(u => u.name.toLowerCase().includes(mencaoQuery.toLowerCase())).slice(0, 6);
```

- [ ] **Step 3: O textarea e o dropdown**

**A estrutura de hoje**, para você não se perder no balanceamento:
```
945    <div className="shrink-0 mb-4">      <- abre
946-953   <textarea ... />                  <- SUBSTITUIR
954-962   {commentBody.trim() && (<button>Enviar</button>)}   <- NÃO MEXER
963    </div>                               <- fecha (continua servindo)
```

Substituir **só as linhas 945-953** (a abertura da `div` + o `textarea`) pelo bloco
abaixo. As linhas 954-962 (o botão Enviar) e o `</div>` da 963 **ficam como estão** — o
dropdown entra antes delas, dentro da mesma `div`, que agora é `relative` para o
`absolute` do dropdown se ancorar nela:

```tsx
              <div className="shrink-0 mb-4 relative">
                <textarea
                  ref={comentarioRef}
                  value={commentBody}
                  onChange={onChangeComentario}
                  onKeyDown={e => {
                    // Enquanto o seletor de mencao esta aberto, Esc fecha e Enter
                    // escolhe o primeiro — sem isso o Enter enviaria o comentario
                    // no meio da escolha.
                    if (mencaoQuery !== null && mencaoCandidatos.length > 0) {
                      if (e.key === "Escape") { e.preventDefault(); setMencaoQuery(null); return; }
                      if (e.key === "Enter") { e.preventDefault(); inserirMencao(mencaoCandidatos[0]); return; }
                    }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); }
                  }}
                  placeholder="Escrever um comentário…  (@ para marcar alguém)"
                  rows={3}
                  className="w-full text-sm text-slate-200 bg-background-elevated border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-500 leading-relaxed"
                />
                {mencaoQuery !== null && mencaoCandidatos.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 z-20 w-56 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                    {mencaoCandidatos.map(u => (
                      <button
                        key={u.id}
                        onClick={() => inserirMencao(u)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-background-elevated transition-colors text-left"
                      >
                        <div className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-300 shrink-0">
                          {u.initials}
                        </div>
                        <span className="text-xs text-slate-200 truncate">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
```

**Não** feche a `div` aqui: o bloco acima termina com o dropdown, e logo abaixo dele
continuam o botão Enviar (linhas 954-962 originais) e o `</div>` da 963. Se o build
reclamar de tag desbalanceada, você removeu uma linha a mais ou a menos — confira contra
a estrutura acima e **reporte** o que ajustou.

Nota: o dropdown abre **para cima** (`bottom-full`) porque o campo de comentário fica na
parte de baixo do modal.

- [ ] **Step 4: Limpar o estado ao enviar**

Em `handleAddComment` (`:314-326`), depois de `setCommentBody("")`, acrescentar:

```tsx
      setMencaoQuery(null);
```

- [ ] **Step 5: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro. **Atenção ao `noUnusedLocals`/`noUnusedParameters`** do
`tsconfig.app.json` — variável sem uso quebra o build.

**Não reinicie o Vite** (porta 5173) — é do usuário.

No navegador. Monte o cenário e olhe a tela:

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
MID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_MEMBRO_EMAIL';" | tr -d ' ')
Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz seletor"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz card"}'
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$Q/members" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"user_id\":$MID,\"role\":\"member\"}"
echo "abra: http://localhost:5173/boards/$Q   (quadro $Q — apague ao terminar)"
```

**A. O seletor abre e filtra:** abrir o card → no campo de comentário digitar `@` → a
lista aparece com **os 2 membros do quadro** (não as 27 pessoas). Digitar mais letras
filtra.

**B. Escolher insere o token:** clicar numa pessoa → o texto vira `@[Nome](id) ` e o
cursor fica depois dele.

**C. O Enter não atrapalha:** com o seletor aberto, `Enter` escolhe o primeiro da lista
(não envia o comentário). Com o seletor fechado, `Enter` envia normalmente.

**D. O `Esc` fecha** o seletor sem enviar nada.

**E. Não abre onde não deve:** digitar um `@` e depois um espaço fecha o seletor. Digitar
`@` dentro de um token já inserido não reabre.

**LIMPEZA** (obrigatória — a listagem mostra esse quadro pra empresa inteira):
```bash
curl -s -o /dev/null -w "apaga o quadro: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```
Esperado: `204` e `boards restantes: [20]`.

- [ ] **Step 6: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/pages/BoardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): seletor de mencao (@) no campo de comentario

Digitar @ abre a lista dos membros do QUADRO — a mesma fonte do seletor
de membros do card, e a mesma regra: o backend so notifica quem e membro.

O Enter com o seletor aberto escolhe o primeiro em vez de enviar o
comentario, e o Esc fecha. Sem isso o Enter enviaria no meio da escolha.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Renderizar a menção como chip

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:980` (o `<p>` do corpo do comentário)

**Interfaces:**
- Consumes: o formato `@[Nome](id)` (Task 1).
- Produces: componente `CorpoComentario`.

- [ ] **Step 1: O componente**

Acrescentar em `frontend/src/pages/BoardPage.tsx`, **antes** do `CardDetailModal` (perto
dos outros componentes auxiliares do arquivo):

```tsx
// @[Nome da Pessoa](14) — tem que casar com o MENCAO_RE do backend (app/mentions.py).
// O {1,120} e o limite do User.name; o teto (em vez de +) evita a varredura quadratica.
const MENCAO_RENDER = /@\[([^\]\n]{1,120})\]\((\d+)\)/g;

/** O corpo do comentário com as menções destacadas.
 *  Mostra o nome guardado no token — o da época em que foi escrito. É o registro
 *  do que a pessoa disse, não uma versão reescrita depois. */
function CorpoComentario({ texto }: { texto: string }) {
  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENCAO_RENDER);   // instancia propria: lastIndex e mutavel
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(
      <span key={`${m.index}-${m[2]}`} className="text-primary font-semibold bg-primary/10 rounded px-1">
        @{m[1]}
      </span>
    );
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}
```

Nota: `new RegExp(MENCAO_RENDER)` cria uma instância nova a cada chamada. A regex com
flag `g` guarda `lastIndex` entre execuções — compartilhar a mesma instância entre
comentários faria o segundo comentário começar a busca no meio.

- [ ] **Step 2: Usar no comentário**

Trocar a linha `:980`:

```tsx
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-background-elevated rounded-lg px-2.5 py-2"><CorpoComentario texto={c.body} /></p>
```

O `whitespace-pre-wrap` continua na `<p>`, então as quebras de linha do texto ao redor
seguem preservadas.

- [ ] **Step 3: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

No navegador (monte um quadro `zzz` como na Task 2, ou reuse se ainda tiver um):

**A. O chip aparece:** um comentário com menção mostra `@Nome` destacado, e o resto do
texto normal ao redor.

**B. Texto ao redor intacto:** comentar
`linha um @[Nome](id) meio
linha dois` → as duas linhas aparecem, a quebra preservada, e o chip no meio da primeira.

**C. Duas menções no mesmo comentário:** as duas viram chip (este é o caso que o
`lastIndex` da regex quebraria).

**D. Comentário sem menção:** aparece exatamente como antes.

**E. Vários comentários com menção na mesma tela:** todos renderizam (o outro caso do
`lastIndex`).

**LIMPEZA:** apague o quadro `zzz` e confirme `boards restantes: [20]`.

- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/pages/BoardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): renderiza a mencao como chip no comentario

O corpo era um <p> de texto puro; agora e montado por partes. Mostra o
nome guardado no token — o da epoca em que foi escrito.

A regex com flag g guarda lastIndex entre execucoes, entao cada chamada
instancia a sua: compartilhar faria o segundo comentario (ou a segunda
mencao) comecar a busca no meio e sumir da tela.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Changelog v1.5.0

**Files:**
- Modify: `frontend/src/data/changelog.ts` (topo do array `CHANGELOG`)

**Interfaces:**
- Consumes: nada. `APP_VERSION` deriva de `CHANGELOG[0]`.

- [ ] **Step 1: A entrada**

Inserir como **primeiro** item do array `CHANGELOG`, antes da entrada `1.4.1`:

```ts
  {
    version: "1.5.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "Marque pessoas nos comentários: digite @ e escolha alguém do quadro. A pessoa recebe uma notificação de que foi mencionada." },
    ],
  },
```

Versão **1.5.0**: novidade (a regra do `CLAUDE.md` manda minor para novidade).

- [ ] **Step 2: Verificar**

```bash
cd /home/ericks/github/TaskHS/frontend && npm run build
```
Esperado: build sem erro.

No navegador: o rodapé da sidebar mostra **TaskHS · v1.5.0**; clicar abre o
`ChangelogModal` com a 1.5.0 no topo, marcada como "Versão atual".

- [ ] **Step 3: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/data/changelog.ts
git commit -m "$(cat <<'EOF'
docs: changelog v1.5.0 — mencoes em comentarios

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final da branch

```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build backend && sleep 6 && curl -s localhost:8000/api/health
set -a; source backend/.env.dev-users; set +a
tok() { curl -s -m 15 -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
A=$(tok "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"); jid() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
MID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_MEMBRO_EMAIL';" | tr -d ' ')
CID=$(./scripts/psql-dev.sh -t -c "SELECT id FROM users WHERE email='$TASKHS_COORD_EMAIL';" | tr -d ' ')

Q=$(curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz final"}' | jid)
L=$(curl -s -X POST "http://localhost:8000/api/boards/$Q/lists" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"l"}' | jid)
C=$(curl -s -X POST "http://localhost:8000/api/lists/$L/cards" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"title":"zzz card"}' | jid)
curl -s -o /dev/null -X POST "http://localhost:8000/api/boards/$Q/members" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"user_id\":$MID,\"role\":\"member\"}"
curl -s -o /dev/null -X POST "http://localhost:8000/api/lists/$L/cards/$C/members/$MID" -H "Authorization: Bearer $A"

echo "1) mencao legitima + forjada, no mesmo comentario:"
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "http://localhost:8000/api/lists/$L/cards/$C/comments" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"body\":\"@[Legitimo](${MID}) olha isso, e @[Invasor](${CID}) tambem\"}"
./scripts/psql-dev.sh -c "SELECT u.name, n.type, left(n.message,55) AS msg FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.card_id=$C ORDER BY n.id;"
echo "   ^ esperado: SO o membro legitimo, tipo card_mention, com o texto mostrando @Legitimo e @Invasor (o texto e livre; a NOTIFICACAO e que nao vai pro invasor)"
./scripts/psql-dev.sh -t -c "SELECT '   notificacoes para o nao-membro: '||count(*) FROM notifications WHERE card_id=$C AND user_id=$CID;"

echo "LIMPEZA:"
curl -s -o /dev/null -w "   apaga: %{http_code}\n" -X DELETE "http://localhost:8000/api/boards/$Q" -H "Authorization: Bearer $A"
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $A" | python3 -c 'import sys,json; print("   boards restantes:", [b["id"] for b in json.load(sys.stdin)])'
```

Esperado: `201` · **só** o membro legítimo notificado, tipo `card_mention` ·
`notificacoes para o nao-membro: 0` · `boards restantes: [20]`.

```bash
cd frontend && npm run build
```
Esperado: build sem erro.
