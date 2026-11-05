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

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function shareCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
