# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

TaskHS é um clone de Trello (gestão de quadros/listas/cartões) com backend **FastAPI assíncrono + PostgreSQL** e frontend **React 19 + Vite + Tailwind v4**. Interface e mensagens de erro são em português.

## Como rodar

O backend exige um PostgreSQL acessível (a conexão fica em `backend/.env`, fora do versionamento — copiar de `backend/.env.example`).

**Backend (Docker, recomendado — bate com o `Dockerfile`/Python 3.12):**
```bash
docker compose up -d --build      # sobe em http://localhost:8000  (docs: /docs)
docker compose logs -f backend
docker compose down
```

**Backend (local, sem Docker):**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # ESLint
```

Health check do backend: `curl http://localhost:8000/api/health`.

**Não há suíte de testes** no projeto (nem pytest no backend, nem testes no frontend). Não invente comandos de teste.

## Gotchas importantes

- **Driver do banco:** `DATABASE_URL` precisa do dialeto async — `postgresql+asyncpg://...`. Uma URL `postgresql://` pura (sem `+asyncpg`) quebra o engine. O mesmo banco em outro ambiente (ex.: Easypanel) pode usar a URL sem o `+asyncpg`; ajustar conforme o driver.
- **Schema é criado por `Base.metadata.create_all`** no `lifespan` de [backend/app/main.py](backend/app/main.py), na subida do app. **Alembic está no `requirements.txt` mas NÃO é usado** (não existe pasta de migrations). Consequência: `create_all` só **cria tabelas que faltam** — ele **não altera** tabelas já existentes. Mudou uma coluna num model? Precisa alterar o banco manualmente (ou dropar a tabela) ou a mudança não aparece.
- **URL da API fixa no frontend, em dois lugares:** `http://localhost:8000/api` em [frontend/src/lib/api.ts](frontend/src/lib/api.ts) e a URL de import do Trello em [frontend/src/pages/BoardsPage.tsx](frontend/src/pages/BoardsPage.tsx). Mudou a porta/host do backend? Atualizar ambos.
- **CORS** aceita só `http://localhost:5173` e `:4173` (ver `main.py`). Outra origem é bloqueada.
- **Autorização é mínima:** quase todo endpoint exige apenas usuário autenticado (`get_current_user`), **sem checar se ele é membro do board**. Só `update_board`/`delete_board` validam dono/admin, e as rotas de admin (`get_admin_user`) exigem `is_admin`. Ao adicionar features, não assuma que o membership já foi validado upstream.

## Arquitetura do backend

SQLAlchemy 2.0 estilo `Mapped[...]` / `mapped_column`, tudo async (`AsyncSession`). Sessão injetada via `get_db` ([database.py](backend/app/database.py)); auth via JWT Bearer (`get_current_user` em [dependencies.py](backend/app/dependencies.py)), senha com bcrypt e token HS256 em [core/security.py](backend/app/core/security.py). Config carregada de `.env` por pydantic-settings ([core/config.py](backend/app/core/config.py)).

**Roteadores têm prefixos aninhados** que definem a hierarquia da API (todos sob `/api`):
- `auth` → `/api/auth` (register, login, me, e CRUD de usuários protegido por admin)
- `boards` → `/api/boards`
- `lists` → `/api/boards/{board_id}/lists`
- `cards` → `/api/lists/{list_id}/cards` (inclui comentários, membros, labels, checklists do cartão)
- `labels` → `/api/boards/{board_id}/labels`
- `notifications` → `/api/notifications`

**Modelo de dados** (relationships com `cascade="all, delete-orphan"`): `User` → `Board` (owner) → `BoardMember`/`BoardLabel`/`List` → `Card` → `CardLabel`/`CardMember`/`CardComment`/`CardAttachment`/`Checklist` → `ChecklistItem`. `Notification` referencia user/card/board. Papéis de board: `owner`/`admin`/`member`/`viewer` (`BoardRole`). Prioridade do card: `critical`/`high`/`medium`/`low`.

**Ordenação por posição fracionária:** `Card.position` é `float` (default 65536), incrementado por +65536 ao final da lista; o drag & drop calcula posições intermediárias sem renumerar tudo. Já `List.position` é `int`. Mover/reordenar cartão é um `PATCH` no card alterando `position` (e `list_id` ao trocar de lista).

**Serialização de cartões é manual:** `Card` não é retornado direto pelo ORM — `_card_to_dict` em [routers/cards.py](backend/app/routers/cards.py) achata labels/members/comments/etc., e os endpoints usam `selectinload` (`_card_options()`) para evitar lazy-load em contexto async. Atenção: no JSON o label vem com a chave **`label`** (nome) — não `name`.

**Import de Trello:** `POST /api/boards/import` ([routers/boards.py](backend/app/routers/boards.py)) recebe o JSON de export do Trello e responde via **SSE** (`text/event-stream`), emitindo eventos de progresso. Abre sua própria sessão (`AsyncSessionLocal`) e faz commit a cada 25 cartões. Há também o script standalone [trello_import.py](trello_import.py) na raiz.

## Arquitetura do frontend

React 19 + React Router 7 + Tailwind v4 (plugin `@tailwindcss/vite`, sem config separado). Drag & drop via **dnd-kit**.

- **Auth:** [contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx) guarda token (`taskhs-token`) e user (`taskhs-user`) no `localStorage`. O estado inicial é lido do localStorage **sem revalidar o token** — token expirado só falha na primeira chamada à API. [components/ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx) redireciona pra `/login` se não há user.
- **Cliente HTTP:** [lib/api.ts](frontend/src/lib/api.ts) — `api.get/post/patch/del`, injeta o header `Authorization` automaticamente e joga o campo `detail` do erro como `Error`. (O upload de import do Trello usa `fetch` direto para consumir o stream SSE.)
- **Rotas** (em [App.tsx](frontend/src/App.tsx)): `/login` público; o resto é protegido dentro de `MainLayout` — `/` e `/dashboard`, `/boards`, `/boards/:id`, `/usuarios`.
- **Tipos** centralizados em [types/index.ts](frontend/src/types/index.ts) (espelham os schemas Pydantic). `cn()` em [lib/utils.ts](frontend/src/lib/utils.ts) mescla classes Tailwind (clsx + tailwind-merge).
