import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  DndContext, DragOverlay, closestCorners,
  PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import type { Board, BoardList, Card, Priority } from "../types";

// ── Priority config ────────────────────────────────────────────

const PRIORITY: Record<Priority, { label: string; border: string; dot: string; badge: string }> = {
  critical: { label: "Crítico", border: "border-l-red-500",                          dot: "#ef4444", badge: "bg-red-500/10 text-red-600 dark:text-red-400"          },
  high:     { label: "Alto",    border: "border-l-amber-500",                         dot: "#f59e0b", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400"    },
  medium:   { label: "Médio",   border: "border-l-indigo-400",                        dot: "#818cf8", badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  low:      { label: "Baixo",   border: "border-l-slate-300 dark:border-l-slate-600", dot: "#94a3b8", badge: "bg-slate-100 dark:bg-background-elevated text-slate-500"},
};

// ── Icons ──────────────────────────────────────────────────────

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const IBack = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);
const ICal = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const IChat = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);
const IGrip = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const ICheck = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const IX = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ── CardContent (shared between sortable card and drag overlay) ─

function CardContent({ card, isDragging = false }: { card: Card; isDragging?: boolean }) {
  const p = PRIORITY[card.priority];
  const isOverdue = card.due_date && new Date(card.due_date) < new Date();
  return (
    <div className={cn(
      "w-full text-left rounded-lg",
      "bg-white dark:bg-background-surface",
      "border border-slate-200 dark:border-border border-l-4",
      "p-3 shadow-sm transition-all duration-150",
      isDragging ? "shadow-xl rotate-1 opacity-95" : "hover:shadow-md",
      p.border,
    )}>
      <div className="flex items-center justify-between mb-2 gap-1">
        {card.labels[0] ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {card.labels[0].label}
          </span>
        ) : <span />}
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.dot }} title={p.label} />
      </div>

      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 line-clamp-2 mb-2 leading-snug">
        {card.title}
      </p>

      {card.description && (
        <p className="text-xs text-slate-500 mb-2 leading-relaxed line-clamp-2">{card.description}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-2.5">
          {card.due_date && (
            <span className={cn("flex items-center gap-1 text-[11px]", isOverdue ? "text-danger" : "text-slate-500")}>
              <ICal />{new Date(card.due_date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {card.comments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><IChat />{card.comments.length}</span>
          )}
        </div>
        {card.members[0] && (
          <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-primary leading-none">{card.members[0].initials}</span>
          </div>
        )}
      </div>

      <div className="mt-2">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", p.badge)}>{p.label}</span>
      </div>
    </div>
  );
}

// ── KanbanCard (sortable) ──────────────────────────────────────

function KanbanCard({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative group/card", isDragging && "opacity-40")}
    >
      {/* drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 z-10 p-1 rounded opacity-0 group-hover/card:opacity-100 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-background-elevated transition-all"
        title="Arrastar"
      >
        <IGrip />
      </div>
      <CardContent card={card} />
    </div>
  );
}

// ── DroppableColumn ────────────────────────────────────────────

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px] rounded-lg transition-colors duration-150",
        isOver && "bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

// ── AddCardForm ────────────────────────────────────────────────

function AddCardForm({ listId, onAdded, onCancel }: { listId: number; onAdded: (card: Card) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const card = await api.post<Card>(`/lists/${listId}/cards`, { title: title.trim(), priority });
      onAdded(card);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); }
    if (e.key === "Escape") onCancel();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white dark:bg-background-surface border border-primary/30 shadow-sm p-2 space-y-2">
      <textarea
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Título do card…"
        rows={2}
        className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent resize-none focus:outline-none placeholder-slate-400 leading-snug"
      />
      <div className="flex items-center gap-1.5">
        {(["low", "medium", "high", "critical"] as Priority[]).map(p => (
          <button
            key={p} type="button"
            onClick={() => setPriority(p)}
            className={cn("w-2.5 h-2.5 rounded-full border-2 transition-transform", priority === p ? "scale-125 border-white dark:border-background-surface" : "opacity-50")}
            style={{ backgroundColor: PRIORITY[p].dot }}
            title={PRIORITY[p].label}
          />
        ))}
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="p-1 rounded text-slate-400 hover:text-slate-600 transition-colors"><IX /></button>
        <button type="submit" disabled={loading || !title.trim()} className="p-1 rounded text-primary hover:text-primary-600 disabled:opacity-40 transition-colors"><ICheck /></button>
      </div>
    </form>
  );
}

// ── AddListForm ────────────────────────────────────────────────

function AddListForm({ boardId, position, onAdded, onCancel }: { boardId: number; position: number; onAdded: (l: BoardList) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const list = await api.post<BoardList>(`/boards/${boardId}/lists`, { title: title.trim(), position });
      onAdded(list);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-[268px] shrink-0 rounded-xl bg-white dark:bg-background-surface border border-primary/30 shadow-sm p-3 self-start space-y-2">
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === "Escape" && onCancel()}
        placeholder="Nome da lista…"
        className="w-full text-sm font-medium text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none placeholder-slate-400"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={onCancel} className="flex-1 py-1.5 rounded-lg border border-slate-200 dark:border-border text-xs font-medium text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading || !title.trim()} className="flex-1 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 transition-all">
          {loading ? "…" : "Criar"}
        </button>
      </div>
    </form>
  );
}

// ── KanbanColumn ───────────────────────────────────────────────

function KanbanColumn({ list, cards, onCardAdded }: { list: BoardList; cards: Card[]; onCardAdded: (c: Card) => void }) {
  const [addingCard, setAddingCard] = useState(false);

  return (
    <div className="flex flex-col w-[268px] shrink-0 rounded-xl bg-slate-100 dark:bg-background-elevated border border-slate-200 dark:border-border overflow-hidden">
      <div className="px-3 py-3 shrink-0" style={{ backgroundColor: `${list.color}10` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
            <p className="text-sm font-semibold truncate" style={{ color: list.color }}>{list.title}</p>
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2" style={{ backgroundColor: `${list.color}20`, color: list.color }}>
            {cards.length}
          </span>
        </div>
        {list.description && <p className="text-[11px] text-slate-400 mt-0.5 pl-4">{list.description}</p>}
      </div>

      <div className="h-0.5 shrink-0" style={{ backgroundColor: list.color, opacity: 0.4 }} />

      <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <DroppableColumn id={`list-${list.id}`}>
          {cards.length === 0 && !addingCard && (
            <div className="flex flex-col items-center justify-center py-6 mx-1 rounded-lg border-2 border-dashed border-slate-200 dark:border-border/40">
              <p className="text-xs text-slate-400">Nenhum card</p>
            </div>
          )}
          {cards.map(card => <KanbanCard key={card.id} card={card} />)}
          {addingCard && (
            <AddCardForm
              listId={list.id}
              onAdded={card => { onCardAdded(card); setAddingCard(false); }}
              onCancel={() => setAddingCard(false)}
            />
          )}
        </DroppableColumn>
      </SortableContext>

      {!addingCard && (
        <button
          onClick={() => setAddingCard(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-background-surface transition-all duration-150 shrink-0"
        >
          <IPlus />Adicionar card
        </button>
      )}
    </div>
  );
}

// ── BoardPage ──────────────────────────────────────────────────

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const boardId = Number(id);

  const [board, setBoard] = useState<Board | null>(null);
  const [lists, setLists] = useState<BoardList[]>([]);
  const [cardsByList, setCardsByList] = useState<Record<number, Card[]>>({});
  const [loading, setLoading] = useState(true);
  const [addingList, setAddingList] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const currentListIdRef = useRef<number | null>(null); // tracks card's current list during drag

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (!boardId) return;
    Promise.all([
      api.get<Board>(`/boards/${boardId}`),
      api.get<BoardList[]>(`/boards/${boardId}/lists`),
    ]).then(async ([b, ls]) => {
      setBoard(b);
      setLists(ls);
      const entries = await Promise.all(
        ls.map(l => api.get<Card[]>(`/lists/${l.id}/cards`).then(cards => [l.id, cards] as [number, Card[]]))
      );
      setCardsByList(Object.fromEntries(entries));
    }).finally(() => setLoading(false));
  }, [boardId]);

  // ── Helpers ──────────────────────────────────────────────────

  function findListOfCard(cardId: number): number | undefined {
    for (const [listId, cards] of Object.entries(cardsByList)) {
      if (cards.some(c => c.id === cardId)) return Number(listId);
    }
  }

  function findCard(cardId: number): Card | undefined {
    for (const cards of Object.values(cardsByList)) {
      const card = cards.find(c => c.id === cardId);
      if (card) return card;
    }
  }

  function resolveListId(overId: string | number): number | undefined {
    const str = String(overId);
    if (str.startsWith("list-")) return Number(str.replace("list-", ""));
    // overId is a card id — find its list
    return findListOfCard(Number(overId));
  }

  // ── DnD handlers ─────────────────────────────────────────────

  function onDragStart({ active }: DragStartEvent) {
    const cardId = active.id as number;
    const listId = findListOfCard(cardId) ?? null;
    setActiveCard(findCard(cardId) ?? null);
    setActiveListId(listId);
    currentListIdRef.current = listId;
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId     = active.id as number;
    const overId       = over.id;
    const sourceListId = currentListIdRef.current; // never stale — updated on every cross-list move
    const destListId   = resolveListId(overId);
    if (!sourceListId || !destListId) return;

    if (sourceListId === destListId) {
      if (String(overId).startsWith("list-")) return;
      setCardsByList(prev => {
        const cards     = prev[sourceListId] ?? [];
        const activeIdx = cards.findIndex(c => c.id === activeId);
        const overIdx   = cards.findIndex(c => c.id === Number(overId));
        if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return prev;
        return { ...prev, [sourceListId]: arrayMove(cards, activeIdx, overIdx) };
      });
      return;
    }

    // Cross-list move — update ref so next onDragOver call sees the new list
    currentListIdRef.current = destListId;
    setCardsByList(prev => {
      const source = [...(prev[sourceListId] ?? [])];
      const dest   = [...(prev[destListId]   ?? [])];
      const idx    = source.findIndex(c => c.id === activeId);
      if (idx === -1) return prev;
      const [moved] = source.splice(idx, 1);

      let insertIdx: number;
      if (String(overId).startsWith("list-")) {
        insertIdx = dest.length;
      } else {
        const overIdx = dest.findIndex(c => c.id === Number(overId));
        // insert after if active center Y is below target center Y
        const activeCenter = active.rect.current.translated
          ? active.rect.current.translated.top + active.rect.current.translated.height / 2
          : 0;
        const overCenter = over.rect.top + over.rect.height / 2;
        const after = activeCenter > overCenter;
        insertIdx = overIdx === -1 ? dest.length : (after ? overIdx + 1 : overIdx);
      }

      dest.splice(insertIdx, 0, moved);
      return { ...prev, [sourceListId]: source, [destListId]: dest };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const sourceListId = activeListId;
    setActiveCard(null);
    setActiveListId(null);
    if (!over || !sourceListId) return;

    const activeId   = active.id as number;
    const destListId = resolveListId(over.id);
    if (!destListId) return;

    const finalCards = cardsByList[destListId] ?? [];
    const newIndex   = finalCards.findIndex(c => c.id === activeId);
    const prev       = finalCards[newIndex - 1];
    const next       = finalCards[newIndex + 1];

    let newPosition: number;
    if (!prev && !next)       newPosition = 65536;
    else if (!prev)           newPosition = next.position / 2;
    else if (!next)           newPosition = prev.position + 65536;
    else                      newPosition = (prev.position + next.position) / 2;

    api.patch(`/lists/${sourceListId}/cards/${activeId}`, {
      list_id: destListId,
      position: newPosition,
    }).catch(() => {});
  }

  // ── Render ────────────────────────────────────────────────────

  const totalCards = Object.values(cardsByList).reduce((n, cards) => n + cards.length, 0);
  const filteredCards = (listId: number): Card[] => {
    const cards = cardsByList[listId] ?? [];
    if (!search.trim()) return cards;
    const q = search.toLowerCase();
    return cards.filter(c => c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
  };

  if (loading) {
    return <div className="flex flex-col flex-1 items-center justify-center"><ISpinner /></div>;
  }

  if (!board) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-2">
        <p className="text-slate-500">Board não encontrado.</p>
        <button onClick={() => navigate("/boards")} className="text-sm text-primary hover:underline">Voltar</button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex flex-col flex-1 min-h-0">

        {/* Topbar */}
        <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background-surface px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => navigate("/boards")} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-background-elevated transition-colors shrink-0">
                <IBack />
              </button>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: board.color }} />
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-slate-100 truncate">{board.title}</h1>
                <p className="mt-0.5 text-sm text-slate-500">{totalCards} card{totalCards !== 1 ? "s" : ""} em {lists.length} lista{lists.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  type="text"
                  placeholder="Buscar card…"
                  className="pl-9 pr-3 py-2 text-sm w-48 rounded-lg border border-border/60 bg-background-elevated text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                />
              </div>
              <button
                onClick={() => setAddingList(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150"
              >
                <IPlus />Nova Lista
              </button>
            </div>
          </div>
        </div>

        {/* Board */}
        <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4 md:pb-6">
          <div className="h-full rounded-2xl bg-slate-200/60 dark:bg-slate-900/50 border border-slate-200 dark:border-border overflow-hidden">
            <div className="h-full overflow-x-auto">
              <div className="inline-flex gap-3 h-full p-3">
                {lists.map(list => (
                  <KanbanColumn
                    key={list.id}
                    list={list}
                    cards={filteredCards(list.id)}
                    onCardAdded={card => setCardsByList(prev => ({ ...prev, [list.id]: [...(prev[list.id] ?? []), card] }))}
                  />
                ))}
                {addingList ? (
                  <AddListForm
                    boardId={boardId}
                    position={lists.length}
                    onAdded={list => { setLists(p => [...p, list]); setCardsByList(p => ({ ...p, [list.id]: [] })); setAddingList(false); }}
                    onCancel={() => setAddingList(false)}
                  />
                ) : (
                  <button
                    onClick={() => setAddingList(true)}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl w-52 shrink-0 h-fit text-sm font-medium text-slate-400 hover:text-primary border-2 border-dashed border-slate-300 dark:border-border hover:border-primary/40 transition-all duration-150 self-start"
                  >
                    <IPlus />Adicionar lista
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Drag overlay — ghost card following the cursor */}
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
        {activeCard && (
          <div className="w-[268px] rotate-2 shadow-2xl">
            <CardContent card={activeCard} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
