import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MainLayout } from "./layouts/MainLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { BoardsPage } from "./pages/BoardsPage";
import { BoardPage } from "./pages/BoardPage";
import { UsersPage } from "./pages/UsersPage";
import { LogsPage } from "./pages/LogsPage";

/** Boundary do conteúdo, com a volta ao início feita POR DENTRO do app.
 *
 *  Precisa deste invólucro porque `useNavigate` só existe dentro do roteador e
 *  o boundary é componente de classe. A troca de rota aqui não recarrega a
 *  página — que é o ponto: o F5 derruba a sessão do Fortipam. */
function ConteudoComRedeDeSeguranca({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <ErrorBoundary area="conteúdo" aoVoltar={() => navigate("/", { replace: true })}>
      {children}
    </ErrorBoundary>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <MainLayout>
                  {/* Boundary por conteúdo: erro numa página derruba só a
                      página — a barra lateral segue de pé e a pessoa consegue
                      sair para outra tela sem recarregar. */}
                  <ConteudoComRedeDeSeguranca>
                    <Routes>
                      <Route index element={<DashboardPage />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="boards" element={<BoardsPage />} />
                      <Route path="boards/:id" element={<BoardPage />} />
                      <Route path="usuarios" element={<UsersPage />} />
                      <Route path="logs" element={<LogsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </ConteudoComRedeDeSeguranca>
                </MainLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
