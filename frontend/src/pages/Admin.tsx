import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, Activity, Connection, Grant, Health, Stats, User } from "../api";
import { useAuth } from "../auth";

const emptyHost = {
  name: "",
  protocol: "rdp",
  hostname: "",
  port: 3389,
  username: "",
  group: "Engineering",
  os: "",
  description: ""
};

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Admin() {
  const { user } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [form, setForm] = useState(emptyHost);
  const [msg, setMsg] = useState("");
  const [userForm, setUserForm] = useState({ username: "", password: "", displayName: "", email: "", role: "operator" });
  const [grantForm, setGrantForm] = useState({
    userId: "",
    connectionId: "",
    startsAt: localInput(new Date()),
    endsAt: localInput(new Date(Date.now() + 60 * 60 * 1000)),
    reason: ""
  });

  function refresh() {
    api<Health>("/api/health").then(setHealth);
    api<Stats>("/api/stats").then(setStats);
    api<Activity[]>("/api/activity").then(setActivity);
    api<Connection[]>("/api/connections").then(setConnections);
    if (user?.role === "admin") {
      api<User[]>("/api/users").then(setUsers);
      api<Grant[]>("/api/grants").then(setGrants);
    }
  }

  useEffect(() => {
    refresh();
  }, [user?.role]);

  async function addHost(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/connections", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          port: Number(form.port),
          tags: [form.protocol, form.group.toLowerCase()]
        })
      });
      setForm(emptyHost);
      setMsg("Host added");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    }
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(userForm) });
      setUserForm({ username: "", password: "", displayName: "", email: "", role: "operator" });
      setMsg("User added");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    }
  }

  async function patchUser(id: string, body: Partial<User> & { password?: string }) {
    await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    refresh();
  }

  async function addGrant(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/grants", {
        method: "POST",
        body: JSON.stringify({
          ...grantForm,
          startsAt: new Date(grantForm.startsAt).toISOString(),
          endsAt: new Date(grantForm.endsAt).toISOString()
        })
      });
      setMsg("Grant created");
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    }
  }

  async function revokeGrant(id: string) {
    await api(`/api/grants/${id}/revoke`, { method: "POST" });
    refresh();
  }

  function setWindow(hours: number) {
    const start = new Date();
    setGrantForm({
      ...grantForm,
      startsAt: localInput(start),
      endsAt: localInput(new Date(start.getTime() + hours * 60 * 60 * 1000))
    });
  }

  const operators = useMemo(() => users.filter((u) => !u.disabled), [users]);

  return (
    <div className="page admin">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Gateway</p>
          <h1>Console status</h1>
          <p className="lede">Users, timed grants, clipboard sync, and idle policy live here. The display stream is a private tunnel to the host.</p>
        </div>
      </section>

      <div className="admin-grid">
        <article className="panel">
          <h3>Status</h3>
          <ul className="kv">
            <li>
              <span>Mode</span>
              <b>{health?.gateway.mode || "—"}</b>
            </li>
            <li>
              <span>Link</span>
              <b>{health?.gateway.reachable ? "online" : "offline"}</b>
            </li>
            <li>
              <span>Live sessions</span>
              <b>{stats?.activeSessions ?? "—"}</b>
            </li>
            <li>
              <span>Active grants</span>
              <b>{stats?.grants ?? 0}</b>
            </li>
            <li>
              <span>Google</span>
              <b>{health?.sso?.google ? "ready" : "off"}</b>
            </li>
            <li>
              <span>Microsoft</span>
              <b>{health?.sso?.entra ? "ready" : "off"}</b>
            </li>
          </ul>
        </article>

        <article className="panel">
          <h3>How it is wired</h3>
          <ol className="steps">
            <li>
              <b>Browser</b> Helix console and HTML5 display
            </li>
            <li>
              <b>API</b> Sessions, grants, users, idle timeout
            </li>
            <li>
              <b>Tunnel</b> Encrypted display stream to the host
            </li>
            <li>
              <b>SSO</b> Local accounts, Google, or Microsoft Entra
            </li>
          </ol>
        </article>

        {user?.role === "admin" && (
          <article className="panel wide">
            <h3>Users</h3>
            <form className="host-form" onSubmit={addUser}>
              <input
                placeholder="Username"
                value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                required
              />
              <input
                placeholder="Password"
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                required
              />
              <input
                placeholder="Display name"
                value={userForm.displayName}
                onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })}
              />
              <input
                placeholder="Email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
              <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
              <button type="submit">Add user</button>
            </form>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <div className="tiny">
                        {u.username}
                        {u.email ? ` · ${u.email}` : ""}
                      </div>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        onChange={(e) => patchUser(u.id, { role: e.target.value })}
                        disabled={u.id === user.id}
                      >
                        <option value="operator">operator</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td>{u.disabled ? "disabled" : u.provider || "local"}</td>
                    <td className="row-actions">
                      {u.id !== user.id && (
                        <button className="ghost" type="button" onClick={() => patchUser(u.id, { disabled: !u.disabled })}>
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}

        {user?.role === "admin" && (
          <article className="panel wide">
            <h3>Timed access</h3>
            <p className="muted">A grant locks that user to the window. Hosts without grants stay open.</p>
            <form className="host-form" onSubmit={addGrant}>
              <select
                value={grantForm.userId}
                onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })}
                required
              >
                <option value="">User</option>
                {operators.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.username})
                  </option>
                ))}
              </select>
              <select
                value={grantForm.connectionId}
                onChange={(e) => setGrantForm({ ...grantForm, connectionId: e.target.value })}
              >
                <option value="">All hosts</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={grantForm.startsAt}
                onChange={(e) => setGrantForm({ ...grantForm, startsAt: e.target.value })}
              />
              <input
                type="datetime-local"
                value={grantForm.endsAt}
                onChange={(e) => setGrantForm({ ...grantForm, endsAt: e.target.value })}
              />
              <input
                placeholder="Reason"
                value={grantForm.reason}
                onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })}
              />
              <div className="chip-row">
                <button type="button" className="ghost" onClick={() => setWindow(1)}>
                  1 hour
                </button>
                <button type="button" className="ghost" onClick={() => setWindow(8)}>
                  8 hours
                </button>
                <button type="button" className="ghost" onClick={() => setWindow(24)}>
                  24 hours
                </button>
              </div>
              <button type="submit">Create grant</button>
            </form>
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Host</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {grants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No grants yet. Operators can open any host until you add one.
                    </td>
                  </tr>
                ) : (
                  grants.map((g) => (
                    <tr key={g.id}>
                      <td>{g.username}</td>
                      <td>{g.connectionName}</td>
                      <td>
                        {new Date(g.startsAt).toLocaleString()} → {new Date(g.endsAt).toLocaleString()}
                      </td>
                      <td className={`status ${g.status === "active" ? "online" : g.status === "scheduled" ? "degraded" : "offline"}`}>
                        {g.status}
                      </td>
                      <td className="row-actions">
                        {g.status !== "revoked" && g.status !== "expired" && (
                          <button className="ghost" type="button" onClick={() => revokeGrant(g.id)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        )}

        {user?.role === "admin" && (
          <article className="panel wide">
            <h3>Add connection</h3>
            <form className="host-form" onSubmit={addHost}>
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
                <option value="rdp">RDP</option>
                <option value="vnc">VNC</option>
                <option value="ssh">SSH</option>
              </select>
              <input
                placeholder="Hostname"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                required
              />
              <input
                placeholder="Port"
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
              <input
                placeholder="Username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <input
                placeholder="Group"
                value={form.group}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
              />
              <input placeholder="OS" value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} />
              <input
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <button type="submit">Map host</button>
            </form>
            {msg && <p className="tiny">{msg}</p>}
            <p className="tiny">{connections.length} hosts in catalog</p>
          </article>
        )}

        <article className="panel wide">
          <h3>Recent activity</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {activity.slice(0, 12).map((a) => (
                <tr key={a.id}>
                  <td>{a.time}</td>
                  <td>{a.user}</td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
    </div>
  );
}
