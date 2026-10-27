# Travados por setor — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard mostra, por setor, quantos cards estão há mais de 24 h úteis na mesma lista; setores são cadastro do admin e etiquetados por lista no drawer.

**Architecture:** Tabela `setores` + `lists.setor_id` + `cards.list_entered_at` (migration 016 com backfill pelo `audit_log` e pré-preenchimento por nome). O relógio da lista é zerado por um listener de atributo do SQLAlchemy em `Card.list_id` (pega todo caminho que muda a lista) e à mão no desarquivar do card. O Dashboard reaproveita o loop sobre `ativos`.

**Tech Stack:** FastAPI async + SQLAlchemy 2, PostgreSQL, React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-27-travados-por-setor-design.md`

## Global Constraints

- Sem suíte de testes: verificação = SQL via `./scripts/psql-dev.sh`, `curl` com a bateria de `backend/.env.dev-users`, `npm run build`. Nunca senha em arquivo versionado.
- Régua: `horas_uteis(list_entered_at, agora) > LIMITE_HORAS_LISTA` com `LIMITE_HORAS_LISTA = 24` em `app/horas_uteis.py`.
- Toda query do Dashboard filtra `deleted_at IS NULL` em card, lista e quadro, e `archived`.
- Interface em português. Versão **2.12.0** no `changelog.ts`.
- Trabalho na branch `feat/travados-por-setor`.
- O banco de dev **é o de produção**: a migration só roda depois do OK do Erick.

## Review Focus

1. Card movido pela **integração** → `list_entered_at` tem que mudar (1.728 dos "mover" vêm dela). Verificado na Task 1.
2. Reordenar dentro da mesma lista **não** zera o relógio. Verificado na Task 1.
3. Card de setor numa lista `is_done` ou arquivada, ou num quadro arquivado, não conta. Verificado na Task 3 com SQL independente.
4. Membro comum não vê setor de quadro alheio e leva 403 em `POST /api/setores`. Verificado nas Tasks 2 e 3.
5. Salvar o drawer sem mudar nenhum setor não pode desmarcar o setor das listas arquivadas, porque o endpoint só altera o que recebe. Verificado na Task 2.

---

### Task 1: Migration, modelos e relógio da lista

**Files:**
- Create: `backend/migrations/016_setores.sql`, `backend/app/models/setor.py`
- Modify: `backend/app/models/list.py`, `backend/app/models/card.py`, `backend/app/models/__init__.py`, `backend/app/routers/cards.py` (`restore_card`), `backend/app/routers/integration.py` (campo `archived` do upsert), `backend/app/horas_uteis.py`

**Interfaces:**
- Produces: `Setor(id:int, nome:str, ativo:bool, created_at)`; `List.setor_id: int | None`; `Card.list_entered_at: datetime` (NOT NULL, `server_default=now()`, default Python `now(utc)`); `LIMITE_HORAS_LISTA = 24`.

- [ ] **Step 1: escrever `016_setores.sql`** (idempotente):
  - `CREATE TABLE IF NOT EXISTS setores (id serial PK, nome varchar(80) NOT NULL, ativo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())` + `CREATE UNIQUE INDEX IF NOT EXISTS ux_setores_nome ON setores (lower(nome))`.
  - `ALTER TABLE lists ADD COLUMN IF NOT EXISTS setor_id integer REFERENCES setores(id) ON DELETE SET NULL`.
  - `ALTER TABLE cards ADD COLUMN IF NOT EXISTS list_entered_at timestamptz`, depois um `UPDATE` com o backfill: o último `audit_log.created_at` em que `entity_type='card' AND action='mover' AND card_id=cards.id AND (changes::json->'list_id'->>'para')::int = cards.list_id`, com `COALESCE(..., cards.created_at)` e só onde `list_entered_at IS NULL`. Por fim, `SET DEFAULT now()` e `SET NOT NULL`.
  - Seed com `INSERT ... ON CONFLICT DO NOTHING` (sobre o índice de `lower(nome)`, usando `WHERE NOT EXISTS`, porque o `ON CONFLICT` não aceita índice de expressão sem a mesma expressão): Financeiro, Laboratório, Expedição, Comercial, Vendas, Setup, Suporte, RH, TI, Qualidade, Almoxarifado, Administração, Diretoria, Marketing.
  - Pré-preenchimento, só onde `setor_id IS NULL AND deleted_at IS NULL`. O título é normalizado com `lower(translate(title, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'))` e casado com regex `~`: `financeiro`, `laboratorio`, `expedicao`, `comercial`, `vendas`, `setup`, `suporte`, `\mrh\M`, `\mti\M`, `qualidade`, `almoxarifado`, `administracao`, `diretoria`, `marc?keting`. A ordem dos `UPDATE`s segue essa lista; o primeiro que bater ganha, porque os seguintes só tocam `setor_id IS NULL`.
  - Termina com um `SELECT b.title, l.title, s.nome` das listas vivas de quadros vivos e não arquivados, ordenado por quadro e posição.
- [ ] **Step 2: modelos.** `models/setor.py` no estilo de `models/list.py`. `List.setor_id = mapped_column(ForeignKey("setores.id", ondelete="SET NULL"), nullable=True)`. Em `Card`, `list_entered_at` e um listener `@event.listens_for(Card.list_id, "set")` que faz `target.list_entered_at = datetime.now(timezone.utc)` quando `oldvalue is not NO_VALUE and value != oldvalue` (criação fica com o default). Comentário curto explicando que é o relógio da régua de 24 h. Registrar `Setor` em `models/__init__.py`. `LIMITE_HORAS_LISTA = 24` em `horas_uteis.py`.
- [ ] **Step 3: desarquivar zera.** Em `restore_card` e no upsert da integração, quando `archived` passa de `True` para `False`, faz `card.list_entered_at = now(utc)`.
- [ ] **Step 4: pedir ao Erick o OK para rodar a migration** no banco (é produção). Depois do OK: `./scripts/psql-dev.sh -f backend/migrations/016_setores.sql`. Mostrar o relatório final ao Erick.
- [ ] **Step 5: verificar.** `docker compose up -d --build`. Depois, `./scripts/psql-dev.sh -c "SELECT count(*) FILTER (WHERE list_entered_at IS NULL), count(*) FILTER (WHERE list_entered_at > created_at) FROM cards"`: o primeiro tem que ser 0 e o segundo maior que 0. Num card de teste, via `curl` PATCH, mover de lista → `list_entered_at` muda; PATCH só `position` → não muda.
- [ ] **Step 6: commit** `feat(setores): tabela, etiqueta na lista e relogio da lista`.

### Task 2: API de setores e etiqueta por lista

**Files:**
- Create: `backend/app/routers/setores.py`, `backend/app/schemas/setor.py`
- Modify: `backend/app/main.py`, `backend/app/schemas/list.py`, `backend/app/routers/boards.py`

**Interfaces:**
- Consumes: `Setor`, `List.setor_id` (Task 1); `get_admin_user` de `routers/auth.py`.
- Produces: `SetorOut{id, nome, ativo, listas:int}`. `GET /api/setores?todos=0|1` devolve só os ativos por padrão; `listas` = quantas listas vivas usam o setor. `POST /api/setores {nome}` → 201. `PATCH /api/setores/{id} {nome?, ativo?}`. Nome duplicado (case-insensitive, depois de `strip`) → 409; vazio → 422. `ListOut.setor_id: int | None = None`. `PUT /api/boards/{board_id}/list-setores` com corpo `ListSetoresUpdate{setores: dict[int, int | None]}` → `list[ListOut]` das listas ativas.

- [ ] **Step 1:** implementar o router e os schemas. Registrar em `main.py`.
- [ ] **Step 2:** escrever `set_list_setores` em `boards.py`, ao lado de `set_done_lists`, com o mesmo gate (dono/elevado → 403; `assert_board_writable`). Regras: list_id fora das listas ativas do quadro → 400 "Lista não pertence a este quadro"; setor inexistente → 400; setor inativo atribuído a uma lista que **não** o tinha → 400 "Setor inativo". Só altera as listas presentes no corpo.
- [ ] **Step 3: verificar com `curl`** (bateria `.env.dev-users`):
  - Admin: `POST /api/setores {"nome":"financeiro"}` → 409. `POST {"nome":"Teste X"}` → 201. `PATCH {"ativo":false}` → ok, e o setor some do `GET` sem `todos`.
  - Membro comum: `POST` → 403; `GET` → 200.
  - `PUT list-setores` com uma lista de outro quadro → 400. Com `{}` → 200, e nenhum `setor_id` muda (conferir via SQL, inclusive nas arquivadas). O "Teste X" fica inativo (não há delete).
- [ ] **Step 4: commit** `feat(setores): API de setores e etiqueta por lista`.

### Task 3: Dashboard — travados por setor (backend)

**Files:**
- Modify: `backend/app/routers/dashboard.py`, `backend/app/schemas/dashboard.py`

**Interfaces:**
- Produces, em `DashboardOut`: `travados_por_setor: list[{setor_id:int, nome:str, total:int}]`, ordenado por `-total`, depois `nome`; inclui setores com 0 que tenham ao menos uma lista **contável** (ativa, não `is_done`) no recorte. `travados_setor: list[{card_id, title, board_id, board_title, list_id, list_title, setor_id, list_entered_at, horas_uteis}]`, ordenado por `horas_uteis` decrescente.

- [ ] **Step 1:** acrescentar `List.setor_id` à query de `listas` e `List.setor_id`, `Card.list_entered_at` à de `ativos`. No mesmo loop (depois do `continue` do `list_done`), contar quando `setor_id` não é nulo e `horas_uteis(list_entered_at, agora) > LIMITE_HORAS_LISTA`. Buscar os nomes dos setores numa query só. Atualizar a docstring do módulo com a régua nova.
- [ ] **Step 2: verificar.** `curl /api/dashboard` (admin, "Todos") e conferir que a soma de `travados_por_setor[].total` é igual a uma contagem SQL independente. A contagem usa os mesmos filtros e uma aproximação por horas corridas, então só vale como teto: conferir que `soma ≤ SQL corrido` e que um card sabidamente parado aparece. Repetir com `?board_id=` de um quadro com Financeiro, e com um membro comum, conferindo que só entram os quadros dele.
- [ ] **Step 3: commit** `feat(dashboard): travados por setor`.

### Task 4: Front — tela de setores e seletor no drawer

**Files:**
- Create: `frontend/src/pages/SetoresPage.tsx`
- Modify: `frontend/src/App.tsx` (rota `setores`), `frontend/src/layouts/MainLayout.tsx` (item "Setores" com `adminOnly: true, adminStrict: true`, logo depois de Usuários), `frontend/src/types/index.ts` (`Setor`, `BoardList.setor_id`), `frontend/src/pages/BoardPage.tsx` (drawer)

**Interfaces:**
- Consumes: os endpoints da Task 2.

- [ ] **Step 1:** `SetoresPage`, no visual da `UsersPage`: uma tabela com Nome (edição inline, salva no blur/Enter), Listas (contagem) e Ativo (toggle), mais o botão "Novo setor". Mostrar o erro do 409 como "Já existe um setor com esse nome".
- [ ] **Step 2:** no drawer, ao lado do checkbox de concluído, cada lista ativa ganha um `<select>` com "— sem setor —", os setores ativos e o setor atual se estiver inativo (sufixo " (inativo)"). O estado fica em `editSetorPorLista: Map<number, number | null>`, carregado no `openEditBoard`. Buscar `GET /setores` (sem `todos`) ao abrir o drawer; para o setor inativo atual, buscar com `todos=1`. Em `handleSaveBoard`, depois do `done-lists`, mandar `PUT list-setores` só com as listas que mudaram (se houver) e aplicar `setor_id` no `setLists`. Se falhar: "Não foi possível salvar os setores das listas. Tente de novo."
- [ ] **Step 3:** rodar `npm run build` (tem que passar). No navegador: o admin cria um setor, etiqueta uma lista no drawer, recarrega e a etiqueta persistiu. Um membro comum não vê o item "Setores" no menu.
- [ ] **Step 4: commit** `feat(setores): tela de setores e seletor no drawer`.

### Task 5: Front — bloco no Dashboard e changelog

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`, `frontend/src/components/AtrasadosModal.tsx`, `frontend/src/types/index.ts`, `frontend/src/data/changelog.ts`

**Interfaces:**
- Consumes: `travados_por_setor`, `travados_setor` (Task 3).

- [ ] **Step 1:** tipos `DashboardTravadoSetor` e `DashboardTravado` (a `DashboardTravado` é igual a `DashboardAtrasado`, mas com `setor_id`, `list_entered_at` e sem `created_at`).
- [ ] **Step 2:** criar `TravadosPorSetor` logo abaixo do `AlertaAtrasados`. O título é "Travados por setor (24 h úteis na lista)". Cada setor é uma barra horizontal em `div`, vermelha quando tem total > 0; os setores com 0 ficam em cinza no fim. O estado vazio diz "Nenhuma lista com setor. Marque o setor das listas no drawer do quadro." Clicar numa barra com total > 0 abre o modal filtrado por aquele setor.
- [ ] **Step 3:** parametrizar o `AtrasadosModal` para servir aos dois casos: título, texto de rodapé ("Contando só dias de semana, desde que o card entrou na lista atual.") e a coluna de data ("Na lista desde"). Não duplicar o componente.
- [ ] **Step 4:** adicionar a entrada **2.12.0** no topo do `CHANGELOG`, com a data `2026-10-27`:
  - novidade: "Dashboard: cards travados por setor — mais de 24 h úteis na mesma lista"
  - novidade: "Cadastro de setores (admin) e setor de cada lista no drawer do quadro"
- [ ] **Step 5:** rodar `npm run build` (tem que passar). No navegador, conferir o bloco em "Todos" e num quadro, conferir que o modal abre filtrado e que clicar no card abre o quadro.
- [ ] **Step 6: commit** `feat(dashboard): bloco de travados por setor` + `docs(changelog): v2.12.0 travados por setor`.

### Fechamento

- [ ] Review final da branch inteira (um revisor novo) → `superpowers:finishing-a-development-branch` → merge na `main` + push.
