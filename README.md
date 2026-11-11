# Helix Remote

Custom web console for remote desktops. Download the project and run one script. Helix starts the console; Docker starts the display relay if it is installed.

## Start

Linux / macOS:

```bash
chmod +x start.sh
./start.sh
```

Windows:

```bat
start.bat
```

Then open http://localhost:5173 and sign in with `admin` / `admin` or `operator` / `operator`.

The script installs Node packages on first run, starts `guacd` when Docker is available, and launches Helix. Stop with Ctrl+C.

This quick start is for local evaluation: it runs with in-memory data (reset on every restart) and a randomly generated session secret. See **Production setup** below before putting this in front of real hosts or real users.

## What you need

- Node.js 18 or newer (https://nodejs.org)
- Docker Desktop or Docker Engine, only if you want live RDP / VNC / SSH.
  Without Docker, Helix still opens in preview mode.

## Layout

- `frontend` — operator console
- `backend` — sessions, grants, users, display tunnel
- `docker-compose.yml` — `guacd` (display relay), an optional `app-db` Postgres for Helix's own data, and the official stock Guacamole UI (optional)

Users do not start the API or Vite by hand. `start.sh` / `start.bat` do that.

## Production setup

The quick start above is intentionally zero-config. Before deploying this for real:

1. **Set `NODE_ENV=production`.** The backend refuses to start in production unless `HELIX_JWT_SECRET` and `HELIX_CRYPTO_KEY` are both set (32+ characters). Generate each with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **Turn on persistence.** By default all users, connections, grants, and activity live in memory and vanish on restart. Set `DATABASE_URL` to a Postgres connection string (the bundled `app-db` service works out of the box — see below) and the backend will create its schema automatically and persist everything except live session/socket state, which is inherently process-local.
   ```bash
   docker compose up -d app-db
   export DATABASE_URL=postgresql://helix:helix@127.0.0.1:5433/helix
   ```
   Once `DATABASE_URL` is set, `HELIX_JWT_SECRET`/`HELIX_CRYPTO_KEY` become required even outside production — a key that changes on every restart would make already-stored connection passwords permanently undecryptable.
3. **Change the seed accounts.** `admin`/`admin` and `operator`/`operator` are demo credentials. Override them before first boot with `HELIX_SEED_ADMIN_PASSWORD` / `HELIX_SEED_OPERATOR_PASSWORD`, or change the passwords via the admin UI immediately after.
4. **Lock down CORS.** Set `HELIX_CORS_ORIGINS` to your real frontend origin(s) (comma-separated). It defaults to the local Vite dev server only.
5. **Set `HELIX_TRUST_PROXY`** to the number of reverse-proxy hops in front of the backend (e.g. `1` for a single nginx/ALB) if you're behind one. This is what the login rate limiter uses to see real client IPs.
6. **Review per-connection certificate validation.** `ignoreCert` now defaults to `false` for every connection — an admin must explicitly opt a host into skipping RDP certificate validation, rather than every host trusting an unverified cert by default.

See `.env.example` for the full list of environment variables.

## Persistence details

With `DATABASE_URL` unset, the app behaves exactly as before: in-memory, demo-friendly, resets on restart. With it set:

- `users`, `connections`, `grants`, `grant_requests`, `recordings`, and `activity` are persisted to Postgres (schema auto-created from `backend/src/schema.sql`).
- Connection passwords (target host credentials) are encrypted at rest with `HELIX_CRYPTO_KEY`, not stored in plaintext.
- User passwords are always hashed with bcrypt, whether persisted or in-memory.
- Session recordings themselves are `.guac` files on disk (`HELIX_RECORDINGS_DIR`, default `backend/recordings/`) — only their metadata (who, which host, when, size) lives in Postgres/memory. Deleting a recording from the admin UI removes both.
- Live sessions, WebSocket rooms, and share codes stay in-memory — a socket only means something to the process holding it, so this state is rebuilt on reconnect rather than restored across a restart.

## Testing

```bash
cd backend && npm test
```

Covers password hashing/verification, token encryption, and grant/access-evaluation logic. CI (`.github/workflows/ci.yml`) runs this plus a frontend build check on every push and pull request.

## Optional stock Guacamole UI

```bash
docker compose --profile stock-ui up -d
```

That UI is at http://localhost:8080/. Helix remains the console.

## How it is wired

Browser (Helix) → Express API → display tunnel `/ws/display` → guacd → RDP / VNC / SSH
