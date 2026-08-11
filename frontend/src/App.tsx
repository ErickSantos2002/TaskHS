import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
                  <ErrorBoundary area="conteúdo">
                    <Routes>
                      <Route index element={<DashboardPage />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="boards" element={<BoardsPage />} />
                      <Route path="boards/:id" element={<BoardPage />} />
                      <Route path="usuarios" element={<UsersPage />} />
                      <Route path="logs" element={<LogsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </ErrorBoundary>
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
