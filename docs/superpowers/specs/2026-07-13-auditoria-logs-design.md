# Auditoria / Página de Logs — Design

**Data:** 2026-07-13
**Status:** Aprovado
**Contexto:** O TaskHS vai para produção com ~27 pessoas. O Erick precisa de **auditoria completa e confiável**: qualquer mudança no sistema (até adicionar/remover uma etiqueta) deve registrar **quem fez, o quê e quando**, para acabar com o "não fui eu". Hoje não existe nenhum registro. O sistema tem **45 endpoints de escrita**, um motor de automações, um loop de lembretes e uma API de integração — instrumentar tudo à mão seria garantia de furo (e todo endpoint futuro nasceria sem log).

O perfil **Administrador estrito** já existe (`get_admin_user`), reservado justamente para esta página.

## Decisões (com o Erick)

| Tema | Decisão |
|------|---------|
| Captura | **Automática no ORM** (listener de flush da sessão SQLAlchemy) — cobre os 45 endpoints, o motor de automações e qualquer endpoint futuro. |
| Escopo | **Tudo**, exceto: reordenar card **dentro da mesma lista** (só muda `position` → inundaria o log) e ruído de sino (`Notification`, `ReminderSent`). Mover card **entre** listas **é** registrado. |
| Eventos de acesso | **Login** (sucesso e falha), **tentativas bloqueadas (403)** e **ações da integração** (ator = o sistema externo, ex.: GestorHS). |
| Integridade | O log é **append-only** e é gravado **na mesma transação** da mudança. |
| Visibilidade | Página `/logs` **exclusiva do Administrador** (não Coordenador). |

## 1. Modelo `audit_log`

Tabela nova (o `create_all` cria sozinha — **sem migração manual**). Model em `backend/app/models/audit.py`.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | PK | |
| `created_at` | datetime tz, **index** | quando |
| `actor_type` | str(20) | `usuario` \| `integracao` \| `sistema` |
| `actor_user_id` | int, nullable, **index** | **sem FK** (ver §1.1) |
| `actor_name` | str(120) | **snapshot** do nome |
| `actor_email` | str(255), nullable | **snapshot** |
| `action` | str(20), index | `criar` \| `editar` \| `mover` \| `excluir` \| `login` \| `login_falhou` \| `acesso_negado` |
| `entity_type` | str(40), index | `quadro`, `lista`, `card`, `etiqueta_quadro`, `etiqueta_card`, `membro_quadro`, `membro_card`, `comentario`, `checklist`, `item_checklist`, `anexo`, `lembrete`, `automacao`, `usuario`, `sessao` |
| `entity_id` | int, nullable | id da entidade (**sem FK**) |
| `entity_label` | str(255), nullable | **snapshot** legível (título do card, nome da etiqueta…) |
| `board_id` | int, nullable, index | contexto (**sem FK**) |
| `card_id` | int, nullable, index | contexto (**sem FK**) |
| `summary` | Text | **frase pronta em pt-BR** (gerada na gravação) |
| `changes` | Text (JSON) nullable | `{campo: {"de": x, "para": y}}` |
| `ip` | str(45), nullable | |
| `path` | str(255), nullable | método + rota (ex.: `DELETE /api/lists/3/cards/9/labels/2`) |

### 1.1 Por que **sem foreign keys**
Se `card_id`/`actor_user_id` fossem FK com cascade, **apagar o card apagaria o histórico dele** — o pior cenário possível numa auditoria. As colunas são inteiros soltos + **snapshots** (`actor_name`, `entity_label`, `summary`), então o log permanece legível mesmo depois que a pessoa, o card ou a etiqueta forem excluídos. O log **nunca** é apagado em cascata.

### 1.2 Append-only
Não existe endpoint de editar nem excluir log. Só `GET`.

## 2. Captura automática — `backend/app/audit.py`

### 2.1 Ator (ContextVar)
`current_actor: ContextVar[Actor | None]`, onde `Actor` = `{actor_type, user_id, name, email, ip, path}`. É setado:
- **Usuário:** na dependency `get_current_user` (já roda em todo endpoint autenticado) → `usuario` + snapshot.
- **Integração:** na dependency `require_integration_key` → `integracao`, `name = source` do payload quando disponível (senão `"integração"`).
- **Sistema:** no loop de lembretes (`app/reminders.py`) e no import → `sistema`.
- Sem ator (não deveria ocorrer) → `sistema`.

`ip`/`path` vêm de um **middleware** que guarda o `Request` num ContextVar.

### 2.2 Listeners de flush
Registrados na `Session` **síncrona** (a `AsyncSession` delega para ela):

- **`before_flush`** — varre `session.new`, `session.dirty` e `session.deleted`. Para cada objeto de tipo **auditável**, calcula o **diff** via `inspect(obj).attrs[...].history` e guarda uma entrada pendente em `session.info["_audit"]` (guardando a referência ao objeto, porque o PK de um INSERT ainda não existe aqui).
- **`after_flush`** — os PKs já estão preenchidos. Resolve `entity_id`, monta as linhas e insere com um **Core insert** (`session.execute(insert(AuditLog), rows)`), o que grava **dentro da mesma transação** sem re-disparar o listener (o log não passa pelo unit-of-work do ORM).

> **Ponto técnico crucial:** dentro dos handlers de flush a execução está **dentro do greenlet** do SQLAlchemy async, então **consultas síncronas são permitidas** (`session.execute(select(...))`). É isso que permite resolver nomes ("etiqueta *Urgente*", "membro *Cláudia Santos*") para o `summary`. Essas consultas devem rodar sob `with session.no_autoflush:` para não causar flush reentrante.

### 2.3 Tipos auditáveis e exclusões
- **Auditados:** `Board`, `List`, `Card`, `BoardLabel`, `CardLabel`, `BoardMember`, `CardMember`, `CardComment`, `Checklist`, `ChecklistItem`, `CardAttachment`, `Reminder`, `Automation`, `User`.
- **Excluídos (ruído):** `Notification`, `ReminderSent` e o próprio `AuditLog`.

### 2.4 Regras especiais
- **Card, mudança só de `position`** (e/ou `updated_at`) → **não gera log** (é reordenar dentro da lista).
- **Card com `list_id` alterado** → ação **`mover`**, com `summary` "moveu o card *X* de *Lista A* para *Lista B*".
- **`User`**: nunca registrar `password_hash` no `changes` (campo sensível — sempre mascarado como `"***"`).
- **Delete de usuário**: hoje é `db.execute(sql_delete(User))` (passa por fora do ORM) → **trocar por `await db.delete(user)`** para ser capturado.
- Os outros 12 `sql_delete` em massa são limpeza de tabelas auxiliares (notificações/lembretes/automações de um card/quadro sendo excluído). O **evento pai** (excluir card/quadro) é auditado; a limpeza em cascata **não** gera linhas próprias — decisão consciente para não poluir.

### 2.5 Atomicidade
O log é inserido **na mesma transação** da mudança. Se a gravação do log falhar, a transação inteira falha e a mudança **não acontece** — auditoria não pode ser "melhor esforço".

### 2.6 Import de Trello (modo silencioso)
O import cria centenas de objetos numa sessão própria. Nessa sessão setamos `session.info["audit_silent"] = True` → o listener ignora, e o import grava **um único evento-resumo**: "importou o quadro *X* (N listas, M cards)".

## 3. Eventos que não são escrita no banco

- **Login** (`POST /api/auth/login`): sucesso → `action=login`; credenciais inválidas → `action=login_falhou` (com `actor_name` = o e-mail tentado, `actor_user_id` nulo se o e-mail não existe). Gravado explicitamente no handler.
- **Tentativas bloqueadas (403):** um **exception handler global** em `main.py` para `HTTPException` com `status_code == 403` grava `action=acesso_negado` com a rota e o motivo (`detail`). Assim **todo gate atual e futuro** fica coberto sem ninguém precisar lembrar.

## 4. API — `GET /api/logs` (Administrador estrito)

Router novo `backend/app/routers/logs.py`, prefixo `/logs`, dependency **`get_admin_user`** (administrador estrito — Coordenador recebe 403).

**Query params (todos opcionais):** `actor_user_id`, `action`, `entity_type`, `board_id`, `card_id`, `date_from` (date), `date_to` (date), `q` (busca `ILIKE` no `summary`), `limit` (default 50, máx 200), `offset` (default 0).

**Resposta:** `{ "total": <int>, "items": [AuditLogOut, …] }`, ordenado por `created_at DESC, id DESC`.
`AuditLogOut` expõe todos os campos da tabela, com `changes` já desserializado (objeto).

Schemas em `backend/app/schemas/audit.py`. **Não há POST/PATCH/DELETE.**

## 5. Frontend — página `/logs`

- **Rota** `/logs` dentro do `MainLayout` (em `App.tsx`), protegida.
- **Menu lateral:** item **"Logs"** visível **apenas para `role === "administrador"`**. ⚠️ O `NAV_ITEMS` hoje tem `adminOnly`, que após o perfil Coordenador significa **elevado** (admin **ou** coordenador). Portanto o item de Logs precisa de um marcador novo — `adminStrict: true` — e o filtro do nav passa a tratar os dois casos (`adminStrict` → só administrador; `adminOnly` → elevado).
- **Guarda na página:** se `role !== "administrador"` → redireciona para `/boards` (o backend também barra com 403).
- **UI:** linha do tempo/tabela com **quando · quem · o quê** (o `summary`), badge da ação e do tipo de entidade; **expandir** a linha mostra o `changes` (**de → para**) e o contexto (rota, IP). Filtros no topo (pessoa, ação, tipo, quadro, período, busca) + paginação ("Carregar mais" com `offset`).
- Tipo `AuditLog` em `types/index.ts`.

## 6. Fora de escopo (v1)

- Feed de atividade **dentro do card** (dá para fazer depois reusando os mesmos dados).
- Expurgo/retenção automática (o sistema é pequeno; guarda tudo).
- Exportar log (CSV/PDF).
- Auditar **leituras** (só escritas + acesso).

## 7. Critérios de aceite

1. **Cobertura:** criar/editar/excluir quadro, lista e card; **adicionar e remover etiqueta** do card; adicionar/remover membro; comentar; criar/excluir checklist e item; anexar/excluir anexo; criar/excluir lembrete; criar/editar/excluir automação; criar/editar-papel/excluir usuário — **cada uma gera exatamente uma linha** com o ator correto, `summary` legível e o `changes` correto.
2. **Mover card entre listas** gera uma linha `mover` com "de *Lista A* para *Lista B*".
3. **Reordenar card dentro da mesma lista** (PATCH só de `position`) **não gera nenhuma linha**.
4. **Login** OK gera `login`; senha errada gera `login_falhou`.
5. **Tentativa bloqueada** (ex.: coordenador tentando editar um administrador) gera `acesso_negado`.
6. **Integração** (upsert via `X-API-Key`) gera linhas com `actor_type=integracao` e o nome do `source`.
7. **Sobrevivência:** excluir um card **não apaga** as linhas de log dele; o `summary` continua legível (snapshot).
8. **Segurança:** `GET /api/logs` responde **403** para coordenador e para membro; 200 para administrador. Não existe endpoint de escrita no log. `password_hash` nunca aparece no `changes`.
9. **Frontend:** item "Logs" só aparece para administrador; a página lista, filtra e pagina; expandir mostra de → para.
10. `npm run build` passa; changelog **v1.3.0**.
