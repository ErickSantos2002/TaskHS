import { useState, useEffect, useMemo } from "react";
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
const IStar = ({ filled }: { filled: boolean }) => (
  <svg className="w-4 h-4" fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
);
const IGrid = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
);
const IList = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);
const ISearch = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);
const IChevron = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);
const IArrow = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

// ── Board colors ───────────────────────────────────────────────

const COLORS = [
  "#0ea5e9", "#6366f1", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ── Favorites helpers ──────────────────────────────────────────

const FAVORITES_KEY = "taskhs-starred-boards";

function loadFavorites(): number[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"); }
  catch { return []; }
}

function saveFavorites(ids: number[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

// ── Sort types ─────────────────────────────────────────────────

type SortOption = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const SORT_LABELS: Record<SortOption, string> = {
  "date-desc": "Mais recentes",
  "date-asc":  "Mais antigos",
  "name-asc":  "Nome A–Z",
  "name-desc": "Nome Z–A",
};

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
      <div className="w-full max-w-md rounded-2xl bg-background-surface border border-border shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-100 mb-4">Novo Board</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Nome</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: SST — Planta Industrial"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background-elevated text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Descrição (opcional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Breve descrição do board"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background-elevated text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => setColor(c)}
                  className={cn("w-7 h-7 rounded-full transition-all duration-150", color === c ? "ring-2 ring-offset-2 ring-offset-background-surface scale-110" : "opacity-70 hover:opacity-100")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-slate-400 hover:bg-background-elevated transition-colors">
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

// ── BoardCard (grid) ───────────────────────────────────────────

function BoardCard({ board, starred, onToggleStar, onClick }: {
  board: Board;
  starred: boolean;
  onToggleStar: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === "Enter" && onClick()}
      className="group cursor-pointer text-left rounded-xl bg-background-surface border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden"
    >
      <div className="h-2" style={{ backgroundColor: board.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white/80" style={{ backgroundColor: `${board.color}30` }}>
            <IBoard />
          </div>
          <button
            onClick={onToggleStar}
            className={cn(
              "p-1 rounded-md transition-all duration-150",
              starred
                ? "text-warning opacity-100"
                : "text-slate-600 opacity-0 group-hover:opacity-100 hover:text-warning",
            )}
          >
            <IStar filled={starred} />
          </button>
        </div>
        <p className="font-semibold text-slate-100 group-hover:text-primary transition-colors leading-snug mb-1">
          {board.title}
        </p>
        {board.description && (
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{board.description}</p>
        )}
        <p className="text-[11px] text-slate-600 mt-3">
          {new Date(board.created_at).toLocaleDateString("pt-BR")}
        </p>
      </div>
    </div>
  );
}

// ── BoardRow (list) ────────────────────────────────────────────

function BoardRow({ board, starred, onToggleStar, onClick }: {
  board: Board;
  starred: boolean;
  onToggleStar: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === "Enter" && onClick()}
      className="group cursor-pointer w-full flex items-center gap-4 px-4 py-3 rounded-xl bg-background-surface border border-border hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 text-left"
    >
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: board.color }} />
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white/70" style={{ backgroundColor: `${board.color}30` }}>
        <IBoard />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-slate-100 group-hover:text-primary transition-colors truncate">{board.title}</p>
        {board.description && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{board.description}</p>
        )}
      </div>
      <p className="text-xs text-slate-600 shrink-0 hidden sm:block">
        {new Date(board.created_at).toLocaleDateString("pt-BR")}
      </p>
      <button
        onClick={onToggleStar}
        className={cn(
          "p-1.5 rounded-md transition-all duration-150 shrink-0",
          starred
            ? "text-warning opacity-100"
            : "text-slate-600 opacity-0 group-hover:opacity-100 hover:text-warning",
        )}
      >
        <IStar filled={starred} />
      </button>
      <span className="text-slate-600 group-hover:text-primary transition-colors shrink-0">
        <IArrow />
      </span>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{children}</p>
  );
}

// ── BoardsPage ─────────────────────────────────────────────────

export function BoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("date-desc");
  const [view, setView] = useState<"grid" | "list">(() =>
    (localStorage.getItem("taskhs-boards-view") as "grid" | "list") ?? "grid"
  );
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);

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

  function toggleStar(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      saveFavorites(next);
      return next;
    });
  }

  function toggleView(v: "grid" | "list") {
    setView(v);
    localStorage.setItem("taskhs-boards-view", v);
  }

  const sorted = useMemo(() => {
    const filtered = boards.filter(b =>
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      (b.description ?? "").toLowerCase().includes(search.toLowerCase())
    );
    return filtered.sort((a, b) => {
      if (sort === "name-asc")  return a.title.localeCompare(b.title);
      if (sort === "name-desc") return b.title.localeCompare(a.title);
      if (sort === "date-asc")  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [boards, search, sort]);

  const starredBoards = sorted.filter(b => favorites.includes(b.id));
  const otherBoards   = sorted.filter(b => !favorites.includes(b.id));

  const gridClass = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";
  const listClass = "flex flex-col gap-2";

  function renderBoard(board: Board) {
    const starred = favorites.includes(board.id);
    return view === "grid" ? (
      <BoardCard
        key={board.id}
        board={board}
        starred={starred}
        onToggleStar={e => toggleStar(e, board.id)}
        onClick={() => navigate(`/boards/${board.id}`)}
      />
    ) : (
      <BoardRow
        key={board.id}
        board={board}
        starred={starred}
        onToggleStar={e => toggleStar(e, board.id)}
        onClick={() => navigate(`/boards/${board.id}`)}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Topbar ── */}
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-4">
        <div className="rounded-2xl border border-border/40 bg-background-surface px-5 py-4 space-y-4">
          {/* Title row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold text-slate-100">Boards</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {sorted.length} board{sorted.length !== 1 ? "s" : ""}
                {search && ` encontrado${sorted.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150"
            >
              <IPlus />Novo Board
            </button>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-45">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                <ISearch />
              </span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar boards..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background-elevated text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
              />
            </div>

            {/* Sort */}
            <div className="relative">
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortOption)}
                className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-border bg-background-elevated text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer transition-colors"
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                <IChevron />
              </span>
            </div>

            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-border bg-background-elevated overflow-hidden">
              <button
                onClick={() => toggleView("grid")}
                className={cn(
                  "p-2 transition-colors duration-150",
                  view === "grid" ? "bg-primary/15 text-primary" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <IGrid />
              </button>
              <button
                onClick={() => toggleView("list")}
                className={cn(
                  "p-2 transition-colors duration-150",
                  view === "list" ? "bg-primary/15 text-primary" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <IList />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <ISpinner />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center">
            <div className="w-14 h-14 rounded-2xl bg-background-elevated flex items-center justify-center mb-4 text-slate-500">
              <IBoard />
            </div>
            <p className="font-semibold text-slate-300 mb-1">Nenhum board ainda</p>
            <p className="text-sm text-slate-500 mb-4">Crie seu primeiro board para começar a organizar as tarefas de SST.</p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 transition-all"
            >
              <IPlus />Criar Board
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="font-semibold text-slate-400 mb-1">Nenhum resultado</p>
            <p className="text-sm text-slate-600">Tente buscar por outro termo.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Starred section */}
            {starredBoards.length > 0 && (
              <div>
                <SectionLabel>⭐ Favoritos</SectionLabel>
                <div className={view === "grid" ? gridClass : listClass}>
                  {starredBoards.map(renderBoard)}
                </div>
              </div>
            )}

            {/* All boards */}
            <div>
              {starredBoards.length > 0 && otherBoards.length > 0 && (
                <SectionLabel>Todos os boards</SectionLabel>
              )}
              <div className={view === "grid" ? gridClass : listClass}>
                {otherBoards.map(renderBoard)}
                {/* New board button — grid only */}
                {view === "grid" && (
                  <button
                    onClick={() => setShowModal(true)}
                    className="rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:text-primary text-slate-600 text-sm font-medium flex flex-col items-center justify-center gap-2 p-8 transition-all duration-150 min-h-30"
                  >
                    <IPlus />
                    Novo Board
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showModal && <CreateBoardModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}
