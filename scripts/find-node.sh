#!/bin/bash
# Finds Node, including installs that are not on the default PATH, and puts
# its directory on PATH. Sourced (not executed) by the double-click scripts.
#
# Why this is a shared file rather than a loop in each script: a double-clicked
# .command does not read ~/.zshrc or ~/.bash_profile, so `command -v node`
# alone only finds Node in the system PATH. That is fine for the .pkg
# installer, which needs an administrator password -- and not everyone has one.
# On a locked-down or borrowed machine the usual answer is a user-space Node in
# the home folder, which works perfectly in Terminal and then makes a launcher
# claim Node is not installed at all.
#
# start.command learned that list the hard way. The LaunchAgent installer had
# its own, shorter version and would have failed on exactly the machines the
# list exists for, so both now read from here. One list, two consumers.
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

# Last resort: ask a login shell, which picks up nvm/volta shell functions that
# never land in a plain directory.
if ! command -v node >/dev/null 2>&1; then
  _login_node="$(/bin/bash -lc 'command -v node' 2>/dev/null || true)"
  if [ -n "$_login_node" ]; then
    PATH="$(dirname "$_login_node"):$PATH"
    export PATH
  fi
  unset _login_node
fi
