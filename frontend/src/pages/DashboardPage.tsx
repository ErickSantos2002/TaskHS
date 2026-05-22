import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "../lib/utils";
import type { Board } from "../types";

// ── Types ──────────────────────────────────────────────────────

interface Stats {
  boards: number;
  cards_total: number;
  cards_overdue: number;
  cards_due_today: number;
  cards_completed: number;
}

// ── Icons ──────────────────────────────────────────────────────

const IBoard = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
  </svg>
);
const ICards = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);
const IClock = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const ICheck = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const ICal = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const IArrow = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
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

// ── DashboardPage ──────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Stats>("/boards/stats"),
      api.get<Board[]>("/boards"),
    ]).then(([s, b]) => {
      setStats(s);
      setBoards(b.slice(0, 6));
    }).finally(() => setLoading(false));
  }, []);

  const completionRate = stats && stats.cards_total > 0
    ? Math.round((stats.cards_completed / stats.cards_total) * 100)
    : null;

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
        <button
          onClick={() => navigate("/boards")}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all self-start sm:self-auto"
        >
          Ver todos os boards <IArrow />
        </button>
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Boards"
          value={stats?.boards}
          icon={<IBoard />}
          color="bg-primary/15 text-primary"
        />
        <StatCard
          label="Cards ativos"
          value={stats?.cards_total}
          icon={<ICards />}
          color="bg-indigo-500/15 text-indigo-400"
          sub={completionRate !== null ? `${completionRate}% concluídos` : undefined}
        />
        <StatCard
          label="Vencidos"
          value={stats?.cards_overdue}
          icon={<IClock />}
          color={stats?.cards_overdue ? "bg-red-500/15 text-red-400" : "bg-slate-700/40 text-slate-500"}
        />
        <StatCard
          label="Vencem hoje"
          value={stats?.cards_due_today}
          icon={<ICal />}
          color={stats?.cards_due_today ? "bg-amber-500/15 text-amber-400" : "bg-slate-700/40 text-slate-500"}
        />
      </div>

      {/* ── Completion bar ── */}
      {stats && stats.cards_total > 0 && (
        <div className="rounded-xl bg-background-surface border border-border px-5 py-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <ICheck />
              Progresso geral
            </div>
            <span className="text-sm font-bold text-slate-200">{completionRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-background-elevated overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-700"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {stats.cards_completed} de {stats.cards_total} cards com prazo concluídos
          </p>
        </div>
      )}

      {/* ── Recent boards ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Boards recentes</p>
          <button onClick={() => navigate("/boards")} className="text-xs text-primary hover:underline">Ver todos</button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><ISpinner /></div>
        ) : boards.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-background-elevated flex items-center justify-center text-slate-500"><IBoard /></div>
            <p className="text-sm font-semibold text-slate-400">Nenhum board ainda</p>
            <button
              onClick={() => navigate("/boards")}
              className="text-sm text-primary hover:underline"
            >
              Criar primeiro board
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {boards.map(board => (
              <button
                key={board.id}
                onClick={() => navigate(`/boards/${board.id}`)}
                className="group text-left rounded-xl bg-background-surface border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden"
              >
                <div className="h-1.5" style={{ backgroundColor: board.color }} />
                <div className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white/70" style={{ backgroundColor: `${board.color}28` }}>
                    <IBoard />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 group-hover:text-primary transition-colors truncate">{board.title}</p>
                    {board.description && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">{board.description}</p>
                    )}
                    <p className="text-[11px] text-slate-600 mt-1">
                      {new Date(board.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="text-slate-600 group-hover:text-primary transition-colors shrink-0"><IArrow /></span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
