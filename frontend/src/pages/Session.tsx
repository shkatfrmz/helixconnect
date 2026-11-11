import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Connection, Session as SessionT } from "../api";
import DisplayStage from "../components/DisplayStage";

type Tick = { cpu: number; mem: number; fps: number; idleRemainingMs?: number | null };
type ChatMessage = { from: string; text: string; at: string };

const PROTO_LABEL: Record<string, string> = { rdp: "RDP", vnc: "VNC", ssh: "SSH", telnet: "TELNET", kubernetes: "K8S" };

export default function Session() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const sid = params.get("sid") || "";
  const [conn, setConn] = useState<Connection | null>(null);
  const [session, setSession] = useState<SessionT | null>(null);
  const [allConnections, setAllConnections] = useState<Connection[]>([]);
  const [openSessions, setOpenSessions] = useState<Record<string, SessionT>>({});
  const [switchError, setSwitchError] = useState("");
  const [tick, setTick] = useState<Tick | null>(null);
  const [clipboard, setClipboard] = useState("");
  const [outgoingClip, setOutgoingClip] = useState("");
  const [autoClip, setAutoClip] = useState(true);
  const lastLocalClip = useRef("");
  const autoClipRef = useRef(true);
  autoClipRef.current = autoClip;
  const [fs, setFs] = useState(false);
  const [keys, setKeys] = useState<string[]>([]);
  const [scaleMode, setScaleMode] = useState<"fit" | "1:1">("fit");
  const [osk, setOsk] = useState(false);
  const [tunnelState, setTunnelState] = useState("idle");
  const [shareMsg, setShareMsg] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatLogRef = useRef<HTMLDivElement>(null);
  const [idleMs, setIdleMs] = useState<number | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [injectKey, setInjectKey] = useState<{ keysym: number; pressed: boolean; n: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!id) return;
    api<Connection>(`/api/connections/${id}`).then(setConn);
  }, [id]);

  useEffect(() => {
    if (!sid) return;
    api<SessionT>(`/api/sessions/${sid}`).then(setSession).catch(() => undefined);
  }, [sid]);

  useEffect(() => {
    api<Connection[]>("/api/connections").then(setAllConnections);
  }, []);

  // Track which connections already have a live session so the tree can
  // switch back to one without opening a second session for the same host.
  useEffect(() => {
    if (!id || !session) return;
    setOpenSessions((prev) => ({ ...prev, [id]: session }));
  }, [id, session]);

  async function switchTo(target: Connection) {
    setSwitchError("");
    if (target.id === id) return;
    const existing = openSessions[target.id];
    if (existing && existing.status !== "disconnected") {
      nav(`/session/${target.id}?sid=${existing.id}`, { replace: true });
      return;
    }
    try {
      const sess = await api<SessionT>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          connectionId: target.id,
          width: Math.round(window.innerWidth * 0.6),
          height: Math.round(window.innerHeight * 0.7)
        })
      });
      setOpenSessions((prev) => ({ ...prev, [target.id]: sess }));
      nav(`/session/${target.id}?sid=${sess.id}`, { replace: true });
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : `Could not connect to ${target.name}`);
    }
  }

  const groupedConnections = useMemo(() => {
    const groups = new Map<string, Connection[]>();
    for (const c of allConnections) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)!.push(c);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allConnections]);

  useEffect(() => {
    if (!id) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({ connectionId: id });
    if (sid) qs.set("sessionId", sid);
    const ws = new WebSocket(`${proto}://${location.host}/ws/demo?${qs.toString()}`);
    wsRef.current = ws;
    setChat([]);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "tick") {
        setTick(msg);
        if (typeof msg.idleRemainingMs === "number") setIdleMs(msg.idleRemainingMs);
        if (msg.session) setSession((s) => ({ ...(s || msg.session), ...msg.session }));
      }
      if (msg.type === "clipboard" && typeof msg.text === "string") {
        lastLocalClip.current = msg.text;
        setClipboard(msg.text);
        if (autoClipRef.current) navigator.clipboard?.writeText(msg.text).catch(() => undefined);
      }
      if (msg.type === "ended") {
        setSession(msg.session);
        setTunnelState(msg.reason || "ended");
      }
      if (msg.type === "idle-warn") setTunnelState("idle warning");
      if (msg.type === "grant-warn") setTunnelState("grant ending");
      if (msg.type === "reconnected") setSession(msg.session);
      if (msg.type === "chat" && typeof msg.text === "string") {
        setChat((prev) => [...prev, { from: msg.from, text: msg.text, at: msg.at }].slice(-200));
      }
    };
    const beat = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "heartbeat" }));
      if (sid) api(`/api/sessions/${sid}/heartbeat`, { method: "POST" }).catch(() => undefined);
    }, 8000);
    return () => {
      clearInterval(beat);
      ws.close();
    };
  }, [id, sid]);

  useEffect(() => {
    function onFs() {
      setFs(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const title = useMemo(() => conn?.name || "Session", [conn]);

  function toggleFs() {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => setFs(true));
    else document.exitFullscreen();
  }

  async function share() {
    if (!sid) return;
    const res = await api<{ shareCode: string; url: string; session: SessionT }>(`/api/sessions/${sid}/share`, {
      method: "POST"
    });
    setSession(res.session);
    const url = `${location.origin}${res.url}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setShareMsg(`Share code ${res.shareCode} copied`);
  }

  async function unshare() {
    if (!sid) return;
    const next = await api<SessionT>(`/api/sessions/${sid}/unshare`, { method: "POST" });
    setSession(next);
    setShareMsg("Sharing stopped");
  }

  async function reconnect() {
    if (!sid) return;
    const next = await api<SessionT>(`/api/sessions/${sid}/reconnect`, { method: "POST" });
    setSession(next);
    setReconnectNonce((n) => n + 1);
    setTunnelState("reconnecting");
  }

  async function disconnect() {
    if (sid) await api(`/api/sessions/${sid}/disconnect`, { method: "POST" }).catch(() => undefined);
    nav("/");
  }

  function pushClip(text: string) {
    if (!text || text === lastLocalClip.current) return;
    lastLocalClip.current = text;
    setClipboard(text);
    setOutgoingClip(`${text}\u200b${Date.now()}`);
    wsRef.current?.send(JSON.stringify({ type: "clipboard", text }));
  }

  function sendClip() {
    lastLocalClip.current = "";
    pushClip(clipboard);
  }

  function ingestRemoteClip(text: string) {
    lastLocalClip.current = text;
    setClipboard(text);
    if (autoClipRef.current) navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  useEffect(() => {
    if (!autoClip) return;
    async function pullLocal() {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastLocalClip.current) pushClip(text);
      } catch {
        /* clipboard permission may be denied until click */
      }
    }
    pullLocal();
    const onFocus = () => pullLocal();
    const onCopy = () => window.setTimeout(pullLocal, 50);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    const beat = window.setInterval(pullLocal, 2500);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      window.clearInterval(beat);
    };
  }, [autoClip]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "chat", text }));
    setChatInput("");
  }

  function oskPress(label: string, keysym: number) {
    setKeys((k) => [label, ...k].slice(0, 8));
    const n = Date.now();
    setInjectKey({ keysym, pressed: true, n });
    window.setTimeout(() => setInjectKey({ keysym, pressed: false, n: n + 1 }), 80);
  }

  if (!conn) return <div className="page">Loading session…</div>;

  const remaining = idleMs == null ? null : Math.max(0, Math.round(idleMs / 1000));
  const ended = session?.status === "disconnected";

  return (
    <div className={`page session ${fs ? "is-fs" : ""}`}>
      <div className="session-meta">
        <button className="ghost" onClick={() => nav("/")}>
          Back
        </button>
        <div>
          <p className="eyebrow">
            {conn.protocol.toUpperCase()} · {conn.os} · {session?.mode || "preview"}
          </p>
          <h1>{title}</h1>
        </div>
        <div className="session-id">
          <span>SID {(session?.id || sid).slice(-10)}</span>
          <span>
            {conn.hostname}:{conn.port}
          </span>
          <span className={`status ${session?.status || "active"}`}>{session?.status || "active"}</span>
        </div>
      </div>

      <div className="session-layout">
        <aside className="conn-tree">
          {groupedConnections.map(([groupName, items]) => (
            <div key={groupName}>
              <p className="conn-tree-group">{groupName}</p>
              {items.map((c) => {
                const locked = c.status === "offline" || (c.access ? !c.access.allowed : false);
                const isActive = c.id === id;
                const isOpen = Boolean(openSessions[c.id] && openSessions[c.id].status !== "disconnected");
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`conn-tree-item ${isActive ? "active" : ""}`}
                    disabled={locked}
                    title={locked ? c.access?.reason || "Host offline" : `${c.hostname}:${c.port}`}
                    onClick={() => switchTo(c)}
                  >
                    <span className={`dot ${c.status}`} />
                    <span className="name">{c.name}</span>
                    {isOpen && <span className="live-mark" title="Session open" />}
                    <span className="proto-tag">{PROTO_LABEL[c.protocol]}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {switchError && <p className="form-error">{switchError}</p>}
        </aside>

        <div className="bezel" ref={stageRef}>
          <div className="bezel-chrome">
            <span className="traffic" aria-hidden>
              <i className="c" />
              <i className="m" />
              <i className="x" />
            </span>
            <span className="win-title">{title}</span>
            <span>{scaleMode === "fit" ? "FIT" : "1:1"}</span>
            <span className="live-dot">{tunnelState}</span>
          </div>
          <div className="viewport">
            <DisplayStage
              conn={conn}
              mode={session?.mode || "demo"}
              token={session?.displayToken}
              readOnly={session?.readOnly}
              scaleMode={scaleMode}
              sendClipboard={outgoingClip}
              injectKey={injectKey}
              reconnectNonce={reconnectNonce}
              onClipboard={ingestRemoteClip}
              onState={setTunnelState}
              onKey={(k) => setKeys((prev) => [k, ...prev].slice(0, 8))}
            />
            <div className="osd">
              <span>{tick ? `${tick.fps} fps` : "— fps"}</span>
              <span>{tick ? `cpu ${tick.cpu}%` : "cpu —"}</span>
              <span>{remaining == null ? "idle —" : `idle ${remaining}s`}</span>
              {session?.grantEndsAt && (
                <span>grant {Math.max(0, Math.round((new Date(session.grantEndsAt).getTime() - Date.now()) / 60000))}m</span>
              )}
            </div>
            {ended && (
              <div className="session-overlay">
                <p>Session ended</p>
                <button onClick={reconnect}>Reconnect</button>
              </div>
            )}
          </div>
          {osk && (
            <div className="osk">
              {[
                ["Esc", 0xff1b],
                ["Tab", 0xff09],
                ["Ctrl", 0xffe3],
                ["Alt", 0xffe9],
                ["Win", 0xffeb],
                ["Del", 0xffff],
                ["Enter", 0xff0d],
                ["Bksp", 0xff08],
                ["Up", 0xff52],
                ["Dn", 0xff54],
                ["Lt", 0xff51],
                ["Rt", 0xff53]
              ].map(([label, keysym]) => (
                <button key={String(label)} type="button" onClick={() => oskPress(String(label), Number(keysym))}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="bezel-tools">
            <button onClick={toggleFs}>{fs ? "Exit fullscreen" : "Fullscreen"}</button>
            <button onClick={() => setScaleMode((m) => (m === "fit" ? "1:1" : "fit"))}>
              {scaleMode === "fit" ? "1:1 scale" : "Fit display"}
            </button>
            <button onClick={() => setOsk((v) => !v)}>{osk ? "Hide OSK" : "On-screen keys"}</button>
            <button onClick={reconnect}>Reconnect</button>
            <button onClick={disconnect}>Disconnect</button>
          </div>
        </div>

        <aside className="sideboard">
          <section>
            <h4>Share</h4>
            <p className="muted">Anyone with the code can join as a viewer.</p>
            {session?.shareCode ? (
              <>
                <p className="share-code">{session.shareCode}</p>
                <button className="ghost" onClick={unshare}>
                  Stop sharing
                </button>
              </>
            ) : (
              <button onClick={share}>Create share code</button>
            )}
            {shareMsg && <p className="tiny">{shareMsg}</p>}
            {session?.viewers?.length ? <p className="tiny">Viewers: {session.viewers.join(", ")}</p> : null}
          </section>
          {(session?.shareCode || session?.parentId) && (
            <section>
              <h4>Chat</h4>
              <p className="muted">Visible to the host and everyone watching this shared session.</p>
              <div className="chat-log" ref={chatLogRef}>
                {chat.length === 0 && <p className="tiny muted">No messages yet.</p>}
                {chat.map((m, i) => (
                  <p key={i} className="chat-msg">
                    <b>{m.from}</b>
                    <span>{m.text}</span>
                  </p>
                ))}
              </div>
              <div className="chat-input-row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChatMessage();
                  }}
                  placeholder="Message everyone watching…"
                />
                <button className="ghost" onClick={sendChatMessage} disabled={!chatInput.trim()}>
                  Send
                </button>
              </div>
            </section>
          )}
          <section>
            <h4>Clipboard</h4>
            <p className="muted">Syncs text between this browser and the remote session.</p>
            <label className="toggle">
              <input type="checkbox" checked={autoClip} onChange={(e) => setAutoClip(e.target.checked)} />
              Auto-sync
            </label>
            <textarea
              value={clipboard}
              onChange={(e) => setClipboard(e.target.value)}
              placeholder="Paste to send, or grab from remote"
            />
            <button className="ghost" onClick={sendClip}>
              Send to remote
            </button>
          </section>
          <section>
            <h4>Session</h4>
            <ul className="kv">
              <li>
                <span>Protocol</span>
                <b>{conn.protocol}</b>
              </li>
              <li>
                <span>Reconnects</span>
                <b>{session?.reconnectCount ?? 0}</b>
              </li>
              <li>
                <span>Idle limit</span>
                <b>{Math.round((session?.idleTimeoutMs || 900000) / 60000)} min</b>
              </li>
              {session?.grantEndsAt && (
                <li>
                  <span>Grant ends</span>
                  <b>{new Date(session.grantEndsAt).toLocaleTimeString()}</b>
                </li>
              )}
              <li>
                <span>Mode</span>
                <b>{session?.mode === "live" ? "live" : "preview"}</b>
              </li>
            </ul>
            {keys.length > 0 && (
              <div className="keylog">
                {keys.map((k, i) => (
                  <code key={i}>{k}</code>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
