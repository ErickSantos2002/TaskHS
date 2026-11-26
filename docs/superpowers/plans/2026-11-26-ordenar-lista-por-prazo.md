# Ordenar lista por prazo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opção por lista (só administrador/coordenador liga) que mostra os cards ordenados pelo prazo; as demais listas seguem na ordem manual.

**Architecture:** O banco guarda só `lists.sort_mode` (`manual` | `prazo`). A ordenação é feita no front, na hora de desenhar a coluna, por uma função pura; `Card.position` nunca é reescrito. Numa lista `prazo`, o drag & drop dentro da própria lista não reordena nem envia PATCH.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Pydantic v2; React 19 + dnd-kit + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-26-ordenar-lista-por-prazo-design.md`

## Global Constraints

- Branch `feat/ordenar-lista-por-prazo`, a partir da `main`.
- Valores do modo: exatamente `"manual"` (padrão) e `"prazo"`.
- Migration: `backend/migrations/019_list_sort_mode.sql`, idempotente (`IF NOT EXISTS`). Roda sozinha no boot (`app/migrations.py`).
- ⚠️ Dev usa o banco de **produção** e migrations rodam no boot: **não subir o backend local com a 019 antes do deploy** sem o Erick autorizar. Verificação do backend é por pytest em container (não aplica migration — ver comando na Task 1) e `npm run build`.
- Repo público: nenhum segredo em código, plano ou commit.
- Changelog: entrada nova no topo de `frontend/src/data/changelog.ts`, `version: "2.18.0"`, `date: "2026-11-26"`, `kind: "melhoria"`.
- Interface em português.

## Review Focus

1. **Card arrastado de uma lista manual para uma lista `prazo`** — deve aparecer no lugar do prazo (não onde foi solto) e receber `position` calculada como hoje (PATCH normal). Coberto na Task 2, passo de verificação manual.
2. **Arrastar dentro de lista `prazo` e soltar** — nenhum PATCH (conferir aba Network), nenhuma animação de "abrir espaço" entre os cards. Task 2.
3. **Desligar a ordenação** — a lista volta à ordem manual de antes (positions intactas). Task 3, verificação manual.
4. **Prazo editado no modal / chegando por SSE** — o card muda de lugar sozinho na lista `prazo`, sem recarregar. Task 2 (sai de graça por ordenar no render; verificar).
5. **Membro comum** — vê o selo "Ordenada por prazo", não vê o item do menu; `PATCH` com `sort_mode` por não-elevado → 403 (já garantido por `get_elevated_user`). Task 3.

---

### Task 1: Backend — coluna `sort_mode`

**Files:**
- Create: `backend/migrations/019_list_sort_mode.sql`
- Modify: `backend/app/models/list.py` (depois de `setor_id`)
- Modify: `backend/app/schemas/list.py` (`ListUpdate`, `ListOut`)
- Test: `backend/tests/test_list_sort_mode.py`

**Interfaces:**
- Produces: `ListOut.sort_mode: Literal["manual","prazo"]` (default `"manual"`), presente em `PATCH /api/boards/{board_id}/lists/{id}`, no snapshot (`boards.py:337`) e no evento SSE de lista (`realtime.py:77`) — os três já serializam via `ListOut`, nada a mudar neles.
- Produces: `ListUpdate.sort_mode: Literal["manual","prazo"] | None = None`.

- [ ] **Step 1: Teste que falha** — `backend/tests/test_list_sort_mode.py`:

```python
import pytest
from pydantic import ValidationError
from app.schemas.list import ListOut, ListUpdate

def test_list_update_aceita_modos():
    assert ListUpdate(sort_mode="prazo").sort_mode == "prazo"
    assert ListUpdate(sort_mode="manual").sort_mode == "manual"
    assert ListUpdate().model_dump(exclude_none=True) == {}

def test_list_update_rejeita_modo_desconhecido():
    with pytest.raises(ValidationError):
        ListUpdate(sort_mode="prioridade")

def test_list_out_default_manual():
    from datetime import datetime, timezone
    out = ListOut(id=1, board_id=1, title="x", description=None, color="#64748b",
                  position=0, created_at=datetime.now(timezone.utc))
    assert out.sort_mode == "manual"
```

- [ ] **Step 2: Rodar e ver falhar**

Run (na raiz do repo; precisa da imagem `taskhs-backend` — `docker compose build backend` se não existir; o pytest não sobe o lifespan, logo não aplica migration):
`docker run --rm -u root -v "$PWD/backend":/app -w /app --env-file backend/.env taskhs-backend sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider tests/test_list_sort_mode.py"`
Expected: FAIL (`sort_mode` desconhecido).

- [ ] **Step 3: Implementar**
  - Migration 019 com comentário de cabeçalho no estilo da 018 (por quê + referência à spec) e:
    `ALTER TABLE lists ADD COLUMN IF NOT EXISTS sort_mode VARCHAR(10) NOT NULL DEFAULT 'manual';`
  - Model: `sort_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="manual", server_default=text("'manual'"))` com comentário `# Ordenação da lista (migration 019): "manual" (Card.position) ou "prazo" (ordenado no front).`
  - Schemas: `SortMode = Literal["manual", "prazo"]`; campo em `ListUpdate` (opcional) e `ListOut` (default `"manual"`).

- [ ] **Step 4: Rodar a suíte inteira** (mesmo comando, sem o caminho do arquivo). Expected: tudo PASS.

- [ ] **Step 5: Commit** — `feat(listas): coluna sort_mode (manual|prazo) na lista`

---

### Task 2: Front — ordenar no render e travar o drag interno

**Files:**
- Create: `frontend/src/lib/ordenarCards.ts`
- Modify: `frontend/src/types/index.ts` (`BoardList`, ~linha 62)
- Modify: `frontend/src/pages/BoardPage.tsx` — `filteredCards` (~3372), `onDragOver` (~3300), `onDragEnd` (~3342), `SortableContext` do `KanbanColumn` (~2483)

**Interfaces:**
- Consumes: `BoardList.sort_mode` vindo da Task 1.
- Produces: `export type SortMode = "manual" | "prazo"` e `BoardList.sort_mode: SortMode` em `types/index.ts`.
- Produces: `export function ordenarPorPrazo(cards: Card[]): Card[]` em `lib/ordenarCards.ts` — devolve **cópia** (não muta).

- [ ] **Step 1: `ordenarPorPrazo`** — regra da spec:
  1. grupo A: `due_date` não-nulo **e** `!due_date_completed`, por `due_date` crescente (string ISO `YYYY-MM-DD`, comparar com `localeCompare`);
  2. grupo B: o resto (sem prazo ou concluído);
  3. desempate dentro do mesmo dia e dentro do grupo B: `position` crescente.

- [ ] **Step 2: Aplicar no render** — em `filteredCards(listId)`, depois do filtro, se a lista (`lists.find(l => l.id === listId)`) tiver `sort_mode === "prazo"`, devolver `ordenarPorPrazo(filtrados)`. O estado `cardsByList` continua na ordem de `position`.

- [ ] **Step 3: Travar o drag dentro da lista `prazo`**
  - `onDragOver`: no ramo `sourceListId === destListId`, se a lista for `prazo`, `return` sem `arrayMove`.
  - `onDragEnd`: se `sourceListId === destListId` e a lista for `prazo`, `return` antes de calcular posição (sem PATCH). Movimento para outra lista (inclusive para dentro de uma `prazo`) segue o cálculo atual.
  - `KanbanColumn`: `SortableContext strategy={list.sort_mode === "prazo" ? semAnimacaoDeOrdem : verticalListSortingStrategy}` com `const semAnimacaoDeOrdem: SortingStrategy = () => null;` no escopo do módulo (importar o tipo `SortingStrategy` de `@dnd-kit/sortable`) — evita os cards "abrindo espaço" sob o card arrastado.

- [ ] **Step 4: Verificar** — `cd frontend && npm run build && npm run lint`. Expected: build passa, lint sem erro novo. (Verificação no navegador fica para a Task 3, quando há como ligar o modo.)

- [ ] **Step 5: Commit** — `feat(board): lista com sort_mode=prazo ordena por prazo e trava o drag interno`

---

### Task 3: Front — item no menu ⋯, selo e changelog

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` — `KanbanColumn` (menu ~2407-2470; cabeçalho ~2400)
- Modify: `frontend/src/data/changelog.ts`

**Interfaces:**
- Consumes: `BoardList.sort_mode` (Task 2), `onListUpdate(updated: BoardList)` já existente.

- [ ] **Step 1: Item do menu** — no menu ⋯ (já só elevado), um bloco `border-t` logo após "Mudar cor": botão "Ordenar por prazo" com marca (✓ / ícone check) quando `list.sort_mode === "prazo"`. Handler `handleToggleSortMode()` no molde de `handleColorChange`: `api.patch<BoardList>(\`/boards/${list.board_id}/lists/${list.id}\`, { sort_mode: list.sort_mode === "prazo" ? "manual" : "prazo" })` → `onListUpdate(updated)`; fecha o menu.

- [ ] **Step 2: Selo** — quando `list.sort_mode === "prazo"`, para **todos** (inclusive não-elevado e quadro arquivado), uma linha pequena abaixo do título/descrição: ícone de calendário + "Ordenada por prazo", `text-[11px] text-slate-500`, `title="Os cards que vencem antes ficam em cima. Arrastar dentro desta lista não muda a ordem."`.

- [ ] **Step 3: Changelog** — topo de `CHANGELOG`: `{ version: "2.18.0", date: "2026-11-26", changes: [{ kind: "melhoria", text: "Listas podem ser ordenadas por prazo: no menu ⋯ da lista (administrador e coordenador), \"Ordenar por prazo\" põe em cima os cards que vencem antes. As outras listas continuam na ordem manual." }] }`.

- [ ] **Step 4: Verificar** — `npm run build && npm run lint`. Verificação no navegador **só depois do deploy da 019** (ou com autorização explícita do Erick para subir o backend local, que aplica a migration no banco de produção): ligar numa lista de teste e conferir os 5 itens do Review Focus.

- [ ] **Step 5: Commit** — `feat(board): opção "Ordenar por prazo" no menu da lista (v2.18.0)`
