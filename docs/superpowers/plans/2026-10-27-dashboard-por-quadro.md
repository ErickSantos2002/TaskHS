# Dashboard por quadro + alerta de 72 h úteis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seletor de quadro no Dashboard com indicadores por quadro e um alerta clicável de cards há mais de 72 h úteis fora de listas de concluído.

**Architecture:** Coluna `lists.is_done` (migration 014, aplicada no boot) marcada no drawer do quadro por um endpoint dono/elevado. Um router novo `/api/dashboard` calcula os indicadores e a lista de atrasados com uma função pura de horas úteis (`app/horas_uteis.py`). O `DashboardPage` ganha seletor (estado na URL), painel por quadro, barras por lista e um modal.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0, React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-27-dashboard-por-quadro-design.md`

## Global Constraints

- Limite: **72 horas úteis**; só segunda a sexta contam, 24 h por dia; fuso **UTC−3 fixo** (mesmo `TZ_BR` de `routers/logs.py`; Brasil sem horário de verão).
- Card só deixa de contar por estar em lista `is_done`. **`Card.done` e `due_date_completed` não influenciam.**
- Não contam: card arquivado, card em lista arquivada, card/lista/quadro com `deleted_at`.
- Quadro sem lista `is_done` → todos os cards ativos contam.
- Acesso: elevado vê todos os quadros vivos; membro comum só os com linha em `board_members`. Acesso antes de existência (403 antes de 404).
- Toda query nova filtra `deleted_at IS NULL` em card, lista e quadro.
- Marcar listas de concluído: dono do quadro ou elevado.
- Textos da interface em português. Versão **2.9.0** no changelog.
- Sem suíte de testes: verificação por script Python no container, curl e `npm run build`. Nunca senha em arquivo versionado (logins via `backend/.env.dev-users`).

## Review Focus

1. Card criado no fim de semana → relógio começa segunda 00:00 (BRT). Teste em `horas_uteis` (Task 2).
2. Virada de fuso: criado segunda 01:00 UTC = domingo 22:00 BRT → ainda é fim de semana. Teste em `horas_uteis` (Task 2).
3. `?board_id=` de quadro alheio para membro comum → 403; de quadro inexistente/na lixeira → 403 para membro, 404 para elevado. curl na Task 2.
4. `PUT done-lists` com id de lista de outro quadro ou na lixeira → 400, nada gravado. curl na Task 1.
5. `/dashboard?board=X` na URL de um quadro que a pessoa não abre (ou inexistente) → cai em "Todos os quadros", sem tela quebrada. Navegador na Task 4.

---

### Task 1: Listas de concluído (backend + drawer)

**Files:**
- Create: `backend/migrations/014_lists_is_done.sql`
- Modify: `backend/app/models/list.py`, `backend/app/schemas/list.py`, `backend/app/schemas/board.py`, `backend/app/routers/boards.py`
- Modify: `frontend/src/types/index.ts` (`BoardList`), `frontend/src/pages/BoardPage.tsx` (drawer do quadro: `openEditBoard`/`handleSaveBoard` e a seção de integração)

**Interfaces:**
- Produces: `List.is_done: bool`; `ListOut.is_done: bool = False` (vai junto no SSE/snapshot, que usam `ListOut`); `BoardList.is_done: boolean` no front.
- Produces: `PUT /api/boards/{board_id}/done-lists` corpo `DoneListsUpdate { list_ids: list[int] }` → `list[ListOut]` (todas as listas vivas do quadro, atualizadas).

- [ ] **Step 1:** Migration `ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;` com comentário no estilo da 013. Coluna no model com `server_default=text("false")`.
- [ ] **Step 2:** Endpoint `set_done_lists` em `boards.py`: `_get_board_or_404`, 403 se não for dono nem elevado (mesma mensagem de `update_board`), 400 `"Lista não pertence a este quadro"` se algum id não for lista viva do quadro; senão `is_done = id in list_ids` para cada lista viva do quadro; commit; devolve as listas por `position`.
- [ ] **Step 3:** No drawer: estado `editDoneListIds: Set<number>` iniciado de `lists.filter(l => l.is_done)` em `openEditBoard`; bloco "Listas de concluído" com um checkbox por lista não arquivada, texto de ajuda "Cards nessas listas não entram no alerta de 72 h do Dashboard." Visível só para dono/elevado, como o resto do drawer de edição. Em `handleSaveBoard`, após o PATCH, chamar o PUT e aplicar o retorno em `setLists` (preservando a ordem e os cards no state).
- [ ] **Step 4: Verificar**
  - `docker compose up -d --build backend` → `docker compose logs backend | grep -i 014` mostra a migration aplicada.
  - Com o login do coordenador: PUT com ids do quadro → 200 e `is_done` certo; PUT com id de lista de outro quadro → 400 e nada muda; login de membro comum que não é dono → 403.
  - `GET /api/boards/{id}/lists` traz `is_done`.
- [ ] **Step 5: Commit** `feat(dashboard): marcar listas de concluido por quadro`

### Task 2: Horas úteis + endpoint `/api/dashboard`

**Files:**
- Create: `backend/app/horas_uteis.py`, `backend/app/routers/dashboard.py`, `backend/app/schemas/dashboard.py`
- Modify: `backend/app/main.py` (include_router)

**Interfaces:**
- Produces: `horas_uteis(inicio: datetime, fim: datetime) -> float` (horas, datetimes aware; soma por dia em UTC−3, só `weekday() < 5`); `LIMITE_HORAS = 72`.
- Produces: `GET /api/dashboard?board_id=<int opcional>` → `DashboardOut`:
  - `board_id: int | None`
  - `kpis: { cards_ativos, listas, arquivados, prazo_vencido, vencem_hoje, em_concluido, atrasados }` (ints; no modo Todos, os mesmos indicadores somados sobre os quadros acessíveis)
  - `listas: list[{ id, title, is_done, total, atrasados }]` — só no modo quadro, ordem `position`, só listas vivas não arquivadas; `[]` no modo Todos
  - `atrasados: list[{ card_id, list_id, board_id, board_title, list_title, title, created_at, horas_uteis }]` ordenado por `created_at` asc
- Definições dos KPIs como na tabela do spec; `prazo_vencido`/`vencem_hoje` com a mesma regra de `get_stats` (`date.today()`).

- [ ] **Step 1: Script de verificação de `horas_uteis`** (rodado no container, não versionado — em `scratchpad`), asserts:
  - sexta 15:00 BRT → quarta 15:00 BRT = `72.0`
  - sábado 10:00 BRT → quinta 00:00 BRT = `72.0`
  - segunda 01:00 UTC (domingo 22:00 BRT) → segunda 03:00 UTC (segunda 00:00 BRT) = `0.0`
  - terça 09:00 → terça 17:00 BRT = `8.0`
  - `fim <= inicio` → `0.0`
- [ ] **Step 2:** Rodar → falha (módulo não existe).
- [ ] **Step 3:** Implementar `horas_uteis.py` (laço dia a dia em UTC−3; docstring com a regra e o porquê do offset fixo).
- [ ] **Step 4:** Rodar o script → passa.
- [ ] **Step 5:** Router `dashboard.py` (prefixo `/dashboard`, `get_current_user`). Com `board_id`: `user_can_access_board` → falso → 403 para não-elevado, 404 para elevado (elevado alcança tudo, então falso = não existe). Sem `board_id`: mesmos `board_ids` de `get_stats`. Uma query de cards ativos (card/lista/quadro vivos, card e lista não arquivados) com `List.is_done`, `List.title`, `Board.title`; KPIs e atrasados calculados em Python (`agora - created_at` via `horas_uteis > LIMITE_HORAS` e lista não `is_done`). `arquivados` em query própria. Docstring explicando a regra e que `Card.done` não entra de propósito.
- [ ] **Step 6: Verificar com curl** (coordenador e membro, logins via `.env.dev-users`):
  - `/api/dashboard?board_id=136` → 200; `sum(l.total) == kpis.cards_ativos`; `sum(l.atrasados) == kpis.atrasados == len(atrasados)`; nenhum atrasado em lista `is_done`.
  - Marcar (Task 1) "📮Despachado (Correios)" e "Coletado" do 136 como concluído → `atrasados` cai e nenhum item vem dessas listas.
  - Membro em quadro alheio → 403; elevado com `board_id=999999` → 404.
  - `/api/dashboard` sem board → 200, `listas == []`, `atrasados` traz `board_title`.
  - Tempo de resposta < 1 s.
- [ ] **Step 7: Commit** `feat(dashboard): endpoint de indicadores e atrasados 72 h uteis`

### Task 3: Tipos e cliente no front

**Files:** Modify `frontend/src/types/index.ts`

**Interfaces:**
- Produces: `DashboardKpis`, `DashboardLista`, `DashboardAtrasado`, `DashboardData` espelhando `DashboardOut` (campos com os mesmos nomes).

Dobrada na Task 4 (sem entregável próprio): escrever junto, mesmo commit.

### Task 4: DashboardPage com seletor, painel, barras e modal

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Create: `frontend/src/components/AtrasadosModal.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard?board_id=`, `GET /api/boards` (`can_open`), `GET /api/boards/stats`.
- Produces: `AtrasadosModal({ atrasados: DashboardAtrasado[], mostrarQuadro: boolean, onClose: () => void })`.

- [ ] **Step 1:** Seletor (layout A, `select` no topo à direita do título "Dashboard"): "Todos os quadros" + quadros `can_open`, estado em `useSearchParams` (`board`). Valor que não está entre os `can_open` → trata como Todos e limpa o parâmetro.
- [ ] **Step 2:** Modo Todos: mantém os `StatCard`s e a taxa de conclusão atuais + `StatCard` de alerta "Mais de 72 h úteis" (vermelho quando > 0, clicável → modal com coluna Quadro e filtro por quadro). A grade de quadros continua.
- [ ] **Step 3:** Modo quadro: alerta em destaque + Cards ativos, Listas, Arquivados (1ª linha); Prazo vencido, Vencem hoje, Em listas de concluído (2ª linha); "Cards por lista" com barras em `div` (largura proporcional ao maior total, parte vermelha = atrasados, ✓ nas listas `is_done`). Esconde a grade de quadros.
- [ ] **Step 4:** `AtrasadosModal`: título "N cards há mais de 72 h úteis", filtro por lista (e por quadro quando `mostrarQuadro`), tabela Card / (Quadro) / Lista atual / Criado em (dd/mm HH:mm local) / Tempo útil (`Xd Yh` — dias úteis = horas/24; abaixo de 24 h mostra só horas), mais antigo primeiro, "Abrir" → `navigate(\`/boards/${board_id}?card=${card_id}&list=${list_id}\`)`. Fecha com Esc e clique fora. Estado vazio: "Nenhum card passou de 72 h úteis."
- [ ] **Step 5: Verificar**
  - `cd frontend && npm run build` passa; `npm run lint` sem erro novo.
  - Navegador (`npm run dev`, login coordenador): trocar quadro atualiza URL e painel; F5 mantém; `?board=999999` cai em Todos; clicar no alerta abre o modal; "Abrir" leva ao card aberto no quadro; login de membro só lista os quadros dele.
- [ ] **Step 6: Commit** `feat(dashboard): painel por quadro com alerta de 72 h uteis`

### Task 5: Changelog e fechamento

- [ ] **Step 1:** Entrada `2.9.0` (data `2026-10-27`) no topo de `frontend/src/data/changelog.ts`: novidade (Dashboard por quadro com indicadores e cards por lista), novidade (alerta de cards há mais de 72 h úteis — só dias de semana — com lista clicável que leva ao card), melhoria (listas de concluído marcadas no drawer do quadro, pelo dono ou administrador).
- [ ] **Step 2:** `npm run build` passa; `git grep -nE "password|PGPASSWORD|senha.*=" -- <arquivos alterados>` vazio.
- [ ] **Step 3: Commit** `docs(changelog): v2.9.0 dashboard por quadro`
- [ ] **Step 4:** Review final da branch → finishing-a-development-branch (merge na `main` + push).
