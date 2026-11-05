import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api, Health } from "../api";

export default function Login() {
  const { login, acceptToken, user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  useEffect(() => {
    api<Health>("/api/health").then(setHealth).catch(() => undefined);
  }, []);

  useEffect(() => {
    const token = params.get("token");
    const sso = params.get("sso");
    const ssoError = params.get("error");
    if (ssoError) {
      setError(ssoError);
      setParams({}, { replace: true });
      return;
    }
    if (sso === "1" && token) {
      setBusy(true);
      acceptToken(token)
        .then(() => nav("/", { replace: true }))
        .catch((err) => setError(err instanceof Error ? err.message : "SSO failed"))
        .finally(() => {
          setBusy(false);
          setParams({}, { replace: true });
        });
    }
  }, [params, acceptToken, nav, setParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function startSso(provider: "google" | "entra") {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ url: string }>(`/api/auth/${provider}/start`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO is not configured");
      setBusy(false);
    }
  }

  const live = health?.gateway.reachable;
  const sso = health?.sso;

  return (
    <div className="login-root">
      <div className="login-photo" />
      <div className="login-wash" />
      <aside className="login-brand">
        <div className="mark">HX</div>
        <p className="eyebrow">Remote operations</p>
        <h1>Helix Remote</h1>
        <p className="lede">RDP, VNC, and SSH in the browser. Share a session, lock idle desks, disconnect from anywhere.</p>
        <div className={`backend-chip ${health?.gateway.mode || "demo"}`}>
          <span className="dot" />
          {health ? (live ? "Gateway online" : "Preview mode · host offline") : "Checking gateway…"}
        </div>
      </aside>
      <main className="login-panel">
        <form onSubmit={onSubmit} className="login-form">
          <h2>Sign in</h2>
          <p className="hint">Use admin / admin or operator / operator, or continue with SSO.</p>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Enter console"}
          </button>
          <div className="sso-row">
            <button type="button" className="ghost" disabled={busy || !sso?.google} onClick={() => startSso("google")}>
              {sso?.google ? "Continue with Google" : "Google not configured"}
            </button>
            <button type="button" className="ghost" disabled={busy || !sso?.entra} onClick={() => startSso("entra")}>
              {sso?.entra ? "Continue with Microsoft" : "Microsoft not configured"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
