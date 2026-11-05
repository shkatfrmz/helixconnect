import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Shell from "./pages/Shell";
import Catalog from "./pages/Catalog";
import Session from "./pages/Session";
import Admin from "./pages/Admin";
import Live from "./pages/Live";
import Join from "./pages/Join";

function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Helix Remote</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Private>
              <Shell />
            </Private>
          }
        >
          <Route index element={<Catalog />} />
          <Route path="live" element={<Live />} />
          <Route path="join/:code" element={<Join />} />
          <Route path="session/:id" element={<Session />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
