import crypto from "crypto";

export const IS_PRODUCTION = (process.env.NODE_ENV || "development") === "production";
export const DATABASE_URL = process.env.DATABASE_URL || "";

// A random per-process secret is fine for pure in-memory demo mode — restart
// just means everyone re-logs in. But with DATABASE_URL set, connection
// passwords are encrypted at rest with CRYPTO_KEY and outlive the process,
// so a key that changes on every restart makes already-stored data
// permanently undecryptable. Persistence therefore requires stable secrets
// even outside production.
const REQUIRE_STABLE_SECRETS = IS_PRODUCTION || Boolean(DATABASE_URL);

function required(name, { minLength = 0 } = {}) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `Missing required environment variable ${name}${minLength ? ` (must be at least ${minLength} characters)` : ""}.\n` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  return value;
}

// In production (or whenever persistence is on) these MUST be set, or the
// process refuses to start — a shipped default secret here would let anyone
// forge session tokens or decrypt stored Guacamole connection tokens. In
// pure in-memory dev/demo mode we generate a random one per process start
// instead, so there's still a zero-config quick start.
export const JWT_SECRET = REQUIRE_STABLE_SECRETS
  ? required("HELIX_JWT_SECRET", { minLength: 32 })
  : process.env.HELIX_JWT_SECRET || crypto.randomBytes(32).toString("base64");

export const CRYPTO_KEY = (
  REQUIRE_STABLE_SECRETS
    ? required("HELIX_CRYPTO_KEY", { minLength: 32 })
    : process.env.HELIX_CRYPTO_KEY || crypto.randomBytes(32).toString("base64")
).slice(0, 32);

if (!REQUIRE_STABLE_SECRETS && !process.env.HELIX_JWT_SECRET) {
  console.log("[helix] HELIX_JWT_SECRET not set — using a random dev secret for this run (tokens won't survive a restart)");
}

export const CORS_ORIGINS = (process.env.HELIX_CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
