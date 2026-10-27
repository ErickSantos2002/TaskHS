# Arquivar quadro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Administrador arquiva/desarquiva quadro; arquivado some da vitrine, do Dashboard, da busca e dos lembretes, e abre só para leitura.

**Architecture:** Coluna `boards.archived_at` (migration 015). Bloqueio de escrita centralizado nas trancas de `dependencies.py` (método ≠ GET/HEAD/OPTIONS → 409), mais checagens explícitas nos destinos de corpo e nos endpoints de `boards.py`. Filtros `archived_at IS NULL` nas listagens. No front, faixa + `readOnly` que desliga arrastar, botões de adicionar e edição no modal/drawer.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0, React 19 + Tailwind v4, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-10-27-arquivar-quadro-design.md`

## Global Constraints

- Arquivar/desarquivar: só `current_user.is_admin`. Senão 403 "Apenas administrador pode arquivar quadros".
- Escrita em quadro arquivado: **409** `"Quadro arquivado: somente leitura"`. Ordem 403 → 404 → 409.
- `GET`, `HEAD`, `OPTIONS` e `POST /boards/{id}/stream-ticket` continuam liberados.
- Integração (`routers/integration.py`) não é bloqueada.
- Migration aplicada no boot (runner), `ADD COLUMN IF NOT EXISTS`.
- Versão **2.10.0** no changelog. Nunca segredo em arquivo versionado.
- Testes que escrevem em produção usam um quadro criado só para o teste (via API, elevado), mandado para a lixeira e apagado de vez no fim (`DELETE /api/trash/boards/{id}` exige admin — se o login admin não funcionar, o quadro de teste fica na lixeira e isso vai no relatório).

## Review Focus

1. Card movido (`PATCH` com `list_id`) **de** quadro ativo **para** lista de quadro arquivado → 409 (destino no corpo). Check da Task 2.
2. Card movido **de** quadro arquivado para quadro ativo → 409 (o gate da URL barra). Check da Task 2.
3. `POST /boards/{id}/stream-ticket` em quadro arquivado continua 200 (senão a tela do arquivado não conecta SSE). Check da Task 2.
4. Membro comum chamando `/archive` → 403; quadro na lixeira → 404. Check da Task 1.
5. Visitante de quadro arquivado no front não consegue arrastar nem editar no modal (só fechar). Navegador na Task 4.

---

### Task 1: Coluna, arquivar/desarquivar e listagens

**Files:** Create `backend/migrations/015_board_archived.sql`. Modify `backend/app/models/board.py`, `backend/app/schemas/board.py` (`BoardOut`, `BoardListOut`: `archived_at: datetime | None = None`), `backend/app/routers/boards.py`.

**Interfaces — Produces:**
- `Board.archived_at`, `Board.archived_by`.
- `POST /api/boards/{id}/archive`, `POST /api/boards/{id}/unarchive` → `BoardOut` (admin; idempotentes; `publish_reload`).
- `GET /api/boards/archived` → `list[BoardListOut]` (mesmo `_board_list_item`, `archived_at` preenchido, ordem `archived_at desc`). Rota declarada **antes** de `/{board_id}`.
- `GET /api/boards` e `/api/boards/stats` filtram `archived_at IS NULL`.

- [ ] Check (RED): criar quadro de teste (coordenador), `POST /archive` como coordenador → 403; membro → 403; admin → 200 com `archived_at`; `GET /boards` não traz; `GET /boards/archived` traz; `/stats.boards` diminui 1; `POST /unarchive` admin → volta. Se admin não logar, rodar arquivamento via SQL não é aceitável — registrar e usar o caminho que existir.
- [ ] Implementar; rebuild; check GREEN.
- [ ] Commit `feat(quadros): arquivar e desarquivar quadro`

### Task 2: Somente leitura no backend + filtros

**Files:** Modify `backend/app/dependencies.py`, `backend/app/routers/cards.py` (`update_card`, `copy_card`), `backend/app/routers/boards.py` (`update_board`, `set_done_lists`, `add_member`, `remove_member`), `backend/app/routers/search.py`, `backend/app/routers/dashboard.py`, `backend/app/reminders.py`.

**Interfaces — Produces:**
- `board_is_archived(board_id, db) -> bool`, `list_board_is_archived(list_id, db) -> bool`.
- `assert_board_writable(board_id, db)` / `assert_list_writable(list_id, db)` → 409.
- `require_board_access_by_board_id` / `require_board_access_by_list_id` recebem `request: Request` e chamam o assert quando `request.method not in ("GET","HEAD","OPTIONS")`.

- [ ] Check (RED) no quadro de teste arquivado: `POST` lista → 409; `POST` card → 409; `PATCH` card movendo de quadro ativo para lista do arquivado → 409; `PATCH` card do arquivado → 409; `GET` snapshot → 200; `POST stream-ticket` → 200; `PATCH /boards/{id}` → 409; `/dashboard?board_id=<arq>` → 404 (coord) / 403 (membro); busca pelo título único do card do quadro de teste → 0 resultados; `/dashboard` sem board não traz cards dele.
- [ ] Implementar; rebuild; check GREEN.
- [ ] Commit `feat(quadros): quadro arquivado e somente leitura`

### Task 3: Tipos + página de Boards

**Files:** Modify `frontend/src/types/index.ts` (`Board.archived_at: string | null`), `frontend/src/pages/BoardsPage.tsx`.

- [ ] Seção recolhível no fim: botão "Quadros arquivados" que ao abrir busca `/boards/archived` e mostra os cartões no mesmo componente da vitrine (cadeado se `!can_open`); vazio: "Nenhum quadro arquivado."
- [ ] `npm run build`.
- [ ] Commit junto com a Task 4.

### Task 4: Quadro arquivado no BoardPage

**Files:** Modify `frontend/src/pages/BoardPage.tsx`.

- [ ] `const readOnly = !!board?.archived_at`. Faixa no topo; "Desarquivar" se `currentUser.role === "administrador"` (POST `/unarchive`, `setBoard`).
- [ ] `readOnly` → `DndContext` com `sensors` vazio; esconder "Adicionar card"/"Adicionar lista"; `CardDetailModal` recebe `readOnly` e embrulha o corpo editável num `<fieldset disabled>` (o botão de fechar fica fora); drawer: campos e "Salvar" num `<fieldset disabled>`.
- [ ] Drawer: botão "Arquivar quadro" (admin, quadro ativo) com confirmação em dois cliques, como o excluir.
- [ ] Verificar no navegador (coordenador e, se possível, admin): faixa aparece, arrastar não move, modal sem edição, Boards mostra a seção; build + lint sem erro novo.
- [ ] Commit `feat(quadros): telas de quadro arquivado`

### Task 5: Changelog e fechamento

- [ ] `2.10.0` / `2026-10-27`: novidade (arquivar quadro, só administrador, some da lista/Dashboard/busca, fica em "Quadros arquivados" para consulta só leitura).
- [ ] Build; grep de segredos; commit; review final; merge + push.
