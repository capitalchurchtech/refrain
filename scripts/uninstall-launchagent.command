#!/bin/bash
# Stops and removes the Refrain background service installed by
# install-launchagent.command. Double-click to run. This does not touch
# your config.json, .env, or any data; it only removes the launchd entry.
set -e

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
