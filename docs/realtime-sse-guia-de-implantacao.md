# Tempo real por SSE — guia para implantar em outro sistema

> Documento para ser lido por **outro agente de IA** que vai reproduzir este
> mecanismo em outro código. Descreve como o TaskHS faz "um usuário move um
> cartão e todos os outros que estão com o mesmo quadro aberto veem a mudança na
> hora". Traz os trechos reais e, mais importante, **o porquê** de cada decisão —
> são as decisões que evitam os bugs, não o código em si.

## O que se quer

Vários usuários com o mesmo quadro aberto. Um deles arrasta um cartão para outra
lista. Em ~instantes, a tela dos outros reflete a mudança sozinha, **sem F5 e sem
polling**. Vale para qualquer mudança: criar/editar/mover/excluir cartão, lista,
etiqueta, etc.

## Escolha de arquitetura: SSE, não WebSocket

O fluxo é **só do servidor para o cliente** (o cliente manda mudanças por REST
normal, como sempre). Para isso, **Server-Sent Events (SSE)** é mais simples que
WebSocket: é HTTP puro, reconecta fácil, e o navegador tem `EventSource` nativo.
WebSocket só compensaria se o cliente precisasse empurrar dados pelo mesmo canal.

**Premissa que decide o resto:** este desenho assume **1 processo** de servidor
(o hub de assinantes vive na memória do processo). Isso é dito de novo no fim,
com o que muda para escalar. Se você já vai rodar com múltiplos workers/réplicas,
leia a seção "Escalando" **antes** de implementar.

---

## As 5 peças

```
  Cliente A (quem move)            Cliente B..N (quem observa)
        │                                   ▲
        │ 1. PATCH /cards/X (REST normal)   │ 5. EventSource recebe o evento
        ▼                                   │    e aplica no estado local
 ┌─────────────────────────────────────────┴───────────┐
 │ SERVIDOR (1 processo)                                 │
 │                                                       │
 │  2. hook after_commit  ──enfileira──►  3. fila async  │
 │     (dispara na MESMA                      │          │
 │      transação da mudança)                 ▼          │
 │                                    4. consumer:        │
 │                                    serializa + fan-out │
 │                                    p/ os assinantes    │
 │                                    daquele quadro      │
 └───────────────────────────────────────────────────────┘
```

1. **Cliente muda** via REST comum. Nada de especial aqui.
2. **Hook de commit** (SQLAlchemy `after_commit`): detecta o que mudou e
   enfileira um aviso leve `(board_id, tipo, id, ação)`. **Não** serializa nada
   aqui.
3. **Fila em memória** (`asyncio.Queue`): ponte entre o mundo síncrono do hook e
   o mundo async.
4. **Consumer** (task de fundo única): tira da fila, **serializa** a entidade
   (busca no banco o estado final) e faz **fan-out** para os assinantes daquele
   quadro.
5. **Endpoint SSE** por quadro: cada cliente conectado é uma fila; o consumer
   escreve nelas, o `EventSource` do navegador recebe e a página aplica no estado.

O ponto sutil, que separa uma implementação boa de uma cheia de bugs: **os passos
2 e 4 são separados de propósito**. O hook só anota "algo mudou" (rápido, dentro
da transação); a serialização pesada (queries, montar JSON) acontece **fora** do
caminho da request, na task de fundo. Ver "Armadilhas" no fim.

---

## Peça 1 — O hub em memória (`realtime.py`)

Guarda quem está ouvindo cada quadro, e a fila de mudanças pendentes.

```python
import asyncio, logging
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from app.database import AsyncSessionLocal

# board_id -> conjunto de filas (uma por cliente conectado naquele quadro)
_subscribers: dict[int, set[asyncio.Queue]] = {}

# Ponte sync->async: o hook after_commit (síncrono) enfileira aqui;
# a consumer() (async) drena, serializa e faz fan-out.
_changes: "asyncio.Queue[tuple[int, str, int, str]]" = asyncio.Queue()


def subscribe(board_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(board_id, set()).add(q)
    return q


def unsubscribe(board_id: int, q: asyncio.Queue) -> None:
    subs = _subscribers.get(board_id)
    if subs:
        subs.discard(q)
        if not subs:
            _subscribers.pop(board_id, None)   # não vaza quadros sem ninguém


def enqueue_change(board_id: int, kind: str, entity_id: int, action: str) -> None:
    """Chamado do hook SÍNCRONo after_commit. put_nowait não bloqueia."""
    _changes.put_nowait((board_id, kind, entity_id, action))


def publish_reload(board_id: int) -> None:
    """Evento 'recarregue tudo'. Para operações em massa (excluir lista/quadro,
    fim de import) que NÃO passam pelos hooks item a item — ver Armadilha 3."""
    _changes.put_nowait((board_id, "reload", 0, "reload"))
```

O fan-out e a serialização:

```python
def _fanout(board_id: int, event: dict) -> None:
    # list(...) porque unsubscribe pode mexer no set durante a iteração
    for q in list(_subscribers.get(board_id, ())):
        q.put_nowait(event)


async def _serialize(board_id, kind, entity_id, action) -> dict | None:
    if kind == "reload":
        return {"type": "board", "action": "reload", "board_id": board_id}
    if action == "delete":
        return {"type": kind, "action": "delete", "id": entity_id, "board_id": board_id}

    # SESSÃO PRÓPRIA, curta. Não reusa a sessão da request (já fechou).
    async with AsyncSessionLocal() as db:
        if kind == "card":
            card = (await db.execute(
                select(Card).where(Card.id == entity_id).options(*_card_options())
            )).scalar_one_or_none()
            if card is None:
                return None   # foi apagado entre o enqueue e agora — ignora
            # model_validate no DICT ACHATADO, não no ORM cru:
            # o schema de saída descarta campos sensíveis (ex.: password_hash).
            return {"type": "card", "action": "upsert", "board_id": board_id,
                    "card": jsonable_encoder(CardOut.model_validate(_card_to_dict(card)).model_dump())}
        # ... idem para list, board, board_labels
    return None


async def consumer() -> None:
    """Task de fundo única (sobe no lifespan). Serializa FORA do caminho da request."""
    while True:
        board_id, kind, entity_id, action = await _changes.get()
        try:
            event = await _serialize(board_id, kind, entity_id, action)
            if event is not None:
                _fanout(board_id, event)
        except Exception:
            # NUNCA deixar um evento ruim derrubar o consumer — se ele morre,
            # o tempo real para pra todo mundo em silêncio.
            _log.exception("falha ao serializar/entregar (%s/%s/%s)", board_id, kind, entity_id)
```

---

## Peça 2 — Disparar a partir do commit (`audit.py`)

Aqui está o coração. Em vez de cada endpoint (mover card, criar lista…) lembrar de
"avisar o tempo real", um **listener de evento do SQLAlchemy** intercepta todo
commit e descobre sozinho o que mudou. Um lugar só; endpoint novo já entra no
tempo real de graça.

São três fases, porque o ciclo do SQLAlchemy exige:

**`before_flush`** — enquanto os objetos ainda têm o histórico de alterações,
anota o que é novo/sujo/deletado numa lista temporária guardada em
`session.info`:

```python
@event.listens_for(Session, "before_flush")
def _before_flush(session, flush_context, instances):
    sse_raw = session.info.setdefault("_sse_raw", [])
    for obj in session.new:
        sse_raw.append((obj, "upsert"))
    for obj in session.dirty:
        if session.is_modified(obj, include_collections=False):
            sse_raw.append((obj, "upsert"))
        # Caso especial do MOVER entre listas: guardamos a lista ANTIGA,
        # senão os observadores não removem o card da coluna de origem.
        if type(obj) is Card:
            hist = inspect(obj).attrs.list_id.history
            if hist.deleted and hist.added and hist.deleted[0] != hist.added[0]:
                session.info.setdefault("_sse_moves", []).append((obj.id, hist.deleted[0]))
    for obj in session.deleted:
        sse_raw.append((obj, "delete"))
```

**`after_flush`** — agora os IDs já existem (INSERT já rodou). Traduz cada objeto
para o alvo `(board_id, kind, id, action)`. É aqui que um **filho re-serializa o
pai**: mudou um item de checklist? O evento emitido é "upsert do card inteiro",
porque a tela mostra o card, não o item solto.

```python
def _sse_target(session, obj, raw_action):
    t = type(obj)
    if t is Card:
        lst = session.get(List, obj.list_id)
        return (lst.board_id, "card", obj.id,
                "delete" if raw_action == "delete" else "upsert") if lst else None
    if t is List:
        return (obj.board_id, "list", obj.id,
                "delete" if raw_action == "delete" else "upsert")
    # filhos do card (comentário, checklist, etiqueta, anexo...) -> re-serializa o card
    if t in _CARD_CHILDREN:
        card_id = _resolve_card_id(session, obj)
        _, board_id = _card_ctx(session, card_id)
        return (board_id, "card", card_id, "upsert") if board_id else None
    return None
```

**`after_commit`** — só aqui a transação **de fato persistiu**. Faz o dedup e
enfileira no hub. Emitir antes do commit seria o pior bug possível: um rollback
mandaria para os outros usuários uma mudança que **não aconteceu**.

```python
@event.listens_for(Session, "after_commit")
def _after_commit(session):
    pend = session.info.pop("_sse_pending", None)
    if not pend:
        return
    # Dedup por (board_id, kind, id): vários filhos do mesmo card viram 1 upsert;
    # delete vence upsert (card apagado + filhos em cascata no mesmo commit).
    best: dict[tuple, str] = {}
    for board_id, kind, eid, action in pend:
        key = (board_id, kind, eid)
        if best.get(key) == "delete":
            continue
        best[key] = action
    for (board_id, kind, eid), action in best.items():
        realtime.enqueue_change(board_id, kind, eid, action)
```

E limpar em rollback, senão lixo de uma transação abortada vaza para a próxima:

```python
@event.listens_for(Session, "after_rollback")
def _after_rollback(session):
    for k in ("_sse_raw", "_sse_moves", "_sse_pending"):
        session.info.pop(k, None)
```

> **Se seu ORM não for SQLAlchemy:** o padrão continua o mesmo — você precisa de
> um gancho pós-commit. Django: sinal `post_save`/`post_delete` + `transaction.on_commit`.
> Prisma/TypeORM: middleware ou subscriber pós-transação. O importante é
> **disparar depois do commit** e ter um lugar central, não espalhado por endpoint.

---

## Peça 3 — O endpoint SSE e o ticket de autenticação

`EventSource` (a API do navegador) **não deixa mandar cabeçalhos** — ou seja, não
dá para enviar `Authorization: Bearer`. A saída padrão: o cliente pede um
**ticket efêmero** por uma rota autenticada normal, e usa o ticket na URL do
stream.

```python
# Ticket = JWT curto (60s), com escopo próprio, assinado com o mesmo segredo.
def create_stream_ticket(subject: str, board_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=60)
    return jwt.encode({"sub": subject, "board_id": board_id,
                       "scope": "stream", "exp": expire}, SECRET_KEY, algorithm=ALG)

def decode_stream_ticket(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALG])
    except Exception:
        return None
    return payload if payload.get("scope") == "stream" else None  # não aceita token normal
```

```python
@router.post("/{board_id}/stream-ticket")   # autenticado do jeito normal
async def stream_ticket(board_id: int, user = Depends(require_board_access)):
    return {"ticket": create_stream_ticket(user.email, board_id)}


@router.get("/{board_id}/stream")            # autenticado pelo ticket na query
async def board_stream(board_id: int, ticket: str):
    payload = decode_stream_ticket(ticket)
    if not payload or payload.get("board_id") != board_id:
        raise HTTPException(401, "Ticket inválido")

    # Handshake numa sessão CURTA e fecha. O gerador abaixo fica aberto por horas;
    # se ele segurasse uma conexão do pool a vida toda, o pool esgotaria.
    async with AsyncSessionLocal() as db:
        user = await _load_active_user(db, payload["sub"])
        if user is None or not await user_can_access_board(board_id, user, db):
            raise HTTPException(403, "Sem acesso")

    async def gen():
        q = realtime.subscribe(board_id)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"     # keep-alive: proxies matam conexão ociosa
        finally:
            realtime.unsubscribe(board_id, q)   # SEMPRE limpa ao desconectar

    return StreamingResponse(gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

Três detalhes que **vão** te morder se ignorar:
- **`X-Accel-Buffering: no`** — sem isso, nginx enfileira a resposta e o "tempo
  real" chega em lotes de vários segundos.
- **Ping a cada 20s** — proxies e balanceadores derrubam conexão HTTP ociosa. O
  `: ping` é um comentário SSE que o cliente ignora, só mantém o cano vivo.
- **`finally: unsubscribe`** — se não remover a fila ao desconectar, cada
  refresh do usuário deixa uma fila fantasma recebendo eventos para sempre.

---

## Peça 4 — Endpoint de baseline (`/snapshot`)

Ao (re)conectar, o cliente não sabe o que perdeu enquanto estava fora. Ele **não**
tenta reconstruir a partir de eventos: pega o estado completo do quadro de uma vez
por um endpoint REST normal (`/boards/{id}/snapshot` devolve listas + cards +
etiquetas) e **substitui** o estado local. Simples e à prova de eventos perdidos.

A regra de ouro: **snapshot é a verdade no connect; os eventos são deltas em cima
dele.** Toda vez que o SSE (re)abre, refaz o snapshot.

---

## Peça 5 — O cliente (`useBoardStream` + aplicar eventos)

O hook que abre o `EventSource`, com um detalhe crucial de reconexão:

```typescript
export function useBoardStream(boardId, onEvent, onOpen) {
  useEffect(() => {
    let es = null, stopped = false, backoff = 1000, timer;

    async function connect() {
      if (stopped) return;
      try {
        // ticket NOVO a cada tentativa — ver o comentário abaixo
        const { ticket } = await api.post(`/boards/${boardId}/stream-ticket`, {});
        if (stopped) return;
        es = new EventSource(`${API_BASE}/boards/${boardId}/stream?ticket=${encodeURIComponent(ticket)}`);
        es.onopen    = () => { backoff = 1000; onOpen(); };        // dispara o resync
        es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
        es.onerror   = () => {
          es?.close(); es = null;
          if (!stopped) { timer = setTimeout(connect, backoff); backoff = Math.min(backoff*2, 10000); }
        };
      } catch {
        if (!stopped) { timer = setTimeout(connect, backoff); backoff = Math.min(backoff*2, 10000); }
      }
    }
    connect();
    return () => { stopped = true; es?.close(); clearTimeout(timer); };
  }, [boardId]);
}
```

**Por que reconexão manual e não a nativa do `EventSource`:** o auto-reconnect do
navegador reabre a **mesma URL** — com o **mesmo ticket, já vencido** (60s). Daria
401 para sempre. Então desligamos o retry nativo (fechando no `onerror`) e
reconectamos à mão, pegando um **ticket fresco** a cada tentativa, com backoff
exponencial.

Aplicar o evento no estado — reduz cada evento à mutação local mínima:

```typescript
const applyStreamEvent = useCallback((evt) => {
  if (evt.type === "card" && evt.action === "upsert") {
    const card = evt.card;
    setCardsByList(prev => {
      // remove o card de QUALQUER lista (pode ter mudado de coluna)...
      const next = {};
      for (const [lid, cards] of Object.entries(prev))
        next[+lid] = cards.filter(c => c.id !== card.id);
      // ...e recoloca na lista atual, ordenado por position
      next[card.list_id] = [...(next[card.list_id] ?? []), card].sort((a,b)=>a.position-b.position);
      return next;
    });
    setSelectedCard(sc => sc?.id === card.id ? card : sc);  // atualiza o modal se aberto
  } else if (evt.type === "card" && evt.action === "delete") {
    setCardsByList(prev => { /* filtra o id de todas as listas */ });
  } else if (evt.type === "list") {
    /* upsert: substitui e reordena; delete: remove */
  } else if (evt.type === "board" && evt.action === "reload") {
    resync();   // evento estrutural -> refaz o snapshot inteiro
  }
  // ...
}, [resync]);

// Liga tudo: no (re)connect (onOpen), refaz o baseline.
useBoardStream(boardId, applyStreamEvent, () => resync());
```

O `upsert` de card remove-de-todas-as-listas-e-recoloca resolve o mover **e** o
editar com o mesmo código: não importa de onde o card veio, ele acaba na lista
certa, na posição certa.

---

## Armadilhas (as partes que causam bug de verdade)

1. **Emitir dentro do commit, não antes.** Se você emitir o evento em cima da
   mudança (antes do `commit`) e a transação der rollback, você mandou para todo
   mundo uma mudança que não existe. Sempre no `after_commit`.

2. **Serializar fora do caminho da request.** Se o hook serializar o card inteiro
   (queries, JSON) na hora, quem fez o PATCH espera por isso. Por isso o hook só
   enfileira `(board_id, tipo, id, ação)` — leve — e a task de fundo serializa. A
   fila é a fronteira entre "rápido, na transação" e "pesado, depois".

3. **Operação em massa não dispara hook por item.** `DELETE ... WHERE board_id=X`
   (bulk) não passa pelo unit-of-work do ORM, então os listeners não veem os
   itens sumirem — os observadores ficariam com cards fantasma. Para esses casos
   (excluir lista/quadro, fim de import) emita **um** `publish_reload(board_id)`
   explícito, e o cliente refaz o snapshot. Mesma pegadinha vale para a auditoria.

4. **Filho re-serializa o pai.** Comentário, item de checklist, etiqueta do card —
   a tela não os mostra soltos, mostra o card. Todo evento de filho vira "upsert
   do card", e o dedup no `after_commit` junta N filhos de um card em 1 evento.

5. **Sessão própria e curta para serializar.** A sessão da request já fechou
   quando o consumer roda. E a conexão SSE fica aberta por horas: se o handshake
   dela segurasse uma conexão do pool, o pool esgota. Handshake em sessão curta,
   fecha, e o loop de streaming não toca no banco.

6. **Ticket, não header.** `EventSource` não manda `Authorization`. Ticket
   efêmero de escopo próprio na query string — nunca o JWT de sessão na URL (fica
   em log de acesso, histórico, referer).

7. **O evento pode chegar depois da entidade sumir.** Entre enfileirar e
   serializar, o card pode ter sido apagado. `_serialize` devolve `None` e o
   consumer ignora — nunca `raise`.

---

## Escalando além de 1 processo

Tudo acima assume **um processo** (`uvicorn` sem `--workers`, uma réplica). O
`_subscribers` e a `_changes` vivem na memória **daquele** processo. Com 2+
workers, o usuário A conecta no worker 1, o commit do usuário B acontece no
worker 2 — e o worker 2 não conhece a fila do A. Metade das atualizações some.

Para escalar, troque a fila em memória por um **pub/sub externo** (Redis
`PUBLISH`/`SUBSCRIBE`, ou Postgres `LISTEN/NOTIFY`):

- o `after_commit` publica no canal do Redis em vez de `_changes.put_nowait`;
- **cada** processo roda um consumer que assina o Redis e faz fan-out para os
  **seus** assinantes locais.

O resto (hooks, ticket, snapshot, cliente) **não muda**. Só a fronteira entre
"quem emite" e "quem entrega" passa a ser o Redis em vez de uma fila de processo.

---

## Checklist de implantação

- [ ] Gancho pós-commit do seu ORM, num lugar central (não por endpoint).
- [ ] Hub em memória: `subscribe`/`unsubscribe`/`enqueue`/`fanout` + consumer de fundo.
- [ ] Consumer sobe junto com a app (no `lifespan`/startup) e **nunca** morre por erro de um evento.
- [ ] Endpoint SSE com ticket efêmero, ping keep-alive e `unsubscribe` no `finally`.
- [ ] `X-Accel-Buffering: no` se houver nginx na frente.
- [ ] Endpoint de snapshot para o baseline no (re)connect.
- [ ] Cliente: reconexão manual com ticket novo + backoff; resync no `onOpen`.
- [ ] Operações em massa emitem `reload` explícito.
- [ ] Decidiu 1 processo (memória) vs. N processos (Redis/pub-sub) **antes** de subir.
```
