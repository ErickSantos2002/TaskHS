import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, type User } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { APP_VERSION } from "../data/changelog";

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const ticket = searchParams.get("ticket");
  // Sem ticket não há o que trocar — erro derivado direto no estado inicial
  // (evita setState síncrono dentro do efeito, que o lint reprova).
  const [erro, setErro] = useState(() =>
    ticket ? "" : "Link de autenticação inválido. Tente entrar de novo."
  );
  // StrictMode roda o efeito duas vezes em dev; o ticket é de uso único e a
  // segunda tentativa queimaria em 400. Uma trava por montagem resolve.
  const jaTrocou = useRef(false);

  useEffect(() => {
    if (!ticket || jaTrocou.current) return;
    jaTrocou.current = true;

    api
      .post<{ access_token: string; user: User }>("/auth/sso/exchange", { ticket })
      .then(data => {
        loginWithToken(data.access_token, data.user);
        navigate("/", { replace: true });
      })
      .catch(() => {
        setErro("Não foi possível concluir o login com a Microsoft. Tente de novo.");
      });
  }, [ticket, loginWithToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        {erro ? (
          <div className="rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-sm p-6">
            <div className="flex items-center gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-sm text-danger text-left mb-4">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {erro}
            </div>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-[0.98] transition-all duration-150"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
            <svg className="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Autenticando com a Microsoft…</p>
          </div>
        )}
        <p className="text-center text-xs text-slate-400 mt-6">
          TaskHS · Health &amp; Safety Tech · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
