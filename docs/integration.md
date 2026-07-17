# Guia de integração — espelhar cards no TaskHS

Este guia tem tudo que um sistema externo (ex.: **GestorHS**) precisa para criar,
atualizar, mover e remover cards no TaskHS automaticamente. É ao mesmo tempo o
**contrato** da API e o **passo a passo** de integração.

---

## Mudou na v2 (2026-07-17)

O payload usava os **nomes** do quadro e da lista. Agora usa **`list_id`**.

Por quê: com nome, um título que não batesse fazia a API **criar um quadro novo em
silêncio**, e os cards passavam a cair nele — bastava alguém renomear a lista na tela.
Aconteceu de verdade. Com id, um id errado devolve **404** na primeira tentativa.

O que muda no seu lado:

| v1 | v2 |
|---|---|
| `{"board": "Serviço", "list": "Recebido", ...}` | `{"list_id": 42, ...}` |
| quadro/lista criados sozinhos se não existissem | **têm que existir** → senão `404` |

Os cards já criados não são afetados: eles são achados por `(source, external_id)`, que
não mudou.

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
  O externo decide em qual **lista** (pelo `list_id`) o card deve estar; o quadro vem
  junto, porque toda lista já pertence a um quadro. O TaskHS **não cria nada** — a
  lista tem que existir.

### Conceitos

| Conceito | O que é |
|---|---|
| **Quadro (board)** | Um quadro do TaskHS. Não aparece no payload — é deduzido da lista (toda lista pertence a um quadro). |
| **Lista (list)** | Uma coluna dentro de um quadro. Identificada **pelo `list_id`** no payload; tem que existir e não estar arquivada. |
| **Card** | O cartão espelhado. Vinculado à entidade externa por `(source, external_id)`. |
| **`source`** | Identifica o sistema de origem (ex.: `"gestorhs"`). Namespaceia o `external_id`. |
| **`external_id`** | O id da entidade no sistema externo (string). |

A **identidade** do card é o par `(source, external_id)`. É isso que torna o upsert
idempotente: reenviar o mesmo par atualiza o mesmo card, nunca duplica.

---

## Como descobrir o `list_id`

Abra o quadro no TaskHS e use a API, com o seu **token de usuário** (login normal — não
é a API key de integração):

```bash
curl -s "$BASE/boards" \
  -H "Authorization: Bearer $SEU_TOKEN"          # acha o id do quadro

curl -s "$BASE/boards/<BOARD_ID>/lists" \
  -H "Authorization: Bearer $SEU_TOKEN"          # id e título de cada lista
```

Anote os ids no seu lado. Eles não mudam quando alguém renomeia a lista na tela — é
justamente por isso que a v2 usa id.

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
| `list_id` | int | ✅ | Id da lista onde o card deve ficar; o quadro é deduzido dela. A lista **tem que existir** e não estar arquivada — senão `404`. |
| `title` | string | ✅ | Título do card. |
| `description` | string \| null | — | Descrição (texto livre). A integração não escreve mais aqui — campo livre do usuário (ver §4.5). |
| `due_date` | string (`YYYY-MM-DD`) \| null | — | Data de entrega. |
| `priority` | string \| null | — | Um de: `critical`, `high`, `medium`, `low`. Default `medium` na criação. |
| `archived` | bool \| null | — | `true` arquiva o card (some do quadro), `false` desarquiva. `null` ou omitido = não altera. |
| `obs1` … `obs6` | string \| null | — | Texto de uma etapa/observação. Exibido no card **só se** o quadro tiver a integração ligada e a obs correspondente nomeada. Mesma regra de update parcial do `description` (omitir preserva; `null` limpa). |

**Exemplo:**
```bash
curl -X POST "$BASE/integration/cards" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{
    "source": "gestorhs",
    "external_id": "1234",
    "list_id": 44,
    "title": "OS #1234 · Cliente X · Bafômetro SN-987",
    "obs1": "chegou 17/07",
    "obs2": "em análise",
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
  "description": null,
  "obs1": "chegou 17/07", "obs2": "em análise", "obs3": null,
  "obs4": null, "obs5": null, "obs6": null,
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
fase/status continua sendo só outro `list_id` no upsert.

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
| `404` | Delete de um `(source, external_id)` inexistente **ou** upsert com `list_id` que não existe (ou está arquivada). | No delete, tratar como "já não existe" (idempotente). No upsert, é erro de configuração do seu lado — confira o `list_id`. |
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
- `obs1`…`obs6` seguem a mesma regra: omitir preserva o valor atual, `null` limpa.

> Recomendação para o sistema externo: como você é o dono da verdade, **envie sempre o
> estado completo** (todos os campos que você controla). Aí não precisa se preocupar
> com a distinção acima.

### 4.3 Mover de lista

No upsert, se o `list_id` for diferente da lista atual do card, ele é **movido** para
a nova lista (vai para o fim dela). É assim que você reflete uma mudança de
fase/status: basta mandar o novo `list_id`. Se a nova lista for de **outro quadro**, o
card muda de quadro junto — e membros, etiquetas e lembretes que não existem no quadro
de destino são removidos do card (a mesma limpeza que acontece quando isso é feito pela
tela).

### 4.4 A lista tem que existir — a integração não cria nada

`list_id` é resolvido direto pelo id, sem heurística de nome e sem criação automática:
- Não existe (id errado, ou nunca criado) → `404 Lista não encontrada`.
- Existe mas está **arquivada** → também `404`. Do ponto de vista da integração,
  arquivada é como não existir: some das listagens do quadro, das stats e não é card
  arquivado (o único tipo que aparece no modal de "Arquivados").
- Existe e ativa → o TaskHS usa essa lista, ponto — sem ambiguidade de nome, sem chance
  de reusar ou colidir com um quadro criado à mão.

Isso é proposital: no v1 (por nome), um título que não batesse fazia o TaskHS **criar
um quadro novo em silêncio**, e os cards passavam a cair nele — bastava alguém
renomear a lista na tela. Aconteceu de verdade. Com id, o erro é imediato e alto
(`404`), não um quadro fantasma.

### 4.5 O que a integração **não** faz

- Não cria quadro nem lista — eles têm que existir previamente no TaskHS (seção 4.4).
- Não move/atualiza nada de volta no sistema externo (sem sincronização reversa).
- Mover um card pela integração **não dispara** as automações do TaskHS (regras do tipo
  "quando card movido para lista X"). Integração e automações são caminhos separados.
- Não mexe em membros, etiquetas, comentários, checklists ou anexos do card (esta
  versão cobre título, data, prioridade, lista e as observações `obs1…obs6`).
- **A descrição não é mais usada pela integração.** Ela passou a ser campo livre do
  usuário; os dados de cada etapa vão nas obs (`obs1…obs6`). Nomeie as obs e ligue o
  toggle "Este quadro recebe informações de integração?" nas Configurações do quadro.

---

## 5. Confiabilidade e reenvio

A integração é **best-effort** no lado do sistema externo:

1. Chame o upsert quando a entidade abrir e a cada atualização relevante.
2. Se a chamada falhar (rede, `5xx`, TaskHS fora do ar), **logue e siga** — não trave
   o fluxo do seu sistema por causa do espelhamento.
3. Como o upsert é idempotente e você manda o estado completo, **a próxima atualização
   reconcilia** o que tiver falhado. Não é preciso fila nem retry sofisticado por enquanto.
4. Chamadas para a mesma entidade devem ser **sequenciais** (não dispare várias em
   paralelo para o mesmo `external_id` ao mesmo tempo). O TaskHS tolera corrida (não
   duplica), mas sequencial é mais simples e previsível.

---

## 6. Exemplo ponta-a-ponta (GestorHS)

A regra "fase da OS → lista" vive **no GestorHS**. Exemplo de mapa (os `list_id` abaixo
são ilustrativos — descubra os reais do seu quadro como na seção "Como descobrir o
`list_id`"):

| Fase da OS (GestorHS) | `list_id` enviado ao TaskHS |
|---|---|
| Recebido | `101` |
| Laboratório | `102` |
| Pós-Vendas | `103` |
| Preparando Retorno | `104` |
| Finalizada | `105` |
| Cancelada | `106` |

Pseudo-código no GestorHS (chamar ao abrir a OS e em cada avanço/atualização):

```python
import httpx  # ou requests

TASKHS_BASE = "https://<taskhs>/api"
TASKHS_KEY  = settings.TASKHS_INTEGRATION_KEY   # env no GestorHS

FASE_PARA_LIST_ID = {
    4: 101, 5: 102, 6: 103,
    7: 104, 8: 105, 9: 106,
}

def espelhar_os_no_taskhs(os):
    payload = {
        "source": "gestorhs",
        "external_id": str(os.id),
        "list_id": FASE_PARA_LIST_ID.get(os.fase, 101),
        "title": f"OS #{os.id} · {os.cliente_nome} · {os.equipamento_descricao or ''}".strip(" ·"),
        "obs1": os.obs_recebido or None,
        "obs2": os.obs_laboratorio or None,
        "obs3": os.obs_pos_vendas or None,
        "obs4": os.obs_financeiro or None,
        "obs5": os.obs_preparando_retorno or None,
        "obs6": os.obs_finalizado or None,
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
   nas envs do backend (Easypanel).
2. **No sistema externo:** guardar a base URL do TaskHS e a chave em config/env.
3. **No TaskHS:** criar (ou escolher) o quadro e as listas de destino — a integração
   não cria nada — e descobrir os `list_id` de cada uma (seção "Como descobrir o
   `list_id`").
4. Escolher um `source` único (ex.: nome do sistema).
5. Definir o mapa do seu "status/fase" → `list_id`.
6. Montar o payload e chamar `POST /integration/cards` ao **criar** e a cada
   **atualização** da entidade; chamar `DELETE` ao **excluir**.
7. Tratar falhas como best-effort (logar e seguir); confiar na reconciliação do
   próximo upsert.
8. Testar com `curl` (seção 3) antes de ligar no fluxo real.

---

## 8. Resumo do contrato

| Item | Valor |
|---|---|
| Base URL | `{dominio}/api` |
| Auth | header `X-API-Key` (env `INTEGRATION_API_KEY`; vazio = 401) |
| Upsert | `POST /integration/cards` → `200` |
| Remover | `DELETE /integration/cards` → `204` / `404` |
| Identidade do card | `(source, external_id)` |
| Lista (e quadro) | por **`list_id`**; a lista tem que existir e não estar arquivada (senão `404`) |
| Idempotente | sim — reenviar o estado completo é seguro |
