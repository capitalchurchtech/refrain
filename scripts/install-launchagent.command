#!/bin/bash
# Installs Refrain as a macOS launchd LaunchAgent: it runs in the
# background with no Terminal window, starts automatically at login, and
# relaunches itself if it ever crashes. Double-click this file to run it.
# To undo, double-click uninstall-launchagent.command.
#
# This replaces the start.command / Login Item way of running Refrain, so
# if you set one of those up, remove it afterward (see the note at the end)
# so two copies don't fight over the same port.
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.refrain.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$APP_DIR/logs"

echo "Installing the Refrain background service..."
echo "App folder: $APP_DIR"

# Find Node the way an interactive shell would, so this works whether Node
# came from the nodejs.org installer, Homebrew (Intel or Apple Silicon), or nvm.
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  NODE="$(/bin/bash -lc 'command -v node' 2>/dev/null || true)"
fi
if [ -z "$NODE" ]; then
  echo
  echo "Couldn't find Node.js on this machine. Install it first (see the"
  echo "README's 'Installing Node.js' section), then run this again."
  read -r -p "Press Enter to close..."
  exit 1
fi
NODE_DIR="$(dirname "$NODE")"
echo "Using Node at: $NODE"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# launchd does not expand ~ or environment variables inside the plist, so
# every path written here is absolute. WorkingDirectory must be the app
# folder because Refrain reads config.json and writes data relative to it.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP_DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/refrain.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/refrain.err.log</string>
</dict>
</plist>
PLISTEOF

# Make sure it's a valid plist before we try to load it.
plutil -lint "$PLIST" >/dev/null

# Reload cleanly whether or not a previous version was already loaded.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo
echo "Done. Refrain is now running in the background as a service."
echo "  Settings file: $PLIST"
echo "  Logs:          $LOG_DIR/refrain.out.log (and refrain.err.log)"
echo
echo "It will start on its own every time this account logs in, and relaunch"
echo "if it crashes. For it to come back after a full reboot with no one"
echo "present, also turn on automatic login for this account in"
echo "System Settings > Users & Groups."
echo
echo "If you previously started Refrain with start.command or added it as a"
echo "Login Item, remove that now so two copies don't run at the same time."
read -r -p "Press Enter to close..."
