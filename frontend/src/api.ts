const TOKEN_KEY = "helix.token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined)
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    if (!path.includes("/login")) window.location.href = "/login";
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

// Playback/download need the raw bytes of a .guac recording rather than
// parsed JSON, but still have to carry the bearer token — a plain <a href>
// or <video src> can't attach an Authorization header, so recordings are
// always fetched as a blob and handed to the player or an object URL.
export async function apiBlob(path: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  if (res.status === 401) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || "Request failed");
  }
  return res.blob();
}

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatar: string;
  email?: string;
  provider?: string;
  disabled?: boolean;
  favorites?: string[];
  mfaEnabled?: boolean;
};

export type Access = {
  allowed: boolean;
  standing: boolean;
  grant: Grant | null;
  reason: string | null;
};

export type Grant = {
  id: string;
  userId: string;
  username: string;
  connectionId: string;
  connectionName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  recurrence?: { daysOfWeek: number[]; startMinutes: number; endMinutes: number } | null;
  status: "active" | "scheduled" | "expired" | "revoked";
};

export type Connection = {
  id: string;
  name: string;
  protocol: "rdp" | "vnc" | "ssh" | "telnet" | "kubernetes";
  hostname: string;
  port: number;
  username: string;
  tags: string[];
  group: string;
  status: "online" | "offline" | "degraded";
  latencyMs: number | null;
  lastSeen: string;
  description: string;
  os: string;
  resolution: string;
  colorDepth: number;
  clipboardEnabled?: boolean;
  fileTransferEnabled?: boolean;
  recordingEnabled?: boolean;
  access?: Access;
};

export type Recording = {
  id: string;
  sessionId: string;
  connectionId: string;
  connectionName: string;
  protocol: string;
  userId: string;
  username: string;
  displayName?: string;
  mode: "live" | "demo";
  status: "recording" | "complete";
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  sizeBytes: number;
};

export type Session = {
  id: string;
  connectionId: string;
  connectionName: string;
  protocol: string;
  userId: string;
  username: string;
  displayName?: string;
  startedAt: string;
  lastActivity?: number;
  mode: "live" | "demo";
  status: "active" | "idle" | "disconnected";
  shareCode: string | null;
  sharing: boolean;
  viewers: string[];
  idleTimeoutMs: number;
  reconnectCount: number;
  readOnly: boolean;
  parentId: string | null;
  displayToken?: string | null;
  tunnelPath?: string;
  hostSessionId?: string;
  grantId?: string | null;
  grantEndsAt?: string | null;
};

export type Stats = {
  connections: number;
  online: number;
  activeSessions: number;
  users: number;
  backendMode: "live" | "demo";
  relayOnline: boolean;
  sharing?: number;
  grants?: number;
  sso?: { google: boolean; entra: boolean };
};

export type Usage = {
  days: number;
  totalSessions: number;
  totalMinutes: number;
  sessionsByDay: { date: string; count: number }[];
  topHosts: { key: string; name: string; sessions: number; totalMinutes: number }[];
  topUsers: { key: string; name: string; sessions: number; totalMinutes: number }[];
  latency: { connectionId: string; connectionName: string; status: string; latencyMs: number | null; history: (number | null)[] }[];
};

export type GrantRequest = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  connectionId: string;
  connectionName: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type Activity = {
  id: string;
  user: string;
  action: string;
  target: string;
  time: string;
  type: string;
};

export type Health = {
  ok: boolean;
  name: string;
  gateway: {
    reachable: boolean;
    mode: "live" | "demo";
  };
  sso?: { google: boolean; entra: boolean };
};
