import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, API_BASE } from "../lib/api";
import logo from "../assets/logo.png";
import { APP_VERSION } from "../data/changelog";

const ERROS_SSO: Record<string, string> = {
  usuario_nao_encontrado: "Nenhuma conta TaskHS para este e-mail Microsoft. Fale com o administrador.",
  usuario_inativo: "Sua conta está inativa. Fale com o administrador.",
  falha_microsoft: "Falha na autenticação com a Microsoft. Tente novamente.",
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Mensagem vinda do callback do SSO (o backend devolve aqui com ?erro=) —
  // erro derivado direto no estado inicial (evita setState síncrono dentro
  // de um efeito, que o lint reprova; mesmo padrão de AuthCallbackPage.tsx).
  const [error, setError] = useState(() => {
    const codigo = searchParams.get("erro");
    return codigo ? (ERROS_SSO[codigo] ?? "Não foi possível entrar. Tente novamente.") : "";
  });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [ssoAtivo, setSsoAtivo] = useState(false);

  // Sem app configurado no Azure, o botão nem aparece.
  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/sso/status")
      .then(r => setSsoAtivo(r.enabled))
      .catch(() => setSsoAtivo(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 dark:bg-primary/15 flex items-center justify-center mb-3 shadow-sm">
            <img src={logo} alt="" className="w-9 h-9 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">TaskHS</h1>
          <p className="text-sm text-slate-500 mt-1">Gestão de SST — faça login para continuar</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                E-mail
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="voce@healthsafety.com"
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background-elevated text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
              />
            </div>

            {/* Senha */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 text-sm rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background-elevated text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPass ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Erro */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-sm text-danger">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* Botão */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 mt-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Entrando…
                </>
              ) : "Entrar"}
            </button>
          </form>

            {ssoAtivo && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-border" />
                  <span className="text-xs text-slate-400 uppercase tracking-wide">ou</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-border" />
                </div>
                <a
                  href={`${API_BASE}/auth/microsoft`}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-background-elevated text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-background-surface active:scale-[0.98] transition-all duration-150"
                >
                  <svg className="w-4 h-4" viewBox="0 0 23 23" aria-hidden="true">
                    <path fill="#f25022" d="M0 0h11v11H0z" />
                    <path fill="#7fba00" d="M12 0h11v11H12z" />
                    <path fill="#00a4ef" d="M0 12h11v11H0z" />
                    <path fill="#ffb900" d="M12 12h11v11H12z" />
                  </svg>
                  Entrar com Microsoft
                </a>
              </>
            )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          TaskHS · Health & Safety Tech · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
