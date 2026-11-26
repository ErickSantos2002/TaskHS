import type { Card } from "../types";

/** Ordem de uma lista com sort_mode "prazo" (v2.18.0). Devolve cópia.
 *  1. prazo pendente, do que vence antes (atrasados no topo) ao mais distante;
 *  2. depois os sem prazo e os de prazo concluído, juntos.
 *  Empate (mesmo dia, ou dentro do grupo 2) segue a ordem manual (position). */
export function ordenarPorPrazo(cards: Card[]): Card[] {
  const pendente = (c: Card) => !!c.due_date && !c.due_date_completed;
  return [...cards].sort((a, b) => {
    const pa = pendente(a), pb = pendente(b);
    if (pa !== pb) return pa ? -1 : 1;
    if (pa && pb && a.due_date !== b.due_date) return a.due_date!.localeCompare(b.due_date!);
    return a.position - b.position;
  });
}
