import { Component, type ReactNode, type ErrorInfo } from "react";

/** Rede de segurança para erro de render.
 *
 *  POR QUE EXISTE: sem boundary, qualquer erro durante o render faz o React
 *  desmontar a árvore INTEIRA — a tela fica em branco e a pessoa não tem o que
 *  fazer nem o que reportar. Aconteceu em produção (jul/2026) com um "Minified
 *  React error #185" (loop de atualização), e o único rastro foi um stack
 *  minificado num bundle que já não existia mais.
 *
 *  Faz duas coisas, e só: mostra o erro de um jeito que dá para fotografar, e
 *  registra `componentStack` no console — que é o que diz QUAL componente
 *  quebrou. Não tenta se recuperar sozinho: remontar a mesma árvore que acabou
 *  de entrar em loop só refaz o loop. */
interface Props {
  children: ReactNode;
  /** Aparece na mensagem e no log — para distinguir a raiz do app da área de conteúdo. */
  area: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // Uma linha só, com tudo que o diagnóstico precisa: a mensagem, onde a
    // pessoa estava e a pilha de componentes.
    console.error(
      `[TaskHS] erro de render em "${this.props.area}" · ${window.location.pathname}${window.location.search}\n` +
      `${error.message}\n` +
      `componentStack:${info.componentStack ?? " (indisponível)"}`,
      error,
    );
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    // As posições saem minificadas (arquivo.js:linha:coluna). Não tem problema:
    // o build publica o sourcemap, então esses números viram linha de código
    // exata na hora do diagnóstico. É por isso que o print vale.
    const detalhe = [
      error.message,
      `em: ${this.props.area} · ${window.location.pathname}${window.location.search}`,
      // O stack do erro vem primeiro: é ele que aponta quem disparou.
      error.stack ? `origem:\n${error.stack.split("\n").slice(1, 5).join("\n")}` : null,
      componentStack ? `componentes:${componentStack.split("\n").slice(0, 5).join("\n")}` : null,
    ].filter(Boolean).join("\n");

    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="max-w-lg w-full rounded-2xl border border-border bg-background-surface p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/15 text-red-400 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.4 14.55A1.5 1.5 0 003.24 21h17.52a1.5 1.5 0 001.3-2.51l-8.4-14.55a1.5 1.5 0 00-2.6 0z" />
              </svg>
            </span>
            <div>
              <p className="text-base font-bold text-slate-100">Algo quebrou nesta tela</p>
              <p className="text-xs text-slate-500">Nada do seu trabalho foi perdido — o que estava salvo continua salvo.</p>
            </div>
          </div>

          <p className="text-sm text-slate-400">
            Recarregue a página para continuar. Se der para <span className="font-semibold text-slate-300">mandar um print
            deste quadro cinza</span> para a equipe, ele diz exatamente onde foi o defeito.
          </p>

          <pre className="text-[11px] leading-relaxed text-slate-400 bg-background rounded-lg border border-border p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-52">
            {detalhe}
          </pre>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 transition-colors"
          >
            Recarregar a página
          </button>
        </div>
      </div>
    );
  }
}
