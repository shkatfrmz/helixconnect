import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, encryptToken, decryptToken, generateTotpSecret, totpToken, verifyTotp } from "./crypto.js";

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

test("generateTotpSecret produces a usable base32 string", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.ok(secret.length >= 16);
});

test("verifyTotp accepts the code totpToken produces for the same instant", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totpToken(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, now), true);
});

test("verifyTotp tolerates one time-step of clock drift either way, but not two", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totpToken(secret, now);
  assert.equal(verifyTotp(secret, code, now + 30_000), true);
  assert.equal(verifyTotp(secret, code, now - 30_000), true);
  assert.equal(verifyTotp(secret, code, now + 90_000), false);
});

test("verifyTotp rejects a wrong or malformed code", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totpToken(secret, now);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal(verifyTotp(secret, wrong, now), false);
  assert.equal(verifyTotp(secret, "abcdef", now), false);
  assert.equal(verifyTotp(secret, "", now), false);
});

test("two different secrets produce different codes at the same instant", () => {
  const now = Date.now();
  const a = totpToken(generateTotpSecret(), now);
  const b = totpToken(generateTotpSecret(), now);
  // Astronomically unlikely to collide with random 160-bit secrets; this
  // mainly guards against a function that ignores the secret entirely.
  assert.notEqual(a, b);
});
