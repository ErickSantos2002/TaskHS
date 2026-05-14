import { cn } from "../lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface Card {
  id: number;
  title: string;
  description?: string;
  tag: { label: string; cls: string };
  dueDate?: string;
  dueSoon?: boolean;
  comments?: number;
  attachments?: number;
  assignee?: string;
  priority: "critical" | "high" | "medium" | "low";
}

interface Column {
  id: number;
  title: string;
  desc: string;
  color: string;
  bg: string;
  text: string;
  headerBg: string;
  cards: Card[];
}

// ── Priority ──────────────────────────────────────────────────

const PRIORITY = {
  critical: { label: "Crítico", border: "border-l-red-500",                          dot: "#ef4444", badge: "bg-red-500/10 text-red-600 dark:text-red-400"           },
  high:     { label: "Alto",    border: "border-l-amber-500",                         dot: "#f59e0b", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400"     },
  medium:   { label: "Médio",   border: "border-l-indigo-400",                        dot: "#818cf8", badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"  },
  low:      { label: "Baixo",   border: "border-l-slate-300 dark:border-l-slate-600", dot: "#94a3b8", badge: "bg-slate-100 dark:bg-background-elevated text-slate-500"},
};

const ASSIGNEE: Record<string, string> = {
  EH: "bg-primary/10 border-primary/20 text-primary",
  AM: "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
  RS: "bg-success/10 border-success/20 text-success",
};

// ── Icons ─────────────────────────────────────────────────────

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const ISearch = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
const IClip = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
  </svg>
);

// ── Data ──────────────────────────────────────────────────────

const COLUMNS: Column[] = [
  {
    id: 1, title: "A Fazer", desc: "Aguardando início",
    color: "#64748b", bg: "bg-slate-500/10", text: "text-slate-500 dark:text-slate-400", headerBg: "bg-slate-500/5 dark:bg-slate-500/10",
    cards: [
      { id: 1, title: "Mapear riscos da obra do piso 3", description: "Verificar condições de trabalho em altura e EPI dos colaboradores.", tag: { label: "Inspeção", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" }, dueDate: "20/05", comments: 2, attachments: 1, assignee: "EH", priority: "high" },
      { id: 2, title: "Atualizar PCMSO 2025", tag: { label: "Documentação", cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" }, dueDate: "30/05", attachments: 3, assignee: "AM", priority: "medium" },
      { id: 3, title: "Treinamento NR-35 — equipe manutenção", tag: { label: "Treinamento", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" }, dueDate: "15/06", assignee: "RS", priority: "low" },
    ],
  },
  {
    id: 2, title: "Em Andamento", desc: "Responsável vinculado",
    color: "#0ea5e9", bg: "bg-sky-500/10", text: "text-sky-600 dark:text-sky-400", headerBg: "bg-sky-500/5 dark:bg-sky-500/10",
    cards: [
      { id: 4, title: "Investigação do acidente leve — setor embalagem", description: "Coletar depoimentos e preencher CAT junto ao RH.", tag: { label: "Urgente", cls: "bg-red-500/10 text-red-600 dark:text-red-400" }, dueDate: "14/05", dueSoon: true, comments: 5, attachments: 2, assignee: "EH", priority: "critical" },
      { id: 5, title: "Revisão do PPRA — área química", tag: { label: "Documentação", cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" }, dueDate: "22/05", comments: 1, assignee: "AM", priority: "high" },
    ],
  },
  {
    id: 3, title: "Em Revisão", desc: "Aguardando aprovação",
    color: "#f59e0b", bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", headerBg: "bg-amber-500/5 dark:bg-amber-500/10",
    cards: [
      { id: 6, title: "Relatório de inspeção mensal — abril", tag: { label: "Relatório", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }, dueDate: "10/05", comments: 3, attachments: 1, assignee: "RS", priority: "medium" },
    ],
  },
  {
    id: 4, title: "Concluído", desc: "Finalizado com sucesso",
    color: "#10b981", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", headerBg: "bg-emerald-500/5 dark:bg-emerald-500/10",
    cards: [
      { id: 7, title: "Entrega dos EPIs — equipe externa", tag: { label: "EPI", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }, dueDate: "05/05", comments: 1, assignee: "EH", priority: "low" },
      { id: 8, title: "DDS — semana de prevenção", tag: { label: "Treinamento", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" }, dueDate: "07/05", attachments: 1, assignee: "AM", priority: "low" },
    ],
  },
];

// ── KanbanCard ────────────────────────────────────────────────

function KanbanCard({ card }: { card: Card }) {
  const p = PRIORITY[card.priority];
  return (
    <button className={cn(
      "w-full text-left rounded-lg",
      "bg-white dark:bg-background-surface",
      "border border-slate-200 dark:border-border border-l-4",
      "p-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0",
      "transition-all duration-150 group",
      p.border,
    )}>
      <div className="flex items-center justify-between mb-2 gap-1">
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", card.tag.cls)}>
          {card.tag.label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {card.dueSoon && <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Urgente</span>}
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.dot }} title={p.label} />
        </div>
      </div>

      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 line-clamp-2 mb-2 leading-snug group-hover:text-primary transition-colors duration-150">
        {card.title}
      </p>

      {card.description && (
        <p className="text-xs text-slate-500 mb-2 leading-relaxed line-clamp-2">{card.description}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-2.5">
          {card.dueDate && (
            <span className={cn("flex items-center gap-1 text-[11px]", card.dueSoon ? "text-danger" : "text-slate-500")}>
              <ICal />{card.dueDate}
            </span>
          )}
          {!!card.comments && <span className="flex items-center gap-1 text-[11px] text-slate-500"><IChat />{card.comments}</span>}
          {!!card.attachments && <span className="flex items-center gap-1 text-[11px] text-slate-500"><IClip />{card.attachments}</span>}
        </div>
        {card.assignee && (
          <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center shrink-0", ASSIGNEE[card.assignee])}>
            <span className="text-[9px] font-bold leading-none">{card.assignee}</span>
          </div>
        )}
      </div>

      <div className="mt-2">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", p.badge)}>{p.label}</span>
      </div>
    </button>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────

function KanbanColumn({ col }: { col: Column }) {
  return (
    <div className="flex flex-col w-[268px] shrink-0 rounded-xl bg-slate-100 dark:bg-background-elevated border border-slate-200 dark:border-border overflow-hidden">
      <div className={cn("px-3 py-3 shrink-0", col.headerBg)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
            <p className={cn("text-sm font-semibold truncate", col.text)}>{col.title}</p>
          </div>
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2", col.bg, col.text)}>{col.cards.length}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5 pl-4">{col.desc}</p>
      </div>

      <div className="h-0.5 shrink-0" style={{ backgroundColor: col.color, opacity: 0.4 }} />

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {col.cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 mx-1 rounded-lg border-2 border-dashed border-slate-200 dark:border-border/40 mt-1">
            <svg className="w-6 h-6 text-slate-300 dark:text-slate-600 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-slate-400">Nenhum card</p>
          </div>
        ) : (
          col.cards.map(card => <KanbanCard key={card.id} card={card} />)
        )}
        <button className="flex w-full items-center gap-2 px-2 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-background-surface transition-all duration-150">
          <IPlus />
          Adicionar card
        </button>
      </div>
    </div>
  );
}

// ── BoardPage ─────────────────────────────────────────────────

export function BoardPage() {
  const total = COLUMNS.reduce((n, c) => n + c.cards.length, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Topbar da página ── */}
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background-surface px-5 py-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-100">Boards</h1>
            <p className="mt-0.5 text-sm text-slate-500">Gestão de SST — {total} cards em {COLUMNS.length} listas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><ISearch /></span>
              <input type="text" placeholder="Buscar card…" className="pl-9 pr-3 py-2 text-sm w-48 rounded-lg border border-border/60 bg-background-elevated text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors" />
            </div>
            <div className="flex -space-x-2">
              {Object.entries(ASSIGNEE).map(([i, cls]) => (
                <div key={i} className={cn("w-8 h-8 rounded-full border-2 border-white dark:border-background-surface flex items-center justify-center text-xs font-bold", cls)} title={i}>{i}</div>
              ))}
            </div>
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150">
              <IPlus />Nova Lista
            </button>
          </div>
        </div>
      </div>

      {/* ── Board kanban ── */}
      <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4 md:pb-6">
        <div className="h-full rounded-2xl bg-slate-200/60 dark:bg-slate-900/50 border border-slate-200 dark:border-border overflow-hidden">
          <div className="h-full overflow-x-auto">
            <div className="inline-flex gap-3 h-full p-3">
              {COLUMNS.map(col => <KanbanColumn key={col.id} col={col} />)}
              <button className="flex items-center gap-2 px-4 py-3 rounded-xl w-52 shrink-0 h-fit text-sm font-medium text-slate-400 hover:text-primary border-2 border-dashed border-slate-300 dark:border-border hover:border-primary/40 transition-all duration-150 self-start">
                <IPlus />Adicionar lista
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
