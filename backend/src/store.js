import { users, connections as seedConnections, activity as seedActivity } from "./data.js";
import { newId, shareCode } from "./crypto.js";

export const directory = users;
export const connections = seedConnections.map((c) => ({
  ...c,
  password: c.password || "",
  ignoreCert: true,
  security: c.protocol === "rdp" ? "any" : undefined
}));
export const activity = [...seedActivity];
export const grants = [];
export const sessions = new Map();
export const rooms = new Map();

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    avatar: user.avatar,
    email: user.email || "",
    provider: user.provider || "local",
    disabled: Boolean(user.disabled)
  };
}

export function initials(name) {
  return String(name || "HX")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "HX";
}

export function upsertSsoUser({ email, displayName, username, provider }) {
  const mail = String(email || "").toLowerCase();
  let user = directory.find((u) => u.email && u.email.toLowerCase() === mail);
  if (!user) {
    user = directory.find((u) => u.provider === provider && u.username === username);
  }
  if (user) {
    if (user.disabled) {
      const err = new Error("Account disabled");
      err.status = 403;
      throw err;
    }
    user.displayName = displayName || user.displayName;
    user.email = mail || user.email;
    user.provider = provider;
    user.avatar = user.avatar || initials(user.displayName);
    return user;
  }
  let uname = username || mail.split("@")[0] || "user";
  if (directory.some((u) => u.username === uname)) uname = `${uname}-${newId("sso").slice(-4)}`;
  user = {
    id: newId("u"),
    username: uname,
    password: "",
    displayName: displayName || uname,
    role: "operator",
    avatar: initials(displayName || uname),
    email: mail,
    provider,
    disabled: false
  };
  directory.push(user);
  return user;
}

export function publicConnection(conn) {
  const { password, ...rest } = conn;
  return rest;
}

export function logActivity(user, action, target, type = "session") {
  activity.unshift({
    id: newId("act"),
    user,
    action,
    target,
    time: "Just now",
    type
  });
  if (activity.length > 80) activity.pop();
}

export function sessionView(session) {
  return {
    id: session.id,
    connectionId: session.connectionId,
    connectionName: session.connectionName,
    protocol: session.protocol,
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
    mode: session.mode,
    status: session.status,
    shareCode: session.shareCode,
    sharing: Boolean(session.shareCode),
    viewers: session.viewers,
    idleTimeoutMs: session.idleTimeoutMs,
    reconnectCount: session.reconnectCount,
    readOnly: session.readOnly,
    parentId: session.parentId || null,
    grantId: session.grantId || null,
    grantEndsAt: session.grantEndsAt || null
  };
}

export function grantStatus(grant, at = Date.now()) {
  if (grant.revoked) return "revoked";
  const start = new Date(grant.startsAt).getTime();
  const end = new Date(grant.endsAt).getTime();
  if (at < start) return "scheduled";
  if (at > end) return "expired";
  return "active";
}

export function grantView(grant) {
  return {
    id: grant.id,
    userId: grant.userId,
    username: grant.username,
    connectionId: grant.connectionId,
    connectionName: grant.connectionName,
    startsAt: grant.startsAt,
    endsAt: grant.endsAt,
    reason: grant.reason,
    createdBy: grant.createdBy,
    createdAt: grant.createdAt,
    status: grantStatus(grant)
  };
}

export function grantsForUser(userId) {
  return grants.filter((g) => g.userId === userId || g.userId === "*");
}

export function evaluateAccess(actor, connectionId) {
  const role = actor.role;
  const userId = actor.sub || actor.id;
  if (role === "admin") {
    return { allowed: true, standing: true, grant: null, reason: null };
  }
  const relevant = grantsForUser(userId).filter((g) => g.connectionId === connectionId || g.connectionId === "*");
  if (relevant.length === 0) {
    return { allowed: true, standing: true, grant: null, reason: null };
  }
  const active = relevant.find((g) => grantStatus(g) === "active");
  if (active) {
    return { allowed: true, standing: false, grant: grantView(active), reason: null };
  }
  const next = relevant
    .filter((g) => grantStatus(g) === "scheduled")
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
  if (next) {
    return { allowed: false, standing: false, grant: grantView(next), reason: "Grant has not started" };
  }
  return { allowed: false, standing: false, grant: null, reason: "No active grant for this host" };
}

export function createGrant({ actor, user, conn, startsAt, endsAt, reason }) {
  const start = startsAt ? new Date(startsAt) : new Date();
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    const err = new Error("Invalid grant window");
    err.status = 400;
    throw err;
  }
  const grant = {
    id: newId("grant"),
    userId: user.id,
    username: user.username,
    connectionId: conn ? conn.id : "*",
    connectionName: conn ? conn.name : "All hosts",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: reason || "",
    createdBy: actor.displayName || actor.username,
    createdAt: new Date().toISOString(),
    revoked: false
  };
  grants.unshift(grant);
  return grant;
}

export function createSession({
  user,
  conn,
  mode,
  readOnly = false,
  parentId = null,
  idleTimeoutMs = 15 * 60 * 1000,
  grant = null
}) {
  const id = newId("sess");
  const session = {
    id,
    connectionId: conn.id,
    connectionName: conn.name,
    protocol: conn.protocol,
    userId: user.sub,
    username: user.username,
    displayName: user.displayName || user.username,
    startedAt: new Date().toISOString(),
    lastActivity: Date.now(),
    mode,
    status: "active",
    shareCode: null,
    viewers: [],
    idleTimeoutMs,
    reconnectCount: 0,
    readOnly,
    parentId,
    grantId: grant?.id || null,
    grantEndsAt: grant?.endsAt || null,
    guacamoleToken: null
  };
  sessions.set(id, session);
  return session;
}

export function touchSession(session) {
  session.lastActivity = Date.now();
  if (session.status === "idle") session.status = "active";
}

export function endSession(session, reason = "disconnected") {
  session.status = "disconnected";
  session.endedAt = new Date().toISOString();
  session.endReason = reason;
  session.shareCode = null;
}

export function ensureShare(session) {
  if (!session.shareCode) session.shareCode = shareCode();
  return session.shareCode;
}

export function findByShare(code) {
  const needle = String(code || "").toUpperCase();
  return [...sessions.values()].find((s) => s.shareCode === needle && s.status !== "disconnected");
}

export function activeSessions() {
  return [...sessions.values()].filter((s) => s.status !== "disconnected");
}

export function pruneSessions() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.status === "disconnected" && new Date(session.endedAt || session.startedAt).getTime() < cutoff) {
      sessions.delete(id);
    }
  }
}

export function roomBroadcast(sessionId, payload) {
  const set = rooms.get(sessionId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(data);
  }
}

export function joinRoom(sessionId, ws) {
  if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
  rooms.get(sessionId).add(ws);
}

export function leaveRoom(sessionId, ws) {
  const set = rooms.get(sessionId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(sessionId);
}
