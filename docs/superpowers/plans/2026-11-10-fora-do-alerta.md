# Quadro fora do alerta de atrasos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configuração por quadro `fora_do_alerta` que tira o quadro do alerta de 72 h e dos travados por setor sem marcar listas como concluídas.

**Architecture:** Coluna nova em `boards` (migration 018, que também corrige os dados de 143/144/154), exposta pelo `BoardOut`/`BoardUpdate` e editada pelo `PATCH /boards/{id}` existente; o Dashboard pula as réguas para cards não concluídos desses quadros; checkbox no drawer e nota no Dashboard filtrado.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0, React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-10-fora-do-alerta-design.md`

## Global Constraints

- Coluna: `boards.fora_do_alerta BOOLEAN NOT NULL DEFAULT false`.
- `List.is_done` e `routers/minhas.py` não mudam.
- Edição só dono/elevado, pelo `update_board` existente (sem endpoint novo).
- Ordem no loop do Dashboard: contadores → `if list_done: em_concluido += 1; continue` → `if fora_do_alerta: continue` → réguas.
- Migração de dados por id: 154 mantém só 372; 143 nenhuma; 144 mantém 291, 295, 299, 304; os três com `fora_do_alerta = true`. "Demais listas" inclui arquivadas e na lixeira.
- ⚠️ dev = produção e migrations rodam no boot: **não subir o backend local** antes do deploy. Verificação de backend nesta branch = `python -c "import app.main"` + leitura; a verificação com dados roda depois do deploy.
- Sem segredos em arquivo versionado; usar `./scripts/psql-dev.sh`.
- Não há suíte de testes: verificação manual + `npm run build`.

## Review Focus

- Quadro fora do alerta com card em lista `is_done` → continua contando em `em_concluido` (pinado no Task 2).
- Setor cujas listas estão todas em quadros fora do alerta → não aparece em `travados_por_setor` com 0 (Task 2).
- `PATCH` de não-dono com `fora_do_alerta` → 403, como os outros campos (já garantido por `update_board`; conferir na leitura do Task 1).
- `PATCH` sem o campo → não mexe (`exclude_none`; `bool | None = None`) (Task 1).
- `create_board`/listagem devolvem o campo (senão o front recebe `undefined`) (Task 1).

---

### Task 1: Coluna, migration de dados e API

**Files:**
- Create: `backend/migrations/018_board_fora_do_alerta.sql`
- Modify: `backend/app/models/board.py` (campo após `obs_labels`)
- Modify: `backend/app/schemas/board.py` (`BoardUpdate`: `fora_do_alerta: bool | None = None`; `BoardOut`: `fora_do_alerta: bool = False`)
- Modify: `backend/app/routers/boards.py` (`_board_list_item` e o dict de `create_board` levam `"fora_do_alerta": board.fora_do_alerta`)

**Interfaces:**
- Produces: `Board.fora_do_alerta: Mapped[bool]`; campo `fora_do_alerta` em `GET /boards`, `GET /boards/{id}`, `PATCH /boards/{id}`.

- [ ] **Step 1:** Escrever a 018: comentário curto do porquê (spec), `ALTER TABLE boards ADD COLUMN IF NOT EXISTS fora_do_alerta BOOLEAN NOT NULL DEFAULT false;`, depois
  `UPDATE boards SET fora_do_alerta = true WHERE id IN (143, 144, 154);`,
  `UPDATE lists SET is_done = (id = 372) WHERE board_id = 154;`,
  `UPDATE lists SET is_done = false WHERE board_id = 143;`,
  `UPDATE lists SET is_done = (id IN (291, 295, 299, 304)) WHERE board_id = 144;`.
- [ ] **Step 2:** Modelo, schemas e os dois dicts manuais.
- [ ] **Step 3:** Verificar: `docker compose run --rm --no-deps backend python -c "import app.main"` (ou `backend/.venv/bin/python -c ...` de dentro de `backend/`) importa sem erro; `grep -n fora_do_alerta backend/app -r` mostra modelo, 2 schemas, 2 dicts; conferir que `update_board` usa `model_dump(exclude_none=True)` + `setattr` (campo passa sozinho) e que a trava dono/elevado vem antes.
- [ ] **Step 4:** Commit `feat(boards): coluna fora_do_alerta + migration 018`.

### Task 2: Dashboard respeita fora_do_alerta

**Files:**
- Modify: `backend/app/routers/dashboard.py` (queries `listas` e `ativos`, loop, `setores_no_recorte`)
- Modify: `backend/app/schemas/dashboard.py` só se o Task 3 precisar (ver Interfaces)

**Interfaces:**
- Consumes: `Board.fora_do_alerta` (Task 1).

- [ ] **Step 1:** Adicionar `Board.fora_do_alerta` ao `select` de `listas` (4→5 colunas) e de `ativos` (desempacotar no `for`). Atualizar os outros consumidores de `listas` (desempacotamento em `setores_no_recorte` e onde montam o `por_lista` ~linha 252).
- [ ] **Step 2:** No loop: após o bloco `if list_done: ... continue`, `if fora_do_alerta: continue`.
- [ ] **Step 3:** `setores_no_recorte` exclui listas com `done` **ou** `fora_do_alerta`.
- [ ] **Step 4:** Atualizar o docstring do módulo (linha ~5) citando `Board.fora_do_alerta`.
- [ ] **Step 5:** Verificar import (`python -c "import app.routers.dashboard"`) e reler o loop conferindo a ordem dos Global Constraints.
- [ ] **Step 6:** Commit `feat(dashboard): quadro fora do alerta não entra nas réguas de atraso`.

### Task 3: Front — tipo, drawer, nota no Dashboard, changelog

**Files:**
- Modify: `frontend/src/types/index.ts` (`fora_do_alerta: boolean` no `Board`)
- Modify: `frontend/src/pages/BoardPage.tsx` (estado `editForaDoAlerta`, inicializado junto de `editIntegrationEnabled` ~3089, enviado no mesmo `PATCH` ~3115, checkbox perto das listas de concluído)
- Modify: `frontend/src/pages/DashboardPage.tsx` (nota quando filtrado num quadro com `fora_do_alerta`)
- Modify: `frontend/src/data/changelog.ts` (nova versão no topo)

**Interfaces:**
- Consumes: `fora_do_alerta` em `GET /boards` / `GET /boards/{id}` (Task 1).

- [ ] **Step 1:** Tipo + checkbox no drawer. Rótulo: **"Fora do alerta de atrasos"**. Ajuda: *"Os cards deste quadro não entram no alerta de 72 h nem nos travados por setor do Dashboard. Continuam abertos em Minhas tarefas."*
- [ ] **Step 2:** Dashboard: o front descobre o flag pelo quadro selecionado na lista de quadros que a página já carrega (se não carregar, buscar `GET /boards/{id}`); quando ligado, a seção das réguas mostra *"Este quadro está fora do alerta de atrasos."* no lugar das réguas.
- [ ] **Step 3:** Changelog: minor sobre `CHANGELOG[0]`, data `2026-11-10`, `{ kind: "melhoria", text: "Quadro pode ficar fora do alerta de atrasos (drawer do quadro) sem marcar as listas como concluídas — os cards voltam a aparecer em Minhas tarefas." }`.
- [ ] **Step 4:** `cd frontend && npm run build` passa.
- [ ] **Step 5:** Commit `feat(front): opção fora do alerta no drawer + nota no Dashboard + changelog`.

### Pós-merge (com o Erick, depois do deploy)

- `./scripts/psql-dev.sh -c "SELECT id, fora_do_alerta FROM boards WHERE id IN (143,144,154);"` e `SELECT board_id, count(*) FILTER (WHERE is_done) FROM lists WHERE board_id IN (143,144,154) GROUP BY 1;` → 154:1, 143:0, 144:4.
- `/cards/minhas?abertas=true` do Erick traz os cards de "EM ANDAMENTO - ERICK"; Dashboard sem 143/154 nas réguas; drawer liga/desliga.
