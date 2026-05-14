import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { User } from "../types";

// ── Icons ─────────────────────────────────────────────────────

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const ITrash = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const IShield = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const IX = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ── New User Modal ─────────────────────────────────────────────

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: User) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", initials: "", is_admin: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.initials.trim()) {
      setError("Preencha todos os campos.");
      return;
    }
    setLoading(true);
    try {
      const user = await api.post<User>("/auth/users", form);
      onCreated(user);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao criar usuário.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-border">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Novo usuário</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-background-elevated transition-colors">
            <IX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nome completo</label>
              <input
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="Ex: João Silva"
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Iniciais</label>
              <input
                value={form.initials}
                onChange={e => set("initials", e.target.value.toUpperCase().slice(0, 4))}
                placeholder="JS"
                maxLength={4}
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400 uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="joao@empresa.com"
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Senha</label>
            <input
              type="password"
              value={form.password}
              onChange={e => set("password", e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => set("is_admin", !form.is_admin)}
              className={cn(
                "w-10 h-6 rounded-full transition-colors relative shrink-0",
                form.is_admin ? "bg-primary" : "bg-slate-200 dark:bg-border"
              )}
            >
              <span className={cn(
                "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                form.is_admin ? "translate-x-5" : "translate-x-1"
              )} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Administrador</p>
              <p className="text-xs text-slate-400">Pode gerenciar usuários e boards</p>
            </div>
          </label>

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-border text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-all"
            >
              {loading ? "Criando…" : "Criar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── UsersPage ──────────────────────────────────────────────────

export function UsersPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!me?.is_admin) { navigate("/boards", { replace: true }); return; }
    api.get<User[]>("/auth/users").then(setUsers).finally(() => setLoading(false));
  }, [me]);

  async function handleToggleAdmin(user: User) {
    try {
      const updated = await api.patch<User>(`/auth/users/${user.id}`, { is_admin: !user.is_admin });
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    } catch {}
  }

  async function handleDelete(userId: number) {
    setDeletingId(userId);
    try {
      await api.del(`/auth/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch {}
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center"><ISpinner /></div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Usuários</h1>
            <p className="text-sm text-slate-500 mt-0.5">{users.length} usuário{users.length !== 1 ? "s" : ""} cadastrado{users.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-95 transition-all"
          >
            <IPlus />Novo usuário
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-border bg-slate-50 dark:bg-background-elevated">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Usuário</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Perfil</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Membro desde</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{u.initials}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{u.name}</p>
                        {u.id === me?.id && <span className="text-[10px] text-primary font-medium">você</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{u.email}</td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full",
                      u.is_admin
                        ? "bg-primary/10 text-primary"
                        : "bg-slate-100 dark:bg-background-elevated text-slate-500"
                    )}>
                      {u.is_admin && <IShield />}
                      {u.is_admin ? "Administrador" : "Membro"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {u.id !== me?.id && (
                        <>
                          <button
                            onClick={() => handleToggleAdmin(u)}
                            title={u.is_admin ? "Remover admin" : "Tornar admin"}
                            className={cn(
                              "p-2 rounded-lg transition-colors text-xs",
                              u.is_admin
                                ? "text-primary hover:bg-primary/10"
                                : "text-slate-400 hover:text-primary hover:bg-primary/10"
                            )}
                          >
                            <IShield />
                          </button>
                          {confirmDeleteId === u.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => handleDelete(u.id)}
                                disabled={deletingId === u.id}
                                className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold"
                              >
                                {deletingId === u.id ? "…" : "Confirmar"}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(u.id)}
                              title="Excluir usuário"
                              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                            >
                              <ITrash />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <NewUserModal
          onClose={() => setShowModal(false)}
          onCreated={u => setUsers(prev => [...prev, u].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}
    </div>
  );
}
