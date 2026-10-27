import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { Setor } from "../types";

// Cadastro de setores (v2.12.0): cada lista de quadro pode ser marcada com um
// setor no drawer, e o Dashboard soma os cards travados por setor. Não há
// exclusão — desativar tira o setor do seletor, mas as listas já marcadas
// continuam contando.

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
  </svg>
);

const inputCls = "w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-1.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400";

function mensagemErro(err: unknown, padrao: string): string {
  return err instanceof Error && err.message ? err.message : padrao;
}

// Nome editável na própria linha: salva no Enter ou ao sair do campo.
function NomeSetor({ setor, onSalvo }: { setor: Setor; onSalvo: (s: Setor) => void }) {
  const [nome, setNome] = useState(setor.nome);
  const [erro, setErro] = useState("");

  useEffect(() => { setNome(setor.nome); }, [setor.nome]);

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo || limpo === setor.nome) { setNome(setor.nome); setErro(""); return; }
    try {
      onSalvo(await api.patch<Setor>(`/setores/${setor.id}`, { nome: limpo }));
      setErro("");
    } catch (err) {
      setErro(mensagemErro(err, "Não foi possível renomear."));
    }
  }

  return (
    <div>
      <input
        value={nome}
        onChange={e => { setNome(e.target.value); setErro(""); }}
        onBlur={salvar}
        onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setNome(setor.nome); setErro(""); }
        }}
        maxLength={80}
        className={cn(inputCls, "max-w-xs font-semibold", !setor.ativo && "text-slate-400 dark:text-slate-500")}
      />
      {erro && <p className="text-xs text-red-500 mt-1">{erro}</p>}
    </div>
  );
}

export function SetoresPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [setores, setSetores] = useState<Setor[]>([]);
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [erroNovo, setErroNovo] = useState("");

  useEffect(() => {
    if (me?.role !== "administrador") { navigate("/boards", { replace: true }); return; }
    api.get<Setor[]>("/setores?todos=1").then(setSetores).finally(() => setLoading(false));
  }, [me]);

  function atualizar(s: Setor) {
    setSetores(prev => prev.map(x => x.id === s.id ? s : x));
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    setCriando(true);
    try {
      const s = await api.post<Setor>("/setores", { nome: novo.trim() });
      setSetores(prev => [...prev, s].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      setNovo("");
      setErroNovo("");
    } catch (err) {
      setErroNovo(mensagemErro(err, "Não foi possível criar o setor."));
    } finally {
      setCriando(false);
    }
  }

  async function alternarAtivo(s: Setor) {
    try {
      atualizar(await api.patch<Setor>(`/setores/${s.id}`, { ativo: !s.ativo }));
    } catch {}
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center"><ISpinner /></div>;
  }

  const ativos = setores.filter(s => s.ativo).length;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="w-full px-4 md:px-6 py-6 space-y-6">

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Setores</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {ativos} ativo{ativos !== 1 ? "s" : ""} · o setor de cada lista é marcado no drawer do quadro
            </p>
          </div>
          <form onSubmit={criar} className="flex items-start gap-2">
            <div>
              <input
                value={novo}
                onChange={e => { setNovo(e.target.value); setErroNovo(""); }}
                placeholder="Nome do setor"
                maxLength={80}
                className={cn(inputCls, "w-56 py-2")}
              />
              {erroNovo && <p className="text-xs text-red-500 mt-1">{erroNovo}</p>}
            </div>
            <button
              type="submit"
              disabled={criando || !novo.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-95 transition-all disabled:opacity-50"
            >
              <IPlus />Novo setor
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-border bg-slate-50 dark:bg-background-elevated">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Setor</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Listas</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border">
              {setores.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
                  <td className="px-5 py-3"><NomeSetor setor={s} onSalvo={atualizar} /></td>
                  <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{s.listas}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => alternarAtivo(s)}
                      title={s.ativo ? "Desativar: some do seletor do drawer" : "Reativar"}
                      className={cn(
                        "text-xs font-semibold rounded-full px-2.5 py-1 border transition-colors",
                        s.ativo
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20"
                          : "bg-slate-500/10 border-slate-500/30 text-slate-400 hover:bg-slate-500/20",
                      )}
                    >
                      {s.ativo ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
