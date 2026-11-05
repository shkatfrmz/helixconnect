import crypto from "crypto";

export const CRYPTO_CYPHER = "AES-256-CBC";
export const CRYPTO_KEY = (process.env.HELIX_CRYPTO_KEY || "HelixRemoteGuacamoleKey32bytes!!").slice(0, 32);

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

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function shareCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
