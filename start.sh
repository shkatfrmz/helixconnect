#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required."
  echo "Install it from https://nodejs.org then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (it ships with Node.js)."
  exit 1
fi

if [ ! -d node_modules ] || [ ! -d backend/node_modules ] || [ ! -d frontend/node_modules ]; then
  echo "Installing Helix…"
  npm install
fi

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "Starting display relay…"
    # The Docker CLI can be present with no daemon running (Docker Desktop
    # not started, no permission on the socket, etc). Don't let that abort
    # the whole script under set -e — fall back to preview mode instead.
    if ! docker compose up -d guacd; then
      echo "Could not reach the Docker daemon. Helix will open in preview mode (catalog works, live desktops need Docker running)."
    fi
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "Starting display relay…"
    if ! docker-compose up -d guacd; then
      echo "Could not reach the Docker daemon. Helix will open in preview mode (catalog works, live desktops need Docker running)."
    fi
  else
    echo "Docker is installed but Compose is missing. Helix will open in preview mode."
  fi
else
  echo "Docker not found. Helix will open in preview mode (catalog works, live desktops need Docker)."
fi

export GUACD_HOST="${GUACD_HOST:-127.0.0.1}"
export GUACD_PORT="${GUACD_PORT:-4822}"

echo
echo "Helix Remote  http://localhost:5173"
echo "Sign in       admin / admin"
echo "Stop          Ctrl+C"
echo

npm run dev
