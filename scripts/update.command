#!/bin/bash
# One-click update (macOS). Fetches the latest Refrain code and installs
# any new dependencies. Double-click to run, then relaunch Refrain.
# Your config.json and .env are never touched.
set -e
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "This copy of Refrain wasn't set up with Git, so it can't update itself."
  echo "To update: download the latest ZIP from GitHub, unzip it to a new"
  echo "folder, and copy your config.json and .env into it before starting it."
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Fetching the latest version..."
# What the new version needs, before anything is pulled: an update this Node
# can't run would leave Refrain half-broken (server/node-version.js).
git fetch --quiet
NEED="$(git show '@{u}:package.json' 2>/dev/null | node --input-type=module -e '
import { nodeTooOld } from "./server/node-version.js";
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => { try { const n = nodeTooOld(JSON.parse(s).engines?.node); if (n) console.log(n); } catch {} });
' 2>/dev/null || true)"
if [ -n "$NEED" ]; then
  echo "This update needs Node $NEED or newer, and this Mac runs Node $(node --version)."
  echo "Install the current LTS from nodejs.org, then run this again. Nothing was changed."
  read -r -p "Press Enter to close..."
  exit 1
fi
# npm rewrites package-lock.json whenever it syncs the lockfile to
# package.json, and a modified lockfile makes `git pull` refuse outright.
# Discarding it is safe and is not a data loss: it is generated from
# package.json and node_modules, and `npm install` below rebuilds it.
git checkout -- package-lock.json 2>/dev/null || true

git pull --ff-only

echo "Installing any new dependencies..."
npm install

# Refrain.app is built on this Mac from mac/, so rebuild it if this update
# changed what it's built from. Nothing on a Mac that never built the app.
node server/mac-app.js || true

echo
echo "Update complete. Close Refrain (and its Terminal window) and start it"
echo "again to finish. If you run it as the background service, it picks up"
echo "the update the next time it restarts."
read -r -p "Press Enter to close..."
