import express from "express";
import cors from "cors";
import http from "http";
import net from "net";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  CRYPTO_CYPHER,
  CRYPTO_KEY,
  encryptToken,
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotp,
  totpAuthUrl
} from "./crypto.js";
import QRCode from "qrcode";
import { JWT_SECRET, CORS_ORIGINS, IS_PRODUCTION } from "./config.js";
import {
  RECORDINGS_DIR,
  ensureRecordingsDir,
  recordingFileName,
  recordingFilePath,
  recordingFileExists,
  recordingFileSize,
  deleteRecordingFile,
  synthesizeDemoRecording
} from "./recordingFile.js";
import {
  directory,
  connections,
  activity,
  grants,
  grantRequests,
  recordings,
  sessions,
  publicConnection,
  publicUser,
  logActivity,
  sessionView,
  createSession,
  touchSession,
  endSession,
  ensureShare,
  findByShare,
  activeSessions,
  pruneSessions,
  roomBroadcast,
  joinRoom,
  leaveRoom,
  evaluateAccess,
  createGrant,
  grantView,
  grantStatus,
  upsertSsoUser,
  initials,
  persistUser,
  persistConnection,
  persistGrant,
  createGrantRequest,
  resolveGrantRequest,
  requestGrantView,
  recordingView,
  startRecording,
  finishRecording,
  findRecording,
  removeRecording,
  recordingsForUser
} from "./store.js";
import { authorizeUrl, exchangeCode, publicOrigin, publicSsoStatus } from "./oidc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const GUACD_HOST = process.env.GUACD_HOST || "127.0.0.1";
const GUACD_PORT = Number(process.env.GUACD_PORT || 4822);
const IDLE_CHECK_MS = 5000;

const app = express();
// "true" trusts every hop's X-Forwarded-For, which lets a client spoof its
// own IP and bypass the login rate limiter below. Default to trusting
// nothing; set HELIX_TRUST_PROXY to the number of reverse-proxy hops in
// front of this server (e.g. "1" for a single nginx/ALB in front of it).
const trustProxy = process.env.HELIX_TRUST_PROXY ? Number(process.env.HELIX_TRUST_PROXY) : false;
app.set("trust proxy", trustProxy);
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests (no Origin header — curl, server-to-server) are
      // always allowed; browser cross-origin requests must match the allowlist.
      if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    }
  })
);
app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." }
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function canManage(req, session) {
  return req.user.role === "admin" || session.userId === req.user.sub;
}

function probeGuacd() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: GUACD_HOST, port: GUACD_PORT });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 800);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function guacamoleSettings(conn, extras = {}) {
  const settings = {
    hostname: conn.hostname,
    port: String(conn.port),
    username: extras.username || conn.username || "",
    password: extras.password || conn.password || "",
    width: extras.width || 1280,
    height: extras.height || 720,
    dpi: extras.dpi || 96
  };
  // Clipboard defaults to on (matches the in-browser clipboard-sync panel);
  // an admin can lock it down per host (e.g. the Finance desktop).
  if (conn.clipboardEnabled === false) {
    settings["disable-copy"] = true;
    settings["disable-paste"] = true;
  }
  if (conn.protocol === "rdp") {
    settings.security = conn.security || "any";
    settings["ignore-cert"] = conn.ignoreCert === true;
    settings["enable-wallpaper"] = false;
    if (conn.fileTransferEnabled) {
      settings["enable-drive"] = true;
      settings["drive-path"] = `/tmp/helix-drives/${conn.id}`;
      settings["create-drive-path"] = true;
      settings["drive-name"] = "Helix Share";
    }
  }
  if (conn.protocol === "ssh") {
    settings["color-scheme"] = "green-black";
    settings["font-name"] = "monospace";
    settings["font-size"] = "12";
    if (conn.fileTransferEnabled) {
      settings["enable-sftp"] = true;
      settings["sftp-root-directory"] = "/";
    }
  }
  // VNC has no protocol-level file-transfer channel in guacd — the toggle
  // is still stored per-connection but only takes effect for RDP/SSH.
  // Session recording is a guacd-level feature (not guacamole-lite): telling
  // guacd a recording-path/name makes it write a .guac file itself as the
  // session plays out, independent of anything our own server does.
  if (extras.recordingPath) {
    settings["recording-path"] = extras.recordingPath;
    settings["recording-name"] = extras.recordingName || "recording";
    settings["create-recording-path"] = true;
  }
  return settings;
}

function attachGuacamoleToken(session, conn, extras = {}) {
  const recordingExtras = conn.recordingEnabled
    ? { recordingPath: RECORDINGS_DIR, recordingName: recordingFileName(session.id) }
    : {};
  session.guacamoleToken = encryptToken({
    connection: {
      type: conn.protocol,
      settings: guacamoleSettings(conn, { ...extras, ...recordingExtras })
    }
  });
  return session.guacamoleToken;
}

// Finds the in-progress recording tied to this session (if the connection
// had recording enabled) and finalizes it: in live mode guacd has already
// written the .guac file to RECORDINGS_DIR by the time the session ends, so
// we just stat it; in demo mode there is no guacd, so we synthesize a real,
// valid (if blank) .guac recording spanning the session's actual duration.
function finalizeSessionRecording(session) {
  const rec = recordings.find((r) => r.sessionId === session.id && r.status === "recording");
  if (!rec) return;
  const durationMs = Math.max(0, new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime());
  const sizeBytes =
    session.mode === "demo" ? synthesizeDemoRecording(session.id, durationMs) : recordingFileSize(session.id);
  finishRecording(rec, sizeBytes);
  logActivity(session.displayName, "Recording saved", session.connectionName, "recording");
}

function tickIdle() {
  const now = Date.now();
  for (const session of activeSessions()) {
    if (session.grantEndsAt) {
      const remaining = new Date(session.grantEndsAt).getTime() - now;
      if (remaining <= 0) {
        endSession(session, "grant-expired");
        finalizeSessionRecording(session);
        logActivity("System", "Grant expired", session.connectionName, "grant");
        roomBroadcast(session.id, { type: "ended", reason: "grant-expired", session: sessionView(session) });
        continue;
      }
      if (remaining < 5 * 60 * 1000) {
        roomBroadcast(session.id, {
          type: "grant-warn",
          remainingMs: remaining,
          session: sessionView(session)
        });
      }
    }
    const idleFor = now - session.lastActivity;
    if (idleFor > session.idleTimeoutMs) {
      endSession(session, "idle-timeout");
      finalizeSessionRecording(session);
      logActivity("System", "Idle timeout", session.connectionName, "session");
      roomBroadcast(session.id, { type: "ended", reason: "idle-timeout", session: sessionView(session) });
      continue;
    }
    if (idleFor > session.idleTimeoutMs * 0.7 && session.status === "active") {
      session.status = "idle";
      roomBroadcast(session.id, { type: "idle-warn", remainingMs: session.idleTimeoutMs - idleFor, session: sessionView(session) });
    }
  }
  pruneSessions();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

function finishLogin(res, user) {
  logActivity(user.displayName, "Signed in", user.provider === "local" ? "Auth" : user.provider, "auth");
  return res.json({
    token: signToken(user),
    user: publicUser(user)
  });
}

setInterval(tickIdle, IDLE_CHECK_MS);

app.get("/api/health", async (_req, res) => {
  const guacd = await probeGuacd();
  res.json({
    ok: true,
    name: "Helix Remote",
    gateway: {
      reachable: guacd,
      mode: guacd ? "live" : "demo"
    },
    sso: publicSsoStatus()
  });
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = directory.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.password)) {
    logActivity(username || "unknown", "Failed login", "Auth", "auth");
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (user.disabled) {
    logActivity(user.displayName, "Login blocked (disabled)", "Auth", "auth");
    return res.status(403).json({ error: "Account disabled" });
  }
  if (user.totpEnabled) {
    // Password verified but a second factor is required — issue a short-lived
    // challenge token naming this user rather than a full session token.
    const challenge = jwt.sign({ mfaFor: user.id }, JWT_SECRET, { expiresIn: "5m" });
    return res.json({ mfaRequired: true, challenge });
  }
  return finishLogin(res, user);
});

app.post("/api/login/verify", loginLimiter, (req, res) => {
  const { challenge, code } = req.body || {};
  let payload;
  try {
    payload = jwt.verify(String(challenge || ""), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Login challenge expired — sign in again" });
  }
  if (!payload.mfaFor) return res.status(401).json({ error: "Invalid challenge" });
  const user = directory.find((u) => u.id === payload.mfaFor);
  if (!user || !user.totpEnabled || !user.totpSecret) return res.status(401).json({ error: "Invalid challenge" });
  if (!verifyTotp(user.totpSecret, code)) {
    logActivity(user.displayName, "Failed MFA code", "Auth", "auth");
    return res.status(401).json({ error: "Incorrect code" });
  }
  return finishLogin(res, user);
});

app.get("/api/auth/:provider/start", (req, res) => {
  const provider = req.params.provider;
  if (!["google", "entra"].includes(provider)) return res.status(404).json({ error: "Unknown provider" });
  const state = jwt.sign({ p: provider, n: Date.now() }, JWT_SECRET, { expiresIn: "10m" });
  const url = authorizeUrl(req, provider, state);
  if (!url) return res.status(409).json({ error: `${provider} SSO is not configured` });
  res.json({ url });
});

app.get("/api/auth/:provider/callback", loginLimiter, async (req, res) => {
  const provider = req.params.provider;
  const frontend = (process.env.USER_FRONTEND_ORIGIN || `${publicOrigin(req)}/login`).replace(/\/$/, "");
  function bounce(query) {
    const dest = frontend.includes("/login") ? frontend : `${frontend}/login`;
    res.redirect(`${dest}?${query}`);
  }
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    jwt.verify(String(req.query.state || ""), JWT_SECRET);
    const profile = await exchangeCode(req, provider, String(req.query.code || ""));
    const user = upsertSsoUser(profile);
    logActivity(user.displayName, "Signed in", provider, "auth");
    const token = signToken(user);
    bounce(`sso=1&token=${encodeURIComponent(token)}`);
  } catch (err) {
    bounce(`sso=0&error=${encodeURIComponent(err.message || "SSO failed")}`);
  }
});

app.get("/api/me", auth, (req, res) => {
  const user = directory.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(publicUser(user));
});

app.post("/api/me/favorites/:connectionId", auth, (req, res) => {
  const user = directory.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Not found" });
  const conn = connections.find((c) => c.id === req.params.connectionId);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const favorites = new Set(user.favorites || []);
  const favorited = favorites.has(conn.id);
  if (favorited) favorites.delete(conn.id);
  else favorites.add(conn.id);
  user.favorites = [...favorites];
  persistUser(user);
  res.json({ favorites: user.favorites });
});

app.post("/api/me/mfa/setup", auth, async (req, res) => {
  const user = directory.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (user.provider !== "local") {
    return res.status(409).json({ error: "MFA applies to local accounts only — SSO already has its own second factor" });
  }
  const secret = generateTotpSecret();
  user.totpPendingSecret = secret;
  persistUser(user);
  const otpauth = totpAuthUrl(secret, user.username);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  res.json({ secret, otpauth, qrDataUrl });
});

app.post("/api/me/mfa/verify", auth, (req, res) => {
  const user = directory.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (!user.totpPendingSecret) return res.status(409).json({ error: "No MFA setup in progress — start setup first" });
  if (!verifyTotp(user.totpPendingSecret, req.body?.code)) {
    return res.status(401).json({ error: "Incorrect code" });
  }
  user.totpSecret = user.totpPendingSecret;
  user.totpPendingSecret = null;
  user.totpEnabled = true;
  persistUser(user);
  logActivity(user.displayName, "Enabled MFA", "Auth", "auth");
  res.json({ mfaEnabled: true });
});

app.post("/api/me/mfa/disable", auth, (req, res) => {
  const user = directory.find((u) => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (!verifyPassword(req.body?.password, user.password)) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  user.totpSecret = null;
  user.totpPendingSecret = null;
  user.totpEnabled = false;
  persistUser(user);
  logActivity(user.displayName, "Disabled MFA", "Auth", "auth");
  res.json({ mfaEnabled: false });
});

app.get("/api/users", auth, requireAdmin, (_req, res) => {
  res.json(directory.map(publicUser));
});

app.post("/api/users", auth, requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.username || !body.password) return res.status(400).json({ error: "username and password are required" });
  if (directory.some((u) => u.username === body.username)) return res.status(409).json({ error: "Username already exists" });
  const user = {
    id: `u-${Date.now().toString(36)}`,
    username: body.username,
    password: hashPassword(body.password),
    displayName: body.displayName || body.username,
    role: body.role === "admin" ? "admin" : "operator",
    avatar: initials(body.displayName || body.username),
    email: body.email || "",
    provider: "local",
    disabled: false
  };
  directory.push(user);
  persistUser(user);
  logActivity(req.user.displayName, "Created user", user.username, "admin");
  res.status(201).json(publicUser(user));
});

app.patch("/api/users/:id", auth, requireAdmin, (req, res) => {
  const user = directory.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const body = req.body || {};
  if (body.displayName !== undefined) user.displayName = body.displayName;
  if (body.email !== undefined) user.email = body.email;
  if (body.role === "admin" || body.role === "operator") user.role = body.role;
  if (body.password) user.password = hashPassword(body.password);
  if (body.disabled !== undefined) user.disabled = Boolean(body.disabled);
  if (body.resetMfa) {
    user.totpSecret = null;
    user.totpPendingSecret = null;
    user.totpEnabled = false;
    logActivity(req.user.displayName, "Reset MFA", user.username, "admin");
  }
  persistUser(user);
  logActivity(req.user.displayName, "Updated user", user.username, "admin");
  res.json(publicUser(user));
});

app.get("/api/grants", auth, (req, res) => {
  const list = req.user.role === "admin" ? grants : grants.filter((g) => g.userId === req.user.sub);
  res.json(list.map(grantView));
});

app.post("/api/grants", auth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const user = directory.find((u) => u.id === body.userId || u.username === body.username);
  if (!user) return res.status(404).json({ error: "User not found" });
  // A grant targets exactly one of: a specific host, a whole host Group, or
  // every host ("*" / nothing specified). body.group takes precedence if
  // both are somehow sent, since the form only ever sends one.
  const conn = !body.group && body.connectionId && body.connectionId !== "*"
    ? connections.find((c) => c.id === body.connectionId)
    : null;
  if (!body.group && body.connectionId && body.connectionId !== "*" && !conn) {
    return res.status(404).json({ error: "Connection not found" });
  }
  try {
    const grant = createGrant({
      actor: req.user,
      user,
      conn,
      group: body.group || null,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason,
      recurrence: body.recurrence || null
    });
    logActivity(req.user.displayName, "Granted access", `${user.username} · ${grant.connectionName}`, "grant");
    res.status(201).json(grantView(grant));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/grants/:id/revoke", auth, requireAdmin, (req, res) => {
  const grant = grants.find((g) => g.id === req.params.id);
  if (!grant) return res.status(404).json({ error: "Grant not found" });
  grant.revoked = true;
  persistGrant(grant);
  for (const session of activeSessions()) {
    if (session.grantId === grant.id) {
      endSession(session, "grant-revoked");
      finalizeSessionRecording(session);
      roomBroadcast(session.id, { type: "ended", reason: "grant-revoked", session: sessionView(session) });
    }
  }
  logActivity(req.user.displayName, "Revoked grant", grant.username, "grant");
  res.json(grantView(grant));
});

app.get("/api/grant-requests", auth, (req, res) => {
  const list = req.user.role === "admin" ? grantRequests : grantRequests.filter((r) => r.userId === req.user.sub);
  res.json(list.map(requestGrantView));
});

app.post("/api/grant-requests", auth, (req, res) => {
  const body = req.body || {};
  const conn = connections.find((c) => c.id === body.connectionId);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const access = evaluateAccess(req.user, conn);
  if (access.allowed) return res.status(409).json({ error: "You already have access to this host" });
  const request = createGrantRequest({ user: req.user, conn, reason: body.reason });
  logActivity(req.user.displayName, "Requested access", conn.name, "grant");
  res.status(201).json(requestGrantView(request));
});

app.post("/api/grant-requests/:id/approve", auth, requireAdmin, (req, res) => {
  const request = grantRequests.find((r) => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.status !== "pending") return res.status(409).json({ error: "Request already resolved" });
  const user = directory.find((u) => u.id === request.userId);
  const conn = connections.find((c) => c.id === request.connectionId);
  if (!user || !conn) return res.status(404).json({ error: "User or connection no longer exists" });
  const hours = Number(req.body?.hours) || 8;
  const grant = createGrant({
    actor: req.user,
    user,
    conn,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
    reason: request.reason || "Approved from self-service request"
  });
  resolveGrantRequest(request, "approved", req.user.displayName);
  logActivity(req.user.displayName, "Approved access request", `${user.username} · ${conn.name}`, "grant");
  res.json({ request: requestGrantView(request), grant: grantView(grant) });
});

app.post("/api/grant-requests/:id/deny", auth, requireAdmin, (req, res) => {
  const request = grantRequests.find((r) => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.status !== "pending") return res.status(409).json({ error: "Request already resolved" });
  resolveGrantRequest(request, "denied", req.user.displayName);
  logActivity(req.user.displayName, "Denied access request", `${request.username} · ${request.connectionName}`, "grant");
  res.json(requestGrantView(request));
});

app.get("/api/connections", auth, (req, res) => {
  res.json(
    connections.map((conn) => {
      const access = evaluateAccess(req.user, conn);
      return { ...publicConnection(conn), access };
    })
  );
});

app.post("/api/connections", auth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  const body = req.body || {};
  if (!body.name || !body.hostname || !body.protocol) {
    return res.status(400).json({ error: "name, hostname, and protocol are required" });
  }
  const conn = {
    id: `conn-${Date.now().toString(36)}`,
    name: body.name,
    protocol: body.protocol,
    hostname: body.hostname,
    port: Number(body.port) || (body.protocol === "rdp" ? 3389 : body.protocol === "vnc" ? 5900 : 22),
    username: body.username || "",
    password: body.password || "",
    tags: body.tags || [],
    group: body.group || "Unassigned",
    status: body.status || "online",
    latencyMs: body.latencyMs ?? 20,
    lastSeen: "Just now",
    description: body.description || "Operator-defined host.",
    os: body.os || "Unknown",
    resolution: body.resolution || "1280x720",
    colorDepth: body.colorDepth || 24,
    // Certificate validation defaults ON; an operator must opt out per-connection
    // rather than every RDP host silently trusting an unverified certificate.
    ignoreCert: Boolean(body.ignoreCert),
    security: body.protocol === "rdp" ? "any" : undefined,
    // Clipboard defaults ON (matches existing behavior); file transfer
    // defaults OFF — an admin opts a host in rather than every new RDP/SSH
    // host silently exposing a drive/SFTP channel.
    clipboardEnabled: body.clipboardEnabled !== false,
    fileTransferEnabled: Boolean(body.fileTransferEnabled),
    // Recording defaults OFF — it's an explicit per-host opt-in, same
    // reasoning as file transfer.
    recordingEnabled: Boolean(body.recordingEnabled)
  };
  connections.push(conn);
  persistConnection(conn);
  logActivity(req.user.displayName, "Added connection", conn.name, "admin");
  res.status(201).json(publicConnection(conn));
});

app.patch("/api/connections/:id", auth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const body = req.body || {};
  ["name", "hostname", "protocol", "username", "password", "group", "description", "os", "resolution", "status"].forEach((k) => {
    if (body[k] !== undefined) conn[k] = body[k];
  });
  if (body.port !== undefined) conn.port = Number(body.port);
  if (body.tags) conn.tags = body.tags;
  if (body.ignoreCert !== undefined) conn.ignoreCert = Boolean(body.ignoreCert);
  if (body.clipboardEnabled !== undefined) conn.clipboardEnabled = Boolean(body.clipboardEnabled);
  if (body.fileTransferEnabled !== undefined) conn.fileTransferEnabled = Boolean(body.fileTransferEnabled);
  if (body.recordingEnabled !== undefined) conn.recordingEnabled = Boolean(body.recordingEnabled);
  persistConnection(conn);
  logActivity(req.user.displayName, "Updated connection", conn.name, "admin");
  res.json(publicConnection(conn));
});

app.get("/api/connections/:id", auth, (req, res) => {
  const conn = connections.find((c) => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  res.json({ ...publicConnection(conn), access: evaluateAccess(req.user, conn) });
});

app.get("/api/activity", auth, (req, res) => {
  const { type, q, limit } = req.query || {};
  let list = activity;
  if (type && type !== "all") list = list.filter((a) => a.type === type);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((a) => `${a.user} ${a.action} ${a.target}`.toLowerCase().includes(needle));
  }
  const cap = Number(limit) || 80;
  res.json(list.slice(0, cap));
});

app.get("/api/recordings", auth, (req, res) => {
  const { connectionId } = req.query || {};
  let list = recordingsForUser(req.user);
  if (connectionId) list = list.filter((r) => r.connectionId === connectionId);
  res.json(list.map(recordingView));
});

app.get("/api/recordings/:id/stream", auth, (req, res) => {
  const rec = findRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: "Recording not found" });
  if (req.user.role !== "admin" && rec.userId !== req.user.sub) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (rec.status !== "complete") return res.status(409).json({ error: "Recording is still in progress" });
  if (!recordingFileExists(rec.sessionId)) return res.status(404).json({ error: "Recording file missing" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${rec.id}.guac"`);
  res.sendFile(recordingFilePath(rec.sessionId));
});

app.delete("/api/recordings/:id", auth, requireAdmin, (req, res) => {
  const rec = findRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: "Recording not found" });
  deleteRecordingFile(rec.sessionId);
  removeRecording(rec);
  logActivity(req.user.displayName, "Deleted recording", rec.connectionName, "recording");
  res.json({ ok: true });
});

app.get("/api/stats", auth, async (_req, res) => {
  const guacd = await probeGuacd();
  const online = connections.filter((c) => c.status === "online").length;
  const live = activeSessions();
  res.json({
    connections: connections.length,
    online,
    activeSessions: live.length,
    users: directory.length,
    backendMode: guacd ? "live" : "demo",
    relayOnline: guacd,
    sharing: live.filter((s) => s.shareCode).length,
    grants: grants.filter((g) => grantStatus(g) === "active").length,
    recordings: recordings.length,
    sso: publicSsoStatus()
  });
});

app.post("/api/sessions", auth, async (req, res) => {
  const { connectionId, username, password, width, height, idleTimeoutMs } = req.body || {};
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  if (conn.status === "offline") return res.status(409).json({ error: "Host is offline" });
  const access = evaluateAccess(req.user, conn);
  if (!access.allowed) return res.status(403).json({ error: access.reason || "Access denied" });
  const guacd = await probeGuacd();
  const session = createSession({
    user: req.user,
    conn,
    mode: guacd ? "live" : "demo",
    idleTimeoutMs: Number(idleTimeoutMs) || 15 * 60 * 1000,
    grant: access.grant
  });
  attachGuacamoleToken(session, conn, { username, password, width, height });
  if (conn.recordingEnabled) startRecording({ session, conn });
  logActivity(req.user.displayName, "Opened session", conn.name, "session");
  res.json({
    ...sessionView(session),
    displayToken: session.guacamoleToken,
    tunnelPath: "/ws/display"
  });
});

app.get("/api/sessions", auth, (_req, res) => {
  res.json(activeSessions().map(sessionView));
});

app.get("/api/sessions/:id", auth, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!canManage(req, session) && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({
    ...sessionView(session),
    displayToken: canManage(req, session) ? session.guacamoleToken : null,
    tunnelPath: "/ws/display"
  });
});

app.post("/api/sessions/:id/heartbeat", auth, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session || session.status === "disconnected") return res.status(404).json({ error: "Session not found" });
  touchSession(session);
  res.json(sessionView(session));
});

app.post("/api/sessions/:id/reconnect", auth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!canManage(req, session)) return res.status(403).json({ error: "Forbidden" });
  const conn = connections.find((c) => c.id === session.connectionId);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const guacd = await probeGuacd();
  session.mode = guacd ? "live" : "demo";
  session.status = "active";
  session.reconnectCount += 1;
  touchSession(session);
  attachGuacamoleToken(session, conn, req.body || {});
  logActivity(req.user.displayName, "Reconnected", session.connectionName, "session");
  roomBroadcast(session.id, { type: "reconnected", session: sessionView(session) });
  res.json({
    ...sessionView(session),
    displayToken: session.guacamoleToken,
    tunnelPath: "/ws/display"
  });
});

app.post("/api/sessions/:id/share", auth, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session || session.status === "disconnected") return res.status(404).json({ error: "Session not found" });
  if (!canManage(req, session)) return res.status(403).json({ error: "Forbidden" });
  const code = ensureShare(session);
  logActivity(req.user.displayName, "Shared session", session.connectionName, "share");
  roomBroadcast(session.id, { type: "shared", session: sessionView(session) });
  res.json({
    shareCode: code,
    url: `/join/${code}`,
    session: sessionView(session)
  });
});

app.post("/api/sessions/:id/unshare", auth, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!canManage(req, session)) return res.status(403).json({ error: "Forbidden" });
  session.shareCode = null;
  session.viewers = [];
  logActivity(req.user.displayName, "Stopped sharing", session.connectionName, "share");
  roomBroadcast(session.id, { type: "unshared", session: sessionView(session) });
  res.json(sessionView(session));
});

app.post("/api/sessions/:id/disconnect", auth, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!canManage(req, session)) return res.status(403).json({ error: "Forbidden" });
  endSession(session, "force-disconnect");
  finalizeSessionRecording(session);
  logActivity(req.user.displayName, "Force disconnect", session.connectionName, "session");
  roomBroadcast(session.id, { type: "ended", reason: "force-disconnect", session: sessionView(session) });
  res.json(sessionView(session));
});

app.post("/api/join", auth, async (req, res) => {
  const { code } = req.body || {};
  const host = findByShare(code);
  if (!host) return res.status(404).json({ error: "Share code not found" });
  const conn = connections.find((c) => c.id === host.connectionId);
  const guacd = await probeGuacd();
  const viewer = createSession({
    user: req.user,
    conn,
    mode: guacd ? "live" : "demo",
    readOnly: true,
    parentId: host.id,
    idleTimeoutMs: host.idleTimeoutMs
  });
  viewer.guacamoleToken = host.guacamoleToken;
  host.viewers = [...new Set([...(host.viewers || []), req.user.username])];
  logActivity(req.user.displayName, "Joined shared session", host.connectionName, "share");
  roomBroadcast(host.id, { type: "viewer", username: req.user.username, session: sessionView(host) });
  res.json({
    ...sessionView(viewer),
    hostSessionId: host.id,
    displayToken: host.guacamoleToken,
    tunnelPath: "/ws/display"
  });
});

const dist = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/demo" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const sessionId = url.searchParams.get("sessionId");
  const connectionId = url.searchParams.get("connectionId") || "unknown";
  const conn = connections.find((c) => c.id === connectionId);
  const session = sessionId ? sessions.get(sessionId) : null;

  if (session) joinRoom(session.id, ws);

  ws.send(
    JSON.stringify({
      type: "hello",
      connection: conn ? { id: conn.id, name: conn.name, protocol: conn.protocol, os: conn.os } : null,
      session: session ? sessionView(session) : null,
      message: session?.mode === "live"
        ? "Control channel attached."
        : "Preview display attached. Connect the relay for a live desktop."
    })
  );

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    if (session && session.status === "disconnected") {
      ws.send(JSON.stringify({ type: "ended", reason: session.endReason, session: sessionView(session) }));
      return;
    }
    ws.send(
      JSON.stringify({
        type: "tick",
        at: Date.now(),
        cpu: 12 + Math.round(Math.random() * 18),
        mem: 38 + Math.round(Math.random() * 12),
        fps: 24 + Math.round(Math.random() * 8),
        idleRemainingMs: session ? Math.max(0, session.idleTimeoutMs - (Date.now() - session.lastActivity)) : null,
        grantRemainingMs: session?.grantEndsAt ? Math.max(0, new Date(session.grantEndsAt).getTime() - Date.now()) : null,
        session: session ? sessionView(session) : null
      })
    );
  }, 1200);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "heartbeat" && session) touchSession(session);
      if (msg.type === "clipboard" && session) {
        roomBroadcast(session.id, { type: "clipboard", text: msg.text, from: session.username });
      }
    } catch {
      /* ignore */
    }
  });

  ws.on("close", () => {
    clearInterval(interval);
    if (session) leaveRoom(session.id, ws);
  });
});

let guacamoleLiteServer = null;

async function attachGuacamoleLite() {
  const reachable = await probeGuacd();
  if (!reachable) {
    console.log(`[helix] guacd not reachable at ${GUACD_HOST}:${GUACD_PORT} — running in demo mode`);
    return;
  }
  try {
    const { default: GuacamoleLite } = await import("guacamole-lite");
    guacamoleLiteServer = new GuacamoleLite(
      { server, path: "/ws/display" },
      { host: GUACD_HOST, port: GUACD_PORT },
      {
        crypt: { cypher: CRYPTO_CYPHER, key: CRYPTO_KEY },
        maxInactivityTime: 0,
        log: { level: "ERRORS" }
      }
    );
    console.log(`[helix] display tunnel attached at /ws/display`);
  } catch (err) {
    console.log("[helix] guacamole-lite unavailable, demo mode only:", err.message);
  }
}

ensureRecordingsDir();

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`[helix] API listening on :${PORT} (${IS_PRODUCTION ? "production" : "development"})`);
  if (IS_PRODUCTION && CORS_ORIGINS.every((o) => o.includes("localhost") || o.includes("127.0.0.1"))) {
    console.log("[helix] WARNING: HELIX_CORS_ORIGINS is unset in production — set it to your real frontend origin(s)");
  }
  await attachGuacamoleLite();
});
