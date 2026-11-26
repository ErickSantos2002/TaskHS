# Ordenar lista por prazo — design (v2.18.0)

## Por quê

Hoje toda lista segue a **ordem manual** (`Card.position`): card novo no fim,
drag & drop reposiciona, "Mover para…" põe no topo. O time gosta assim. Uma
pessoa, numa lista específica, quer ver no topo os cards que vencem antes.

## Objetivo

Opção **por lista**, ligada por administrador/coordenador, que ordena os cards
pelo prazo (`due_date`). Todas as outras listas continuam exatamente como hoje.

**Não-objetivos:** outros critérios (prioridade, criação), ordenação por quadro
ou por usuário, ordenação em outras telas (Meus cards, Dashboard).

**Anti-objetivo:** perder a ordem manual. Desligar a opção devolve a lista como
estava.

## Abordagens

1. **Ordenar na tela (escolhida).** O banco guarda só o modo da lista; o
   navegador ordena ao desenhar. Pega card novo, prazo editado e eventos SSE
   sem nada novo no servidor.
2. Ordenar no servidor — descartada: a tela não recarrega os cards após o
   snapshot, então SSE/edição colocariam o card no lugar errado; a tela teria
   que ordenar de qualquer jeito.
3. Regravar `position` na ordem do prazo — descartada: destrói a ordem manual e
   precisaria repetir a cada mudança de prazo.

## Design

- **Banco:** migration `019_list_sort_mode.sql` —
  `ALTER TABLE lists ADD COLUMN IF NOT EXISTS sort_mode VARCHAR(10) NOT NULL DEFAULT 'manual'`.
  Valores: `manual` | `prazo`. Coluna no model `List`; `ListUpdate` aceita
  (`Literal["manual","prazo"] | None`); `ListOut` devolve. O `PATCH` da lista
  já exige elevado (`get_elevated_user`). Conferir que snapshot/SSE de lista
  levam o campo novo.
- **Menu ⋯ da lista** (já só elevado): item "Ordenar por prazo" que alterna
  `manual` ↔ `prazo`, com marca quando ativo.
- **Cabeçalho da lista** (todos veem, quando `prazo`): selo pequeno "Ordenada
  por prazo".
- **Regra de ordenação** (função pura no front, aplicada só em lista `prazo`):
  1. cards com `due_date` e `due_date_completed = false`, por `due_date`
     crescente (atrasados ficam no topo naturalmente);
  2. depois concluídos e sem prazo, juntos;
  3. empate (mesmo dia, ou grupo 2) → `position`.
- **Drag & drop numa lista `prazo`:** arrastar para **outra** lista funciona
  normal. Dentro da própria lista não reordena: soltar entre cards não
  altera `position` nem envia PATCH. Card que **chega** de outra lista
  calcula `position` como hoje (para o caso de desligarem a opção) e aparece
  no lugar do prazo.
- **Changelog:** v2.18.0, `melhoria`.

## Restrições

- Migrations rodam no boot e dev usa o banco de produção: não subir o backend
  local com a migration antes do deploy (ou aplicar a migration conscientemente).
- Sem suíte de testes no front: verificação manual + `npm run build`.

## Fica para o implementador

Texto exato do item de menu/selo, ícone, e como desligar o reordenamento
interno no dnd-kit (ex.: tratar no `onDragOver`/`onDragEnd`).
