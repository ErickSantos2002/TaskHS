import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DashboardAtrasado } from "../types";

// "4d 6h" em dias úteis de 24 h; abaixo de um dia, só as horas.
function formatTempoUtil(horas: number): string {
  const dias = Math.floor(horas / 24);
  const resto = Math.floor(horas % 24);
  if (dias === 0) return `${resto}h`;
  return resto ? `${dias}d ${resto}h` : `${dias}d`;
}

function formatCriado(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const selectCls = "text-xs bg-background-elevated rounded-lg border border-border px-2 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 max-w-[12rem]";

export function AtrasadosModal({ atrasados, mostrarQuadro, onClose }: {
  atrasados: DashboardAtrasado[];
  mostrarQuadro: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [quadro, setQuadro] = useState("");
  const [lista, setLista] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const quadros = useMemo(
    () => [...new Map(atrasados.map(a => [String(a.board_id), a.board_title])).entries()],
    [atrasados],
  );
  // Com um quadro escolhido, o filtro de lista só oferece as listas dele.
  const listas = useMemo(
    () => [...new Map(
      atrasados.filter(a => !quadro || String(a.board_id) === quadro).map(a => [String(a.list_id), a.list_title]),
    ).entries()],
    [atrasados, quadro],
  );
  // O backend já manda do mais antigo para o mais novo.
  const visiveis = atrasados.filter(a =>
    (!quadro || String(a.board_id) === quadro) && (!lista || String(a.list_id) === lista),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-border bg-background-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-100">
              {atrasados.length} {atrasados.length === 1 ? "card há" : "cards há"} mais de 72 h úteis
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Contando só dias de semana, desde a criação do card. Cards em listas de concluído ficam de fora.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mostrarQuadro && (
              <select value={quadro} onChange={e => { setQuadro(e.target.value); setLista(""); }} className={selectCls}>
                <option value="">Quadro: todos</option>
                {quadros.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
              </select>
            )}
            <select value={lista} onChange={e => setLista(e.target.value)} className={selectCls}>
              <option value="">Lista: todas</option>
              {listas.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </select>
            <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-16rem)] overflow-auto px-6 py-4">
          {visiveis.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">Nenhum card passou de 72 h úteis.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-3 font-semibold">Card</th>
                  {mostrarQuadro && <th className="pb-2 pr-3 font-semibold">Quadro</th>}
                  <th className="pb-2 pr-3 font-semibold">Lista atual</th>
                  <th className="pb-2 pr-3 font-semibold whitespace-nowrap">Criado em</th>
                  <th className="pb-2 pr-3 font-semibold whitespace-nowrap">Tempo útil</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map(a => (
                  <tr key={a.card_id} className="border-t border-border/60">
                    <td className="py-2 pr-3 text-slate-200 max-w-xs truncate" title={a.title}>{a.title}</td>
                    {mostrarQuadro && <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{a.board_title}</td>}
                    <td className="py-2 pr-3 text-slate-400 max-w-[14rem] truncate" title={a.list_title}>{a.list_title}</td>
                    <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{formatCriado(a.created_at)}</td>
                    <td className="py-2 pr-3 font-semibold text-red-400 whitespace-nowrap">{formatTempoUtil(a.horas_uteis)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => navigate(`/boards/${a.board_id}?card=${a.card_id}&list=${a.list_id}`)}
                        className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                      >
                        Abrir ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
