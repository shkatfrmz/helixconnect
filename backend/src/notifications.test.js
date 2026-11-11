import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";

// notifications.js reads its env vars once, at module load, same pattern as
// config.js and recordingFile.js — so the "unconfigured" checks below must
// run against a fresh import with no env vars set (the module cache key is
// the resolved URL, so importing it again later with different env vars in
// this same file uses a cache-busting query string to force a fresh module
// instance rather than the cached unconfigured one).
const unconfigured = await import("./notifications.js");

test("email and Slack report unconfigured when no env vars are set", () => {
  assert.equal(unconfigured.emailConfigured(), false);
  assert.equal(unconfigured.slackConfigured(), false);
});

test("sendEmail resolves sent:false with a clear reason when unconfigured, never throws", async () => {
  const result = await unconfigured.sendEmail({ to: "someone@example.com", subject: "hi", text: "hi" });
  assert.equal(result.sent, false);
  assert.match(result.reason, /not configured/i);
});

test("sendEmail resolves sent:false when there is no recipient address", async () => {
  const result = await unconfigured.sendEmail({ to: "", subject: "hi", text: "hi" });
  assert.equal(result.sent, false);
  assert.match(result.reason, /no recipient/i);
});

test("sendSlack resolves sent:false with a clear reason when unconfigured, never throws", async () => {
  const result = await unconfigured.sendSlack("hello");
  assert.equal(result.sent, false);
  assert.match(result.reason, /not configured/i);
});

test("notify() never throws even with both channels unconfigured", () => {
  assert.doesNotThrow(() => unconfigured.notify({ email: { to: "a@b.com", subject: "x", text: "y" }, slack: "hi" }));
});

test("sendSlack posts the message JSON to a real webhook endpoint", async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = JSON.parse(body);
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  process.env.HELIX_SLACK_WEBHOOK_URL = `http://127.0.0.1:${port}/webhook`;
  try {
    const configured = await import(`./notifications.js?t=${Date.now()}-slack`);
    assert.equal(configured.slackConfigured(), true);
    const result = await configured.sendSlack("a real alert");
    assert.equal(result.sent, true);
    assert.equal(received.text, "a real alert");
  } finally {
    delete process.env.HELIX_SLACK_WEBHOOK_URL;
    server.close();
  }
});

test("sendSlack resolves sent:false (not throws) when the webhook endpoint errors", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  process.env.HELIX_SLACK_WEBHOOK_URL = `http://127.0.0.1:${port}/webhook`;
  try {
    const configured = await import(`./notifications.js?t=${Date.now()}-slack-error`);
    const result = await configured.sendSlack("a real alert");
    assert.equal(result.sent, false);
    assert.match(result.reason, /500/);
  } finally {
    delete process.env.HELIX_SLACK_WEBHOOK_URL;
    server.close();
  }
});

test("sendEmail resolves sent:false (not throws) when the configured SMTP host refuses the connection", async () => {
  // A TCP server that immediately resets every connection stands in for an
  // SMTP host that's down/unreachable — nodemailer should reject, and our
  // sendEmail wrapper should turn that into a graceful {sent:false}.
  const net = await import("net");
  const server = net.createServer((sock) => sock.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  process.env.HELIX_SMTP_HOST = "127.0.0.1";
  process.env.HELIX_SMTP_PORT = String(port);
  try {
    const configured = await import(`./notifications.js?t=${Date.now()}-smtp`);
    assert.equal(configured.emailConfigured(), true);
    const result = await configured.sendEmail({ to: "someone@example.com", subject: "x", text: "y" });
    assert.equal(result.sent, false);
    assert.ok(result.reason);
  } finally {
    delete process.env.HELIX_SMTP_HOST;
    delete process.env.HELIX_SMTP_PORT;
    server.close();
  }
});
