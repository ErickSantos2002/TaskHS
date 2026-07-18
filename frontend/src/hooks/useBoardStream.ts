import { useEffect, useRef } from "react";
import { api, API_BASE } from "../lib/api";

/** Abre um EventSource por quadro, autenticado por ticket efemero, com
 *  reconexao MANUAL (pega ticket novo a cada tentativa — o auto-reconnect
 *  nativo reabriria a mesma URL com ticket vencido). */
export function useBoardStream(
  boardId: number,
  onEvent: (evt: any) => void,
  onOpen: () => void,
) {
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  onEventRef.current = onEvent;
  onOpenRef.current = onOpen;

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let backoff = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      if (stopped) return;
      try {
        const { ticket } = await api.post<{ ticket: string }>(`/boards/${boardId}/stream-ticket`, {});
        if (stopped) return;
        es = new EventSource(`${API_BASE}/boards/${boardId}/stream?ticket=${encodeURIComponent(ticket)}`);
        es.onopen = () => { backoff = 1000; onOpenRef.current(); };
        es.onmessage = (m) => { try { onEventRef.current(JSON.parse(m.data)); } catch { /* ignora */ } };
        es.onerror = () => {
          es?.close(); es = null;
          if (stopped) return;
          timer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 10000);
        };
      } catch {
        if (stopped) return;
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      }
    }
    connect();
    return () => { stopped = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [boardId]);
}
