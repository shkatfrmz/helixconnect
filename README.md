# Helix Remote

Custom web console for Apache Guacamole. Guacamole (guacd) stays the protocol backend. Helix is the operator UI.

## Layout

- `frontend` — Vite + React control surface
- `backend` — Express API, session tokens, guacamole-lite WebSocket tunnel
- `docker-compose.yml` — official `guacamole/guacd` (and optional stock Guacamole UI)

## Run the custom UI

```bash
npm install
npm run dev
```

Open the Vite preview. Sign in with `admin` / `admin` or `operator` / `operator`.

Without guacd, Helix runs in demo mode: catalog, session chrome, and a local display stream. Attach a live backend to stream a real desktop.

## Live Guacamole backend

```bash
docker compose up -d
```

guacd listens on `4822`. Point Helix at it:

```bash
GUACD_HOST=127.0.0.1 GUACD_PORT=4822 npm run dev
```

Optional stock Guacamole web UI (kept in the background):

```bash
docker compose --profile stock-ui up -d
```

That UI is at `http://localhost:8080/`. Helix remains the custom front-end.

## How it is wired

Browser (Helix) → Express API → guacamole-lite `/ws/guacamole` → guacd → RDP / VNC / SSH

guacamole-common-js is the client protocol stack Guacamole documents for custom apps. This console uses that model: Helix owns auth, catalog, and chrome; guacd owns remote desktop translation.
