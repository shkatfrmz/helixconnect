// HelixConnect agent.
//
// Runs on a machine HelixConnect can't reach directly (behind NAT, no
// inbound RDP/VNC/SSH port open). This script dials OUT to the HelixConnect
// server instead, so nothing needs to be opened in a firewall on this side.
//
// First run (enrolling): the admin who created this agent in HelixConnect's
// "Agents" tab gives you a HELIX_SERVER, HELIX_AGENT_ID, and a one-time
// HELIX_ENROLL_TOKEN. This script trades that token for a persistent secret,
// saved next to this script in agent-config.json. The token is only good
// once and expires after 30 minutes — if it's already been used (or it's
// stale), ask the admin to re-enroll the agent for a fresh one.
//
// Every run after that: agent-config.json already has the secret, so
// HELIX_ENROLL_TOKEN isn't needed (and is ignored if set) — just
// HELIX_SERVER and HELIX_AGENT_ID.
//
// What it actually does once connected: holds one control WebSocket open
// (enroll/auth, heartbeat), and whenever HelixConnect asks it to open a
// tunnel (because someone started a remote session against this agent), it
// opens a second WebSocket plus a local TCP connection to 127.0.0.1:<port>
// — the RDP/VNC/SSH port on THIS machine — and relays raw bytes between
// the two. See ../backend/src/index.js (openAgentTunnel / the two
// /ws/agent-* WebSocket servers) for the server side of this protocol.
//
// Usage:
//   npm install
//   set HELIX_SERVER=wss://helix.example.com
//   set HELIX_AGENT_ID=agent-xxxxxxxx
//   set HELIX_ENROLL_TOKEN=xxxxxxxxxxxxxxxx   (first run only)
//   node windows-agent.js
//
// Running it as a Windows service (so it survives logoff/reboot): see
// README.md in this folder.

import WebSocket from "ws";
import net from "net";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.HELIX_AGENT_CONFIG || path.join(__dirname, "agent-config.json");

const SERVER = (process.env.HELIX_SERVER || "").replace(/\/$/, "");
const AGENT_ID = process.env.HELIX_AGENT_ID || "";
const ENROLL_TOKEN = process.env.HELIX_ENROLL_TOKEN || "";
const HEARTBEAT_MS = 20000;
const MAX_RECONNECT_DELAY_MS = 30000;

function log(...args) {
  console.log(`[helix-agent ${new Date().toISOString()}]`, ...args);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

if (!SERVER || !AGENT_ID) {
  console.error("[helix-agent] HELIX_SERVER and HELIX_AGENT_ID are required — see README.md.");
  process.exit(1);
}

// A stored secret only applies to the agent id it was issued for. If this
// config was left over from enrolling as a different agent id, start fresh
// rather than silently authenticating as the wrong device.
let config = loadConfig();
if (config.agentId !== AGENT_ID) config = {};

let reconnectDelayMs = 2000;

function identity() {
  return { hostname: os.hostname(), os: `${os.type()} ${os.release()}` };
}

function connectControl() {
  const url = `${SERVER}/ws/agent-control?agentId=${encodeURIComponent(AGENT_ID)}`;
  log("connecting to", url);
  const ws = new WebSocket(url);
  let authed = false;
  let heartbeatTimer = null;

  ws.on("open", () => {
    reconnectDelayMs = 2000; // we got a real connection — reset backoff
    if (config.secret) {
      ws.send(JSON.stringify({ type: "auth", secret: config.secret, ...identity() }));
    } else if (ENROLL_TOKEN) {
      ws.send(JSON.stringify({ type: "enroll", token: ENROLL_TOKEN, ...identity() }));
    } else {
      log("no saved secret in", CONFIG_PATH, "and no HELIX_ENROLL_TOKEN set — nothing to authenticate with.");
      process.exit(1);
    }
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!authed) {
      if (msg.type === "enrolled") {
        config = { agentId: AGENT_ID, secret: msg.secret };
        saveConfig(config);
        authed = true;
        log("enrolled — secret saved to", CONFIG_PATH, "(keep this file private)");
      } else if (msg.type === "authed") {
        authed = true;
        log("connected and authenticated");
      } else {
        return;
      }
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
      }, HEARTBEAT_MS);
      return;
    }

    if (msg.type === "open-tunnel") openTunnel(msg.tunnelId, msg.port);
  });

  ws.on("close", (code, reason) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    const reasonText = reason?.toString() || "";
    if (!authed && !config.secret && !ENROLL_TOKEN) return; // already exited above
    log(`control connection closed (${code}${reasonText ? " " + reasonText : ""}) — retrying in ${reconnectDelayMs}ms`);
    setTimeout(connectControl, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    log("control connection error:", err.message);
  });
}

// One of these runs per active remote session against this agent: relays
// raw bytes between a WebSocket back to the HelixConnect server and a
// plain TCP connection to the real RDP/VNC/SSH port on this machine.
function openTunnel(tunnelId, port) {
  const url = `${SERVER}/ws/agent-tunnel?tunnelId=${encodeURIComponent(tunnelId)}&agentId=${encodeURIComponent(
    AGENT_ID
  )}&secret=${encodeURIComponent(config.secret)}`;
  log("opening tunnel", tunnelId, "-> 127.0.0.1:" + port);

  const tunnelWs = new WebSocket(url);
  const localSocket = net.createConnection({ host: "127.0.0.1", port });
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    localSocket.destroy();
    try {
      tunnelWs.close();
    } catch {
      /* already closed */
    }
  };

  tunnelWs.on("open", () => log("tunnel", tunnelId, "connected"));
  tunnelWs.on("message", (chunk) => {
    if (!localSocket.destroyed) localSocket.write(chunk);
  });
  tunnelWs.on("close", cleanup);
  tunnelWs.on("error", (err) => {
    log("tunnel", tunnelId, "websocket error:", err.message);
    cleanup();
  });

  localSocket.on("data", (chunk) => {
    if (tunnelWs.readyState === WebSocket.OPEN) tunnelWs.send(chunk);
  });
  localSocket.on("close", cleanup);
  localSocket.on("error", (err) => {
    log("tunnel", tunnelId, "local connection to port", port, "failed:", err.message);
    cleanup();
  });
}

log("HelixConnect agent starting — server:", SERVER, "agent id:", AGENT_ID);
connectControl();
