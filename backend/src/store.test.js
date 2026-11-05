import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess, createGrant, grantStatus } from "./store.js";

const admin = { role: "admin", sub: "u-admin" };
const operator = { role: "operator", sub: "u-operator", username: "operator", displayName: "Jordan Lee" };
const actor = { displayName: "Alex Rivera" };

test("admins can always access any connection", () => {
  const access = evaluateAccess(admin, "conn-anything");
  assert.equal(access.allowed, true);
  assert.equal(access.standing, true);
});

test("an operator with no grants for a host has standing access (default-open demo policy)", () => {
  const access = evaluateAccess(operator, "conn-untouched-by-grants");
  assert.equal(access.allowed, true);
  assert.equal(access.standing, true);
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
