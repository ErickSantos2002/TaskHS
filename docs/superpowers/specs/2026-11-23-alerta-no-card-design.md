# Alerta de atraso no modal do card — design (curto)

## Por quê
A Qualidade acompanha no Dashboard os cards há mais de 72 h úteis desde a criação
e os travados há mais de 24 h úteis na mesma lista (por setor). Ao abrir um desses
cards, ela quer ver isso no próprio modal, sem voltar ao Dashboard.

## Objetivos / não-objetivos
- Mostrar no cabeçalho do modal, ao lado de "Criado em", um selo para cada régua
  estourada: **72 h desde a criação** e **parado há X h úteis na lista (setor)**.
- Só administrador e coordenador veem — mesma regra das réguas do Dashboard
  (v2.12.1), cortada **no backend**, não só na tela. Token de agente do HS.OS não
  conta como elevado (`elevado_fora_do_agente`).
- Os números batem com o Dashboard: a regra de horas úteis e de elegibilidade é a
  mesma (lista de concluído, quadro fora do alerta, card/lista/quadro arquivado →
  fora das réguas).
- Não-objetivo: atualizar o selo em tempo real com o modal aberto; recalcula ao
  reabrir (ou ao arquivar, que já refaz o /meta).

## Abordagens
- **A (escolhida):** campo `alerta` no `GET /lists/{l}/cards/{c}/meta`, que o modal
  já chama ao abrir. `null` para não-elevado ou card fora das réguas.
- B: no JSON do card (`_card_to_dict`) — descartada: esse JSON vai pelo SSE a
  todos os membros do quadro e vazaria.
- C: calcular no navegador — descartada: duplica a regra em TS e só esconde na tela.

## Desenho
- `app/horas_uteis.py`: `reguas_do_card(created_at, list_entered_at, setor_id, agora)`
  devolve horas desde a criação, se estourou 72 h, horas na lista e se travou
  (só com setor). O loop do Dashboard passa a usar a mesma função.
- `/meta` devolve `alerta: {horas_criacao, atrasado, horas_lista, travado, setor} | null`.
- Front: selos vermelhos no cabeçalho do modal só quando `atrasado`/`travado`.
- Changelog: v2.17.0 (melhoria).
