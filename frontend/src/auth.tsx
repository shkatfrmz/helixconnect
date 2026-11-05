import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  acceptToken: (token: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<User>("/api/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const res = await api<{ token: string; user: User }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    setToken(res.token);
    setUser(res.user);
  }

  async function acceptToken(token: string) {
    setToken(token);
    const me = await api<User>("/api/me");
    setUser(me);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, acceptToken, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
