#!/bin/bash
# Builds Refrain.app on this Mac and puts it in ~/Applications. Double-click
# this file to run it, and again after an update.
#
# The app is a native window showing Refrain's own screens, in place of a
# Chrome app window. It doesn't run the server: keep Start at login on (Health
# screen), or start Refrain with start.command as before.
#
# Built here, on this Mac, on purpose. An app compiled on the machine is never
# quarantined, so Gatekeeper lets it open without an Apple Developer ID. Don't
# copy the built app to another Mac (AirDrop or a download quarantines it and
# macOS will refuse it); run this script on each Mac instead.
set -euo pipefail
cd "$(dirname "$0")/.."

finish() {
  # Keep a double-clicked window open long enough to read.
  if [ -t 0 ]; then read -r -p "Press Enter to close..."; fi
}

if [ "$(uname)" != "Darwin" ]; then
  echo "Refrain.app is for macOS. On Windows, use the Chrome or Edge app window in README.md."
  exit 1
fi

if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "Building the app needs Apple's Command Line Tools (free, no Apple account)."
  echo "Install them with this command, then run this script again:"
  echo
  echo "    xcode-select --install"
  echo
  finish
  exit 1
fi

VERSION="$(/usr/bin/plutil -extract version raw -o - package.json)"

# The address the server answers on. Start at login keeps its port in the
# LaunchAgent; otherwise the app uses the server's default, 9999.
URL=""
AGENT="$HOME/Library/LaunchAgents/com.refrain.server.plist"
if [ -f "$AGENT" ]; then
  AGENT_PORT="$(/usr/bin/plutil -extract EnvironmentVariables.PORT raw -o - "$AGENT" 2>/dev/null || true)"
  if [ -n "$AGENT_PORT" ]; then URL="http://127.0.0.1:$AGENT_PORT/"; fi
fi

OUT="build/mac"
APP="$OUT/Refrain.app"
echo "Building Refrain.app $VERSION..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

xcrun swiftc -O -swift-version 5 \
  -target "$(uname -m)-apple-macos12.0" \
  mac/Refrain/*.swift \
  -o "$APP/Contents/MacOS/Refrain"

# The tool that photographs drawn slides for phones (server/phone-pictures.js).
# Phones show words without it, so a failure here never costs the app.
mkdir -p "$APP/Contents/Helpers"
if ! xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos12.0" \
     mac/helpers/refrain-snapshot.swift -o "$APP/Contents/Helpers/refrain-snapshot"; then
  echo "Couldn't build the phone pictures tool, so phones will show slides' words."
fi

# The commit built from, so Update now can tell when the app is out of date.
COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
sed -e "s|__VERSION__|$VERSION|g" -e "s|__URL__|$URL|g" -e "s|__COMMIT__|$COMMIT|g" mac/Refrain/Info.plist > "$APP/Contents/Info.plist"
/usr/bin/plutil -lint -s "$APP/Contents/Info.plist"

# The Dock icon, drawn by mac/icon/make-icon.swift with the app's own Archivo,
# in the macOS icon shape, then scaled to every size the Dock and Finder use.
# Artwork must never cost a Mac its app: if drawing fails, use the web icon.
ICON_SRC="$OUT/icon-1024.png"
if ! { xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos12.0" mac/icon/make-icon.swift -o "$OUT/make-icon" \
       && "$OUT/make-icon" public/vendor/fonts/archivo-latin.woff2 "$ICON_SRC"; }; then
  echo "Couldn't draw the app icon on this Mac, so it uses the web icon instead."
  ICON_SRC="public/img/icon-1000.jpg"
fi
ICONSET="$OUT/Refrain.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -s format png -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Refrain.icns"
rm -rf "$ICONSET"

# Ad hoc signature: all Apple Silicon needs to run an app built on this Mac.
codesign --force --sign - "$APP"
codesign --verify "$APP"

DEST="$HOME/Applications/Refrain.app"
mkdir -p "$HOME/Applications"
# Replace only an app this script built. Anything else with that name stays.
if [ -e "$DEST" ]; then
  EXISTING_ID="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$EXISTING_ID" != "com.capitalchurchtech.refrain" ]; then
    echo "$DEST already exists and isn't Refrain.app (it's ${EXISTING_ID:-unknown})."
    echo "Nothing was replaced. Move it, then run this script again. The new build is in $APP."
    finish
    exit 1
  fi
fi
rm -rf "$DEST"
ditto "$APP" "$DEST"

echo
echo "Built: $DEST"
if pgrep -xq Refrain; then
  echo "Refrain.app is open with the old build. Quit it and open it again to use this one."
else
  echo "Open it from ~/Applications, or drag it to the Dock."
fi
finish
