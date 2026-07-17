# Sincronização do quadro em tempo real (SSE) — design

**Data:** 2026-07-17
**Versão alvo:** v1.8.0 (novidade grande)
**Status:** brainstorming feito; spec para revisão do Erick

## Problema

A tela do quadro carrega listas/cards **uma vez** ([BoardPage.tsx:1822-1843](../../../frontend/src/pages/BoardPage.tsx#L1822-L1843)) e só faz updates **locais**. Quando **outra pessoa ou a integração** move/cria/edita um card, os demais só veem depois de dar **F5**. No Trello isso é ao vivo. O único mecanismo "vivo" hoje é o polling do sino de notificações (30s, [MainLayout.tsx:125](../../../frontend/src/layouts/MainLayout.tsx#L125)).

## Objetivo

O quadro reflete em **tempo real** as mudanças feitas por qualquer pessoa **ou pela integração**, sem F5. Escopo **total** (decisão do brainstorming): a "cara do quadro" (mover/criar/excluir/arquivar card; criar/renomear/arquivar/reordenar lista; etiquetas do quadro; config do board) **e** o conteúdo do **card aberto** (título, descrição, etiquetas, membros, comentários, checklists, anexos, obs).

## Decisões do brainstorming (fixas)

1. **Transporte: SSE** (server-sent events), não WebSocket (o cliente já manda tudo por REST; full-duplex é overkill) nem polling.
2. **Escopo: tudo** — cara do quadro + conteúdo do card aberto ao vivo.
3. **Formato do evento: entidade pronta** — o evento carrega a entidade **já serializada** (reaproveita `_card_to_dict` / serializadores existentes); o cliente troca a cópia dele, sem round-trip. Delete carrega `{tipo, id, board_id}`.

## Arquitetura — visão geral

```
mutação (endpoint OU integração)
   │  (mesma request/transação)
   ▼
SQLAlchemy Session hooks (app/audit.py)
   before_flush: coleta (obj, ação, campos) — JÁ EXISTE p/ auditoria
   after_flush:  resolve board_id/kind/id (via _describe/_card_ctx) — JÁ EXISTE
                 + NOVO: guarda (board_id, kind, id, ação) em session.info["_sse_pending"]
   after_commit (NOVO): drena _sse_pending → hub.enqueue_change(...)
   after_rollback (JÁ EXISTE): descarta _sse_pending
   │
   ▼
Hub em memória (app/realtime.py, singleton) — fila asyncio de "avisos de mudança"
   consumer task (iniciada no lifespan): para cada aviso, abre sessão async própria,
   SERIALIZA a entidade (card/list/board/labels) e faz FAN-OUT do evento rico
   para as filas dos assinantes daquele board_id.  (delete não refaz fetch.)
   │
   ▼
GET /api/boards/{board_id}/stream?token=…  (SSE, text/event-stream)
   assina o hub p/ aquele board; yield "data: {json}\n\n"; keepalive periódico;
   desassina no disconnect.
   │
   ▼
Frontend: useBoardStream(boardId) — EventSource
   on message → dispatcher aplica no estado normalizado (cardsByList / lists / …)
   on open/reconnect → refetch baseline do quadro (não perder evento)
```

**Por que nos hooks do `audit.py` e não em cada endpoint:** o `before_flush`/`after_flush` já interceptam **toda** mutação ORM (~29 endpoints + a integração) e já resolvem `board_id`/`card_id` por objeto via `_describe`/`_card_ctx` ([audit.py:116-250](../../../backend/app/audit.py#L116-L250)). Emitir de um lugar só evita esquecer endpoint e cobre a integração de graça (ela passa pelo mesmo audit). **Caveat herdado:** *bulk delete* (`db.execute(sql_delete(...))`) não popula `session.deleted`, então não gera evento — igual ao audit. Onde há bulk delete que precise refletir na tela (ex.: exclusão de lista/quadro apaga cards em massa), emitimos um evento **estrutural** explícito ("recarregue o quadro") no endpoint. Ver "Casos de bulk delete".

**Por que publicar em `after_commit` e não `after_flush`:** `after_flush` ainda pode sofrer rollback; um evento emitido e depois revertido deixaria o cliente divergente. `after_commit` só dispara quando a transação de fato entrou.

## Backend

### 1. Hub em memória — `app/realtime.py` (novo)
- `subscribers: dict[int, set[asyncio.Queue]]` — filas por `board_id`.
- `subscribe(board_id) -> Queue` / `unsubscribe(board_id, q)`.
- `_changes: asyncio.Queue` — avisos `(board_id, kind, id, action, actor)` vindos do `after_commit`.
- `enqueue_change(...)` — `put_nowait` no `_changes` (chamado do hook sync; não-bloqueante, mesmo event loop).
- `consumer()` — task async iniciada no `lifespan`: `await _changes.get()`, abre `AsyncSessionLocal()` própria, **serializa** a entidade conforme `kind` (card via `_card_options()`+`_card_to_dict`; list/board/labels via seus serializadores), monta o evento rico e faz fan-out (`put_nowait`) para cada fila de `subscribers[board_id]`. Delete: sem fetch, evento `{type, action:"delete", kind, id, board_id}`. Processa **em ordem** (uma task só) → entrega ordenada por board.

O hub é **singleton de módulo**; a `consumer()` sobe ao lado do `reminder_loop` no `lifespan` ([main.py:22-31](../../../backend/app/main.py#L22-L31)).

### 2. Emissão nos hooks — `app/audit.py`
- No `after_flush` ([audit.py:286-317](../../../backend/app/audit.py#L286-L317)), depois de calcular `_describe`, empilhar `(board_id, kind, entity_id, action)` em `session.info.setdefault("_sse_pending", [])` (só quando `board_id` resolveu; entidades sem board — ex.: `User` — não emitem).
- Novo listener `@event.listens_for(Session, "after_commit")`: drena `session.info.pop("_sse_pending", [])` e chama `hub.enqueue_change(...)` para cada. Respeita `audit_silent` (o import de Trello marca `audit_silent=True` — não spamma evento por card importado; ao final emitimos **um** evento estrutural "recarregue o quadro").
- `after_rollback`/`after_soft_rollback` ([audit.py:320-327](../../../backend/app/audit.py#L320-L327)): também descartar `_sse_pending`.

### 3. Auth em duas etapas: ticket de vida curta + stream
`EventSource` nativo **não** manda header `Authorization`. Em vez de pôr o JWT de 8h na URL (fica durável em log), usamos um **ticket efêmero**:

- **`POST /api/boards/{board_id}/stream-ticket`** — rota **autenticada por Bearer normal** (`get_current_user` no header) + **tranca de membresia** do board (elevado ou membro; reusa `require_board_access_by_board_id`). Devolve `{ "ticket": "<jwt-curto>" }`: um JWT assinado com o `SECRET_KEY`, **exp ~60s**, claims `{sub: user_id, board_id, scope: "stream"}`. Stateless — sem armazenamento.
- **`GET /api/boards/{board_id}/stream?ticket=…`** — valida o ticket: assinatura, `exp`, `scope=="stream"`, `board_id` bate com a URL, e **reconfirma a membresia** (a associação pode ter mudado nos 60s; checagem barata). Ticket inválido/vencido → 401. O ticket na URL é **inútil após ~60s** (mitiga o risco de log).
- `StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})` — mesmo padrão do import ([boards.py:267-271](../../../backend/app/routers/boards.py#L267-L271)).
- `gen()`: `q = hub.subscribe(board_id)`; loop `await q.get()` → `yield f"data: {json}\n\n"`; **keepalive** `yield ": ping\n\n"` a cada ~20s (via `asyncio.wait_for` com timeout) pra proxies não fecharem; `finally: hub.unsubscribe(board_id, q)` no disconnect. A conexão é longa: o ticket só é preciso no **handshake**; enquanto o stream vive, não há re-auth.

### 4. Snapshot para baseline/reconexão — `GET /api/boards/{board_id}/snapshot` (novo, recomendado)
Hoje o load inicial é **N+1** (1 request por lista para os cards, [BoardPage.tsx:1834-1841](../../../frontend/src/pages/BoardPage.tsx#L1834-L1841)). Um endpoint agregado que devolve `{board, lists, labels, cards_by_list}` num payload só torna o **(re)connect** barato e atômico (baseline consistente). Reusa `_card_to_dict`. Também simplifica o load inicial. *(Se preferir não criar endpoint novo, o front pode reusar o N+1 no reconnect — mas o agregado é melhor.)*

### Casos de bulk delete (não passam pelo hook)
`delete_list` e `delete_board` apagam cards/filhos via `db.execute(sql_delete(...))` — não geram evento por card. Solução: nesses endpoints, após o commit, emitir **um** evento estrutural `{type:"board", action:"reload", board_id}`. O cliente, ao receber `reload`, refaz o baseline (snapshot). Mesmo para o `done` do import.

## Frontend

### 1. Hook `useBoardStream(boardId, handlers)` — novo (`frontend/src/hooks/`)
Com ticket, **não dá pra confiar na reconexão automática do `EventSource`**: ela reabriria a **mesma URL com o ticket já vencido** (~60s) → 401. Por isso o hook faz **reconexão manual com ticket novo**:
- `connect()`: `api.post<{ticket:string}>(\`/boards/${boardId}/stream-ticket\`)` (Bearer no header, via `api`) → abre `new EventSource(\`${API_BASE}/boards/${boardId}/stream?ticket=${encodeURIComponent(ticket)}\`)`.
- `onopen`: dispara **refetch do baseline** (snapshot) — cobre o que passou enquanto desconectado; e zera o backoff.
- `onmessage`: `JSON.parse` → despacha por `evt.type`/`evt.action` para os handlers de reconciliação.
- `onerror`: `es.close()`, espera um **backoff** (ex.: 1s → 2s → 5s → 10s, teto) e chama `connect()` de novo (pega ticket fresco). Assim tanto queda de rede quanto reinício do backend recuperam sozinhos.
- cleanup no unmount / troca de `boardId`: `es.close()` + cancelar o timer de reconexão.
- Se o `POST stream-ticket` devolver 401 (sessão vencida), cai no fluxo normal de logout do `api` ([api.ts:20-24](../../../frontend/src/lib/api.ts#L20-L24)).

### 2. Reconciliação — reusa o estado normalizado existente
Estado: `lists: BoardList[]`, `cardsByList: Record<listId, Card[]>`, `boardLabels`, `board`, `selectedCard` ([BoardPage.tsx:1752-1764](../../../frontend/src/pages/BoardPage.tsx#L1752-L1764)). Já há handlers reutilizáveis: `handleCardUpdate` ([:1903](../../../frontend/src/pages/BoardPage.tsx#L1903)), `handleCardDelete` ([:1918](../../../frontend/src/pages/BoardPage.tsx#L1918)), `handleCardCopy`, `handleListUpdate`, `handleListDelete`. O dispatcher do stream mapeia:
- `card` upsert → localizar por id; se `list_id` mudou, **mover de bucket** (remove da origem, insere no destino ordenado por `position`); senão substituir no lugar. (Estender `handleCardUpdate` para tratar troca de bucket.)
- `card` delete → `handleCardDelete`.
- `list` upsert/delete → `handleListUpdate`/`handleListDelete` (+ criar bucket vazio em `cardsByList` no create).
- `board_labels` → refazer `boardLabels`.
- `board` upsert → `setBoard`. `board reload` → refetch snapshot.

### 3. O nó: edição concorrente do card aberto
Regra: um evento que atualiza o **card aberto** aplica-se a **todos os campos, menos o que a pessoa está editando naquele instante**. Implementação no `CardDetailModal`: rastrear o campo "sujo/focado" (ex.: `descrição` com textarea em foco e valor local ≠ card). Ao chegar update remoto do card aberto (`card.id === selectedCard.id`): atualizar o card base e os campos **não** focados; o campo focado mantém o valor local até `blur`/salvar (o padrão de save-on-blur já existe, [BoardPage.tsx:360-365](../../../frontend/src/pages/BoardPage.tsx#L360-L365)). Comentários/checklists/anexos (append-only na prática) atualizam sempre.

### 4. Echo do próprio autor — por que **não** precisamos suprimir (v1)
O move é otimista e *fire-and-forget*, e o evento carrega o **estado autoritativo do servidor**. Reaplicar o próprio evento é **idempotente**: mesma `list_id`/`position` (fracional) → sem efeito visível; mesmo título/descrição salvos → igual ao local. E a regra do campo focado protege edição em andamento. Portanto **v1 não implementa supressão de echo** (YAGNI). Efeito de borda conhecido: se a pessoa faz 2 moves rápidos, o echo do 1º pode “piscar” a posição por um instante — aceitável. *(Futuro, se incomodar: `X-Client-Id` no request → `origin` no evento → cliente ignora o próprio.)*

## Restrições e deploy

- **1 worker de uvicorn** (confirmado: [Dockerfile:22](../../../backend/Dockerfile#L22) sem `--workers`; mesma premissa dos lembretes). O hub em memória **só funciona com 1 processo**. Escalar para `--workers >1` ou várias réplicas exigiria um broker (Redis pub/sub) no meio — **documentar como restrição** (igual à nota dos lembretes no CLAUDE.md). Fora de escopo agora.
- **Proxy não pode bufferizar** o stream: `X-Accel-Buffering: no` no response (já usado no import) **e** conferir que o proxy do **Easypanel/nginx** na frente do backend não bufferiza `text/event-stream` (senão os eventos chegam em lote).
- **Keepalive** (`: ping`) evita que proxies fechem a conexão ociosa.

## Segurança

- **Ticket de vida curta** (decidido no review): o que vai na URL do stream é um JWT **efêmero (~60s)**, com escopo `stream` e preso a `board_id`+`user_id` — **inútil após expirar**, então mesmo capturado num log de proxy não serve pra nada. O JWT de sessão (8h) **nunca** vai na URL: fica no header do `POST /stream-ticket`.
- A **tranca de membresia** do board vale nas duas rotas: emitir o ticket exige ser membro/elevado, e a abertura do stream **reconfirma** a membresia (pode ter mudado nos 60s). Não-membro → 403/401. Nenhum dado de quadro alheio vaza pelo canal.
- Repo é **público**: nada de segredo em arquivo versionado (nada muda aqui, mas vale a regra de sempre).

## Fora de escopo (YAGNI)

- Multi-worker / Redis pub/sub (só 1 worker hoje).
- Supressão de echo por client-id (idempotência cobre v1).
- Ticket de stream de vida curta (JWT na query basta p/ v1).
- Presença ("fulano está vendo este card"), cursores ao vivo, edição colaborativa char-a-char (tipo Google Docs) — não é o pedido.
- `Last-Event-ID`/replay de eventos perdidos — reconexão refaz o baseline (snapshot), o que já cobre.
- Supressão de echo por client-id (idempotência cobre v1).

## Decisões (confirmadas no review)

1. **Auth do stream = ticket de vida curta** (não o JWT na query). `POST /stream-ticket` (Bearer no header) → JWT efêmero ~60s escopo `stream`; o stream abre com `?ticket=`. Reconexão no front pega ticket novo (não confia no auto-reconnect do EventSource).
2. **Criar o endpoint agregado `/snapshot`** — baseline atômico p/ (re)conectar e resolve o N+1 do load inicial.
3. **Emissão via hooks do `audit.py`** (`after_commit`) — 1 ponto cobre os ~29 endpoints + integração. Bulk-delete (excluir lista/quadro) não passa pelo hook → evento estrutural `reload` nesses endpoints.

## Verificação (manual — não há suíte)

1. Duas abas no mesmo quadro (usuários diferentes): mover um card na aba A aparece na aba B em < ~1s, sem F5.
2. `POST /api/integration/cards` (com X-API-Key) movendo um card → reflete ao vivo nas abas abertas.
3. Criar/excluir/arquivar card e lista; editar etiquetas do quadro; editar config do board → refletem ao vivo.
4. Card aberto nas duas abas: editar título na A aparece na B; enquanto a B digita a **descrição**, um update remoto **não** apaga o que a B está digitando.
5. Excluir uma lista com cards (bulk delete) → a outra aba recebe `reload` e refaz o baseline; nada de card fantasma.
6. Cair a rede/reiniciar o backend → o EventSource reconecta e refaz o baseline (sem estado divergente).
7. Não-membro não abre o stream (403). `npm run build` passa. Backend sobe com a `consumer()` no lifespan sem erro.
