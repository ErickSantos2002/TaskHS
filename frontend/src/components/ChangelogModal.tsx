import { useEffect } from "react";
import { cn } from "../lib/utils";
import { CHANGELOG, type ChangeKind } from "../data/changelog";

const KIND_LABEL: Record<ChangeKind, string> = {
  novidade: "Novidade",
  melhoria: "Melhoria",
  correcao: "Correção",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  novidade: "bg-primary/15 text-primary",
  melhoria: "bg-sky-500/15 text-sky-400",
  correcao: "bg-amber-500/15 text-amber-400",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-100">O que há de novo?</h2>
            <p className="text-xs text-slate-500 mt-0.5">Atualizações recentes do TaskHS</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5 space-y-6">
          {CHANGELOG.map((v, i) => (
            <div key={v.version}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="rounded-md bg-primary/15 text-primary px-2 py-0.5 text-xs font-bold">v{v.version}</span>
                <span className="text-xs text-slate-500">{formatDate(v.date)}</span>
                {i === 0 && (
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">Versão atual</span>
                )}
              </div>
              <ul className="space-y-2">
                {v.changes.map((c, j) => (
                  <li key={j} className="flex gap-2.5 rounded-lg border border-border bg-background-elevated px-3 py-2.5">
                    <span className={cn("shrink-0 h-fit rounded-md px-1.5 py-0.5 text-[10px] font-semibold", KIND_CLASS[c.kind])}>{KIND_LABEL[c.kind]}</span>
                    <span className="text-sm text-slate-300 leading-snug">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 text-center">
          <p className="text-xs text-slate-600">TaskHS — desenvolvido internamente pela Health &amp; Safety</p>
        </div>
      </div>
    </div>
  );
}
