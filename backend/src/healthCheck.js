import net from "net";

// Probes a host:port with a real TCP connect attempt — the same technique
// probeGuacd() in index.js already uses for the guacd relay, just applied
// to every mapped connection's own hostname/port. Resolves reachability and
// round-trip connect latency; never rejects.
export function probeHost(hostname, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const sock = net.createConnection({ host: hostname, port: Number(port) });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(reachable ? { reachable: true, latencyMs: Date.now() - startedAt } : { reachable: false, latencyMs: null });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
  });
}

// A connection that answers but slowly is flagged rather than hidden —
// "degraded" means reachable yet above the threshold, which is more useful
// to an operator than a binary up/down.
export function classifyStatus(reachable, latencyMs, degradedThresholdMs = 300) {
  if (!reachable) return "offline";
  if (latencyMs != null && latencyMs > degradedThresholdMs) return "degraded";
  return "online";
}

// Renders a timestamp the same way the rest of the app already displays
// "last seen" (short, relative, human phrases) rather than a raw ISO string.
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "Never";
  const ms = now - new Date(iso).getTime();
  if (ms < 0) return "Just now";
  const s = Math.round(ms / 1000);
  if (s < 45) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
