# Dashboard com rankings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar progresso/vencidos/vencem hoje do Dashboard por um gráfico de movimentações por dia e quatro rankings (quadros e pessoas), com seletor de período.

**Architecture:** O `GET /api/dashboard` ganha `periodo` e os blocos novos, calculados com GROUP BY no `audit_log` (movimentos) e em `card_members` (pessoas com mais cards), sempre recortados pelos quadros visíveis da pessoa. O front troca os StatCards por dois componentes novos: `RankingBarras` e `MovimentosPorDia`.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0, React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-27-dashboard-rankings-design.md`

## Global Constraints

- Movimento = `audit_log.entity_type == 'card' AND action == 'mover' AND actor_type == 'usuario'`, `created_at >= agora - periodo`.
- `periodo` ∈ {7, 30, 90}, padrão 30; outro valor → 422.
- Recorte: `audit_log.board_id IN quadros_visiveis` (ativos: sem `deleted_at`, sem `archived_at`; elevado = todos, membro = os seus).
- "Com mais cards" (quadros e pessoas): cards ativos (card/lista/quadro vivos, card e lista não arquivados), sem período.
- Top **8** por ranking, ordem `total desc, nome asc`.
- Dia do gráfico em UTC−3 (`TZ_BR` de `app/horas_uteis.py`); a série tem **todos** os dias do período (zeros incluídos), do mais antigo ao mais novo.
- Saem do payload e da tela: `prazo_vencido`, `vencem_hoje`, progresso geral, "Boards recentes".
- Changelog **2.11.0**. Nunca segredo em arquivo versionado.

## Review Focus

1. Membro comum não vê movimento nem pessoa de quadro que não abre (ranking de pessoas recortado). Check da Task 1.
2. `periodo=7` vs `periodo=90`: total de movimentos de 7 ≤ de 90; série com 7 e 90 dias exatos. Check da Task 1.
3. Movimento da integração não conta. Check da Task 1 (comparar com SQL direto).
4. Quadro arquivado não aparece em nenhum ranking. Check da Task 1.
5. `?periodo=abc` na URL do front cai no padrão 30 sem quebrar. Navegador na Task 2.

---

### Task 1: Backend — período, movimentos e rankings

**Files:** Modify `backend/app/routers/dashboard.py`, `backend/app/schemas/dashboard.py`.

**Interfaces — Produces** (`DashboardOut` ganha):
- `periodo: int`
- `movimentos_por_dia: list[{dia: date, total: int}]`
- `quadros_mais_movimentados`, `quadros_com_mais_cards: list[RankingQuadro{id, nome, color, total}]` (vazios no modo quadro)
- `pessoas_que_mais_movimentam`, `pessoas_com_mais_cards: list[RankingPessoa{id, nome, initials, avatar_url, total}]`
- `kpis` sem `prazo_vencido`/`vencem_hoje`.

- [ ] Check (RED) em script: SQL direto vs API para periodo 30 (total de movimentos de pessoa nos quadros visíveis = soma da série); série com 7/30/90 itens; 7 ≤ 90; `periodo=15` → 422; ranking de pessoas do membro ⊆ resultado de SQL recortado pelos quadros dele; modo quadro 136: rankings de quadros vazios, rankings de pessoas só do 136; nenhum quadro arquivado nos rankings; `kpis` sem `prazo_vencido`.
- [ ] Implementar; rebuild; check GREEN.
- [ ] Commit `feat(dashboard): rankings de movimentacao e periodo`

### Task 2: Frontend — novo Dashboard

**Files:** Modify `frontend/src/types/index.ts`, `frontend/src/pages/DashboardPage.tsx`. Create `frontend/src/components/DashboardGraficos.tsx` (`RankingBarras`, `MovimentosPorDia`).

**Interfaces — Produces:**
- `RankingBarras({ titulo, subtitulo?, itens, cor, vazio, onClickItem? })` — `itens: {id, nome, total, color?, avatar?}`.
- `MovimentosPorDia({ serie })`.

- [ ] Seletor de período (7/30/90) em `?periodo=`, inválido → 30. Remover `/boards/stats`, StatCards de vencidos/progresso, "Boards recentes".
- [ ] Todos: alerta → gráfico → grade 2×2 (clicar quadro → `?board=`). Quadro: alerta → 4 KPIs → gráfico → pessoas (2) → cards por lista.
- [ ] Verificar: `npm run build`, lint = baseline; navegador (coordenador e membro): período troca números e URL; `?periodo=abc` → 30; clique no ranking abre o quadro; vazio de "pessoas com mais cards" aparece com a frase da spec.
- [ ] Commit `feat(dashboard): rankings e grafico de movimentacoes`

### Task 3: Changelog e fechamento

- [ ] `2.11.0` (2026-10-27): melhoria (Dashboard com rankings e gráfico, seletor de período); melhoria (saem progresso, vencidos, vencem hoje).
- [ ] Build; grep de segredos; commit; review final; merge + push.
