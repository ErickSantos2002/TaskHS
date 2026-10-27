import { Avatar } from "./Avatar";
import { cn } from "../lib/utils";
import type { MovimentoDia } from "../types";

// ── Ranking em barras horizontais ──────────────────────────────

export interface ItemRanking {
  id: number;
  nome: string;
  total: number;
  /** Quadro: cor da bolinha. */
  color?: string | null;
  /** Pessoa: foto/iniciais. */
  pessoa?: { name: string; initials: string; avatar_url: string | null };
}

export function RankingBarras({ titulo, subtitulo, itens, cor, vazio, onClickItem }: {
  titulo: string;
  subtitulo?: string;
  itens: ItemRanking[];
  /** Classe Tailwind da barra, ex.: "bg-primary/70". */
  cor: string;
  vazio: string;
  onClickItem?: (id: number) => void;
}) {
  const maior = Math.max(1, ...itens.map(i => i.total));
  return (
    <div className="rounded-xl bg-background-surface border border-border px-5 py-4 space-y-3 min-w-0">
      <div>
        <p className="text-sm font-semibold text-slate-300">{titulo}</p>
        {subtitulo && <p className="text-[11px] text-slate-500 mt-0.5">{subtitulo}</p>}
      </div>
      {itens.length === 0 ? (
        <p className="text-xs text-slate-500">{vazio}</p>
      ) : (
        <div className="space-y-1.5">
          {itens.map(item => {
            const conteudo = (
              <>
                <span className="w-28 sm:w-40 shrink-0 flex items-center gap-2 min-w-0 text-slate-300">
                  {item.pessoa ? (
                    <Avatar
                      user={item.pessoa}
                      className="w-5 h-5 rounded-full bg-background-elevated shrink-0 flex items-center justify-center"
                      textClassName="text-[9px] font-bold text-slate-300"
                    />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color ?? "#64748b" }} />
                  )}
                  <span className="truncate" title={item.nome}>{item.nome}</span>
                </span>
                <div className="flex-1 h-3 rounded bg-background-elevated overflow-hidden">
                  <div className={cn("h-full rounded", cor)} style={{ width: `${(item.total / maior) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-slate-400 tabular-nums">{item.total}</span>
              </>
            );
            return onClickItem ? (
              <button
                key={item.id}
                onClick={() => onClickItem(item.id)}
                className="w-full flex items-center gap-3 text-xs rounded hover:bg-background-elevated/60 transition-colors"
                title="Ver o painel deste quadro"
              >
                {conteudo}
              </button>
            ) : (
              <div key={item.id} className="flex items-center gap-3 text-xs">{conteudo}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Movimentações por dia ──────────────────────────────────────

function diaDaSemana(iso: string): number {
  // Meio-dia: evita que o fuso do navegador empurre a data para o dia anterior.
  return new Date(`${iso}T12:00:00`).getDay();
}

function formatDia(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function MovimentosPorDia({ serie }: { serie: MovimentoDia[] }) {
  const maior = Math.max(1, ...serie.map(d => d.total));
  const total = serie.reduce((s, d) => s + d.total, 0);
  return (
    <div className="rounded-xl bg-background-surface border border-border px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-300">Movimentações por dia</p>
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-300">{total}</span> cards mudados de lista no período · cinza = fim de semana
        </p>
      </div>
      <div className="flex items-end gap-[2px] h-28">
        {serie.map(d => {
          const fimDeSemana = [0, 6].includes(diaDaSemana(d.dia));
          return (
            <div
              key={d.dia}
              className="flex-1 h-full flex items-end"
              title={`${formatDia(d.dia)}: ${d.total} ${d.total === 1 ? "movimentação" : "movimentações"}`}
            >
              <div
                className={cn("w-full rounded-t-sm", fimDeSemana ? "bg-slate-600" : "bg-primary/70")}
                style={{ height: `${Math.max((d.total / maior) * 100, d.total > 0 ? 3 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      {serie.length > 0 && (
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>{formatDia(serie[0].dia)}</span>
          <span>{formatDia(serie[serie.length - 1].dia)}</span>
        </div>
      )}
    </div>
  );
}
