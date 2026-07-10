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
git pull --ff-only

echo "Installing any new dependencies..."
npm install

echo
echo "Update complete. Close Refrain (and its Terminal window) and start it"
echo "again to finish. If you run it as the background service, it picks up"
echo "the update the next time it restarts."
read -r -p "Press Enter to close..."
