#!/bin/bash
# Double-click launcher (macOS) — see docs/refrain-architecture.md Section 10/11.
# No terminal knowledge required: installs dependencies on first run,
# starts the server, and opens the app in your browser once it's ready.
set -e
cd "$(dirname "$0")/.."

# Find Node, including installs that are not on the default PATH.
#
# A double-clicked .command does not read ~/.zshrc or ~/.bash_profile, so a
# `command -v node` alone only finds Node in the system PATH. That is fine for
# the .pkg installer, which needs an administrator password -- and not everyone
# has one. On a locked-down or borrowed machine the usual answer is a
# user-space Node in the home folder, which worked perfectly in Terminal and
# then made this launcher claim Node was not installed at all.
#
# So look where a user-space install actually lands before giving up.
if ! command -v node >/dev/null 2>&1; then
  for candidate in \
    "$HOME/.local/node/bin" \
    "$HOME/node/bin" \
    "$HOME/.volta/bin" \
    "$HOME/.fnm/aliases/default/bin" \
    "$HOME"/.nvm/versions/node/*/bin \
    /opt/homebrew/bin \
    /usr/local/bin
  do
    if [ -x "$candidate/node" ]; then
      PATH="$candidate:$PATH"
      export PATH
      break
    fi
  done
fi

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
