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

Health: `curl http://localhost:8000/api/health`. Login conhecido: `healthsafetyti@gmail.com` / (senha em `backend/.env.dev-users`) (admin).

**Não há suíte de testes** (nem pytest, nem testes no front). A verificação do projeto é manual (curl / navegador). Não invente comandos de teste.

## Gotchas importantes

- **Driver do banco:** `DATABASE_URL` precisa do dialeto async — `postgresql+asyncpg://...`. URL `postgresql://` pura quebra o engine.
- **Pool de conexões:** o engine usa `pool_pre_ping=True` + `pool_recycle=1800` ([database.py](backend/app/database.py)). Isso foi adicionado porque sem pre-ping conexões ociosas mortas (derrubadas após horas) travavam a 1ª query (ex.: login ficava "Entrando..." pra sempre). Não remover.
- **Sem migrations automáticas:** o schema nasce de `Base.metadata.create_all` no `lifespan` ([main.py](backend/app/main.py)). Alembic está no `requirements.txt` mas **não é usado**. `create_all` **só cria tabelas que faltam — não altera tabelas existentes**. Para mudar colunas de uma tabela já criada, há SQL manual em [backend/migrations/](backend/migrations/) (ex.: `001_card_attachments.sql`) que se roda via psql. Tabelas novas (ex.: `reminders`) aparecem sozinhas no `create_all`.
- **URL da API no frontend:** vem de `import.meta.env.VITE_API_URL` (default `http://localhost:8000/api`), centralizada em `API_BASE` ([lib/api.ts](frontend/src/lib/api.ts)) e reusada no import SSE de [BoardsPage.tsx](frontend/src/pages/BoardsPage.tsx). Em produção, setar `VITE_API_URL` no build.
- **CORS** vem da env `CORS_ORIGINS` (lista separada por vírgula; default localhost:5173/4173) em [main.py](backend/app/main.py)/[config.py](backend/app/core/config.py). **Em produção, incluir o domínio do frontend** ou o navegador bloqueia tudo.
- **Token JWT dura 8h** (`ACCESS_TOKEN_EXPIRE_MINUTES=480`, default no config). O frontend faz **auto-logout → /login** em qualquer `401` (no `api.ts`) e checa o `exp` do token no load do `AuthContext`.
- **Autorização por membresia (desde v1.4.0):** a tranca é aplicada **no nível do router** — `dependencies=[Depends(...)]` no `APIRouter(...)` — em `lists`, `labels`, `automations` (via `require_board_access_by_board_id`) e `cards`, `attachments`, `reminders` (via `require_board_access_by_list_id`), ambas em [dependencies.py](backend/app/dependencies.py). **Endpoint novo nesses routers já nasce trancado; não replicar a checagem dentro dele.** A regra, definida num lugar só (`user_can_access_list`): elevado (administrador/coordenador) entra em qualquer quadro; senão exige linha em `board_members`; senão 403.
  - Em [boards.py](backend/app/routers/boards.py) o gate vai **por endpoint**, porque o router `/boards` tem rotas sem `board_id` (`GET`/`POST /boards`, `/stats`, `/import`).
  - **Cuidado com o destino no corpo:** o gate de router só valida o que está na **URL**. Endpoint que receba `list_id`/`target_list_id` no **corpo** precisa chamar `assert_board_access_by_list_id(destino, user, db)` à mão (ver `update_card`/`copy_card`) — senão dá para escrever em quadro alheio. E endpoint que aja sobre algo pendurado no card (anexo, checklist, item, etiqueta) precisa de `_get_card_or_404(card_id, list_id, db)` na primeira linha, para amarrar o card à lista que o gate validou.
  - Nas checagens de destino, **acesso vem antes de existência** (403 antes de 404): invertido, um não-membro distinguiria "não existe" de "é de outro quadro" e enumeraria.
  - Gestão de membros (`add_member`/`remove_member`) e `update_board`/`delete_board` exigem **dono ou elevado**. Rotas admin usam `get_admin_user`/`get_elevated_user`. Delete de anexo exige autor/admin; delete de lembrete, o dono.
  - O router `integration` fica fora disso — usa `X-API-Key` e não tem usuário.
  - A integração grava os dados de etapa em `Card.obs1..obs6` (não mais na descrição); a exibição desses campos como chips acima da descrição é ligada por quadro via `Board.integration_enabled` + `Board.obs_labels` (nomes das obs), configurados no drawer do quadro (dono/admin).
- **`GET /api/auth/users` é elevado-only** (devolve papel, e-mail, `is_active` — dados de gestão). Para **seletor de pessoas**, use **`GET /api/auth/users/basic`** (`{id, name, initials}`, qualquer autenticado). Usar o `/auth/users` num seletor quebra a tela para os membros comuns — já aconteceu.

## Segredos: NUNCA em arquivo versionado (OBRIGATÓRIO)

**Este repositório é PÚBLICO** (`github.com/ErickSantos2002/TaskHS`). Tudo que entra
num commit — código, doc, plano, spec, mensagem de commit — vai para a internet.

**Nunca escreva credencial em lugar versionado.** Isso já custou caro **duas vezes no
mesmo dia (2026-07-16)**:

1. Os planos traziam o comando `psql` com a **senha do banco de produção** inline —
   pública no GitHub de **2026-06-18 a 2026-07-16** (~1 mês), com a porta do Postgres
   aberta para a internet e o usuário sendo **superuser**.
2. As **senhas de login de contas reais** (`admin` e as 26 do time) estavam em **12
   arquivos** — inclusive neste `CLAUDE.md` e no `.claude/settings.json` — como
   "tokens da bateria de verificação". Públicas desde junho, e **funcionando no site no
   ar**: bastava clonar o repo e logar como administrador em produção.

O padrão dos dois: a senha entrou como parte de um comando de verificação, e ninguém
reparou porque parecia "só um teste".

- **Para rodar SQL:** use **`./scripts/psql-dev.sh`**, que lê a credencial do
  `backend/.env` (gitignorado). Ex.: `./scripts/psql-dev.sh -c "SELECT count(*) FROM users;"`,
  `./scripts/psql-dev.sh -f backend/migrations/00X_algo.sql`.
- **Para logar nas baterias de verificação:** as senhas vêm de variáveis de ambiente
  (`$TASKHS_ADMIN_PW` etc.), lidas de `backend/.env.dev-users` (gitignorado). Copie de
  `backend/.env.dev-users.example` e faça
  `set -a; source backend/.env.dev-users; set +a`.
- **Nunca** cole em doc/plano/spec/commit/chat: senha de banco **ou de login**,
  `PGPASSWORD=`, `SECRET_KEY`, `INTEGRATION_API_KEY`, ou `DATABASE_URL` completa.
- **Nunca** faça `cat backend/.env` nem `grep` que imprima o valor de um segredo —
  use `grep -c` para só confirmar presença.
- Antes de commitar um plano ou doc:
  `git grep -nE "password|PGPASSWORD|senha.*=|123" -- <arquivo>`.
- Segredo que vaza não se "desvaza": a correção é **rotacionar**, não apagar o commit.
  Se acontecer, **avise o Erick imediatamente** e diga o que ele consegue rotacionar
  sozinho (senha de login é na própria tela de Usuários; a do banco é no Easypanel).

## Changelog / versionamento (OBRIGATÓRIO)

**Toda mudança no sistema deve terminar com uma entrada nova no changelog** — `frontend/src/data/changelog.ts`. Adicionar um objeto `ChangelogVersion` **no topo** do array `CHANGELOG` (mais recente primeiro), com `version`, `date` (ISO `YYYY-MM-DD`) e os `changes` (cada um `{ kind: "novidade" | "melhoria" | "correcao", text }`). Versionamento semântico: correção → patch (`1.0.x`), melhoria → minor (`1.x.0`), novidade grande → minor/major. A versão exibida no rodapé da sidebar e no LoginPage deriva de `CHANGELOG[0]` (`APP_VERSION`) — basta editar o array, não há string de versão cravada em outro lugar. **Não considerar uma feature/fix concluída sem essa entrada.** O rodapé "TaskHS · vX.Y.Z" da sidebar é um botão ("Ver novidades") que abre o `ChangelogModal` ([frontend/src/components/ChangelogModal.tsx](frontend/src/components/ChangelogModal.tsx)).

## Arquitetura do backend

SQLAlchemy 2.0 (`Mapped[...]`/`mapped_column`), tudo async. Sessão via `get_db`; auth JWT Bearer (`get_current_user` em [dependencies.py](backend/app/dependencies.py)); bcrypt + HS256 em [core/security.py](backend/app/core/security.py). Config em `.env` via pydantic-settings ([config.py](backend/app/core/config.py): `DATABASE_URL`, `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `UPLOAD_DIR`, `CORS_ORIGINS`).

**Routers (prefixos aninhados, todos sob `/api`):**
- `auth` → `/api/auth` (register, login, me, CRUD de usuários admin)
- `boards` → `/api/boards` (inclui `/import` SSE, `/stats` e os membros do quadro: `GET`/`POST /{id}/members`, `DELETE /{id}/members/{user_id}`). `GET /api/boards` lista **todos** os quadros da empresa, cada um com `can_open`, `owner_name` e `members` (schema `BoardListOut`; os membros aí são enxutos — `BoardMemberBriefOut`, sem e-mail, porque a listagem é visível a todo mundo). `GET /api/boards/{id}` devolve o `BoardOut` puro. `/stats` conta os quadros que a pessoa **pode abrir** (mesmo critério de `can_open`): elevado (admin/coordenador) conta a empresa toda, membro comum conta os seus. (Até 2026-08-20 contava só as membresias — mudou porque o painel do admin ficava sempre em "1 quadro" mesmo com acesso a tudo.)
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

**Tempo real (SSE):** mudanças no quadro são empurradas via SSE. Um hub em memória ([app/realtime.py](backend/app/realtime.py)) recebe avisos pendurados nos hooks de sessão do audit ([audit.py](backend/app/audit.py), `after_commit`), serializa a entidade numa task de fundo (subida no `lifespan`) e faz fan-out para os assinantes do quadro. O front abre `EventSource` em `GET /api/boards/{id}/stream?ticket=` (ticket efêmero de ~60s tirado em `POST /api/boards/{id}/stream-ticket`); ao (re)conectar refaz o baseline por `GET /api/boards/{id}/snapshot`. **Assume 1 worker** (hub em memória) — igual aos lembretes; múltiplos workers exigiriam Redis pub/sub. Bulk delete (excluir lista/quadro) não passa pelos hooks por-card → emite `publish_reload` explícito.

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

## Processo de trabalho (PADRÃO — sempre seguir)

Toda feature/mudança não-trivial segue **sempre** este fluxo, sem reperguntar a cada vez (o Erick já aprovou como padrão):

1. **brainstorming** (skill) — entender e desenhar; sempre apresentar a recomendação nas perguntas.
2. **spec** — `docs/superpowers/specs/AAAA-MM-DD-<topico>-design.md`, commit, e o Erick revisa.
3. **plano** — `docs/superpowers/plans/AAAA-MM-DD-<feature>.md` (writing-plans), commit.
4. **execução subagent-driven** — um subagente implementador por task + review (spec + qualidade) entre cada uma; em branch `feat/...`.
5. **review final** da branch inteira → **finishing-a-development-branch** → merge na `main` + push.

Não há suíte de testes; a verificação de cada task é manual (curl / navegador / `npm run build`). Cada mudança fecha com uma entrada nova no changelog (ver seção acima). Mudanças pequenas/triviais podem ser commitadas direto na `main` sem todo o ritual, mas o default é o fluxo completo.
