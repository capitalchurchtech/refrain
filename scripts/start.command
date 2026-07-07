#!/bin/bash
# Double-click launcher (macOS) — see docs/refrain-architecture.md Section 10/11.
# No terminal knowledge required: installs dependencies on first run,
# starts the server, and opens the app in your browser once it's ready.
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but wasn't found on this machine."
  echo "Install it from https://nodejs.org (the LTS version), then re-run this script."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

PORT="${PORT:-3000}"

# Open the browser once the server actually responds, without blocking
# the server's own log output in this window.
(
  for _ in $(seq 1 30); do
    sleep 1
    if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
      open "http://localhost:$PORT"
      break
    fi
  done
) &

echo "Starting Refrain — leave this window open while you use it."
npm start
