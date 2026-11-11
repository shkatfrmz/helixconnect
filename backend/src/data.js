import { hashPassword } from "./crypto.js";

// Seed credentials are for local/demo use only. Set HELIX_SEED_ADMIN_PASSWORD
// and HELIX_SEED_OPERATOR_PASSWORD to override them; in production, change
// these passwords (or disable these accounts) immediately after first boot.
const SEED_ADMIN_PASSWORD = process.env.HELIX_SEED_ADMIN_PASSWORD || "admin";
const SEED_OPERATOR_PASSWORD = process.env.HELIX_SEED_OPERATOR_PASSWORD || "operator";

export const users = [
  {
    id: "u-admin",
    username: "admin",
    password: hashPassword(SEED_ADMIN_PASSWORD),
    displayName: "Alex Rivera",
    role: "admin",
    avatar: "AR",
    email: "admin@helix.local",
    provider: "local",
    disabled: false
  },
  {
    id: "u-operator",
    username: "operator",
    password: hashPassword(SEED_OPERATOR_PASSWORD),
    displayName: "Jordan Lee",
    role: "operator",
    avatar: "JL",
    email: "operator@helix.local",
    provider: "local",
    disabled: false
  }
];

export const connections = [
  {
    id: "conn-win-lab",
    name: "Windows Lab 01",
    protocol: "rdp",
    hostname: "10.0.12.21",
    port: 3389,
    username: "labuser",
    tags: ["windows", "lab", "gpu"],
    group: "Engineering",
    status: "online",
    latencyMs: 18,
    lastSeen: "Just now",
    description: "Windows 11 workstation with GPU passthrough for CAD and simulation work.",
    os: "Windows 11 Pro",
    resolution: "1920x1080",
    colorDepth: 32
  },
  {
    id: "conn-linux-dev",
    name: "Linux Devbox",
    protocol: "ssh",
    hostname: "10.0.12.40",
    port: 22,
    username: "dev",
    tags: ["linux", "dev", "terminal"],
    group: "Engineering",
    status: "online",
    latencyMs: 9,
    lastSeen: "2 min ago",
    description: "Ubuntu 24.04 development host with Docker, Node, and Python toolchains.",
    os: "Ubuntu 24.04 LTS",
    resolution: "1600x900",
    colorDepth: 24
  },
  {
    id: "conn-vnc-kiosk",
    name: "Kiosk Display",
    protocol: "vnc",
    hostname: "10.0.30.8",
    port: 5901,
    username: "",
    tags: ["vnc", "kiosk", "read-only"],
    group: "Operations",
    status: "degraded",
    latencyMs: 64,
    lastSeen: "11 min ago",
    description: "Public kiosk desktop used for digital signage and remote support.",
    os: "Debian 12",
    resolution: "1280x720",
    colorDepth: 24
  },
  {
    id: "conn-jump",
    name: "Jump Host",
    protocol: "ssh",
    hostname: "10.0.1.5",
    port: 22,
    username: "ops",
    tags: ["ssh", "bastion", "ops"],
    group: "Operations",
    status: "online",
    latencyMs: 12,
    lastSeen: "Just now",
    description: "Hardened jump box for production access. Session recording enabled.",
    os: "Rocky Linux 9",
    resolution: "1400x900",
    colorDepth: 24
  },
  {
    id: "conn-mac-ci",
    name: "macOS CI Node",
    protocol: "vnc",
    hostname: "10.0.22.17",
    port: 5900,
    username: "ci",
    tags: ["macos", "ci", "vnc"],
    group: "Platform",
    status: "offline",
    latencyMs: null,
    lastSeen: "3 hours ago",
    description: "Apple Silicon builder used for iOS and macOS CI pipelines.",
    os: "macOS Sequoia",
    resolution: "2560x1440",
    colorDepth: 32
  },
  {
    id: "conn-win-finance",
    name: "Finance Desktop",
    protocol: "rdp",
    hostname: "10.0.40.9",
    port: 3389,
    username: "finance",
    tags: ["windows", "finance", "restricted"],
    group: "Finance",
    status: "online",
    latencyMs: 27,
    lastSeen: "4 min ago",
    description: "Locked-down Windows desktop for ERP and reporting applications.",
    os: "Windows 10 LTSC",
    resolution: "1920x1080",
    colorDepth: 32,
    // Locked-down finance box: no clipboard in/out, no file transfer.
    clipboardEnabled: false,
    fileTransferEnabled: false
  }
];

export const activity = [
  { id: "a1", user: "Alex Rivera", action: "Opened session", target: "Windows Lab 01", time: "2 min ago", type: "session" },
  { id: "a2", user: "Jordan Lee", action: "Copied clipboard", target: "Linux Devbox", time: "8 min ago", type: "clipboard" },
  { id: "a3", user: "Alex Rivera", action: "Shared connection", target: "Jump Host", time: "21 min ago", type: "share" },
  { id: "a4", user: "System", action: "Gateway heartbeat", target: "Gateway", time: "1 min ago", type: "system" },
  { id: "a5", user: "Jordan Lee", action: "Failed login", target: "Auth", time: "1 hour ago", type: "auth" }
];
