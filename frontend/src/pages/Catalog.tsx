import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Connection, Stats } from "../api";

const PROTO_LABEL: Record<string, string> = {
  rdp: "RDP",
  vnc: "VNC",
  ssh: "SSH",
  telnet: "TELNET",
  kubernetes: "K8S"
};

export default function Catalog() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [proto, setProto] = useState("all");
  const [group, setGroup] = useState("all");
  const [pending, setPending] = useState<Connection | null>(null);
  const [credUser, setCredUser] = useState("");
  const [credPass, setCredPass] = useState("");
  const [openError, setOpenError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api<Connection[]>("/api/connections").then(setConnections);
    api<Stats>("/api/stats").then(setStats);
  }, []);

  const groups = useMemo(() => ["all", ...new Set(connections.map((c) => c.group))], [connections]);

  const filtered = connections.filter((c) => {
    const hay = `${c.name} ${c.hostname} ${c.os} ${c.tags.join(" ")}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (proto !== "all" && c.protocol !== proto) return false;
    if (group !== "all" && c.group !== group) return false;
    return true;
  });

  function requestOpen(c: Connection) {
    if (c.access && !c.access.allowed) return;
    setPending(c);
    setCredUser(c.username || "");
    setCredPass("");
  }

  async function openSession(id: string, username?: string, password?: string) {
    setOpenError("");
    try {
      const sess = await api<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          connectionId: id,
          username,
          password,
          width: Math.round(window.innerWidth * 0.7),
          height: Math.round(window.innerHeight * 0.7)
        })
      });
      setPending(null);
      nav(`/session/${id}?sid=${sess.id}`);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Could not open session");
    }
  }

  return (
    <div className="page catalog">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Connections</p>
          <h1>lets connect</h1>
        </div>
        <div className="stat-row">
          <Stat n={stats?.online ?? "—"} l="online" />
          <Stat n={stats?.connections ?? "—"} l="hosts" />
          <Stat n={stats?.activeSessions ?? "—"} l="sessions" />
          <Stat n={stats?.backendMode === "live" ? "LIVE" : "PREVIEW"} l="gateway" accent />
        </div>
      </section>

      <div className="filters">
        <input placeholder="Search host, OS, tag" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={proto} onChange={(e) => setProto(e.target.value)}>
          <option value="all">All protocols</option>
          <option value="rdp">RDP</option>
          <option value="vnc">VNC</option>
          <option value="ssh">SSH</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g === "all" ? "All groups" : g}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-row">
          <div className="empty-row-photo empty-row-photo-alt" />
          <div>
            <strong>No hosts match those filters</strong>
            <p className="muted">Try a different search term, protocol, or group.</p>
          </div>
        </div>
      ) : (
        <div className="rack">
          {filtered.map((c) => (
            <article key={c.id} className={`blade ${c.status}`}>
              <header>
                <span className={`proto ${c.protocol}`}>{PROTO_LABEL[c.protocol]}</span>
                <span className={`status ${c.status}`}>{c.status}</span>
              </header>
              <h3>{c.name}</h3>
              <p className="host">
                {c.hostname}:{c.port}
              </p>
              <p className="desc">{c.description}</p>
              <dl>
                <div>
                  <dt>OS</dt>
                  <dd>{c.os}</dd>
                </div>
                <div>
                  <dt>Group</dt>
                  <dd>{c.group}</dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd>{c.latencyMs == null ? "—" : `${c.latencyMs} ms`}</dd>
                </div>
              </dl>
              <div className="tags">
                {c.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              {c.access && !c.access.standing && (
                <p className="tiny">
                  {c.access.allowed && c.access.grant
                    ? `Grant until ${new Date(c.access.grant.endsAt).toLocaleString()}`
                    : c.access.reason || "No grant"}
                </p>
              )}
              <footer>
                <button
                  disabled={c.status === "offline" || (c.access ? !c.access.allowed : false)}
                  onClick={() => requestOpen(c)}
                >
                  {c.status === "offline" ? "Host down" : c.access && !c.access.allowed ? "No access" : "Open session"}
                </button>
                <small>Last seen {c.lastSeen}</small>
              </footer>
            </article>
          ))}
        </div>
      )}

      {pending && (
        <div className="modal-back" onClick={() => setPending(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              openSession(pending.id, credUser, credPass);
            }}
          >
            <p className="eyebrow">{pending.protocol.toUpperCase()}</p>
            <h3>Connect to {pending.name}</h3>
            <p className="muted">
              {pending.hostname}:{pending.port} — credentials stay on this session.
            </p>
            <label>
              Username
              <input value={credUser} onChange={(e) => setCredUser(e.target.value)} autoFocus />
            </label>
            <label>
              Password
              <input type="password" value={credPass} onChange={(e) => setCredPass(e.target.value)} />
            </label>
            {openError && <p className="form-error">{openError}</p>}
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="submit">Connect</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Stat({ n, l, accent }: { n: string | number; l: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <b>{n}</b>
      <span>{l}</span>
    </div>
  );
}
