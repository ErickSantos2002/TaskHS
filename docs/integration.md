# Guia de integração — espelhar cards no TaskHS

Este guia tem tudo que um sistema externo (ex.: **GestorHS**) precisa para criar,
atualizar, mover e remover cards no TaskHS automaticamente. É ao mesmo tempo o
**contrato** da API e o **passo a passo** de integração.

---

## 1. Visão geral

O TaskHS expõe uma API de integração **genérica**: qualquer sistema externo pode
espelhar entidades (uma OS, um chamado, um pedido…) como **cards** em quadros do
TaskHS.

- **Direção:** o sistema externo é o **dono da verdade** e *empurra* o estado para o
  TaskHS (`externo → TaskHS`). O TaskHS é um **espelho** — ele nunca chama de volta.
- **Modelo:** a cada mudança relevante na entidade, o externo envia o **estado atual
  completo** num único endpoint de *upsert* idempotente. O TaskHS decide sozinho se
  cria, atualiza ou move o card.
- **Regra de negócio fica no externo:** o TaskHS não conhece "fases", "status" etc.
  O externo decide em qual **quadro** e **lista** (por nome) o card deve estar; o
  TaskHS obedece e cria o que faltar.

### Conceitos

| Conceito | O que é |
|---|---|
| **Quadro (board)** | Um quadro do TaskHS. Identificado **pelo nome** no payload. |
| **Lista (list)** | Uma coluna dentro do quadro. Identificada **pelo nome**, dentro do quadro. |
| **Card** | O cartão espelhado. Vinculado à entidade externa por `(source, external_id)`. |
| **`source`** | Identifica o sistema de origem (ex.: `"gestorhs"`). Namespaceia o `external_id`. |
| **`external_id`** | O id da entidade no sistema externo (string). |

A **identidade** do card é o par `(source, external_id)`. É isso que torna o upsert
idempotente: reenviar o mesmo par atualiza o mesmo card, nunca duplica.

---

## 2. Base URL e autenticação

### Base URL

- **Local/dev:** `http://localhost:8000/api`
- **Produção:** `https://<dominio-do-backend>/api` (o domínio do backend no Easypanel).

Todos os caminhos abaixo são relativos a essa base (ex.: `POST {BASE}/integration/cards`).
**Use sempre HTTPS em produção** — a API key viaja no header.

### Autenticação — API key

Toda requisição de integração exige o header:

```
X-API-Key: <a chave>
```

- A chave fica na env **`INTEGRATION_API_KEY`** do backend do TaskHS.
- Se a env estiver **vazia** (não configurada) **ou** a chave enviada **não bater**, a
  API responde **`401 Unauthorized`** — ou seja, a integração nasce **desligada** até
  alguém configurar a chave (não há fallback inseguro).
- Gerar uma chave forte: `openssl rand -hex 32`.
- **Rotacionar** = trocar o valor da env e atualizar o sistema externo. Não depende do
  `SECRET_KEY` do JWT dos usuários (são mecanismos separados).

A autenticação dos **usuários** do TaskHS (login JWT) **não** dá acesso a estes
endpoints, e a API key **não** dá acesso às rotas de usuário. São mundos separados.

---

## 3. Referência da API

### 3.1 `POST /integration/cards` — criar / atualizar / mover (upsert)

Cria o card se `(source, external_id)` ainda não existe; senão atualiza os campos e,
se a lista mudou, **move** o card. Tudo numa única transação.

**Headers:** `Content-Type: application/json`, `X-API-Key: <chave>`.

**Corpo (campos):**

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `source` | string | ✅ | Sistema de origem, ex.: `"gestorhs"`. |
| `external_id` | string | ✅ | Id da entidade no sistema externo. Aceita qualquer string. |
| `board` | string | ✅ | Nome do quadro. **Criado se não existir.** |
| `list` | string | ✅ | Nome da lista dentro do quadro. **Criada se não existir.** |
| `title` | string | ✅ | Título do card. |
| `description` | string \| null | — | Descrição (texto livre). |
| `due_date` | string (`YYYY-MM-DD`) \| null | — | Data de entrega. |
| `priority` | string \| null | — | Um de: `critical`, `high`, `medium`, `low`. Default `medium` na criação. |
| `archived` | bool \| null | — | `true` arquiva o card (some do quadro), `false` desarquiva. Omitido = não altera. |

**Exemplo:**
```bash
curl -X POST "$BASE/integration/cards" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{
    "source": "gestorhs",
    "external_id": "1234",
    "board": "Ordens de Serviço — GestorHS",
    "list": "Laboratório",
    "title": "OS #1234 · Cliente X · Bafômetro SN-987",
    "description": "Calibração — chegada em 22/06.",
    "due_date": "2026-07-10",
    "priority": "high"
  }'
```

**Resposta `200 OK`** — o card serializado. Campos principais:
```jsonc
{
  "id": 248,
  "list_id": 44,
  "title": "OS #1234 · Cliente X · Bafômetro SN-987",
  "description": "Calibração — chegada em 22/06.",
  "priority": "high",
  "position": 65536.0,
  "due_date": "2026-07-10",
  "due_date_completed": false,
  "archived": false,
  "created_at": "2026-06-22T13:05:00Z",
  "updated_at": "2026-06-22T13:05:00Z",
  "external_source": "gestorhs",
  "external_id": "1234",
  "labels": [], "members": [], "comments": [], "attachments": [], "checklists": []
}
```
Guarde o `id` se quiser, mas **você não precisa dele** para futuras chamadas — o par
`(source, external_id)` já identifica o card.

### 3.2 `DELETE /integration/cards` — remover

Para quando a entidade externa é **excluída** de vez. **Cancelar não usa este
endpoint** — mande um upsert com `"archived": true` para **arquivar** o card (some
do quadro, fica em "Arquivados"); reative com `"archived": false`. Mudança de
fase/status continua sendo só outra `list` no upsert.

**Headers:** `Content-Type: application/json`, `X-API-Key: <chave>`.

**Corpo:**
```jsonc
{ "source": "gestorhs", "external_id": "1234" }
```

```bash
curl -X DELETE "$BASE/integration/cards" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{ "source": "gestorhs", "external_id": "1234" }'
```

**Resposta `204 No Content`** (sucesso) ou **`404`** se não houver card com esse par.
Ao remover, o TaskHS limpa também as notificações e lembretes ligados ao card.

### 3.3 Códigos de status

| Código | Quando | O que fazer |
|---|---|---|
| `200` | Upsert OK. | Seguir. |
| `204` | Delete OK. | Seguir. |
| `401` | API key ausente/errada (ou `INTEGRATION_API_KEY` não setada no TaskHS). | Conferir a env e o header. |
| `404` | Delete de um `(source, external_id)` inexistente. | Tratar como "já não existe" (idempotente). |
| `422` | Payload inválido (campo obrigatório faltando, `priority`/`due_date` em formato errado). | Corrigir o payload. |
| `5xx` | Erro transitório no TaskHS. | **Repetir depois** — o upsert é idempotente, reenviar é seguro. |

---

## 4. Semântica importante

### 4.1 Idempotência

Reenviar o **mesmo** `(source, external_id)` **nunca cria card duplicado** — sempre
opera no mesmo card (garantido por uma restrição de unicidade no banco). Isso é o que
permite a estratégia "mande o estado completo a cada mudança".

### 4.2 Atualização parcial: omitir ≠ enviar `null`

No upsert de um card que **já existe**:
- **Omitir** um campo opcional (`description`, `due_date`) → o valor atual é
  **preservado** (não sobrescreve).
- Enviar o campo como **`null`** → o valor é **apagado** (definido como vazio).
- `title` é sempre aplicado (é obrigatório).
- `priority`: só muda se enviado e não-nulo. Enviar `null` em `priority` **não** limpa
  (não existe card "sem prioridade"; o default é `medium`).

> Recomendação para o sistema externo: como você é o dono da verdade, **envie sempre o
> estado completo** (todos os campos que você controla). Aí não precisa se preocupar
> com a distinção acima.

### 4.3 Mover de lista

No upsert, se a `list` resolvida for diferente da lista atual do card, ele é **movido**
para a nova lista (vai para o fim dela). É assim que você reflete uma mudança de
fase/status: basta mandar o novo nome de lista.

### 4.4 Quadro e lista por **nome** (e o cuidado com colisão)

`board` e `list` são resolvidos **pelo nome**:
- Não existe → o TaskHS **cria** (o quadro nasce sob um usuário de serviço configurado
  no TaskHS via `INTEGRATION_OWNER_ID`).
- Já existe → o TaskHS **reusa** o existente (se houver mais de um com o mesmo nome,
  usa o de menor id).

⚠️ **Atenção:** se já existir um quadro/lista com aquele nome — inclusive um criado à
mão por uma pessoa — a integração vai **reusar** esse, não criar um novo. Escolha nomes
de quadro pouco prováveis de colidir com quadros humanos (ex.: prefixe/sufixe com o
sistema: `"Ordens de Serviço — GestorHS"`). A integração só **escreve/cria**; ela nunca
lê dados de outros quadros.

### 4.5 O que a integração **não** faz

- Não move/atualiza nada de volta no sistema externo (sem sincronização reversa).
- Mover um card pela integração **não dispara** as automações do TaskHS (regras do tipo
  "quando card movido para lista X"). Integração e automações são caminhos separados.
- Não mexe em membros, etiquetas, comentários, checklists ou anexos do card (o v1 cobre
  título, descrição, data, prioridade, lista e quadro).

---

## 5. Confiabilidade e reenvio

A integração é **best-effort** no lado do sistema externo:

1. Chame o upsert quando a entidade abrir e a cada atualização relevante.
2. Se a chamada falhar (rede, `5xx`, TaskHS fora do ar), **logue e siga** — não trave
   o fluxo do seu sistema por causa do espelhamento.
3. Como o upsert é idempotente e você manda o estado completo, **a próxima atualização
   reconcilia** o que tiver falhado. Não é preciso fila nem retry sofisticado no v1.
4. Chamadas para a mesma entidade devem ser **sequenciais** (não dispare várias em
   paralelo para o mesmo `external_id` ao mesmo tempo). O TaskHS tolera corrida (não
   duplica), mas sequencial é mais simples e previsível.

---

## 6. Exemplo ponta-a-ponta (GestorHS)

A regra "fase da OS → nome da lista" vive **no GestorHS**. Exemplo de mapa:

| Fase da OS (GestorHS) | `list` enviada ao TaskHS |
|---|---|
| Recebido | `Recebido` |
| Laboratório | `Laboratório` |
| Pós-Vendas | `Pós-Vendas` |
| Preparando Retorno | `Preparando Retorno` |
| Finalizada | `Finalizada` |
| Cancelada | `Cancelada` |

Pseudo-código no GestorHS (chamar ao abrir a OS e em cada avanço/atualização):

```python
import httpx  # ou requests

TASKHS_BASE = "https://<taskhs>/api"
TASKHS_KEY  = settings.TASKHS_INTEGRATION_KEY   # env no GestorHS

FASE_PARA_LISTA = {
    4: "Recebido", 5: "Laboratório", 6: "Pós-Vendas",
    7: "Preparando Retorno", 8: "Finalizada", 9: "Cancelada",
}

def espelhar_os_no_taskhs(os):
    payload = {
        "source": "gestorhs",
        "external_id": str(os.id),
        "board": "Ordens de Serviço — GestorHS",
        "list": FASE_PARA_LISTA.get(os.fase, "Recebido"),
        "title": f"OS #{os.id} · {os.cliente_nome} · {os.equipamento_descricao or ''}".strip(" ·"),
        "description": os.obs or None,
        "due_date": os.prox_calibragem.date().isoformat() if os.prox_calibragem else None,
        "priority": "high" if os.garantia is False else "medium",
        "archived": os.fase == 9,   # 9 = Cancelada → arquiva o card
    }
    try:
        httpx.post(f"{TASKHS_BASE}/integration/cards",
                   json=payload,
                   headers={"X-API-Key": TASKHS_KEY},
                   timeout=5).raise_for_status()
    except Exception:
        logger.exception("falha ao espelhar OS %s no TaskHS (reconciliado no próximo upsert)", os.id)

def remover_os_do_taskhs(os_id):
    httpx.request("DELETE", f"{TASKHS_BASE}/integration/cards",
                  json={"source": "gestorhs", "external_id": str(os_id)},
                  headers={"X-API-Key": TASKHS_KEY}, timeout=5)
```

Onde plugar no GestorHS: na criação da OS e na transição de fase
(`os_workflow`/`avançar`), depois do commit da OS — best-effort.

---

## 7. Checklist para integrar um sistema novo

1. **No TaskHS:** gerar a chave (`openssl rand -hex 32`) e setar `INTEGRATION_API_KEY`
   nas envs do backend (Easypanel). Opcional: `INTEGRATION_OWNER_ID` (default `1`, o
   admin) para definir o dono dos quadros criados.
2. **No sistema externo:** guardar a base URL do TaskHS e a chave em config/env.
3. Escolher um `source` único (ex.: nome do sistema) e um nome de **quadro** que não
   colida com quadros humanos.
4. Definir o mapa do seu "status/fase" → nome de **lista**.
5. Montar o payload e chamar `POST /integration/cards` ao **criar** e a cada
   **atualização** da entidade; chamar `DELETE` ao **excluir**.
6. Tratar falhas como best-effort (logar e seguir); confiar na reconciliação do
   próximo upsert.
7. Testar com `curl` (seção 3) antes de ligar no fluxo real.

---

## 8. Resumo do contrato

| Item | Valor |
|---|---|
| Base URL | `{dominio}/api` |
| Auth | header `X-API-Key` (env `INTEGRATION_API_KEY`; vazio = 401) |
| Upsert | `POST /integration/cards` → `200` |
| Remover | `DELETE /integration/cards` → `204` / `404` |
| Identidade do card | `(source, external_id)` |
| Quadro/lista | por **nome**, criados se faltarem |
| Idempotente | sim — reenviar o estado completo é seguro |
