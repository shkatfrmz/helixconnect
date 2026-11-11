import { users, connections as seedConnections, activity as seedActivity } from "./data.js";
import { newId, shareCode, hashPassword } from "./crypto.js";
import * as db from "./db.js";

const persistent = db.hasDatabase();
if (persistent) await db.migrate();

async function seedDatabase() {
  const existingUsers = await db.loadUsers();
  if (existingUsers.length === 0) {
    for (const u of users) await db.saveUser(u);
  }
  const existingConnections = await db.loadConnections();
  if (existingConnections.length === 0) {
    for (const c of seedConnections) await db.saveConnection({ ...c, ignoreCert: c.ignoreCert ?? false });
  }
}
if (persistent) await seedDatabase();

export const directory = persistent
  ? await db.loadUsers()
  : users;
export const connections = persistent
  ? await db.loadConnections()
  : seedConnections.map((c) => ({
      ...c,
      password: c.password || "",
      ignoreCert: c.ignoreCert ?? false,
      security: c.protocol === "rdp" ? "any" : undefined,
      clipboardEnabled: c.clipboardEnabled ?? true,
      fileTransferEnabled: c.fileTransferEnabled ?? false,
      recordingEnabled: c.recordingEnabled ?? false
    }));
export const activity = persistent
  ? await db.loadActivity()
  : [...seedActivity];
export const grants = persistent ? await db.loadGrants() : [];
export const grantRequests = persistent ? await db.loadGrantRequests() : [];
export const recordings = persistent ? await db.loadRecordings() : [];
export const sessions = new Map();
export const rooms = new Map();

// Access is default-deny: an operator needs a grant to touch a host at all
// (see evaluateAccess below). Seed one for the demo "operator" account so
// the quick-start experience in the README still works out of the box,
// without every deployment needing to hand-configure a grant before anyone
// can open a session.
if (grants.length === 0) {
  const demoOperator = directory.find((u) => u.username === "operator");
  if (demoOperator) {
    createGrant({
      actor: { displayName: "System", username: "system" },
      user: demoOperator,
      conn: null,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      reason: "Demo default grant — all hosts"
    });
  }
}

// Fire-and-forget persistence writes: route handlers already mutate the
// in-memory arrays synchronously so the API stays fast and simple; this
// mirrors that mutation to Postgres when configured, without making every
// request handler async. Failures are logged, not thrown — a DB hiccup
// should not take the live session down.
function persist(label, fn) {
  if (!persistent) return;
  fn().catch((err) => console.error(`[helix] persistence failed (${label}):`, err.message));
}

export function persistUser(user) {
  persist("user", () => db.saveUser(user));
}

export function persistConnection(conn) {
  persist("connection", () => db.saveConnection(conn));
}

export function persistGrant(grant) {
  persist("grant", () => db.saveGrant(grant));
}

export function persistGrantRequest(request) {
  persist("grant request", () => db.saveGrantRequest(request));
}

export function persistRecording(rec) {
  persist("recording", () => db.saveRecording(rec));
}

export function recordingView(r) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    connectionId: r.connectionId,
    connectionName: r.connectionName,
    protocol: r.protocol,
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    mode: r.mode,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.endedAt ? new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime() : null,
    sizeBytes: r.sizeBytes || 0
  };
}

// Called right after a session is created for a connection with
// recordingEnabled — guacd (or, in demo mode, our own synthesizer) starts
// writing frames immediately, so the metadata row is created up front in
// "recording" status and finalized once the session ends.
export function startRecording({ session, conn }) {
  const rec = {
    id: newId("rec"),
    sessionId: session.id,
    connectionId: conn.id,
    connectionName: conn.name,
    protocol: conn.protocol,
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    mode: session.mode,
    status: "recording",
    startedAt: session.startedAt,
    endedAt: null,
    sizeBytes: 0
  };
  recordings.unshift(rec);
  persistRecording(rec);
  return rec;
}

export function finishRecording(rec, sizeBytes) {
  rec.status = "complete";
  rec.endedAt = new Date().toISOString();
  rec.sizeBytes = sizeBytes || 0;
  persistRecording(rec);
  return rec;
}

export function findRecording(id) {
  return recordings.find((r) => r.id === id);
}

export function removeRecording(rec) {
  const idx = recordings.indexOf(rec);
  if (idx >= 0) recordings.splice(idx, 1);
  persist("recording delete", () => db.deleteRecording(rec.id));
}

export function recordingsForUser(user) {
  if (user.role === "admin") return recordings;
  return recordings.filter((r) => r.userId === user.sub);
}

export function requestGrantView(r) {
  return {
    id: r.id,
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    connectionId: r.connectionId,
    connectionName: r.connectionName,
    reason: r.reason || "",
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt || null,
    resolvedBy: r.resolvedBy || null
  };
}

export function createGrantRequest({ user, conn, reason }) {
  const existing = grantRequests.find(
    (r) => r.userId === user.sub && r.connectionId === conn.id && r.status === "pending"
  );
  if (existing) return existing;
  const request = {
    id: newId("req"),
    userId: user.sub,
    username: user.username,
    displayName: user.displayName || user.username,
    connectionId: conn.id,
    connectionName: conn.name,
    reason: reason || "",
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null
  };
  grantRequests.unshift(request);
  persistGrantRequest(request);
  return request;
}

export function resolveGrantRequest(request, status, actorName) {
  request.status = status;
  request.resolvedAt = new Date().toISOString();
  request.resolvedBy = actorName;
  persistGrantRequest(request);
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    avatar: user.avatar,
    email: user.email || "",
    provider: user.provider || "local",
    disabled: Boolean(user.disabled),
    favorites: user.favorites || [],
    mfaEnabled: Boolean(user.totpEnabled)
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
    persistUser(user);
    return user;
  }
  let uname = username || mail.split("@")[0] || "user";
  if (directory.some((u) => u.username === uname)) uname = `${uname}-${newId("sso").slice(-4)}`;
  user = {
    id: newId("u"),
    username: uname,
    password: "", // SSO accounts have no local password; password login is rejected for empty hashes
    displayName: displayName || uname,
    role: "operator",
    avatar: initials(displayName || uname),
    email: mail,
    provider,
    disabled: false
  };
  directory.push(user);
  persistUser(user);
  return user;
}

export function publicConnection(conn) {
  const { password, ...rest } = conn;
  return rest;
}

export function logActivity(user, action, target, type = "session") {
  const entry = {
    id: newId("act"),
    user,
    action,
    target,
    time: "Just now",
    type
  };
  activity.unshift(entry);
  if (activity.length > 80) activity.pop();
  persist("activity", () => db.saveActivityEntry(entry));
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

// Minutes since local midnight, for comparing against a recurrence window.
function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function grantStatus(grant, at = Date.now()) {
  if (grant.revoked) return "revoked";
  const start = new Date(grant.startsAt).getTime();
  const end = new Date(grant.endsAt).getTime();
  if (at < start) return "scheduled";
  if (at > end) return "expired";
  if (!grant.recurrence) return "active";
  // Within the overall enrollment window, a recurring grant is only
  // "active" during its own days/hours — e.g. weekdays 9am-5pm — and
  // "scheduled" (will recur again) the rest of the time.
  const { daysOfWeek, startMinutes, endMinutes } = grant.recurrence;
  const now = new Date(at);
  const inDay = !daysOfWeek?.length || daysOfWeek.includes(now.getDay());
  const mins = minutesOfDay(now);
  const inWindow = mins >= startMinutes && mins < endMinutes;
  return inDay && inWindow ? "active" : "scheduled";
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
    recurrence: grant.recurrence || null,
    status: grantStatus(grant)
  };
}

export function grantsForUser(userId) {
  return grants.filter((g) => g.userId === userId || g.userId === "*");
}

export function evaluateAccess(actor, connectionOrId) {
  const role = actor.role;
  const userId = actor.sub || actor.id;
  if (role === "admin") {
    return { allowed: true, standing: true, grant: null, reason: null };
  }
  // Accept either a bare connection id (legacy callers, tests) or the full
  // connection object — the latter is needed to match group-level grants.
  const connectionId = typeof connectionOrId === "string" ? connectionOrId : connectionOrId?.id;
  const group = typeof connectionOrId === "object" && connectionOrId ? connectionOrId.group : null;
  const groupKey = group ? `group:${group}` : null;
  // Default-deny: an operator needs an explicit grant (for this connection,
  // for its group, or a "*" grant covering all hosts) to access a host. No
  // grant at all means no access, not open access.
  const relevant = grantsForUser(userId).filter(
    (g) => g.connectionId === connectionId || g.connectionId === "*" || (groupKey && g.connectionId === groupKey)
  );
  if (relevant.length === 0) {
    return { allowed: false, standing: false, grant: null, reason: "No grant for this host" };
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

function normalizeRecurrence(recurrence) {
  if (!recurrence) return null;
  const daysOfWeek = Array.isArray(recurrence.daysOfWeek)
    ? recurrence.daysOfWeek.map(Number).filter((d) => d >= 0 && d <= 6)
    : [];
  const startMinutes = Number(recurrence.startMinutes);
  const endMinutes = Number(recurrence.endMinutes);
  if (
    daysOfWeek.length === 0 ||
    !Number.isFinite(startMinutes) ||
    !Number.isFinite(endMinutes) ||
    startMinutes < 0 ||
    endMinutes > 24 * 60 ||
    endMinutes <= startMinutes
  ) {
    const err = new Error("Invalid recurrence window");
    err.status = 400;
    throw err;
  }
  return { daysOfWeek, startMinutes, endMinutes };
}

export function createGrant({ actor, user, conn, group, startsAt, endsAt, reason, recurrence }) {
  const start = startsAt ? new Date(startsAt) : new Date();
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    const err = new Error("Invalid grant window");
    err.status = 400;
    throw err;
  }
  const connectionId = conn ? conn.id : group ? `group:${group}` : "*";
  const connectionName = conn ? conn.name : group ? `Group: ${group}` : "All hosts";
  const grant = {
    id: newId("grant"),
    userId: user.id,
    username: user.username,
    connectionId,
    connectionName,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: reason || "",
    createdBy: actor.displayName || actor.username,
    createdAt: new Date().toISOString(),
    recurrence: normalizeRecurrence(recurrence),
    revoked: false
  };
  grants.unshift(grant);
  persistGrant(grant);
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
