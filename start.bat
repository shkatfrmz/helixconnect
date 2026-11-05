@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required.
  echo Install it from https://nodejs.org then run this script again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. It ships with Node.js.
  exit /b 1
)

if not exist node_modules goto INSTALL
if not exist backend\node_modules goto INSTALL
if not exist frontend\node_modules goto INSTALL
goto RELAY

:INSTALL
echo Installing Helix...
call npm install
if errorlevel 1 exit /b 1

:RELAY
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker not found. Helix will open in preview mode.
  goto RUN
)

docker compose version >nul 2>nul
if not errorlevel 1 (
  echo Starting display relay...
  docker compose up -d guacd
  if errorlevel 1 echo Could not reach the Docker daemon. Helix will open in preview mode.
  goto RUN
)

where docker-compose >nul 2>nul
if not errorlevel 1 (
  echo Starting display relay...
  docker-compose up -d guacd
  if errorlevel 1 echo Could not reach the Docker daemon. Helix will open in preview mode.
  goto RUN
)

echo Docker is installed but Compose is missing. Helix will open in preview mode.

:RUN
if "%GUACD_HOST%"=="" set GUACD_HOST=127.0.0.1
if "%GUACD_PORT%"=="" set GUACD_PORT=4822

echo.
echo Helix Remote  http://localhost:5173
echo Sign in       admin / admin
echo Stop          Ctrl+C
echo.

call npm run dev
