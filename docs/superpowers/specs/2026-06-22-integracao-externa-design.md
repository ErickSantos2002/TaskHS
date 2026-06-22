# Integração externa (espelhamento de cards) — Design

**Data:** 2026-06-22
**Status:** Aprovado
**Contexto:** A Health & Safety quer que sistemas externos — começando pelo **GestorHS** (gestão de calibração + Ordens de Serviço, também FastAPI/Postgres) — criem e atualizem cards no TaskHS automaticamente. Caso de uso inicial: quando uma OS é aberta no GestorHS, abrir um card no TaskHS com os dados da OS; quando a OS avança de fase ou muda, atualizar/mover o card. O GestorHS é o **dono da verdade**; o TaskHS é um **espelho**. O fluxo é **externo → TaskHS** (o sistema externo chama a API do TaskHS).

Decisão de arquitetura central: a API é **genérica**, não específica do GestorHS. O payload carrega **quadro + lista por nome**, então qualquer sistema externo pode espelhar cards em qualquer quadro/lista. A regra de negócio (ex.: fase da OS → nome da lista) vive **no sistema externo**, não no TaskHS.

## Escopo

**Neste spec (lado TaskHS):** a API de entrada — autenticação por API key, endpoint de upsert idempotente, endpoint de remoção, vínculo externo no `Card`, criação sob demanda de quadro/lista, e um documento de contrato.

**Fora deste spec:** as chamadas de saída no GestorHS (feitas no repo do GestorHS, depois), sincronização reversa (TaskHS→GestorHS), tempo real/websocket.

## Decisões (definidas com o Erick)

| Tema | Decisão |
|------|---------|
| Direção | Externo → TaskHS (push). TaskHS é espelho. |
| Autenticação | **API key estática** via header `X-API-Key` (env `INTEGRATION_API_KEY`). Separada do JWT de usuário. |
| Sincronização | **Upsert idempotente** — o externo manda o estado completo; o TaskHS cria/atualiza/move sozinho. |
| Quadro/lista | **Genérico** — o payload traz `board` e `list` por **nome**; o TaskHS cria se não existirem. |
| Vínculo | `Card.external_source` + `Card.external_id` (únicos juntos). |
| Remoção | Endpoint `DELETE` por `(source, external_id)`. Cancelar/finalizar é só mandar outra lista no upsert. |
| Dono dos boards criados | Usuário de serviço por env `INTEGRATION_OWNER_ID` (default `1`, o admin). |
| Confiabilidade | Best-effort no externo; o upsert idempotente reconcilia o que falhar. Sem fila/retry no v1. |

## 1. Banco — campos novos no `Card`

Adicionar a `backend/app/models/card.py` (classe `Card`):
- `external_source: Mapped[str | None]` (`String(50)`, nullable) — ex.: `"gestorhs"`.
- `external_id: Mapped[str | None]` (`String(100)`, nullable) — id da entidade no sistema externo (string, pra aceitar qualquer formato).
- **Restrição única composta** `UniqueConstraint("external_source", "external_id", name="uq_card_external")` — garante um card por entidade externa. (Cards normais têm ambos `NULL`; Postgres permite múltiplos `NULL` numa unique composta, então cards normais não conflitam.)

`create_all` **não altera tabelas existentes** (ver CLAUDE.md). Como a tabela `cards` já existe, é preciso uma migração SQL manual em `backend/migrations/` (ex.: `002_card_external_ref.sql`) com `ALTER TABLE cards ADD COLUMN ...` e o `ALTER TABLE ... ADD CONSTRAINT`, rodada via psql no banco remoto.

`_card_to_dict` (serialização em `routers/cards.py`) passa a expor `external_source`/`external_id` (informativo; não quebra nada).

## 2. Autenticação — API key

- Env nova em `backend/app/core/config.py`: `INTEGRATION_API_KEY: str = ""` e `INTEGRATION_OWNER_ID: int = 1`.
- Dependency nova em `backend/app/dependencies.py`: `require_integration_key` — lê o header `X-API-Key`; se `INTEGRATION_API_KEY` estiver vazio (não configurado) **ou** não bater, responde **401**. (Sem fallback inseguro: integração desligada por padrão até a env ser setada.)
- Os endpoints de integração usam **só** essa dependency (não `get_current_user`).

## 3. Endpoint upsert — `POST /api/integration/cards`

Router novo `backend/app/routers/integration.py`, prefixo `/integration`, registrado em `main.py` com prefixo `/api`. Dependency `require_integration_key`.

**Payload** (`IntegrationCardIn`, schema em `backend/app/schemas/integration.py`):
```jsonc
{
  "source": "gestorhs",            // obrigatório
  "external_id": "1234",            // obrigatório (string)
  "board": "Ordens de Serviço",     // obrigatório — nome; cria se não existir
  "list": "Laboratório",            // obrigatório — nome; cria na board se não existir
  "title": "OS #1234 · Cliente X",  // obrigatório
  "description": "…",               // opcional
  "due_date": "2026-07-10",         // opcional (date ISO)
  "priority": "high"                // opcional — critical|high|medium|low (default medium)
}
```

**Lógica (uma transação):**
1. Resolve a board pelo `board` (nome). Não existe → cria `Board(title=board, owner_id=INTEGRATION_OWNER_ID)`. (Match por título exato; se houver mais de uma com o mesmo nome, usa a de menor `id`.)
2. Resolve a lista pelo `list` (nome) **dentro** dessa board. Não existe → cria `List(board_id, title=list, position=<fim>)`.
3. Procura `Card` por `(external_source=source, external_id=external_id)`.
   - **Não existe:** cria o card na lista resolvida com `title`/`description`/`due_date`/`priority`, `position=<fim da lista>`, e grava `external_source`/`external_id`.
   - **Existe:** atualiza `title`/`description`/`due_date`/`priority`; se a lista resolvida ≠ `card.list_id`, **move** (`card.list_id = nova`, `position=<fim>`).
4. Commit. Retorna `200` com o card serializado (inclui `id`, `list_id`, `external_*`).

**Observações:**
- `priority` inválida → `422` (validação Pydantic contra o enum `Priority`).
- Campos opcionais omitidos no update **não apagam** o que já existe? Decisão: como o externo manda o **estado completo**, o upsert aplica os campos enviados; `description`/`due_date` ausentes são tratados como "não informado" e **não** sobrescrevem. (Pydantic com `exclude_unset` distingue ausente de `null`.) Para limpar um campo, o externo envia `null` explicitamente.
- A criação aqui **não dispara** o loop de automações nem reusa o `update_card`; é caminho próprio. (Mover via integração não aciona as automações de "card movido para lista" do v1 — fora de escopo; evita efeitos cruzados inesperados.)

## 4. Endpoint remoção — `DELETE /api/integration/cards`

Mesma dependency. Body `IntegrationCardRef` `{ source, external_id }`.
- Procura o card por `(source, external_id)`. Não existe → `404`.
- Existe → apaga, **limpando antes** `Notification`/`Reminder`/`ReminderSent`/`Automation` por `card_id` (mesma limpeza do `delete_card` atual, senão FK 500). Retorna `204`.

## 5. Contrato — `docs/integration.md`

Documento com: visão geral (externo → TaskHS, espelho), autenticação (`X-API-Key`, como setar `INTEGRATION_API_KEY`), os dois endpoints com payloads e exemplos `curl` completos, semântica de idempotência (upsert por `source`+`external_id`), e um exemplo de mapa fase→lista do GestorHS (ilustrativo, já que essa regra vive no GestorHS). Serve pra ligar o GestorHS e futuros sistemas.

## 6. Critérios de aceite

1. `POST /api/integration/cards` sem/with header `X-API-Key` errado → `401`; com a key certa → funciona.
2. Primeiro upsert de uma `(source, external_id)` nova, com board/lista inexistentes → cria a board, a lista e o card; retorna `200` com o card.
3. Segundo upsert da **mesma** `(source, external_id)` com `list` diferente → **move** o card para a nova lista (não cria card novo) e atualiza os campos.
4. Upsert mudando `title`/`due_date`/`priority` → reflete no card; campos opcionais omitidos não apagam os existentes; enviar `null` limpa.
5. `priority` inválida → `422`.
6. `DELETE /api/integration/cards` com `(source, external_id)` existente → `204` e o card some (sem erro de FK, notifications/reminders/automations limpos); inexistente → `404`.
7. Cards normais (sem `external_*`) continuam funcionando; múltiplos cards normais coexistem (a unique composta não conflita com vários `NULL`).
8. `docs/integration.md` descreve auth + os dois endpoints com exemplos `curl` que batem com a implementação.
