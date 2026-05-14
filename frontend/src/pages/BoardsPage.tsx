import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import type { Board } from "../types";

// ── Icons ─────────────────────────────────────────────────────

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const IBoard = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── Board colors ───────────────────────────────────────────────

const COLORS = [
  "#0ea5e9", "#6366f1", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ── Create Board Modal ─────────────────────────────────────────

function CreateBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Board) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError("");
    try {
      const board = await api.post<Board>("/boards", { title: title.trim(), description: description.trim() || null, color });
      onCreated(board);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao criar board");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Novo Board</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Nome</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: SST — Planta Industrial"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background-elevated text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Descrição (opcional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Breve descrição do board"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background-elevated text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => setColor(c)}
                  className={cn("w-7 h-7 rounded-full transition-all duration-150", color === c ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-background-surface scale-110" : "opacity-70 hover:opacity-100")}
                  style={{ backgroundColor: c, ringColor: c }}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-border text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading || !title.trim()} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {loading ? <ISpinner /> : "Criar Board"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── BoardCard ──────────────────────────────────────────────────

function BoardCard({ board, onClick }: { board: Board; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border hover:border-primary/40 hover:shadow-md transition-all duration-150 overflow-hidden"
    >
      <div className="h-2" style={{ backgroundColor: board.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${board.color}20` }}>
            <IBoard />
          </div>
        </div>
        <p className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors leading-snug mb-1">
          {board.title}
        </p>
        {board.description && (
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{board.description}</p>
        )}
        <p className="text-[11px] text-slate-400 mt-3">
          {new Date(board.created_at).toLocaleDateString("pt-BR")}
        </p>
      </div>
    </button>
  );
}

// ── BoardsPage ─────────────────────────────────────────────────

export function BoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    api.get<Board[]>("/boards")
      .then(setBoards)
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(board: Board) {
    setBoards(prev => [board, ...prev]);
    setShowModal(false);
    navigate(`/boards/${board.id}`);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Topbar */}
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background-surface px-5 py-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-100">Boards</h1>
            <p className="mt-0.5 text-sm text-slate-500">{boards.length} board{boards.length !== 1 ? "s" : ""} disponível{boards.length !== 1 ? "is" : ""}</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150"
          >
            <IPlus />Novo Board
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <ISpinner />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-background-elevated flex items-center justify-center mb-4">
              <IBoard />
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Nenhum board ainda</p>
            <p className="text-sm text-slate-500 mb-4">Crie seu primeiro board para começar a organizar as tarefas de SST.</p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 transition-all"
            >
              <IPlus />Criar Board
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {boards.map(b => (
              <BoardCard key={b.id} board={b} onClick={() => navigate(`/boards/${b.id}`)} />
            ))}
            <button
              onClick={() => setShowModal(true)}
              className="rounded-xl border-2 border-dashed border-slate-200 dark:border-border hover:border-primary/40 hover:text-primary text-slate-400 text-sm font-medium flex flex-col items-center justify-center gap-2 p-8 transition-all duration-150 min-h-[120px]"
            >
              <IPlus />
              Novo Board
            </button>
          </div>
        )}
      </div>

      {showModal && <CreateBoardModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}
