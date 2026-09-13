#!/bin/bash
# Stops and removes the Refrain background service installed by
# install-launchagent.command (or by the Health screen's button). Double-click
# to run. This does not touch your config.json, .env, or any data; it only
# removes the launchd entry.
set -e
cd "$(dirname "$0")/.."

# shellcheck source=find-node.sh
. "$(dirname "$0")/find-node.sh"

# Removing the agent must not depend on Node being findable -- the reason
# someone is uninstalling may well be that Node moved. So do it directly, and
# only fall back to the module for anything more than deleting a file.
LABEL="com.refrain.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$PLIST" ]; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Stopped and removed the Refrain background service."
  echo "Your settings and data are untouched."
else
  echo "No Refrain background service was installed (nothing at $PLIST)."
fi
read -r -p "Press Enter to close..."
