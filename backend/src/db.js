import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DATABASE_URL } from "./config.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : null;

export function hasDatabase() {
  return Boolean(pool);
}

export async function migrate() {
  if (!pool) return;
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("[helix] database schema ready");
}

// --- users -----------------------------------------------------------

export async function loadUsers() {
  const { rows } = await pool.query("SELECT * FROM users ORDER BY created_at");
  return rows.map(rowToUser);
}

export async function saveUser(user) {
  await pool.query(
    `INSERT INTO users (id, username, password_hash, display_name, role, avatar, email, provider, disabled, favorites, totp_secret_encrypted, totp_pending_encrypted, totp_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       password_hash = EXCLUDED.password_hash,
       display_name = EXCLUDED.display_name,
       role = EXCLUDED.role,
       avatar = EXCLUDED.avatar,
       email = EXCLUDED.email,
       provider = EXCLUDED.provider,
       disabled = EXCLUDED.disabled,
       favorites = EXCLUDED.favorites,
       totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
       totp_pending_encrypted = EXCLUDED.totp_pending_encrypted,
       totp_enabled = EXCLUDED.totp_enabled`,
    [
      user.id, user.username, user.password || "", user.displayName, user.role, user.avatar, user.email || "",
      user.provider || "local", Boolean(user.disabled), JSON.stringify(user.favorites || []),
      user.totpSecret ? encryptSecret(user.totpSecret) : null,
      user.totpPendingSecret ? encryptSecret(user.totpPendingSecret) : null,
      Boolean(user.totpEnabled)
    ]
  );
}

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    password: row.password_hash,
    displayName: row.display_name,
    role: row.role,
    avatar: row.avatar,
    email: row.email || "",
    provider: row.provider,
    disabled: row.disabled,
    favorites: row.favorites || [],
    totpSecret: row.totp_secret_encrypted ? decryptSecret(row.totp_secret_encrypted) : null,
    totpPendingSecret: row.totp_pending_encrypted ? decryptSecret(row.totp_pending_encrypted) : null,
    totpEnabled: row.totp_enabled
  };
}

// --- connections -------------------------------------------------------

export async function loadConnections() {
  const { rows } = await pool.query("SELECT * FROM connections ORDER BY created_at");
  return rows.map(rowToConnection);
}

export async function saveConnection(conn) {
  const encryptedPassword = conn.password ? encryptSecret(conn.password) : "";
  await pool.query(
    `INSERT INTO connections (id, name, protocol, hostname, port, username, password_encrypted, tags, "group", status, latency_ms, last_seen, last_seen_at, description, os, resolution, color_depth, ignore_cert, security, clipboard_enabled, file_transfer_enabled, recording_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, protocol = EXCLUDED.protocol, hostname = EXCLUDED.hostname,
       port = EXCLUDED.port, username = EXCLUDED.username, password_encrypted = EXCLUDED.password_encrypted,
       tags = EXCLUDED.tags, "group" = EXCLUDED."group", status = EXCLUDED.status,
       latency_ms = EXCLUDED.latency_ms, last_seen = EXCLUDED.last_seen, last_seen_at = EXCLUDED.last_seen_at,
       description = EXCLUDED.description,
       os = EXCLUDED.os, resolution = EXCLUDED.resolution, color_depth = EXCLUDED.color_depth,
       ignore_cert = EXCLUDED.ignore_cert, security = EXCLUDED.security,
       clipboard_enabled = EXCLUDED.clipboard_enabled, file_transfer_enabled = EXCLUDED.file_transfer_enabled,
       recording_enabled = EXCLUDED.recording_enabled`,
    [
      conn.id, conn.name, conn.protocol, conn.hostname, conn.port, conn.username || "", encryptedPassword,
      JSON.stringify(conn.tags || []), conn.group || "Unassigned", conn.status || "online", conn.latencyMs ?? null,
      conn.lastSeen || "Just now", conn.lastSeenAt || null, conn.description || "", conn.os || "Unknown", conn.resolution || "1280x720",
      conn.colorDepth || 24, Boolean(conn.ignoreCert), conn.security || null,
      conn.clipboardEnabled !== false, Boolean(conn.fileTransferEnabled), Boolean(conn.recordingEnabled)
    ]
  );
}

// A lighter-weight sibling to saveConnection used by the periodic health
// sweep: that runs every few seconds for every mapped host, so it skips
// re-encrypting the password and rewriting every other column each tick.
export async function updateConnectionHealth(conn) {
  await pool.query(
    `UPDATE connections SET status = $2, latency_ms = $3, last_seen = $4, last_seen_at = $5 WHERE id = $1`,
    [conn.id, conn.status, conn.latencyMs ?? null, conn.lastSeen, conn.lastSeenAt || null]
  );
}

function rowToConnection(row) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    hostname: row.hostname,
    port: row.port,
    username: row.username || "",
    password: row.password_encrypted ? decryptSecret(row.password_encrypted) : "",
    tags: row.tags || [],
    group: row.group,
    status: row.status,
    latencyMs: row.latency_ms,
    lastSeen: row.last_seen,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    description: row.description,
    os: row.os,
    resolution: row.resolution,
    colorDepth: row.color_depth,
    ignoreCert: row.ignore_cert,
    security: row.security || undefined,
    clipboardEnabled: row.clipboard_enabled,
    fileTransferEnabled: row.file_transfer_enabled,
    recordingEnabled: row.recording_enabled
  };
}

// --- grants --------------------------------------------------------------

export async function loadGrants() {
  const { rows } = await pool.query("SELECT * FROM grants ORDER BY created_at DESC");
  return rows.map(rowToGrant);
}

export async function saveGrant(grant) {
  await pool.query(
    `INSERT INTO grants (id, user_id, username, connection_id, connection_name, starts_at, ends_at, reason, created_by, revoked, recurrence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET revoked = EXCLUDED.revoked`,
    [
      grant.id, grant.userId, grant.username, grant.connectionId, grant.connectionName, grant.startsAt, grant.endsAt,
      grant.reason || "", grant.createdBy || "", Boolean(grant.revoked),
      grant.recurrence ? JSON.stringify(grant.recurrence) : null
    ]
  );
}

function rowToGrant(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    reason: row.reason || "",
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    revoked: row.revoked,
    recurrence: row.recurrence || null
  };
}

// --- grant requests --------------------------------------------------------

export async function loadGrantRequests() {
  const { rows } = await pool.query("SELECT * FROM grant_requests ORDER BY created_at DESC");
  return rows.map(rowToGrantRequest);
}

export async function saveGrantRequest(r) {
  await pool.query(
    `INSERT INTO grant_requests (id, user_id, username, display_name, connection_id, connection_name, reason, status, resolved_at, resolved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, resolved_by = EXCLUDED.resolved_by`,
    [r.id, r.userId, r.username, r.displayName || "", r.connectionId, r.connectionName, r.reason || "", r.status, r.resolvedAt || null, r.resolvedBy || null]
  );
}

function rowToGrantRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name || "",
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    reason: row.reason || "",
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    resolvedBy: row.resolved_by || null
  };
}

// --- recordings --------------------------------------------------------

export async function loadRecordings() {
  const { rows } = await pool.query("SELECT * FROM recordings ORDER BY created_at DESC");
  return rows.map(rowToRecording);
}

export async function saveRecording(r) {
  await pool.query(
    `INSERT INTO recordings (id, session_id, connection_id, connection_name, protocol, user_id, username, display_name, mode, status, started_at, ended_at, size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, ended_at = EXCLUDED.ended_at, size_bytes = EXCLUDED.size_bytes`,
    [
      r.id, r.sessionId, r.connectionId, r.connectionName, r.protocol, r.userId, r.username,
      r.displayName || "", r.mode, r.status, r.startedAt, r.endedAt, r.sizeBytes || 0
    ]
  );
}

export async function deleteRecording(id) {
  await pool.query("DELETE FROM recordings WHERE id = $1", [id]);
}

function rowToRecording(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    protocol: row.protocol,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name || "",
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    sizeBytes: Number(row.size_bytes || 0)
  };
}

// --- activity --------------------------------------------------------------

export async function loadActivity(limit = 80) {
  const { rows } = await pool.query("SELECT * FROM activity ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(rowToActivity);
}

export async function saveActivityEntry(entry) {
  await pool.query(
    `INSERT INTO activity (id, user_name, action, target, type) VALUES ($1,$2,$3,$4,$5)`,
    [entry.id, entry.user, entry.action, entry.target, entry.type]
  );
  await pool.query(
    `DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created_at DESC LIMIT 200)`
  );
}

function rowToActivity(row) {
  return {
    id: row.id,
    user: row.user_name,
    action: row.action,
    target: row.target,
    time: row.created_at.toISOString(),
    type: row.type
  };
}
