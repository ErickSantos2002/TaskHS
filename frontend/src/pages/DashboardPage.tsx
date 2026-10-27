import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "../lib/utils";
import { AtrasadosModal } from "../components/AtrasadosModal";
import { MovimentosPorDia, RankingBarras, type ItemRanking } from "../components/DashboardGraficos";
import type { BoardListItem, DashboardData, PeriodoDashboard } from "../types";

const PERIODOS: PeriodoDashboard[] = [7, 30, 90];

// ── Types ──────────────────────────────────────────────────────


// ── Icons ──────────────────────────────────────────────────────

const ICards = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);
const ICheck = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const IArrow = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);
const IList = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const IArchive = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);
const IAlert = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── Helpers ────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatDate(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ── Stat Card ──────────────────────────────────────────────────

function StatCard({ label, value, icon, color, sub }: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-background-surface border border-border p-5 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold text-slate-100 leading-none">
          {value === undefined ? <span className="w-8 h-6 rounded bg-background-elevated animate-pulse inline-block" /> : value}
        </p>
        <p className="text-xs text-slate-500 mt-1 font-medium">{label}</p>
        {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Alerta de 72 h úteis ───────────────────────────────────────

function AlertaAtrasados({ valor, onClick }: { valor: number | undefined; onClick: () => void }) {
  const tem = !!valor;
  return (
    <button
      onClick={onClick}
      disabled={valor === undefined}
      className={cn(
        "w-full text-left rounded-xl border p-5 flex items-center gap-4 transition-colors",
        tem
          ? "bg-red-500/10 border-red-500/40 hover:bg-red-500/15"
          : "bg-background-surface border-border hover:border-primary/40",
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
        tem ? "bg-red-500/20 text-red-400" : "bg-slate-700/40 text-slate-500",
      )}>
        <IAlert />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-3xl font-extrabold leading-none", tem ? "text-red-400" : "text-slate-100")}>
          {valor === undefined ? <span className="w-10 h-7 rounded bg-background-elevated animate-pulse inline-block" /> : valor}
        </p>
        <p className="text-sm text-slate-300 mt-1 font-semibold">Cards há mais de 72 h úteis</p>
        <p className="text-[11px] text-slate-500 mt-0.5">Desde a criação, só dias de semana, fora das listas de concluído</p>
      </div>
      <span className="text-xs font-semibold text-primary shrink-0 hidden sm:flex items-center gap-1">Ver cards <IArrow /></span>
    </button>
  );
}

// ── Travados por setor (24 h úteis na mesma lista) ─────────────

function TravadosPorSetor({ setores, onClickSetor }: {
  setores: DashboardData["travados_por_setor"] | undefined;
  onClickSetor: (setorId: number) => void;
}) {
  const maior = Math.max(1, ...(setores ?? []).map(s => s.total));
  return (
    <div className="rounded-xl bg-background-surface border border-border px-5 py-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-300">Travados por setor (24 h úteis na lista)</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Cards parados há mais de 24 h úteis na mesma lista, somados pelo setor da lista
        </p>
      </div>
      {setores === undefined ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-3 rounded bg-background-elevated animate-pulse" />)}
        </div>
      ) : setores.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nenhuma lista com setor. Marque o setor das listas no drawer do quadro.
        </p>
      ) : (
        <div className="space-y-1.5">
          {setores.map(s => {
            const tem = s.total > 0;
            return (
              <button
                key={s.setor_id}
                onClick={() => onClickSetor(s.setor_id)}
                disabled={!tem}
                className={cn(
                  "w-full flex items-center gap-3 text-xs rounded transition-colors",
                  tem ? "hover:bg-background-elevated/60" : "cursor-default",
                )}
              >
                <span className={cn("w-28 sm:w-40 shrink-0 truncate text-left", tem ? "text-slate-300" : "text-slate-500")} title={s.nome}>
                  {s.nome}
                </span>
                <div className="flex-1 h-3 rounded bg-background-elevated overflow-hidden">
                  {tem && <div className="h-full rounded bg-red-500/80" style={{ width: `${(s.total / maior) * 100}%` }} />}
                </div>
                <span className={cn("w-10 shrink-0 text-right tabular-nums", tem ? "font-semibold text-red-400" : "text-slate-500")}>
                  {s.total}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Cards por lista ────────────────────────────────────────────

function BarrasPorLista({ listas }: { listas: DashboardData["listas"] }) {
  const maior = Math.max(1, ...listas.map(l => l.total));
  return (
    <div className="rounded-xl bg-background-surface border border-border px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-300">Cards por lista</p>
        <p className="text-[11px] text-slate-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 align-middle mr-1" />acima de 72 h úteis
          <span className="mx-2">·</span>✓ lista de concluído
        </p>
      </div>
      {listas.length === 0 ? (
        <p className="text-xs text-slate-500">Este quadro não tem listas.</p>
      ) : (
        <div className="space-y-1.5">
          {listas.map(l => (
            <div key={l.id} className="flex items-center gap-3 text-xs">
              <span className="w-32 sm:w-56 shrink-0 truncate text-slate-300" title={l.title}>
                {l.is_done && <span className="text-primary mr-1">✓</span>}{l.title}
              </span>
              <div className="flex-1 h-3 flex rounded bg-background-elevated overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${((l.total - l.atrasados) / maior) * 100}%` }} />
                <div className="h-full bg-red-500" style={{ width: `${(l.atrasados / maior) * 100}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-slate-400 tabular-nums">
                {l.total}{l.atrasados > 0 && <span className="text-red-400"> ({l.atrasados})</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DashboardPage ──────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashCarregado, setDash] = useState<DashboardData | null>(null);
  const [verAtrasados, setVerAtrasados] = useState(false);
  const [setorAberto, setSetorAberto] = useState<number | null>(null);

  useEffect(() => {
    api.get<BoardListItem[]>("/boards")
      // /boards devolve todos os quadros da empresa (vitrine com cadeado é a
      // /boards). Aqui é o painel pessoal: só os que a pessoa pode abrir.
      .then(b => setBoards(b.filter(board => board.can_open)))
      .finally(() => setLoading(false));
  }, []);

  // Quadro (?board=) e período (?periodo=) moram na URL, para F5 e link
  // compartilhado. Quadro que a pessoa não abre vira "Todos os quadros";
  // período fora de 7/30/90 vira 30.
  const boardParam = searchParams.get("board");
  const selecionado = boards.find(b => String(b.id) === boardParam) ?? null;
  const boardId = selecionado?.id ?? null;
  const periodoParam = Number(searchParams.get("periodo"));
  const periodo: PeriodoDashboard = PERIODOS.includes(periodoParam as PeriodoDashboard)
    ? periodoParam as PeriodoDashboard
    : 30;

  useEffect(() => {
    if (!loading && boardParam && !selecionado) {
      setSearchParams(p => { p.delete("board"); return p; }, { replace: true });
    }
  }, [loading, boardParam, selecionado, setSearchParams]);

  useEffect(() => {
    if (loading) return;
    let vigente = true;
    const qs = new URLSearchParams({ periodo: String(periodo) });
    if (boardId) qs.set("board_id", String(boardId));
    api.get<DashboardData>(`/dashboard?${qs}`)
      .then(d => { if (vigente) setDash(d); })
      .catch(() => {});
    // Troca rápida de quadro/período: a resposta anterior não sobrescreve a atual.
    return () => { vigente = false; };
  }, [loading, boardId, periodo]);

  // Enquanto chega o do quadro/período novo, o painel anterior não aparece.
  const dash = dashCarregado && dashCarregado.board_id === boardId && dashCarregado.periodo === periodo
    ? dashCarregado : null;

  function mudarParam(chave: string, valor: string | null) {
    setVerAtrasados(false);
    setSearchParams(p => {
      if (valor) p.set(chave, valor); else p.delete(chave);
      return p;
    });
  }

  const sufixoPeriodo = `nos últimos ${periodo} dias`;
  const semMembros = "Ninguém é membro de card ainda. Entre como membro nos cards pelos quais você é responsável.";
  const pessoas = (lista: DashboardData["pessoas_com_mais_cards"]): ItemRanking[] =>
    lista.map(p => ({ id: p.id, nome: p.nome, total: p.total, pessoa: { name: p.nome, initials: p.initials, avatar_url: p.avatar_url } }));
  const quadros = (lista: DashboardData["quadros_com_mais_cards"]): ItemRanking[] =>
    lista.map(q => ({ id: q.id, nome: q.nome, total: q.total, color: q.color }));
  const carregando = <div className="flex justify-center py-10"><ISpinner /></div>;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto min-h-0 px-4 md:px-6 py-6 space-y-6">

      {/* ── Welcome ── */}
      <div className="rounded-2xl border border-border/40 bg-background-surface px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-100">
            {greeting()}, {user?.name?.split(" ")[0]}!
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">{formatDate()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="flex rounded-lg border border-border bg-background-elevated overflow-hidden" role="group" aria-label="Período">
            {PERIODOS.map(p => (
              <button
                key={p}
                onClick={() => mudarParam("periodo", p === 30 ? null : String(p))}
                className={cn(
                  "px-3 py-2 text-xs font-semibold transition-colors",
                  periodo === p ? "bg-primary/15 text-primary" : "text-slate-400 hover:text-slate-200",
                )}
              >
                {p} dias
              </button>
            ))}
          </div>
          <select
            value={boardId ? String(boardId) : ""}
            onChange={e => mudarParam("board", e.target.value || null)}
            disabled={loading}
            aria-label="Quadro do dashboard"
            className="text-sm bg-background-elevated rounded-lg border border-border px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 max-w-[16rem]"
          >
            <option value="">Todos os quadros</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <button
            onClick={() => navigate("/boards")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all"
          >
            Ver todos os boards <IArrow />
          </button>
        </div>
      </div>

      <AlertaAtrasados valor={dash?.kpis.atrasados} onClick={() => setVerAtrasados(true)} />

      <TravadosPorSetor setores={dash?.travados_por_setor} onClickSetor={setSetorAberto} />

      {selecionado && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Cards ativos" value={dash?.kpis.cards_ativos} icon={<ICards />} color="bg-indigo-500/15 text-indigo-400" />
          <StatCard label="Listas" value={dash?.kpis.listas} icon={<IList />} color="bg-primary/15 text-primary" />
          <StatCard label="Arquivados" value={dash?.kpis.arquivados} icon={<IArchive />} color="bg-slate-700/40 text-slate-400" />
          <StatCard label="Em listas de concluído" value={dash?.kpis.em_concluido} icon={<ICheck />} color="bg-emerald-500/15 text-emerald-400" />
        </div>
      )}

      {!dash ? carregando : (
        <>
          <MovimentosPorDia serie={dash.movimentos_por_dia} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {!selecionado && (
              <>
                <RankingBarras
                  titulo="Quadros mais movimentados"
                  subtitulo={`Cards mudados de lista ${sufixoPeriodo}`}
                  itens={quadros(dash.quadros_mais_movimentados)}
                  cor="bg-primary/70"
                  vazio="Nenhum card foi movido no período."
                  onClickItem={id => mudarParam("board", String(id))}
                />
                <RankingBarras
                  titulo="Quadros com mais cards"
                  subtitulo="Cards ativos agora"
                  itens={quadros(dash.quadros_com_mais_cards)}
                  cor="bg-primary/70"
                  vazio="Nenhum card ativo."
                  onClickItem={id => mudarParam("board", String(id))}
                />
              </>
            )}
            <RankingBarras
              titulo="Pessoas que mais movimentam"
              subtitulo={`Cards mudados de lista ${sufixoPeriodo}`}
              itens={pessoas(dash.pessoas_que_mais_movimentam)}
              cor="bg-indigo-400/70"
              vazio="Ninguém moveu cards no período."
            />
            <RankingBarras
              titulo="Pessoas com mais cards"
              subtitulo="Cards ativos em que a pessoa é membro"
              itens={pessoas(dash.pessoas_com_mais_cards)}
              cor="bg-indigo-400/70"
              vazio={semMembros}
            />
          </div>

          {selecionado && <BarrasPorLista listas={dash.listas} />}
        </>
      )}

      {verAtrasados && dash && (
        <AtrasadosModal
          atrasados={dash.atrasados.map(a => ({ ...a, desde: a.created_at }))}
          mostrarQuadro={!selecionado}
          onClose={() => setVerAtrasados(false)}
          titulo={`${dash.atrasados.length} ${dash.atrasados.length === 1 ? "card há" : "cards há"} mais de 72 h úteis`}
          descricao="Contando só dias de semana, desde a criação do card. Cards em listas de concluído ficam de fora."
          rotuloDesde="Criado em"
          vazio="Nenhum card passou de 72 h úteis."
        />
      )}

      {setorAberto !== null && dash && (() => {
        const travados = dash.travados_setor.filter(t => t.setor_id === setorAberto);
        const nome = dash.travados_por_setor.find(s => s.setor_id === setorAberto)?.nome ?? "";
        return (
          <AtrasadosModal
            atrasados={travados.map(t => ({ ...t, desde: t.list_entered_at }))}
            mostrarQuadro={!selecionado}
            onClose={() => setSetorAberto(null)}
            titulo={`${nome}: ${travados.length} ${travados.length === 1 ? "card parado" : "cards parados"} há mais de 24 h úteis`}
            descricao="Contando só dias de semana, desde que o card entrou na lista atual."
            rotuloDesde="Na lista desde"
            vazio="Nenhum card parado neste setor."
          />
        );
      })()}
    </div>
  );
}
