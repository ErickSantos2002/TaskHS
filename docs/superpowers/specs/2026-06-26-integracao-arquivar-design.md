# Integração — arquivar card via upsert — Design

**Data:** 2026-06-26
**Status:** Aprovado
**Contexto:** Extensão pequena da API de integração externa (ver [2026-06-22-integracao-externa-design.md](2026-06-22-integracao-externa-design.md) e [docs/integration.md](../../integration.md)). Hoje o GestorHS espelha uma OS como card via `POST /api/integration/cards`. Quando uma OS é **cancelada**, queremos **arquivar** o card no TaskHS (some do quadro, fica em "Arquivados") em vez de mantê-lo numa lista "Cancelada". O `Card.archived` (bool, default `false`) já existe; a UI de arquivar só faz `card.archived = True`.

## Decisão (com o Erick)

Abordagem **A**: adicionar um campo opcional `archived` ao payload do **upsert** (não criar endpoint novo). Consistente com o modelo idempotente "mande o estado completo"; dá arquivar **e** desarquivar pelo mesmo caminho.

## Mudança

### 1. Schema — `IntegrationCardIn`
Adicionar campo opcional em `backend/app/schemas/integration.py`:
```python
    archived: bool | None = None
```

### 2. Aplicação no upsert — `backend/app/routers/integration.py`
- **Card novo (create):** setar `archived=body.archived or False` (omitido → `False`, default do modelo).
- **Card existente (update, em `_apply_updates`):** se `"archived" in sent`, `card.archived = body.archived`. Omitir não mexe no estado atual.
- Vale tanto no caminho normal de update quanto na recuperação de `IntegrityError` (ambos passam por `_apply_updates`, então um ponto só).
- O upsert continua resolvendo board/lista e movendo normalmente; `archived` é ortogonal (um card arquivado ainda tem `list_id`). O `_card_to_dict` já expõe `archived` na resposta.

### 3. Comportamento esperado
- `archived: true` → arquiva o card (some do quadro; visível em "Arquivados").
- `archived: false` → desarquiva (reaparece no quadro) — para OS reativada.
- Campo **omitido** → `archived` inalterado.
- `list` continua **obrigatório** (o card mora numa lista mesmo arquivado). No cancelamento o GestorHS manda `archived: true` + a lista que preferir (ex.: a última fase ativa); o card fica oculto de qualquer forma.

### 4. Documentação e changelog
- `docs/integration.md`: adicionar `archived` à tabela de campos do upsert; uma nota curta "Cancelar/arquivar" (mandar `archived: true` no upsert; reativar = `archived: false`) substituindo/complementando a orientação atual de "mandar outra lista"; atualizar o pseudo-código do GestorHS para, no cancelamento, enviar `archived: true`.
- Changelog: entrada **v1.1.1** (`melhoria`) em `frontend/src/data/changelog.ts`.

## Fora de escopo
- Nenhum endpoint novo. Sem mudança no `DELETE` (continua para exclusão definitiva da entidade).
- Sem mexer em members/labels/comments/checklists/anexos.

## Critérios de aceite
1. Upsert de um card existente com `archived: true` → `archived` vira `true` (resposta e banco); o card some do quadro na UI.
2. Upsert com `archived: false` → `archived` vira `false` (desarquiva).
3. Upsert **sem** o campo `archived` → não altera o `archived` atual (nem para card já arquivado).
4. Upsert de card **novo** com `archived: true` → criado já arquivado; sem o campo → criado com `archived: false`.
5. A resposta do upsert inclui `archived` com o valor correto.
6. `docs/integration.md` documenta o campo + o fluxo cancelar→arquivar; changelog v1.1.1 presente; `npm run build` passa.
