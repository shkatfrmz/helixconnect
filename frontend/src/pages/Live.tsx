import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Session } from "../api";
import { useAuth } from "../auth";

function age(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function Live() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const list = await api<Session[]>("/api/sessions");
    setSessions(list);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  async function join(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const sess = await api<Session>("/api/join", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      nav(`/session/${sess.connectionId}?sid=${sess.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Join failed");
    }
  }

  async function kill(id: string) {
    await api(`/api/sessions/${id}/disconnect`, { method: "POST" });
    refresh();
  }

  return (
    <div className="page">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Live</p>
          <h1>Active sessions</h1>
        </div>
      </section>

      <form className="join-bar" onSubmit={join}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Share code"
          maxLength={12}
        />
        <button type="submit">Join as viewer</button>
        {error && <span className="form-error">{error}</span>}
      </form>

      <div className="session-table panel">
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Operator</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Share</th>
              <th>Age</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-row">
                    <div className="empty-row-photo" />
                    <div>
                      <strong>No live sessions</strong>
                      <p className="muted">Open a connection from the catalog to start one.</p>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <b>{s.connectionName}</b>
                  <div className="tiny">{s.protocol.toUpperCase()}</div>
                </td>
                <td>{s.displayName || s.username}</td>
                <td>{s.mode}</td>
                <td className={`status ${s.status}`}>{s.status}</td>
                <td>{s.shareCode || "—"}</td>
                <td>{age(s.startedAt)}</td>
                <td className="row-actions">
                  <button className="ghost" onClick={() => nav(`/session/${s.connectionId}?sid=${s.id}`)}>
                    Open
                  </button>
                  {(user?.role === "admin" || user?.username === s.username) && (
                    <button className="ghost" onClick={() => kill(s.id)}>
                      End
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
