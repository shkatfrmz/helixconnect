import { test } from "node:test";
import assert from "node:assert/strict";
import net from "net";
import { probeHost, classifyStatus, relativeTime } from "./healthCheck.js";

test("classifyStatus marks an unreachable host offline regardless of latency", () => {
  assert.equal(classifyStatus(false, null), "offline");
  assert.equal(classifyStatus(false, 10), "offline");
});

test("classifyStatus marks a fast, reachable host online", () => {
  assert.equal(classifyStatus(true, 20), "online");
});

test("classifyStatus marks a slow, reachable host degraded", () => {
  assert.equal(classifyStatus(true, 500), "degraded");
});

test("relativeTime renders human-readable buckets", () => {
  const now = Date.now();
  assert.equal(relativeTime(null), "Never");
  assert.equal(relativeTime(new Date(now).toISOString(), now), "Just now");
  assert.equal(relativeTime(new Date(now - 5 * 60 * 1000).toISOString(), now), "5 min ago");
  assert.equal(relativeTime(new Date(now - 3 * 60 * 60 * 1000).toISOString(), now), "3 hours ago");
  assert.equal(relativeTime(new Date(now - 1 * 60 * 60 * 1000).toISOString(), now), "1 hour ago");
  assert.equal(relativeTime(new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), now), "2 days ago");
});

test("probeHost resolves reachable:true with a measured latency against a real open port", async () => {
  const server = net.createServer((sock) => sock.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await probeHost("127.0.0.1", port, 1000);
    assert.equal(result.reachable, true);
    assert.ok(typeof result.latencyMs === "number" && result.latencyMs >= 0);
  } finally {
    server.close();
  }
});

test("probeHost resolves reachable:false for a closed port", async () => {
  // Port 1 is a reserved/privileged port extremely unlikely to have
  // anything listening on it in a test environment.
  const result = await probeHost("127.0.0.1", 1, 500);
  assert.equal(result.reachable, false);
  assert.equal(result.latencyMs, null);
});
