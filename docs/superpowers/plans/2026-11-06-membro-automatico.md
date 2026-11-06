# Membro automático do card — Implementation Plan

> **For agentic workers:** Execução **inline** (pedido do Erick em 2026-11-06), via superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** quem mexe no conteúdo de um card vira membro dele automaticamente, e os cards existentes são corrigidos pelo histórico.

**Architecture:** um helper `garantir_membro_card` (módulo novo `backend/app/membro_auto.py`) chamado antes do commit por cada endpoint "de trabalho"; grava via ORM para o `audit.py` registrar e o SSE propagar. Backfill = script Python no container, `--dry-run` por padrão, `--aplicar` idempotente.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0 async, PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-06-membro-automatico-design.md`

## Global Constraints

- Mover/reordenar/arquivar/restaurar/lixeira **não** contam; lembrete não conta; integração/automação/loop nunca adicionam.
- Agente do HS.OS conta como a pessoa (não filtrar `get_actor().via`).
- Só adiciona quem é membro do quadro do card (elevado de fora: não).
- Sem notificação de "você foi adicionado" no auto-add.
- CardMember sempre via ORM (`db.add`), nunca bulk insert (audit).
- Sem segredo em arquivo versionado; SQL via `./scripts/psql-dev.sh`; dev = banco de produção.
- Changelog `2.14.0` / `melhoria` no topo de `frontend/src/data/changelog.ts`.

## Review Focus

- PATCH que reenvia o mesmo título (sem mudar) → não vira membro. (Task 1, passo de verificação "PATCH idêntico")
- Card movido para outro quadro + editado no mesmo PATCH → membro checado no quadro **destino**, depois da limpeza. (Task 1)
- Corrida/duplicata do unique → ação principal (comentário) nunca falha. (Task 1: helper com savepoint; comentar 2× seguidas)
- Import do Trello: importador não vira membro de cards importados no backfill. (Task 2, contagem "descartados por import")
- Rodar `--aplicar` duas vezes → segunda cria 0. (Task 2)

---

### Task 1: Regra ao vivo

**Files:**
- Create: `backend/app/membro_auto.py`
- Modify: `backend/app/routers/cards.py` (`create_card`, `update_card`, `copy_card`, `add_comment`, `edit_comment`, `add_label`, `remove_label`, `create_checklist`, `delete_checklist`, `add_checklist_item`, `update_checklist_item`, `delete_checklist_item`)
- Modify: `backend/app/routers/attachments.py` (`upload_attachments`)
- Modify: `frontend/src/data/changelog.ts`

**Interfaces:**
- Produces: `async def garantir_membro_card(db: AsyncSession, card_id: int, user_id: int, board_id: int | None = None) -> bool` — True se criou. Resolve `board_id` pelo card→lista se None; retorna False se o usuário não está em `board_members` desse quadro ou já é membro; senão `async with db.begin_nested(): db.add(CardMember(...)); await db.flush()` capturando `IntegrityError` → False. Não dá commit.
- Produces: `CAMPOS_CONTEUDO = ("title", "description", "priority", "due_date", "due_date_completed", "done")` no mesmo módulo (o backfill reusa).

- [ ] **Step 1:** criar `membro_auto.py` com as duas interfaces acima.
- [ ] **Step 2:** ligar nos endpoints, sempre antes do `commit` e só no caminho que de fato muda algo (ex.: `add_label` que já existia retorna cedo — não conta; `remove_label`/`delete_checklist` só se achou a linha; `edit_comment` só se o texto mudou).
  - `update_card`: antes do `setattr`, `mudou_conteudo = any(k in CAMPOS_CONTEUDO and getattr(card, k) != v for k, v in data.items())`; após o bloco de limpeza de troca de quadro e **antes** de `run_card_moved_automations`, se `mudou_conteudo`, chamar com `board_id = quadro_destino or quadro_origem`.
  - `create_card`: `db.flush()` para ter o id, depois o helper.
  - `copy_card`: helper no `new_card.id` depois de copiar os membros (o unique/pré-check evita duplicata).
- [ ] **Step 3:** changelog `2.14.0`, data `2026-11-06`, `melhoria`: "Quem mexe no card — cria, edita título/descrição/data/prioridade, comenta, anexa, mexe em checklist ou etiqueta — passa a ser membro dele automaticamente. Mover o card entre listas não conta." (+ segunda linha sobre a correção dos cards antigos).
- [ ] **Step 4: Verificação.** `docker compose up -d --build backend`; `npm run build` no frontend → passa. Bateria com curl (credenciais de `backend/.env.dev-users`; nunca usuário real comum), num **quadro de teste** criado pelo admin e enviado à lixeira + apagado de vez no fim:
  - criar card → criador é membro;
  - outro elevado **membro do quadro**: comentar → membro; sair do card (`DELETE members/{id}`) e comentar de novo → membro de novo;
  - PATCH só `list_id`/`position` → não vira membro; PATCH com o mesmo `title` atual → não vira membro;
  - etiqueta, checklist, item, anexo → vira membro;
  - elevado **não-membro do quadro** comenta → 201 e não aparece em `members`;
  - `audit_log` mostra `membro_card / criar` com o ator.
- [ ] **Step 5:** commit `feat(cards): membro automático ao mexer no card + changelog v2.14.0`.

### Task 2: Backfill

**Files:**
- Create: `backend/scripts/__init__.py` (vazio) e `backend/scripts/backfill_membros_card.py`

**Interfaces:**
- Consumes: `CAMPOS_CONTEUDO` de `app.membro_auto`.
- CLI: `python -m scripts.backfill_membros_card [--aplicar]` (cwd `/app`).

- [ ] **Step 1:** montar em SQL (uma query, `text()`) os pares `(card_id, user_id, ultima_atividade)`:
  - audit `usuario` com `card_id`/`actor_user_id`: `card/criar`; `card/editar` ou `card/mover` cujo `changes::jsonb` tem chave em `CAMPOS_CONTEUDO`, **exceto** `mover` cuja única chave de conteúdo é `due_date_completed` (automação); `comentario` criar/editar; `anexo` criar; `checklist`, `item_checklist`, `etiqueta_card` qualquer ação;
  - `card_comments(author_id, created_at)`; `card_attachments(uploaded_by, uploaded_at)` não nulo;
  - **import:** quadros importados = `entity_id` das linhas `audit_log` com `path='POST /api/boards/import'` e `entity_type='quadro'`; descartar atividade em cards desses quadros com data ≤ `created_at` da linha do import + 5 min.
- [ ] **Step 2:** filtrar: usuário `is_active`; em `board_members` do quadro atual do card; não está em `card_members`; não há `membro_card/excluir` com `changes->'user_id'->>'de'` = usuário e `card_id` igual e data > última atividade (conferir no banco que `excluir` grava `user_id.de`; senão casar pelo `entity_id`→ linha de `criar`).
- [ ] **Step 3:** saída do dry-run: total a criar; por quadro (nome, n); por pessoa (nome, n); pulados por "saiu depois", "não é membro do quadro", "import"; quantos cards abertos com `due_date` vencida ganham membro.
- [ ] **Step 4:** `--aplicar`: `db.add(CardMember)` em lotes de 200 com commit; `ON CONFLICT`-safe via pré-check do conjunto atual + savepoint por lote em caso de corrida.
- [ ] **Step 5: Verificação.** `docker compose run --rm --no-deps -v "$PWD/backend:/app" backend python -m scripts.backfill_membros_card` → números plausíveis (importador não aparece com centenas). Commit `feat(scripts): backfill de membros do card`.

### Task 3: Fechamento

- [ ] Review da branch inteira (subagente revisor), corrigir o que for real.
- [ ] finishing-a-development-branch → merge na `main` + push (deploy).
- [ ] Entregar ao Erick os dois comandos (dry-run e `--aplicar`) para rodar no Konsole depois do deploy.
