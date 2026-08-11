import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Boundary da raiz: pega o que escapa do de dentro — erro no layout, no
        roteador ou no contexto de autenticação. Sem ele, a tela fica branca. */}
    <ErrorBoundary area="raiz">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
