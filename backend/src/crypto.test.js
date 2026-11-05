import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, encryptToken, decryptToken } from "./crypto.js";

test("hashPassword produces a hash that verifies against the original password", () => {
  const hash = hashPassword("correct-horse");
  assert.notEqual(hash, "correct-horse");
  assert.equal(verifyPassword("correct-horse", hash), true);
});

test("verifyPassword rejects a wrong password", () => {
  const hash = hashPassword("correct-horse");
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("verifyPassword rejects an empty hash (e.g. an SSO-only account)", () => {
  assert.equal(verifyPassword("anything", ""), false);
  assert.equal(verifyPassword("", ""), false);
});

test("encryptToken/decryptToken round-trips a value", () => {
  const original = { connection: { type: "rdp", settings: { hostname: "10.0.0.1", password: "s3cret" } } };
  const encrypted = encryptToken(original);
  assert.notEqual(encrypted, JSON.stringify(original));
  assert.deepEqual(decryptToken(encrypted), original);
});

test("each encryptToken call uses a fresh IV, so ciphertext differs even for identical input", () => {
  const a = encryptToken("same-value");
  const b = encryptToken("same-value");
  assert.notEqual(a, b);
  assert.equal(decryptToken(a), "same-value");
  assert.equal(decryptToken(b), "same-value");
});
