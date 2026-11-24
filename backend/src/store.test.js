import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAccess,
  createGrant,
  grantStatus,
  createAgent,
  verifyAgentEnrollToken,
  completeAgentEnrollment,
  verifyAgentSecret,
  agentView,
  agentSockets
} from "./store.js";

const admin = { role: "admin", sub: "u-admin" };
// Deliberately NOT "u-operator" — that id has a real seeded demo grant
// (see store.js), which would make every access check below pass regardless
// of what this test file is actually trying to isolate.
const operator = { role: "operator", sub: "u-test-operator", username: "test-operator", displayName: "Test Operator" };
const actor = { displayName: "Alex Rivera" };

test("admins can always access any connection", () => {
  const access = evaluateAccess(admin, "conn-anything");
  assert.equal(access.allowed, true);
  assert.equal(access.standing, true);
});

test("an operator with no grants for a host is denied (default-deny policy)", () => {
  const access = evaluateAccess(operator, "conn-untouched-by-grants");
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "No grant for this host");
});

test("an operator with an active grant for the host is allowed", () => {
  const grant = createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    conn: { id: "conn-active", name: "Active Host" },
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  assert.equal(grantStatus(grant), "active");
  const access = evaluateAccess(operator, "conn-active");
  assert.equal(access.allowed, true);
  assert.equal(access.grant.id, grant.id);
});

test("an operator with only a future-scheduled grant is denied with a clear reason", () => {
  createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    conn: { id: "conn-future", name: "Future Host" },
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  const access = evaluateAccess(operator, "conn-future");
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "Grant has not started");
});

test("a fresh agent has a valid enrollment token and no secret yet", () => {
  const { agent, enrollToken } = createAgent({ name: "Test Laptop", createdBy: "Alex Rivera" });
  assert.equal(agent.name, "Test Laptop");
  assert.equal(agent.secretHash, "");
  assert.ok(enrollToken.length > 0);
  assert.equal(verifyAgentEnrollToken(agent, enrollToken), true);
  assert.equal(verifyAgentEnrollToken(agent, "wrong-token"), false);
});

test("an expired enrollment token is rejected even if the value matches", () => {
  const { agent, enrollToken } = createAgent({ name: "Expiring", createdBy: "Alex Rivera" });
  agent.enrollTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(verifyAgentEnrollToken(agent, enrollToken), false);
});

test("completing enrollment mints a secret, burns the enrollment token, and the old token can't be reused", () => {
  const { agent, enrollToken } = createAgent({ name: "Enrolling", createdBy: "Alex Rivera" });
  const secret = completeAgentEnrollment(agent, { hostnameReported: "DESKTOP-ABC", os: "Windows 11 Pro" });
  assert.ok(secret.length > 0);
  assert.equal(agent.hostnameReported, "DESKTOP-ABC");
  assert.equal(agent.os, "Windows 11 Pro");
  assert.equal(agent.enrollTokenHash, null);
  assert.equal(verifyAgentEnrollToken(agent, enrollToken), false);
  assert.equal(verifyAgentSecret(agent, secret), true);
  assert.equal(verifyAgentSecret(agent, "wrong-secret"), false);
});

test("agentView never exposes secretHash/enrollTokenHash, and reflects live online status", () => {
  const { agent } = createAgent({ name: "Viewable", createdBy: "Alex Rivera" });
  const view = agentView(agent);
  assert.equal(view.secretHash, undefined);
  assert.equal(view.enrollTokenHash, undefined);
  assert.equal(view.online, false);
  agentSockets.set(agent.id, {});
  assert.equal(agentView(agent).online, true);
  agentSockets.delete(agent.id);
});

test("an operator with only an expired grant is denied", () => {
  createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    conn: { id: "conn-expired", name: "Expired Host" },
    startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  });
  const access = evaluateAccess(operator, "conn-expired");
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "No active grant for this host");
});

test("createGrant rejects an end time at or before the start time", () => {
  const now = new Date().toISOString();
  assert.throws(() =>
    createGrant({
      actor,
      user: { id: operator.sub, username: operator.username },
      conn: { id: "conn-x", name: "X" },
      startsAt: now,
      endsAt: now
    })
  );
});

test("a group-level grant covers every host in that group, not others", () => {
  createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    group: "Finance",
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  const inGroup = evaluateAccess(operator, { id: "conn-finance-1", group: "Finance" });
  assert.equal(inGroup.allowed, true);
  assert.equal(inGroup.grant.connectionName, "Group: Finance");

  const outOfGroup = evaluateAccess(operator, { id: "conn-engineering-1", group: "Engineering" });
  assert.equal(outOfGroup.allowed, false);
});

test("a recurring grant is only active inside its own days/hours window", () => {
  const monday9am = new Date("2024-01-01T09:30:00"); // a Monday
  const mondayMidnight = new Date("2024-01-01T00:00:00");
  const grant = createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    conn: { id: "conn-weekday-9to5", name: "Weekday Host" },
    startsAt: new Date("2023-12-01T00:00:00").toISOString(),
    endsAt: new Date("2024-06-01T00:00:00").toISOString(),
    recurrence: { daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 9 * 60, endMinutes: 17 * 60 }
  });
  assert.equal(grantStatus(grant, monday9am.getTime()), "active");
  assert.equal(grantStatus(grant, mondayMidnight.getTime()), "scheduled");
});

test("createGrant rejects a recurrence with no days selected", () => {
  assert.throws(() =>
    createGrant({
      actor,
      user: { id: operator.sub, username: operator.username },
      conn: { id: "conn-bad-recur", name: "Bad" },
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      recurrence: { daysOfWeek: [], startMinutes: 540, endMinutes: 1020 }
    })
  );
});

test("a revoked grant no longer grants access", () => {
  const grant = createGrant({
    actor,
    user: { id: operator.sub, username: operator.username },
    conn: { id: "conn-revoke-me", name: "Revoke Host" },
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  grant.revoked = true;
  assert.equal(grantStatus(grant), "revoked");
  const access = evaluateAccess(operator, "conn-revoke-me");
  assert.equal(access.allowed, false);
});
