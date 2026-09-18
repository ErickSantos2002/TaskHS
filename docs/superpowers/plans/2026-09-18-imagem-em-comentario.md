# Imagem em comentário de card — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar imagem ao escrever um comentário de card (colar, arrastar ou botão), com a imagem virando automaticamente anexo do card.

**Architecture:** Uma coluna `comment_id` em `card_attachments` liga o anexo ao comentário. O endpoint de upload de anexos não muda: o frontend sobe as imagens por ele e manda os ids na criação do comentário, que valida e carimba o dono. A exibição no comentário reaproveita as miniaturas que o modal já baixa para o bloco Anexos.

**Tech Stack:** FastAPI assíncrono + SQLAlchemy 2.0 + PostgreSQL (asyncpg); React 19 + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-18-imagem-em-comentario-design.md` — leia antes de começar qualquer task.

## Global Constraints

- **Branch:** todo o trabalho em `feat/imagem-em-comentario`, criada a partir da `main`.
- **NÃO existe suíte de testes** neste projeto (nem pytest, nem teste no front). Não invente comandos de teste. A verificação de cada task é manual: `curl`, navegador e `npm run build`.
- **Repositório PÚBLICO.** Nunca escreva senha, `PGPASSWORD=`, `SECRET_KEY`, `INTEGRATION_API_KEY` ou `DATABASE_URL` completa em código, doc, plano ou mensagem de commit. Para rodar SQL use `./scripts/psql-dev.sh`, que lê a credencial do `backend/.env` (gitignorado). Nunca faça `cat backend/.env`.
- **Interface e mensagens em português.**
- **Tipos de imagem aceitos no comentário:** `image/jpeg`, `image/png`, `image/gif`, `image/webp` — e só esses.
- **Limites:** no máximo **5** imagens por comentário; **10 MB** por arquivo (espelha o `MAX_SIZE` do backend).
- **Migration:** aditiva e idempotente, aplicada sozinha no boot pelo runner `app/migrations.py`. Nunca alterar uma migration já existente.
- **Changelog obrigatório:** a feature só está pronta com a entrada **v2.3.0** no topo de `frontend/src/data/changelog.ts` (Task 6).
- Backend roda em Docker: `docker compose up -d --build`, logs com `docker compose logs -f backend`.

---

### Task 1: Coluna `comment_id` no anexo

**Files:**
- Create: `backend/migrations/011_comment_attachments.sql`
- Modify: `backend/app/models/card.py` (classe `CardAttachment`)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: coluna `card_attachments.comment_id` (`int | None`) no banco e o atributo `CardAttachment.comment_id` no ORM. Todas as tasks seguintes dependem dela.

- [ ] **Step 1: Criar a branch**

```bash
git checkout main && git pull
git checkout -b feat/imagem-em-comentario
```

- [ ] **Step 2: Escrever a migration**

Crie `backend/migrations/011_comment_attachments.sql` com exatamente este conteúdo:

```sql
-- 011: imagem enviada dentro de um comentário.
--
-- Rodada automaticamente no boot pelo runner (app/migrations.py), depois do
-- create_all. Aditiva e idempotente.
--
-- comment_id NULL  = anexo solto, subido pelo bloco Anexos (o de sempre).
-- comment_id != NULL = imagem que veio junto daquele comentário. Continua sendo
-- anexo do card (card_id preenchido), então o bloco Anexos a exibe sem mudança.
--
-- ON DELETE SET NULL NÃO É ENFEITE: Card.comments e Card.attachments têm
-- cascade="all, delete-orphan" no ORM, e o SQLAlchemy apaga as coleções filhas
-- sem ordem garantida ENTRE elas. Se os comentários forem apagados antes dos
-- anexos, a FK estoura e delete_card devolve 500. Com SET NULL não existe ordem
-- errada possível.

ALTER TABLE card_attachments
  ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_card_attachments_comment_id
  ON card_attachments (comment_id);
```

- [ ] **Step 3: Declarar a coluna no modelo**

Em `backend/app/models/card.py`, na classe `CardAttachment`, adicione o campo logo depois de `card_id`:

```python
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    # Imagem que veio junto de um comentário (v2.3.0). NULL = anexo solto.
    # O ondelete="SET NULL" tem que existir aqui também, e não só na migration:
    # num banco novo a tabela nasce do create_all, não da migration. Ver 011.
    comment_id: Mapped[int | None] = mapped_column(
        ForeignKey("card_comments.id", ondelete="SET NULL"), nullable=True
    )
```

- [ ] **Step 4: Subir o backend e conferir que a migration aplicou**

```bash
docker compose up -d --build
docker compose logs backend | grep -i migration
```

Esperado: uma linha citando `011_comment_attachments.sql` aplicada. O app **não sobe** se a migration falhar — isso é de propósito.

- [ ] **Step 5: Conferir a coluna no banco**

```bash
./scripts/psql-dev.sh -c "\d card_attachments"
```

Esperado: a coluna `comment_id | integer |` na listagem e a constraint de FK com `ON DELETE SET NULL`.

- [ ] **Step 6: Conferir que a API continua de pé**

```bash
curl -s http://localhost:8000/api/health
```

Esperado: resposta de saúde normal, sem erro 500.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/011_comment_attachments.sql backend/app/models/card.py
git commit -m "feat(anexo): coluna comment_id em card_attachments

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Comentário passa a devolver `attachments`

**Files:**
- Modify: `backend/app/schemas/card.py` (classe `CommentOut`)
- Modify: `backend/app/routers/cards.py` (imports, `_comment_to_dict`, `_card_to_dict`, `_anexos_do_comentario`, `edit_comment`, `delete_comment`)
- Modify: `frontend/src/types/index.ts` (interface `Comment`)

**Interfaces:**
- Consumes: `CardAttachment.comment_id` da Task 1.
- Produces:
  - `CommentOut.attachments: list[AttachmentOut]` — toda resposta que contém comentário passa a trazer a chave `attachments` (lista vazia quando não há imagem).
  - `_comment_to_dict(c: CardComment, anexos: list[dict] | None = None) -> dict`
  - `async _anexos_do_comentario(comment_id: int, db: AsyncSession) -> list[dict]`
  - No frontend, `Comment.attachments?: Attachment[]`.

- [ ] **Step 1: Adicionar o campo em `CommentOut`**

Em `backend/app/schemas/card.py`, a classe `CommentOut` fica assim (o campo novo é o último, antes do `model_config`):

```python
class CommentOut(BaseModel):
    id: int
    body: str
    author: UserOut
    created_at: datetime
    edited_at: datetime | None = None
    original_body: str | None = None   # texto da 1ª versão; None em comentário excluído
    deleted_at: datetime | None = None
    # Imagens enviadas junto deste comentário (v2.3.0). São anexos do card, no
    # mesmo formato do bloco Anexos — o front não precisa de um segundo tipo.
    attachments: list[AttachmentOut] = []
    model_config = {"from_attributes": True}
```

**Atenção à ordem no arquivo:** `AttachmentOut` é declarada DEPOIS de `CommentOut` hoje. Mova a classe `AttachmentOut` inteira (com o `field_validator` dela) para ANTES de `CommentOut`, senão o módulo não importa (`NameError`).

- [ ] **Step 2: Importar o que falta em `cards.py`**

Em `backend/app/routers/cards.py`, na linha do import de modelos, acrescente `CardAttachment`:

```python
from app.models.card import Card, CardAttachment, CardComment, CardMember, CardLabel, Checklist, ChecklistItem
```

E logo abaixo do import de `app.mentions`, acrescente:

```python
# Reusa o serializador do router de anexos para o anexo ter UMA forma só no JSON.
# Import seguro: routers/__init__.py é vazio e attachments.py não importa cards.py.
from app.routers.attachments import attachment_to_dict
```

- [ ] **Step 3: Passar os anexos pelo `_comment_to_dict`**

Em `backend/app/routers/cards.py`, substitua a função `_comment_to_dict` inteira por:

```python
def _comment_to_dict(c: CardComment, anexos: list[dict] | None = None) -> dict:
    # Comentário excluído não devolve corpo nem original — a UI só mostra o placeholder.
    deleted = c.deleted_at is not None
    return {
        "id": c.id,
        "body": "" if deleted else c.body,
        "author": c.author,
        "created_at": c.created_at,
        "edited_at": None if deleted else c.edited_at,
        "original_body": None if deleted else c.original_body,
        "deleted_at": c.deleted_at,
        # Comentário excluído não exibe as imagens. Elas NÃO somem do card: seguem
        # no bloco Anexos, que é outra lista. Ver spec 2026-09-18.
        "attachments": [] if deleted else (anexos or []),
    }
```

- [ ] **Step 4: Agrupar os anexos por comentário no `_card_to_dict`**

Em `backend/app/routers/cards.py`, dentro de `_card_to_dict`, substitua o trecho que monta `comments` e `attachments`. Antes do `return`, abra a função com o agrupamento:

```python
def _card_to_dict(card: Card) -> dict:
    anexos = _to_list(card.attachments)
    # Agrupa em memória: o card já carrega comentários e anexos pelo _card_options(),
    # então isto não custa consulta nenhuma.
    por_comentario: dict[int, list[dict]] = {}
    for a in anexos:
        if a.comment_id is not None:
            por_comentario.setdefault(a.comment_id, []).append(attachment_to_dict(a))
    return {
        ...
```

e troque as duas chaves para:

```python
        "comments": [_comment_to_dict(c, por_comentario.get(c.id)) for c in _to_list(card.comments)],
        # A lista de Anexos do card continua trazendo TODOS os anexos, inclusive os
        # que vieram em comentário — é isso que faz a imagem do comentário aparecer
        # no bloco Anexos sem código novo.
        "attachments": [attachment_to_dict(a) for a in anexos],
```

O dicionário de anexo que estava escrito à mão dentro do `_card_to_dict` some — quem serializa agora é o `attachment_to_dict` importado.

- [ ] **Step 5: Helper para os endpoints que devolvem um comentário só**

Em `backend/app/routers/cards.py`, logo depois de `_comment_to_dict`, acrescente:

```python
async def _anexos_do_comentario(comment_id: int, db: AsyncSession) -> list[dict]:
    """Imagens de UM comentário. Usado pelos endpoints que devolvem um comentário
    isolado (criar/editar/excluir), onde não há o card carregado para agrupar."""
    result = await db.execute(
        select(CardAttachment)
        .where(CardAttachment.comment_id == comment_id)
        .order_by(CardAttachment.id)
    )
    return [attachment_to_dict(a) for a in result.scalars().all()]
```

- [ ] **Step 6: Usar o helper em `edit_comment` e `delete_comment`**

Em `backend/app/routers/cards.py`, troque o `return` das duas funções:

- em `edit_comment`, `return _comment_to_dict(comment)` vira:

```python
    return _comment_to_dict(comment, await _anexos_do_comentario(comment.id, db))
```

- em `delete_comment`, `return _comment_to_dict(comment)` vira o mesmo:

```python
    return _comment_to_dict(comment, await _anexos_do_comentario(comment.id, db))
```

(Em `delete_comment` o resultado será `[]` de qualquer forma, porque `_comment_to_dict` zera a lista de comentário excluído. Chamar mesmo assim mantém as três saídas com a mesma forma, em vez de uma exceção que alguém vai ter que reaprender depois.)

`add_comment` fica para a Task 3.

- [ ] **Step 7: Espelhar o tipo no frontend**

Em `frontend/src/types/index.ts`, na interface `Comment`, acrescente o campo:

```ts
export interface Comment {
  id: number;
  body: string;
  author: User;
  created_at: string;
  edited_at?: string | null;
  original_body?: string | null;
  deleted_at?: string | null;
  // Imagens enviadas no comentário. São anexos do card (mesmo tipo do bloco Anexos).
  attachments?: Attachment[];
}
```

**A interface `Attachment` precisa estar declarada antes ou depois — em TypeScript a ordem não importa**, mas confirme que `Attachment` existe no mesmo arquivo (existe, por volta da linha 103).

- [ ] **Step 8: Reiniciar o backend e verificar por curl**

```bash
docker compose up -d --build
set -a; source backend/.env.dev-users; set +a
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"healthsafetyti@gmail.com\",\"password\":\"$TASKHS_ADMIN_PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

Pegue um card que já tenha comentário (troque `LIST_ID`/`CARD_ID` pelos reais do seu ambiente) e confira a chave nova:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID | python3 -m json.tool | grep -A2 '"comments"'
```

Esperado: cada comentário traz `"attachments": []`. Nada mais mudou.

- [ ] **Step 9: Conferir que o front compila**

```bash
cd frontend && npm run build && npm run lint
```

Esperado: build passa (o `tsc -b` faz parte do `build`).

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/card.py backend/app/routers/cards.py frontend/src/types/index.ts
git commit -m "feat(comentario): comentario passa a devolver seus anexos

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `POST /comments` aceita `attachment_ids`

**Files:**
- Modify: `backend/app/schemas/card.py` (`CommentCreate`)
- Modify: `backend/app/routers/cards.py` (`add_comment`)
- Modify: `backend/app/audit.py` (`_audit_before_flush`)

**Interfaces:**
- Consumes: `_comment_to_dict` / `_anexos_do_comentario` da Task 2; `CardAttachment.comment_id` da Task 1.
- Produces: contrato `POST /api/lists/{list_id}/cards/{card_id}/comments` com corpo `{ "body": str, "attachment_ids": int[] }`. `body` pode ser vazio se `attachment_ids` não for. É o contrato que a Task 5 consome.

- [ ] **Step 1: Ampliar o `CommentCreate`**

Em `backend/app/schemas/card.py`, acrescente `model_validator` ao import do pydantic:

```python
from pydantic import BaseModel, Field, field_validator, model_validator
```

E substitua a classe `CommentCreate` por:

```python
class CommentCreate(BaseModel):
    # 20 mil caracteres cobre ate uma thread de e-mail colada num card (fluxo real
    # aqui), e a coluna e Text (ilimitada). O limite NAO e o que protege a regex de
    # mencoes — quem faz isso e o teto {1,120} do nome em app/mentions.py, medido:
    # 160 KB em 4ms com o teto, 1.3s sem. Este limite e so sanidade de payload.
    #
    # min_length caiu de 1 para 0 na v2.3.0: comentario so com imagem e valido.
    # Quem garante que nao entra comentario vazio de verdade e o validator abaixo.
    body: str = Field(min_length=0, max_length=20000)
    # Anexos que ja existem neste card e ainda nao tem dono. O endpoint carimba o
    # comment_id neles. Teto de 5 para o historico nao virar mural de fotos.
    attachment_ids: list[int] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _texto_ou_imagem(self):
        if not self.body.strip() and not self.attachment_ids:
            raise ValueError("Escreva um texto ou anexe uma imagem.")
        return self
```

- [ ] **Step 2: Validar e carimbar em `add_comment`**

Em `backend/app/routers/cards.py`, dentro de `add_comment`, logo depois da linha `card = await _get_card_or_404(card_id, list_id, db)` e ANTES de criar o `CardComment`, insira:

```python
    # Ids repetidos ([7, 7]) achariam 1 de 2 e dariam 400 por um erro do cliente
    # que nao e erro de verdade. Dedup antes de contar.
    ids_pedidos = sorted(set(body.attachment_ids))
    anexos_do_comentario: list[CardAttachment] = []
    if ids_pedidos:
        res = await db.execute(
            select(CardAttachment).where(
                CardAttachment.id.in_(ids_pedidos),
                # ESTE card. Sem esta linha, o id de um anexo de outro quadro
                # apareceria no comentario daqui — leitura de arquivo alheio pela
                # porta dos fundos. Mesma armadilha do "destino no corpo" que o
                # CLAUDE.md descreve para update_card/copy_card.
                CardAttachment.card_id == card_id,
                CardAttachment.comment_id.is_(None),
                CardAttachment.content_type.startswith("image/"),
            )
        )
        anexos_do_comentario = list(res.scalars().all())
        if len(anexos_do_comentario) != len(ids_pedidos):
            # Recusa o comentario inteiro: melhor do que criar um comentario com
            # metade das imagens e deixar a pessoa descobrir depois.
            raise HTTPException(status_code=400, detail="Imagem inválida ou já usada em outro comentário.")
```

Logo abaixo, a criação do comentário ganha o `flush` e o carimbo. Substitua:

```python
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
```

por:

```python
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
    if anexos_do_comentario:
        await db.flush()   # precisa do id do comentario para carimbar os anexos
        for a in anexos_do_comentario:
            a.comment_id = comment.id
```

- [ ] **Step 3: Mensagem do sino quando não há texto**

Ainda em `add_comment`, substitua o bloco do trecho:

```python
    # O trecho do sino e texto puro: sem isto ele mostraria "@[Adriana Paz](14)".
    limpo = texto_para_notificacao(body.body)
    trecho = f"{limpo[:80]}{'…' if len(limpo) > 80 else ''}"
```

por:

```python
    # O trecho do sino e texto puro: sem isto ele mostraria "@[Adriana Paz](14)".
    limpo = texto_para_notificacao(body.body)
    trecho = f"{limpo[:80]}{'…' if len(limpo) > 80 else ''}"
    # Comentario so com imagem: sem isto a notificacao sairia com os dois pontos e
    # nada depois ('Fulano comentou em "X": ').
    so_imagem = not limpo.strip()
```

e as duas mensagens de notificação passam a escolher a forma. Troque:

```python
            message=f"{current_user.name} mencionou você em \"{card.title}\": {trecho}",
```

por:

```python
            message=(
                f"{current_user.name} mencionou você em \"{card.title}\""
                if so_imagem else
                f"{current_user.name} mencionou você em \"{card.title}\": {trecho}"
            ),
```

e troque:

```python
                message=f"{current_user.name} comentou em \"{card.title}\": {trecho}",
```

por:

```python
                message=(
                    f"{current_user.name} enviou uma imagem em \"{card.title}\""
                    if so_imagem else
                    f"{current_user.name} comentou em \"{card.title}\": {trecho}"
                ),
```

- [ ] **Step 4: Devolver os anexos na resposta**

Ainda em `add_comment`, a última linha `return _comment_to_dict(result.scalar_one())` vira:

```python
    return _comment_to_dict(result.scalar_one(), await _anexos_do_comentario(comment.id, db))
```

- [ ] **Step 5: Calar o ruído de auditoria do carimbo**

Carimbar `comment_id` deixa o anexo sujo na sessão, e o audit gravaria `editou o anexo "colado-....png"` logo depois do `anexou "colado-....png"` que o upload já registrou — duas linhas para um evento só.

Em `backend/app/audit.py`, dentro de `_audit_before_flush`, no laço `for obj in session.dirty:`, logo depois de `if not changes: continue`, acrescente:

```python
        if type(obj) is CardAttachment and set(changes) <= {"comment_id"}:
            continue  # anexo so ganhou dono (o comentario); o "anexou" ja foi registrado
```

Isso segue o mesmo padrão do `set(changes) <= {"position"}` que já existe logo abaixo para `Card`.

- [ ] **Step 6: Verificar o caminho feliz por curl**

Suba o backend e pegue o token como na Task 2, Step 8. Depois, com um card real:

```bash
# 1) sobe uma imagem qualquer pelo endpoint de anexos
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -F "files=@/caminho/para/uma-imagem.png" \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/attachments | python3 -m json.tool
# anote o "id" devolvido -> ATT_ID

# 2) comentario SO com imagem (body vazio)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"body\":\"\",\"attachment_ids\":[ATT_ID]}" \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/comments | python3 -m json.tool
```

Esperado: `201`, e o comentário devolvido traz o anexo dentro de `attachments`.

- [ ] **Step 7: Verificar as recusas**

```bash
# reusar o MESMO anexo em outro comentario -> 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"body\":\"de novo\",\"attachment_ids\":[ATT_ID]}" \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/comments

# comentario vazio de verdade -> 422
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"body":"","attachment_ids":[]}' \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/comments

# id inexistente -> 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"body":"x","attachment_ids":[999999]}' \
  http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/comments
```

Esperado, em ordem: `400`, `422`, `400`.

- [ ] **Step 8: Verificar o registro de atividade**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/lists/LIST_ID/cards/CARD_ID/activity?limit=10" | python3 -m json.tool | grep summary
```

Esperado: aparece `anexou "..."` e `comentou no card "..."`. **Não pode aparecer** `editou o anexo`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/card.py backend/app/routers/cards.py backend/app/audit.py
git commit -m "feat(comentario): aceita attachment_ids e comentario so com imagem

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Escolher imagem na caixa de comentário (colar, arrastar, clipe)

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` (componente `CardDetailModal`)

**Interfaces:**
- Consumes: nada do backend — esta task é 100% local ao navegador. Nenhuma imagem sobe ainda.
- Produces: estado `imagensComentario: ImagemPendente[]` e a função `adicionarImagensComentario(files: File[]): void`, consumidos pela Task 5. Tipo:

```ts
type ImagemPendente = { id: string; file: File; url: string };
```

- [ ] **Step 1: Constantes e tipo**

Em `frontend/src/pages/BoardPage.tsx`, no topo do arquivo (junto das outras constantes de módulo, fora de qualquer componente), acrescente:

```tsx
// Imagem no comentário: só imagem, e menos tipos que o bloco Anexos (que aceita
// PDF/XML/planilha). Decisão de produto, ver spec 2026-09-18.
const TIPOS_IMAGEM_COMENTARIO = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGENS_COMENTARIO = 5;
const MAX_BYTES_IMAGEM = 10 * 1024 * 1024;   // espelha MAX_SIZE do backend

type ImagemPendente = { id: string; file: File; url: string };
```

- [ ] **Step 2: Estado e ref**

Em `CardDetailModal`, junto dos outros `useState` (perto de `const [erroComentario, ...]`), acrescente:

```tsx
  // Imagens escolhidas para o próximo comentário. Vivem só no navegador até o
  // clique em "Enviar" — ver spec 2026-09-18 ("Por que subir só no Enviar").
  const [imagensComentario, setImagensComentario] = useState<ImagemPendente[]>([]);
  const comentarioFileRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Revogar os objectURL ao sair**

Ainda em `CardDetailModal`, perto do `useEffect` que já revoga `thumbUrlsRef`, acrescente:

```tsx
  // Os objectURL da pré-visualização não passam pelo thumbUrlsRef. Sem isto,
  // quem cola cinco prints e fecha o card deixa cinco blobs presos na memória —
  // e este modal fica aberto bastante tempo.
  const imagensPendentesRef = useRef<ImagemPendente[]>([]);
  useEffect(() => { imagensPendentesRef.current = imagensComentario; }, [imagensComentario]);
  useEffect(() => () => { imagensPendentesRef.current.forEach(i => URL.revokeObjectURL(i.url)); }, []);
```

- [ ] **Step 4: As funções de seleção e remoção**

Em `CardDetailModal`, logo acima de `handleAddComment`, acrescente:

```tsx
  function nomeParaColagem(file: File): string {
    const ext = file.type === "image/png" ? "png"
      : file.type === "image/gif" ? "gif"
      : file.type === "image/webp" ? "webp" : "jpg";
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `colado-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  }

  // Colar, arrastar e o botão de clipe caem todos aqui.
  function adicionarImagensComentario(files: File[]) {
    if (files.length === 0) return;
    setErroComentario(null);
    let erro: string | null = null;
    const aceitas: ImagemPendente[] = [];
    for (const f of files) {
      if (imagensComentario.length + aceitas.length >= MAX_IMAGENS_COMENTARIO) {
        erro = `No máximo ${MAX_IMAGENS_COMENTARIO} imagens por comentário.`;
        break;
      }
      if (!TIPOS_IMAGEM_COMENTARIO.includes(f.type)) {
        erro = "No comentário só entra imagem (JPG, PNG, GIF ou WEBP). Para outros arquivos, use o bloco Anexos.";
        continue;
      }
      if (f.size > MAX_BYTES_IMAGEM) {
        erro = `"${f.name}" passa de 10 MB.`;
        continue;
      }
      // Imagem colada chega sem nome utilizável: os navegadores mandam "image.png"
      // para todo mundo, e o bloco Anexos viraria uma pilha de image.png iguais.
      const arquivo = f.name && f.name !== "image.png" ? f : new File([f], nomeParaColagem(f), { type: f.type });
      aceitas.push({ id: crypto.randomUUID(), file: arquivo, url: URL.createObjectURL(arquivo) });
    }
    if (aceitas.length > 0) setImagensComentario(prev => [...prev, ...aceitas]);
    if (erro) setErroComentario(erro);
  }

  function removerImagemComentario(id: string) {
    const alvo = imagensComentario.find(i => i.id === id);
    if (alvo) URL.revokeObjectURL(alvo.url);
    setImagensComentario(prev => prev.filter(i => i.id !== id));
  }
```

- [ ] **Step 5: Colar na textarea**

Na textarea do comentário (a que tem `ref={comentarioRef}`), acrescente a prop `onPaste` logo depois de `onSelect`:

```tsx
                onPaste={e => {
                  const imagens = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
                  if (imagens.length === 0) return;   // colagem de texto segue normal
                  e.preventDefault();
                  adicionarImagensComentario(imagens);
                }}
```

- [ ] **Step 6: Arrastar sobre a caixa**

A textarea está dentro de uma `<div className="shrink-0 mb-4 relative">`. Acrescente os handlers de arrasto NESSA div:

```tsx
            <div
              className="shrink-0 mb-4 relative"
              onDragEnter={e => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
              onDragOver={e => {
                if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                e.preventDefault(); e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={e => {
                if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                // stopPropagation É O PONTO: sem ele o onCardDrop do modal captura o
                // arquivo e manda direto para o bloco Anexos — a imagem sumiria do
                // comentário e apareceria lá embaixo, sem explicação.
                e.preventDefault(); e.stopPropagation();
                dragDepth.current = 0;
                setArrastando(false);   // o overlay do card já apareceu ao entrar no modal
                adicionarImagensComentario(Array.from(e.dataTransfer.files));
              }}
            >
```

- [ ] **Step 7: Botão de clipe e input escondido**

Dentro da mesma div, logo depois da textarea, acrescente o input:

```tsx
              <input
                ref={comentarioFileRef} type="file" multiple hidden
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={e => { adicionarImagensComentario(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              />
```

- [ ] **Step 8: Faixa de pré-visualização**

Logo depois do bloco `{erroComentario && (...)}`, acrescente:

```tsx
              {imagensComentario.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {imagensComentario.map(img => (
                    <div key={img.id} className="relative">
                      <img src={img.url} alt={img.file.name} className="w-16 h-16 rounded-lg object-cover border border-border" />
                      <button
                        onClick={() => removerImagemComentario(img.id)}
                        title="Tirar esta imagem"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background-surface border border-border text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
```

- [ ] **Step 9: Botão de clipe ao lado do "Enviar"**

Substitua o bloco atual do botão Enviar:

```tsx
              {commentBody.trim() && (
                <button
                  onClick={handleAddComment}
                  disabled={submittingComment}
                  className="mt-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-40 transition-all"
                >
                  {submittingComment ? "Enviando…" : "Enviar"}
                </button>
              )}
```

por:

```tsx
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => comentarioFileRef.current?.click()}
                  title="Anexar imagem (ou cole com Ctrl+V)"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-primary hover:bg-background-elevated transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                {/* O Enviar aparece também quando só há imagem — comentário sem
                    texto é válido desde a v2.3.0. */}
                {(commentBody.trim() || imagensComentario.length > 0) && (
                  <button
                    onClick={handleAddComment}
                    disabled={submittingComment}
                    className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-40 transition-all"
                  >
                    {submittingComment ? "Enviando…" : "Enviar"}
                  </button>
                )}
              </div>
```

- [ ] **Step 10: Verificar no navegador**

```bash
cd frontend && npm run dev
```

Abra um card, vá na aba Comentários e confira, **sem enviar nada**:

1. `Ctrl+V` com um print no clipboard → miniatura aparece na faixa.
2. Arrastar um PNG sobre a caixa → miniatura aparece **na faixa**, e o arquivo **não** vai para o bloco Anexos.
3. Clicar no clipe e escolher uma imagem → miniatura aparece.
4. Clicar no X de uma miniatura → some.
5. Tentar um PDF pelo clipe (mude o filtro do seletor para "todos os arquivos"): recado "No comentário só entra imagem…".
6. Escolher 6 imagens de uma vez: entram 5 e aparece o recado do limite.
7. Colar **texto** com `Ctrl+V` → continua colando texto normalmente.
8. Recarregar a página: nada foi salvo (nenhum anexo novo no card). **É o esperado nesta task.**

- [ ] **Step 11: Build e lint**

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Step 12: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(comentario): escolher imagem por colar, arrastar ou clipe

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enviar as imagens e exibi-las no histórico

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` (`handleAddComment` e a renderização da lista de comentários)

**Interfaces:**
- Consumes: `imagensComentario` / `removerImagemComentario` da Task 4; o contrato `{ body, attachment_ids }` da Task 3; `Comment.attachments` da Task 2.
- Produces: o fluxo completo funcionando ponta a ponta.

- [ ] **Step 1: Enviar imagens junto do comentário**

Em `frontend/src/pages/BoardPage.tsx`, substitua a função `handleAddComment` inteira por:

```tsx
  async function handleAddComment() {
    const body = commentBody.trim();
    if ((!body && imagensComentario.length === 0) || submittingComment) return;
    setSubmittingComment(true);
    setErroComentario(null);
    // Marca se as imagens JÁ subiram, para a mensagem de erro do passo seguinte
    // não convidar a pessoa a mandar tudo de novo e duplicar o anexo.
    let jaSubiu = false;
    try {
      let attachment_ids: number[] = [];
      if (imagensComentario.length > 0) {
        const criados = await api.upload<Attachment[]>(
          `/lists/${card.list_id}/cards/${card.id}/attachments`,
          imagensComentario.map(i => i.file),
        );
        attachment_ids = criados.map(a => a.id);
        // A imagem é anexo do card a partir daqui — o bloco Anexos mostra na hora.
        const novosAnexos = [...attachments, ...criados];
        setAttachments(novosAnexos);
        onCardUpdate({ id: card.id, attachments: novosAnexos });
        imagensComentario.forEach(i => URL.revokeObjectURL(i.url));
        setImagensComentario([]);
        jaSubiu = true;
      }
      const comment = await api.post<Comment>(`/lists/${card.list_id}/cards/${card.id}/comments`, { body, attachment_ids });
      const updated = [...comments, comment];
      setComments(updated);
      setCommentBody("");
      setMencaoQuery(null);
      onCardUpdate({ id: card.id, comments: updated });
    } catch (e) {
      // Sem isto o envio falha em silencio: o botao volta ao normal, o texto fica na
      // caixa, e a pessoa nao sabe por que.
      const msg = e instanceof ApiError ? e.message : "Não foi possível enviar o comentário.";
      setErroComentario(jaSubiu ? `${msg} As imagens já foram salvas em Anexos — não precisa mandar de novo.` : msg);
    } finally {
      setSubmittingComment(false);
    }
  }
```

- [ ] **Step 2: Exibir as imagens no comentário**

Na renderização da lista de comentários, no ramo que hoje é:

```tsx
                    ) : (
                      <>
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-background-elevated rounded-lg px-2.5 py-2"><CorpoComentario texto={c.body} /></p>
```

faça **duas** mudanças.

**(a)** Substitua o `<p>` do corpo por este bloco — o resto do `<>...</>`, com a "Versão original", fica como está:

```tsx
                    ) : (
                      <>
                        {/* Comentário só com imagem não renderiza a bolha cinza vazia. */}
                        {c.body && (
                          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-background-elevated rounded-lg px-2.5 py-2"><CorpoComentario texto={c.body} /></p>
                        )}
                        {/* Sem texto e sem imagem = a imagem foi apagada no bloco Anexos.
                            Não existe lápide por imagem: comentário com texto que perdeu
                            uma das fotos mostra só o que sobrou. Ver spec 2026-09-18. */}
                        {!c.body && (c.attachments ?? []).length === 0 && (
                          <p className="text-xs text-slate-500 italic">imagem removida</p>
                        )}
```

**(b)** A grade de miniaturas vai **fora do ternário**, não dentro deste ramo.

O ternário é `c.deleted_at ? (placeholder) : editandoId === c.id ? (textarea) : (<>corpo</>)`. Se a grade ficasse no último ramo, ela sumiria da tela no instante em que a pessoa clicasse em "Editar" — e a spec diz que na edição **as imagens continuam visíveis, fixas**. Colocando fora, ela aparece tanto na leitura quanto na edição, e some só no comentário excluído.

Localize o fechamento do ternário (o `)}` que vem logo antes do `</div>` que fecha a coluna do comentário, depois do bloco da "Versão original") e insira a grade **depois** dele:

```tsx
                    )}
                    {/* FORA do ternário de propósito: assim as miniaturas continuam
                        visíveis enquanto o texto está sendo editado. Comentário
                        excluído não mostra imagem — mas ela segue no bloco Anexos. */}
                    {!c.deleted_at && (c.attachments ?? []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(c.attachments ?? []).map(a => (
                          thumbs[a.id] ? (
                            <img
                              key={a.id} src={thumbs[a.id]} alt={a.filename}
                              onClick={() => setLightbox(thumbs[a.id])}
                              className="w-28 h-28 rounded-lg object-cover cursor-pointer border border-border hover:border-primary transition-colors"
                            />
                          ) : attErros[a.id] ? (
                            <div key={a.id} className="w-28 h-28 rounded-lg bg-red-500/10 border border-red-500/50 flex items-center justify-center text-[10px] text-red-400 text-center px-2">
                              Imagem indisponível
                            </div>
                          ) : (
                            // A miniatura vem do mesmo efeito que abastece o bloco
                            // Anexos (a imagem do comentário É um anexo do card),
                            // então não há requisição nova — só a espera do blob.
                            <div key={a.id} className="w-28 h-28 rounded-lg bg-background-elevated border border-border animate-pulse" />
                          )
                        ))}
                      </div>
                    )}
```

- [ ] **Step 3: Subir tudo e verificar o caminho feliz**

Com o backend no ar (`docker compose up -d`) e `npm run dev`:

1. Colar um print e clicar em **Enviar** sem escrever nada → o comentário aparece com a imagem.
2. A mesma imagem aparece no bloco **Anexos** do card, com nome `colado-AAAA-MM-DD-HHMMSS.png`.
3. Clicar na imagem do comentário → abre o lightbox.
4. Escrever texto + duas imagens e enviar → texto na bolha, duas miniaturas embaixo.
5. Fechar e reabrir o card → tudo continua lá (veio do servidor, não do estado local).

- [ ] **Step 4: Verificar o tempo real (dois navegadores)**

Abra o mesmo card em duas sessões (use uma janela anônima para o segundo usuário, que precisa ser membro do quadro). Mande um comentário com imagem numa → a outra deve mostrar comentário e anexo **sem F5**.

- [ ] **Step 5: Verificar as exclusões**

1. Excluir a imagem pelo bloco **Anexos**, sendo ela a única coisa de um comentário sem texto → aquele comentário passa a mostrar *"imagem removida"*.
2. Mandar um comentário com texto + 2 imagens, apagar uma pelo bloco Anexos → sobra o texto e a outra imagem, sem lápide. **É o comportamento desejado.**
3. Excluir um comentário que tem imagem → mostra "Comentário excluído", e a imagem **continua** no bloco Anexos.

- [ ] **Step 6: Verificar a edição**

Editar um comentário que tem imagem: a textarea abre só com o texto, as miniaturas continuam visíveis e não há como tirar nem pôr imagem. Salvar mantém as imagens.

- [ ] **Step 7: Build e lint**

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(comentario): envia as imagens e exibe no historico

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Changelog e bateria final

**Files:**
- Modify: `frontend/src/data/changelog.ts`

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: `APP_VERSION` = `2.3.0` (derivado de `CHANGELOG[0]`).

- [ ] **Step 1: Entrada no changelog**

Em `frontend/src/data/changelog.ts`, insira este objeto **no topo** do array `CHANGELOG`, antes do `version: "2.2.1"`:

```ts
  {
    version: "2.3.0",
    date: "2026-09-18",
    changes: [
      { kind: "novidade", text: "Agora dá para mandar imagem no comentário do card. Tire o print e cole com Ctrl+V direto na caixa de comentário — não precisa mais salvar em arquivo antes. Também dá para arrastar a imagem para cima da caixa ou escolher pelo ícone de clipe. São até 5 imagens por comentário, e o comentário pode ser só a imagem, sem texto nenhum." },
      { kind: "melhoria", text: "A imagem mandada no comentário entra sozinha na lista de Anexos do card. Ou seja: ela aparece junto do texto que a explica e também fica guardada com os outros arquivos do card, sem ninguém precisar anexar duas vezes. Apagar o comentário não apaga a imagem dos Anexos." },
    ],
  },
```

- [ ] **Step 2: Conferir a versão na tela**

```bash
cd frontend && npm run build && npm run dev
```

No navegador: o rodapé da sidebar deve mostrar **TaskHS · v2.3.0**, e clicar nele abre o changelog com a entrada nova no topo.

- [ ] **Step 3: Bateria final — o caso que a FK protege**

Estes dois passos são o motivo do `ON DELETE SET NULL` na Task 1. **Faça num quadro de teste, não num quadro de trabalho.**

1. Crie um card, mande um comentário com imagem nele e **exclua o card**. Esperado: exclui normalmente, sem erro 500.
2. Crie um quadro, um card, um comentário com imagem, e **exclua o quadro inteiro**. Esperado: exclui normalmente.

Se qualquer um dos dois der 500, confira nos logs (`docker compose logs backend | tail -40`) se é violação de FK em `card_attachments_comment_id_fkey` — nesse caso a migration 011 não aplicou o `ON DELETE SET NULL`.

- [ ] **Step 4: Varredura de segredo antes de fechar**

```bash
git grep -nE "password|PGPASSWORD|senha.*=|123" -- docs/superpowers/plans/2026-09-18-imagem-em-comentario.md docs/superpowers/specs/2026-09-18-imagem-em-comentario-design.md
```

Esperado: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data/changelog.ts
git commit -m "chore(changelog): v2.3.0 — imagem em comentario de card

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Revisão final da branch**

Rode a revisão da branch inteira e, aprovada, siga a skill `superpowers:finishing-a-development-branch` para o merge na `main` e o push.

```bash
git log --oneline main..feat/imagem-em-comentario
git diff main...feat/imagem-em-comentario --stat
```
