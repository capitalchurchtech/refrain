#!/bin/bash
# Double-click launcher (macOS) — see docs/refrain-architecture.md Section 10/11.
# No terminal knowledge required: installs dependencies on first run,
# starts the server, and opens the app in your browser once it's ready.
set -e
cd "$(dirname "$0")/.."

# Find Node, including installs that are not on the default PATH.
# The search list lives in find-node.sh, shared with the LaunchAgent installer.
# shellcheck source=find-node.sh
. "$(dirname "$0")/find-node.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but wasn't found on this machine."
  echo "Install it from https://nodejs.org (the LTS version), then re-run this script."
  echo
  echo "No administrator password? Node can be installed into your home folder"
  echo "instead, with no admin rights — see the Installing section of README.md."
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
