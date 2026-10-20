# Lixeira (exclusão reversível de cards, listas e quadros) — design

**Data:** 2026-10-20 · **Status:** rascunho, escrito sem revisão do Erick (ele saiu e pediu
spec + plano + execução autônoma; revisar ao voltar).

## Por quê

Hoje excluir é `DELETE` de verdade: card, lista (com todos os cards dentro) e quadro (com
tudo) somem do banco sem volta. O TaskHS vai substituir o Trello na empresa, e o Erick quer
fechar esse risco **antes** de acontecer: "não podemos perder dados importantes porque
alguém quis excluir algo".

Sucesso = nenhuma exclusão feita pela interface (ou pela integração) apaga dado; quem
excluiu por engano, ou um colega, desfaz sozinho em segundos, com o card voltando
**inteiro** (comentários, checklists, anexos, etiquetas, membros, lembretes).

## Decisões do Erick

1. **A lixeira nunca se esvazia sozinha.** Nada de purga automática por idade.
2. **Só administrador apaga de vez** (manual, com confirmação).
3. **Qualquer membro do quadro vê a lixeira e restaura** cards e listas.
4. **Cobre as três coisas:** cards, listas e quadros.

## Metas / não-metas / anti-metas

- **Meta:** `DELETE` de card, lista e quadro vira "mover pra lixeira"; restaurar devolve
  tudo como estava; "apagar de vez" só para administrador.
- **Não-meta:** lixeira para comentários, anexos, checklists, etiquetas (comentário já tem
  soft delete próprio desde a v2.x). Visualizar o card completo de dentro da lixeira.
- **Anti-meta (falha mesmo funcionando):** item na lixeira "vazando" — aparecendo no
  quadro, na busca, nas stats, disparando lembrete, recebendo card movido, ou reaparecendo
  ao vivo via SSE. Item na lixeira tem que estar morto para tudo, exceto para a lixeira.

## Modelo

Migration `013_lixeira.sql` (aplicada sozinha no boot pelo `app/migrations.py`):

```sql
ALTER TABLE cards  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE cards  ADD COLUMN IF NOT EXISTS deleted_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lists  ADD COLUMN IF NOT EXISTS deleted_at ...; deleted_by ... ON DELETE SET NULL
ALTER TABLE boards ADD COLUMN IF NOT EXISTS deleted_at ...; deleted_by ... ON DELETE SET NULL
```

Mesmas colunas nos models (`Mapped[datetime | None]`, `Mapped[int | None]` com FK
`ondelete="SET NULL"`), para banco novo nascer certo pelo `create_all`. O `SET NULL` existe
para `deleted_by` (só rastro) não travar a exclusão de usuário pelo admin; a lixeira mostra
"usuário removido" quando vier nulo. *(Minha decisão, apontada na revisão.)*

**A lixeira não propaga para os filhos.** Excluir uma lista marca **só a lista**; os cards
dela continuam com `deleted_at` nulo e somem porque a lista sumiu. Restaurar a lista traz
os cards de volta sem distinguir nada. Assim, um card que **já estava** na lixeira antes
de a lista ser excluída continua na lixeira depois que a lista volta — o que é o certo.
Mesma regra para quadro → listas → cards.

Consequência: "card vivo" = `card.deleted_at IS NULL` **e** lista viva **e** quadro vivo.

## Onde o "vivo" é imposto

Chokepoints em vez de remendo por endpoint:

- **Gates de acesso** (`dependencies.py`):
  - `require_board_access_by_board_id`: depois da checagem de acesso (403 primeiro, como
    manda a regra "acesso antes de existência"), quadro na lixeira → **404**.
  - `require_board_access_by_list_id` / `assert_board_access_by_list_id`: lista na lixeira
    **ou** de quadro na lixeira → **404**. Hoje o elevado passa sem checar se a lista
    existe; passa a checar vida também.
  - Com isso todo endpoint de `lists`, `labels`, `automations`, `cards`, `attachments`,
    `reminders` já nasce bloqueado para lista/quadro na lixeira, e o **destino no corpo**
    (`update_card`/`copy_card`, que chamam `assert_board_access_by_list_id`) não aceita
    lista na lixeira.
  - `user_can_access_board` (stream SSE): quadro na lixeira → sem acesso.
- **Card individual:** `_get_card_or_404` de `cards.py`, `attachments.py`, `reminders.py`
  e o `select` próprio do `update_card` filtram `deleted_at IS NULL`.
- **Listagens:** `get_cards`, `/snapshot`, `get_lists`, `GET /boards`, `/stats`,
  `/archived`, `list_members` (contagem de cards atribuídos), busca global, loop de
  lembretes (manuais e automáticos), `_get_board_or_404` dos routers de quadro.
- **Integração** (`routers/integration.py`): lista de destino na lixeira (ou de quadro na
  lixeira) = 404, igual a arquivada. `DELETE /integration/cards` passa a mandar pra
  lixeira também. **Upsert de card que está na lixeira** atualiza os dados mas **não
  restaura** — a exclusão foi decisão de uma pessoa; a OS ressuscitar sozinha a cada
  sincronização seria pior. *(Minha decisão.)* A resposta leva `deleted_at` preenchido.
  Vale também para card **vivo cuja lista ou quadro está na lixeira**: o upsert atualiza
  os campos de dados mas **não troca a lista** (senão o `_apply_updates` moveria o card
  para uma lista viva e ele ressuscitaria por tabela). Regra única: card "não vivo"
  (ele, a lista ou o quadro na lixeira) recebe os dados, nunca o movimento.
- **Lembretes manuais** que vencem com o card morto: o loop faz o que já faz com quem não
  é membro — marca `fired=True` sem notificar (o comentário de `reminders.py` explica por
  que lembrete atrasado semanas é pior). A linha do lembrete continua existindo; nada se
  perde. *(Minha decisão.)* Automáticos por `due_date`: card morto fica fora do `select`.

## Excluir (mover pra lixeira)

Os endpoints de exclusão continuam os mesmos, com as mesmas permissões de hoje — só param
de apagar:

| Endpoint | Quem pode (inalterado) | Agora |
|---|---|---|
| `DELETE /lists/{l}/cards/{c}` | quem acessa o quadro | `deleted_at=now`, `deleted_by=user` |
| `DELETE /boards/{b}/lists/{l}` | elevado | idem na lista |
| `DELETE /boards/{b}` | dono ou elevado | idem no quadro |
| `DELETE /integration/cards` | API key | idem no card (`deleted_by` nulo) |

Notificações, lembretes e `reminder_sent` **não** são apagados na exclusão (senão o card
não voltaria inteiro). Ficam dormentes: o loop de lembretes ignora card morto.
Automações cujo gatilho é uma lista na lixeira ficam também — nenhum card consegue entrar
numa lista morta, então não disparam.

## Lixeira do quadro (cards e listas)

Router novo `routers/trash.py`, prefixo `/boards/{board_id}/trash`, com o gate de router
`require_board_access_by_board_id` (quadro na lixeira não tem lixeira própria visível):

- `GET /boards/{b}/trash` → `{cards: [...], lists: [...]}`
  - `cards`: card com `deleted_at` não nulo cuja lista **está viva** (card de lista morta
    aparece pela lista). Campos: `id`, `title`, `list_id`, `list_title`, `deleted_at`,
    `deleted_by_name`, e contagens `comments`, `attachments`, `checklists` para a pessoa
    reconhecer o card. Ordem: excluído mais recente primeiro.
  - `lists`: lista com `deleted_at` não nulo do quadro: `id`, `title`, `color`,
    `deleted_at`, `deleted_by_name`, `cards` (quantos cards vivos vão voltar com ela).
- `POST /boards/{b}/trash/cards/{c}/restore` — qualquer membro. Zera `deleted_at`/
  `deleted_by`. Card volta para a mesma lista e posição; se estava arquivado, volta
  arquivado. 404 se o card não está na lixeira desse quadro ou se a lista dele está morta.
- `POST /boards/{b}/trash/lists/{l}/restore` — qualquer membro (decisão 3). Volta na
  posição de antes.
- `DELETE /boards/{b}/trash/cards/{c}` e `DELETE /boards/{b}/trash/lists/{l}` —
  **administrador** (`is_admin`, não coordenador). Apagam de vez, com a limpeza que o
  `delete_card`/`delete_list` fazem hoje (Notification, Reminder, ReminderSent, Automation
  do gatilho) **mais** os arquivos de anexo no disco (`UPLOAD_DIR/<stored_name>`), que hoje
  ficam órfãos. Só aceitam item que está na lixeira — apagar de vez algo vivo, não.

## Lixeira de quadros (só administrador)

Router `routers/trash.py` também expõe, sem `board_id` no prefixo e com `get_admin_user`:

- `GET /trash/boards` → quadros com `deleted_at` não nulo: `id`, `title`, `color`, `icon`,
  `owner_name`, `deleted_at`, `deleted_by_name`, contagem de listas e cards.
- `POST /trash/boards/{b}/restore` — administrador.
- `DELETE /trash/boards/{b}` — administrador; apaga de vez como o `delete_board` de hoje
  + arquivos de anexo.

*(Minha decisão: restaurar quadro é só do administrador, porque só ele enxerga essa
lixeira — um quadro excluído não tem "dentro" onde mostrar a lixeira para os membros.)*

## Auditoria

- Mover pra lixeira e restaurar passam pelo ORM, então o `audit.py` já registra como
  "editar" com o diff de `deleted_at`. A ação é decidida no `_audit_before_flush` (não no
  `_describe`): para Card, List e Board, mudança em `deleted_at` vira ação **`lixeira`**
  (para ≠ nulo) ou **`restaurar`** (para = nulo); `VERB` ganha "moveu para a lixeira" /
  "restaurou da lixeira" e o `_describe` monta "moveu o card X para a lixeira".
- `LogsPage`: `ACTIONS` e `ACTION_CLASS` ganham as duas ações; o link para quadro/card
  é escondido também em `lixeira` de quadro/card (levaria a 404), como já é em `excluir`.
- Apagar de vez é `db.delete` → "excluir" com snapshot, como hoje.

## Tempo real (SSE)

- Card que entra na lixeira dispara `upsert` (é um UPDATE). `realtime._serialize` precisa
  emitir **`delete`** quando o card tem `deleted_at`, senão ele reaparece ao vivo na tela
  de todo mundo. Mesmo para lista (`list` delete). Restaurar volta a ser `upsert` normal;
  o front já trata upsert de card/lista nova.
- Restaurar uma lista: o upsert da lista chega com os cards vazios → emitir
  `publish_reload` (o front refaz o snapshot), igual ao bulk de hoje.
- Quadro na lixeira: `publish_reload`; o front, ao refazer o snapshot, recebe 404 e precisa
  tratar (ver Frontend).

## Frontend

- **Textos de confirmação** mudam: "não pode ser desfeita" → "vai para a **Lixeira** do
  quadro; dá para restaurar" (card, lista, quadro). O painel de **Arquivados** também tem
  "Excluir" (card e lista): passa a mandar pra lixeira, igual.
- **Botão "Lixeira"** no cabeçalho do quadro, ao lado de "Arquivados", para todos os
  membros. Abre painel lateral no mesmo molde do de Arquivados, com abas Cards/Listas:
  título, lista de origem, "excluído por Fulano em dd/mm/aaaa", contagens; botões
  **Restaurar** (todos) e **Apagar de vez** (só administrador), com confirmação inline
  (não `window.confirm`).
- **Lixeira de quadros:** botão "Lixeira" na página de Quadros (`BoardsPage`), só para
  administrador, abrindo painel com os quadros excluídos e os mesmos dois botões.
- Quadro aberto que vai pra lixeira (por outra pessoa): o resync recebe 404 → mostrar a
  tela de "quadro não encontrado"/voltar para `/boards`, não tela branca.
- **Changelog:** entrada nova `2.7.0` (novidade).

## Fora do escopo / deixado para o construtor

- Notificação antiga no sino que aponta para card na lixeira: abre e não acha o card — o
  deep link já lida com card inexistente; não mexer além disso.
- Desenho visual do painel: seguir o de Arquivados.
- `CLAUDE.md` do repo: documentar "vivo = card+lista+quadro sem deleted_at" e os
  chokepoints, para endpoint novo não esquecer o filtro.
