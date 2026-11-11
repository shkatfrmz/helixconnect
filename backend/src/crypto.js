import crypto from "crypto";
import bcrypt from "bcryptjs";
import { CRYPTO_KEY } from "./config.js";

export const CRYPTO_CYPHER = "AES-256-CBC";
export { CRYPTO_KEY };

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export function encryptToken(value) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(CRYPTO_CYPHER, Buffer.from(CRYPTO_KEY), iv);
  let encrypted = cipher.update(JSON.stringify(value), "utf8", "base64");
  encrypted += cipher.final("base64");
  return Buffer.from(
    JSON.stringify({
      iv: iv.toString("base64"),
      value: encrypted
    })
  ).toString("base64");
}

export function decryptToken(encoded) {
  const { iv, value } = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const decipher = crypto.createDecipheriv(CRYPTO_CYPHER, Buffer.from(CRYPTO_KEY), Buffer.from(iv, "base64"));
  let decrypted = decipher.update(value, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

// Encrypts a stored secret (e.g. a target host's password) at rest. Same
// cipher as encryptToken, named separately so call sites read intent.
export const encryptSecret = encryptToken;
export const decryptSecret = decryptToken;

// --- TOTP (RFC 6238 / RFC 4226) — no external dependency: this is just
// HMAC-SHA1 of a time counter, which node's built-in crypto already does.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20); // 160 bits, the RFC 4226 recommendation
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(base32) {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(keyBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", keyBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function totpToken(base32Secret, at = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(at / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter);
}

// Accepts a code from the current 30s step or one step either side, so a
// slightly-off device clock (or the user being slow to type) still works.
export function verifyTotp(base32Secret, token, at = Date.now(), stepSeconds = 30, window = 1) {
  if (!/^\d{6}$/.test(String(token || ""))) return false;
  const counter = Math.floor(at / 1000 / stepSeconds);
  const key = base32Decode(base32Secret);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    if (hotp(key, counter + errorWindow) === token) return true;
  }
  return false;
}

export function totpAuthUrl(secret, username, issuer = "HelixConnect") {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function shareCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
