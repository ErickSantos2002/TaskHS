# Integração externa — espelhamento de cards

Sistemas externos (ex.: GestorHS) podem criar/atualizar/remover cards no TaskHS.
O TaskHS é um **espelho**: o sistema externo é o dono da verdade e envia o
**estado atual completo** da entidade a cada mudança (upsert idempotente).

## Autenticação

Header `X-API-Key: <chave>`. A chave fica na env `INTEGRATION_API_KEY` do
backend do TaskHS (vazia = integração desligada → 401). Use HTTPS em produção.

## `POST /api/integration/cards` — criar/atualizar/mover

Identidade do card = par `(source, external_id)`. O board e a lista são
resolvidos **por nome** (criados se não existirem). Se o card já existe e a
lista mudou, ele é **movido**.

Campos: `source`*, `external_id`*, `board`*, `list`*, `title`* (obrigatórios);
`description`, `due_date` (ISO `YYYY-MM-DD`), `priority`
(`critical|high|medium|low`, default `medium`) opcionais. Campos opcionais
omitidos não sobrescrevem o valor atual; envie `null` para limpar.

```bash
curl -X POST https://<taskhs>/api/integration/cards \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{
    "source": "gestorhs",
    "external_id": "1234",
    "board": "Ordens de Serviço",
    "list": "Laboratório",
    "title": "OS #1234 · Cliente X · Bafômetro SN-987",
    "description": "Calibração — chegada 22/06.",
    "due_date": "2026-07-10",
    "priority": "high"
  }'
```
Resposta `200`: o card serializado (inclui `id`, `list_id`, `external_source`, `external_id`).

## `DELETE /api/integration/cards` — remover

Para quando a entidade externa é excluída. Cancelar/finalizar **não** usa este
endpoint — basta enviar outra `list` no upsert (ex.: "Cancelada").

```bash
curl -X DELETE https://<taskhs>/api/integration/cards \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{ "source": "gestorhs", "external_id": "1234" }'
```
Resposta `204` (ou `404` se não houver card vinculado).

## Exemplo de mapa fase→lista (GestorHS — regra vive no GestorHS)

| Fase da OS (GestorHS) | `list` enviada |
|---|---|
| Recebido | Recebido |
| Laboratório | Laboratório |
| Pós-Vendas | Pós-Vendas |
| Preparando Retorno | Preparando Retorno |
| Finalizada | Finalizada |
| Cancelada | Cancelada |

O GestorHS chama o upsert ao abrir a OS e a cada avanço de fase/atualização,
enviando a `list` correspondente à fase atual. Recomenda-se best-effort
(logar falhas); como o upsert é idempotente, a próxima atualização reconcilia.
