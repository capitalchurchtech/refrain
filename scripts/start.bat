@echo off
rem Double-click launcher (Windows) - see docs/refrain-architecture.md Section 10/11.
rem No terminal knowledge required: installs dependencies on first run,
rem starts the server, and opens the app in your browser once it's ready.
setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but wasn't found on this machine.
  echo Install it from https://nodejs.org ^(the LTS version^), then re-run this script.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
)

if "%PORT%"=="" set PORT=3000

rem Open the browser once the server actually responds, without blocking
rem the server's own log output in this window.
start "" /b powershell -NoProfile -Command ^
  "for ($i=0; $i -lt 30; $i++) { try { Invoke-WebRequest -Uri ('http://localhost:' + $env:PORT) -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process ('http://localhost:' + $env:PORT); break } catch { Start-Sleep -Seconds 1 } }"

echo Starting Refrain -- leave this window open while you use it.
call npm start
pause
