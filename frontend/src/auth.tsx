import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, User } from "./api";

type LoginResult = { mfaRequired: false } | { mfaRequired: true; challenge: string };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  acceptToken: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
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

  async function login(username: string, password: string): Promise<LoginResult> {
    const res = await api<{ token?: string; user?: User; mfaRequired?: boolean; challenge?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    if (res.mfaRequired && res.challenge) {
      return { mfaRequired: true, challenge: res.challenge };
    }
    setToken(res.token!);
    setUser(res.user!);
    return { mfaRequired: false };
  }

  async function verifyMfa(challenge: string, code: string) {
    const res = await api<{ token: string; user: User }>("/api/login/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code })
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

  async function refreshUser() {
    if (!getToken()) return;
    const me = await api<User>("/api/me").catch(() => null);
    if (me) setUser(me);
  }

  return <Ctx.Provider value={{ user, loading, login, verifyMfa, acceptToken, logout, refreshUser }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
