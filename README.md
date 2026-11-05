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

## What you need

- Node.js 18 or newer (https://nodejs.org)
- Docker Desktop or Docker Engine, only if you want live RDP / VNC / SSH
  Without Docker, Helix still opens in preview mode.

## Layout

- `frontend` — operator console
- `backend` — sessions, grants, users, display tunnel
- `docker-compose.yml` — official `guacamole/guacd` (one container)

Users do not start the API or Vite by hand. `start.sh` / `start.bat` do that.

## Optional stock Guacamole UI

```bash
docker compose --profile stock-ui up -d
```

That UI is at http://localhost:8080/. Helix remains the console.

## How it is wired

Browser (Helix) → Express API → display tunnel `/ws/display` → guacd → RDP / VNC / SSH
