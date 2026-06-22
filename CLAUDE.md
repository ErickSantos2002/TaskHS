# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

TaskHS é um clone de Trello (quadros/listas/cartões) feito para **substituir o Trello na empresa Health & Safety**. Backend **FastAPI assíncrono + PostgreSQL**, frontend **React 19 + Vite + Tailwind v4**. Interface e mensagens em português. Funcionalidades já implementadas: boards/listas/cards, drag & drop, etiquetas, membros, comentários, checklists, **anexos**, **lembretes**, **automações**, notificações (sino), import de Trello, admin de usuários. Paridade com o uso da empresa no Trello está completa.

## Como rodar

Backend exige um PostgreSQL acessível; a conexão fica em `backend/.env` (fora do git — copiar de `backend/.env.example`).

**Backend (Docker, recomendado — bate com o `Dockerfile`/Python 3.12):**
```bash
docker compose up -d --build      # http://localhost:8000  (docs: /docs); monta o volume taskhs-uploads em /app/uploads
docker compose logs -f backend
```

**Backend (local, sem Docker):** `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`

**Frontend:**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (HMR)
npm run build      # tsc -b && vite build  — PASSA (os erros TS pré-existentes foram corrigidos)
npm run lint
```

Health: `curl http://localhost:8000/api/health`. Login conhecido: `healthsafetyti@gmail.com` / `admin123` (admin).

**Não há suíte de testes** (nem pytest, nem testes no front). A verificação do projeto é manual (curl / navegador). Não invente comandos de teste.

## Gotchas importantes

- **Driver do banco:** `DATABASE_URL` precisa do dialeto async — `postgresql+asyncpg://...`. URL `postgresql://` pura quebra o engine.
- **Pool de conexões:** o engine usa `pool_pre_ping=True` + `pool_recycle=1800` ([database.py](backend/app/database.py)). Isso foi adicionado porque sem pre-ping conexões ociosas mortas (derrubadas após horas) travavam a 1ª query (ex.: login ficava "Entrando..." pra sempre). Não remover.
- **Sem migrations automáticas:** o schema nasce de `Base.metadata.create_all` no `lifespan` ([main.py](backend/app/main.py)). Alembic está no `requirements.txt` mas **não é usado**. `create_all` **só cria tabelas que faltam — não altera tabelas existentes**. Para mudar colunas de uma tabela já criada, há SQL manual em [backend/migrations/](backend/migrations/) (ex.: `001_card_attachments.sql`) que se roda via psql. Tabelas novas (ex.: `reminders`) aparecem sozinhas no `create_all`.
- **URL da API no frontend:** vem de `import.meta.env.VITE_API_URL` (default `http://localhost:8000/api`), centralizada em `API_BASE` ([lib/api.ts](frontend/src/lib/api.ts)) e reusada no import SSE de [BoardsPage.tsx](frontend/src/pages/BoardsPage.tsx). Em produção, setar `VITE_API_URL` no build.
- **CORS** vem da env `CORS_ORIGINS` (lista separada por vírgula; default localhost:5173/4173) em [main.py](backend/app/main.py)/[config.py](backend/app/core/config.py). **Em produção, incluir o domínio do frontend** ou o navegador bloqueia tudo.
- **Token JWT dura 8h** (`ACCESS_TOKEN_EXPIRE_MINUTES=480`, default no config). O frontend faz **auto-logout → /login** em qualquer `401` (no `api.ts`) e checa o `exp` do token no load do `AuthContext`.
- **Autorização é mínima:** quase todo endpoint exige apenas `get_current_user`, **sem checar membership do board**. Exceções: `update_board`/`delete_board` (dono/admin), rotas admin (`get_admin_user`, exige `is_admin`), delete de anexo (autor/admin), delete de lembrete (dono). Não assuma membership validado upstream.

## Changelog / versionamento (OBRIGATÓRIO)

**Toda mudança no sistema deve terminar com uma entrada nova no changelog** — `frontend/src/data/changelog.ts`. Adicionar um objeto `ChangelogVersion` **no topo** do array `CHANGELOG` (mais recente primeiro), com `version`, `date` (ISO `YYYY-MM-DD`) e os `changes` (cada um `{ kind: "novidade" | "melhoria" | "correcao", text }`). Versionamento semântico: correção → patch (`1.0.x`), melhoria → minor (`1.x.0`), novidade grande → minor/major. A versão exibida no rodapé da sidebar e no LoginPage deriva de `CHANGELOG[0]` (`APP_VERSION`) — basta editar o array, não há string de versão cravada em outro lugar. **Não considerar uma feature/fix concluída sem essa entrada.** O rodapé "TaskHS · vX.Y.Z" da sidebar é um botão ("Ver novidades") que abre o `ChangelogModal` ([frontend/src/components/ChangelogModal.tsx](frontend/src/components/ChangelogModal.tsx)).

## Arquitetura do backend

SQLAlchemy 2.0 (`Mapped[...]`/`mapped_column`), tudo async. Sessão via `get_db`; auth JWT Bearer (`get_current_user` em [dependencies.py](backend/app/dependencies.py)); bcrypt + HS256 em [core/security.py](backend/app/core/security.py). Config em `.env` via pydantic-settings ([config.py](backend/app/core/config.py): `DATABASE_URL`, `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `UPLOAD_DIR`, `CORS_ORIGINS`).

**Routers (prefixos aninhados, todos sob `/api`):**
- `auth` → `/api/auth` (register, login, me, CRUD de usuários admin)
- `boards` → `/api/boards` (inclui `/import` SSE e `/stats`)
- `lists` → `/api/boards/{board_id}/lists`
- `cards` → `/api/lists/{list_id}/cards` (comentários, membros, labels, checklists)
- `labels` → `/api/boards/{board_id}/labels`
- `attachments` → `/api/lists/{list_id}/cards/{card_id}/attachments` (upload multipart, download autenticado, delete autor/admin)
- `reminders` → `/api/lists/{list_id}/cards/{card_id}/reminders` (lembrete manual pessoal: CRUD)
- `automations` → `/api/boards/{board_id}/automations` (regras por evento: CRUD; criar/editar/excluir = dono/admin)
- `notifications` → `/api/notifications` (listar/marcar lida)

**Modelo de dados:** `User` → `Board`(owner) → `BoardMember`/`BoardLabel`/`List` → `Card` → `CardLabel`/`CardMember`/`CardComment`/`CardAttachment`/`Checklist`→`ChecklistItem`. Esses filhos do card têm `cascade="all, delete-orphan"` no ORM. **`Notification`, `Reminder`, `ReminderSent`, `Automation` referenciam `card_id`/`board_id`/`trigger_list_id` mas NÃO têm relationship/cascade** — por isso `delete_card`/`delete_board` (e `delete_list` para `Automation.trigger_list_id`) deletam essas linhas explicitamente antes de excluir (senão FK 500). Papéis: `owner`/`admin`/`member`/`viewer`. Prioridade: `critical`/`high`/`medium`/`low`.

**Ordenação fracionária:** `Card.position` é `float` (default 65536); drag & drop = `PATCH` no card mudando `position` (e `list_id` ao trocar de lista). `List.position` é `int`.

**Serialização de cards é manual:** `_card_to_dict` em [routers/cards.py](backend/app/routers/cards.py) achata labels/members/comments/attachments/checklists; endpoints usam `selectinload` (`_card_options()`). No JSON, label usa a chave **`label`** (não `name`); anexo expõe `is_image`.

**Anexos:** arquivos em disco em `UPLOAD_DIR` (default `/app/uploads`, volume `taskhs-uploads`), nome no disco = UUID; nome original no banco. Download é por endpoint autenticado (`FileResponse`), não estático. `CardAttachment` tem `stored_name`/`content_type`/`size`/`uploaded_by`; anexos antigos do Trello têm `url` (externa) e o download redireciona.

**Lembretes:** loop `asyncio` iniciado no `lifespan` ([app/reminders.py](backend/app/reminders.py): `reminder_loop` chama `run_reminder_cycle` a cada 60s, sessão própria). Gera `Notification` (sino) para: **manuais** (`reminders.remind_at <= now`, marca `fired`) e **automáticos** por `due_date` (véspera/dia/atrasado, só membros do card), com dedup via `reminder_sent` (único `card_id,user_id,kind,due_date`). Datas em UTC. **Assume processo único** (uvicorn sem `--workers`); múltiplos workers duplicariam manuais. Para testar o loop sem esperar 60s: `docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())"`.

**Automações:** regras por evento, dirigidas por evento (não é loop como lembretes). Tabela `automations` (genérica: `trigger_type`/`trigger_list_id`/`action_type`/`action_config`/`enabled`). v1 implementa **um gatilho** (`card_moved_to_list`) + **uma ação** (`mark_due_complete`). O motor [app/automations.py](backend/app/automations.py) (`run_card_moved_automations`) é chamado dentro do `PATCH update_card` quando o `list_id` muda — **na mesma transação** do movimento, sem commit próprio, sem cascata. `mark_due_complete` só marca se o card tem `due_date` (senão no-op). Por ser síncrono no request, **roda com múltiplos workers sem duplicar** (diferente dos lembretes). CRUD em `/api/boards/{board_id}/automations`; criar/editar/excluir exige dono/admin (espelha `update_board`). O modelo é genérico de propósito — novos gatilhos/ações são um ramo no motor + opção na UI, sem migration.

**Import de Trello:** `POST /api/boards/import` ([boards.py](backend/app/routers/boards.py)) consome o JSON de export e responde via **SSE**; sessão própria, commit a cada 25 cards.

## Arquitetura do frontend

React 19 + React Router 7 + Tailwind v4 (`@tailwindcss/vite`). Drag & drop via **dnd-kit**.

- **Auth:** [AuthContext.tsx](frontend/src/contexts/AuthContext.tsx) guarda `taskhs-token`/`taskhs-user` no localStorage; no load checa o `exp` do JWT (token vencido → login). [ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx) protege as rotas.
- **Cliente HTTP** [lib/api.ts](frontend/src/lib/api.ts): `api.get/post/patch/del`, mais `api.upload(path, files)` (multipart, sem setar Content-Type) e `api.getBlob(path)` (para baixar imagens/arquivos com auth → objectURL). Em `401`, limpa a sessão e redireciona pra `/login`. `API_BASE` exportado vem de `VITE_API_URL`.
- **Rotas** ([App.tsx](frontend/src/App.tsx)): `/login` público; resto dentro de `MainLayout` — `/`/`/dashboard`, `/boards`, `/boards/:id`, `/usuarios`. O sino de notificações está no `MainLayout` (polling 30s).
- **Modal do card** ([BoardPage.tsx](frontend/src/pages/BoardPage.tsx), `CardDetailModal`): prioridade, data, descrição, membros, etiquetas, checklists, comentários, **Anexos** (miniaturas + lightbox) e **Meus lembretes** (datetime-local). `CardContent`/`KanbanCard` são `memo` (perf no drag). Arquivo grande — editar com cuidado.
- **Tipos** em [types/index.ts](frontend/src/types/index.ts) espelham os schemas Pydantic.

## Deploy (Easypanel)

Dois serviços, cada um com seu Dockerfile (ambos rodam **não-root**):
- **Backend** ([backend/Dockerfile](backend/Dockerfile)): porta **8000**; volume `taskhs-uploads` em `/app/uploads`; envs do `.env` (`DATABASE_URL` com `+asyncpg`, `SECRET_KEY`, `CORS_ORIGINS` com o domínio do front, etc.).
- **Frontend** ([frontend/Dockerfile](frontend/Dockerfile)): multi-stage → **nginx-unprivileged na porta 8080** (SPA fallback em [nginx.conf](frontend/nginx.conf)); build arg **`VITE_API_URL`** = URL pública do backend + `/api`.

`.dockerignore` em ambos mantém `.env`/`node_modules` fora das imagens.

## Processo de trabalho

Specs e planos de features ficam em [docs/superpowers/](docs/superpowers/) (specs + plans datados). O fluxo usado: brainstorming → spec → plano → execução subagent-driven (um subagente por tarefa + review) → review final → merge na `main` + push. Cada feature em sua branch `feat/...`.
