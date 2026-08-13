import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Falha ao PRÉ-CARREGAR o CSS de um pedaço sob demanda não pode derrubar o app.
// O Vite dispara este evento e, se ninguém cancelar, ele relança o erro — foi
// assim que um "Unable to preload CSS for /assets/PdfViewer-*.css" apagou a
// tela de um usuário (ago/2026). Cancelando, o módulo continua carregando
// normalmente (o Vite trata o CSS ANTES de importar o módulo); o pior caso vira
// um estilo faltando, não a aplicação inteira sumindo.
// Falha do JS não entra aqui de propósito: cancelar entregaria um módulo vazio
// ao React, trocando um erro claro por um confuso. Essa cai no boundary.
window.addEventListener('vite:preloadError', (evento) => {
  const erro = (evento as Event & { payload?: unknown }).payload
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? '')
  if (!mensagem.includes('Unable to preload CSS')) return
  evento.preventDefault()
  console.warn(`[TaskHS] CSS de um módulo sob demanda não carregou; seguindo sem ele. ${mensagem}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Boundary da raiz: pega o que escapa do de dentro — erro no layout, no
        roteador ou no contexto de autenticação. Sem ele, a tela fica branca. */}
    {/* Aqui fora do roteador não dá para usar useNavigate: troco a URL na mão e
        deixo o App remontar (o boundary zera o estado no mesmo clique). Sem
        recarregar — o F5 derrubaria a sessão do Fortipam. */}
    <ErrorBoundary area="raiz" aoVoltar={() => window.history.pushState({}, '', '/')}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
