# Installing and running Refrain

## What you need

- **A Mac running ProPresenter**, with ProPresenter's network API turned on
  (Preferences › Network). Refrain is tested against ProPresenter 21.3.
- **Node.js 20 or newer.**
- **Git** if you want one-press updates. A ZIP download works without it.

Refrain also runs on Windows with `scripts/start.bat`. Start at login,
Refrain.app, the Open and Show in Finder buttons, and noticing that ProPresenter
has quit are Mac only.

## Installing Node.js

Download the **LTS** build from [nodejs.org](https://nodejs.org) and run the
installer (`.pkg` on a Mac, `.msi` on Windows). If the Mac already uses
Homebrew, `brew install node` works too. Check it with `node -v` in Terminal.

### No administrator password?

The installers write to system folders and ask for an administrator password.
You don't need one: Node runs happily from your home folder. On a Mac, paste
this into Terminal. It picks Apple Silicon or Intel, downloads the current LTS,
checks it against Node's published checksum, and installs it to `~/.local/node`.

```bash
set -e
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
VER=$(curl -fsSL https://nodejs.org/dist/index.json | tr '}' '\n' \
      | grep -m1 '"lts":"[A-Za-z]' | sed -n 's/.*"version":"\(v[0-9][0-9.]*\)".*/\1/p')
TAR="node-$VER-darwin-$ARCH.tar.gz"
echo "Installing Node $VER ($ARCH)"
cd "$(mktemp -d)"
curl -fsSLO "https://nodejs.org/dist/$VER/$TAR"
curl -fsSL "https://nodejs.org/dist/$VER/SHASUMS256.txt" | grep " $TAR$" | shasum -a 256 -c -
tar -xzf "$TAR"
mkdir -p "$HOME/.local"
rm -rf "$HOME/.local/node"
mv "node-$VER-darwin-$ARCH" "$HOME/.local/node"
grep -qs 'HOME/.local/node/bin' "$HOME/.zshrc" || echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> "$HOME/.zshrc"
export PATH="$HOME/.local/node/bin:$PATH"
node -v && npm -v
```

If the download is damaged or has been tampered with, the checksum line stops
the script before anything is installed. Open a new Terminal window afterwards.
To remove it later, delete `~/.local/node` and the one line it added to
`~/.zshrc`.

You don't need to do anything else for the launchers. They look for Node in
`~/.local/node/bin`, `~/node/bin`, Volta, fnm, nvm and Homebrew as well as the
usual path, because a double-clicked script doesn't read `~/.zshrc`.

## Where to put Refrain

Refrain keeps its settings, search index and data inside its own folder, so give
it a folder of its own that the account running ProPresenter can write to:

- **One account at the booth:** `~/Refrain`.
- **Several accounts on one Mac:** `/Users/Shared/Refrain`, so there is one copy
  and one set of settings. Only one copy can run at a time.

Avoid the Desktop and Downloads, and avoid anything synced by iCloud Drive,
Dropbox, OneDrive or Google Drive. Refrain writes many small files and a sync
client fights over them. If iCloud's "Desktop and Documents" is on, that rules
out `~/Documents` too. Skip `/Applications`, which needs admin rights to write.

## Getting the code

With Git:

```bash
git clone https://github.com/capitalchurchtech/refrain.git ~/Refrain
```

Without Git: on the [GitHub page](https://github.com/capitalchurchtech/refrain),
choose Code › Download ZIP and unzip it into your folder.

To get Git on a Mac, run `xcode-select --install` and accept the Command Line
Tools prompt. On Windows, use the installer from
[git-scm.com](https://git-scm.com/download/win).

## First run

Double-click `scripts/start.command` (Mac) or `scripts/start.bat` (Windows).
From a terminal it is `npm install && npm start` in the Refrain folder. The
first run installs dependencies, which takes a minute. One of them,
`propresenter-bundle`, comes from GitHub rather than npm.

Refrain opens in your browser at `http://localhost:9999`. Set `PORT` in the
environment to use another port. The booth screens only answer on this computer;
nothing else on the network can reach them.

The setup screen asks three things:

1. **Where ProPresenter is.** **Detect ProPresenter** checks this machine and
   fills in the host and port. If ProPresenter runs on another computer, **Search
   the network anyway** looks across your network (it contacts every computer
   on it, so it waits to be asked), or you can type the host and port.
2. **Test connection.**
3. **Is this the machine that runs ProPresenter live during service?** Answer
   yes (**logger**) on the booth machine and no (**reader**) anywhere else. Only
   the logger records arrangement comparisons.

Press **Save and continue**. Refrain waits until ProPresenter has been answering
for three minutes, because reads fail while ProPresenter is still starting up,
then builds the search index. With ProPresenter on the same Mac that took about
a minute for a library of 763 presentations. See [the search index](indexing.md).

The Terminal window `start.command` runs in is Refrain itself. Closing it stops
Refrain, so minimise it instead, or set up Start at login below.

## Starting at login (Mac)

**Settings › More › Customize › Start at login › Turn on** installs a LaunchAgent that
starts Refrain in the background each time you log in, restarts it if it
crashes, and needs no Terminal window. **Turn off** removes it and changes
nothing else. `scripts/install-launchagent.command` and
`scripts/uninstall-launchagent.command` do the same from Finder.

- Output goes to `logs/refrain.out.log` and `logs/refrain.err.log` in the
  Refrain folder.
- If you had a Login Item for `start.command`, remove it. If two copies do
  start, the second sees the port is taken, says so and stands down.
- A LaunchAgent starts at login, not at boot. For a booth that recovers on its
  own after a power cut, also turn on automatic login for the booth account
  (System Settings › Users & Groups).

On Windows, put a shortcut to `scripts/start.bat` in the Startup folder (press
Win+R and type `shell:startup`).

## Giving Refrain its own window

Refrain is built to sit beside ProPresenter, about 455 pixels wide. A browser
tab wastes that space on tabs and an address bar.

**Chrome or Edge:** open Refrain and use the browser's install button in the
address bar (or Cast, save and share › Install page as app). You get a window
with no tabs, its own Dock icon and no minimum width. **Settings › More ›
Customize › Display** also has a copyable command that opens the same kind of window once:

```bash
open -na "Google Chrome" --args --app=http://localhost:9999 --window-size=420,1000
```

**Refrain.app (Mac):** a small native window onto the same screens. It can stay
on top of ProPresenter (Window › Keep on Top, ⌥⌘T), opens outside links in your
browser, saves downloads to Downloads, and turns the browser's confirm and file
dialogs into Mac sheets. It does not run Refrain itself, so keep Start at login
on. When Refrain isn't answering it says so, offers **Start Refrain** (which
needs Start at login), and comes back on its own once Refrain is up.

Build it by double-clicking `scripts/build-mac-app.command`. It needs Apple's
free Command Line Tools (`xcode-select --install`) and macOS 12 or later, and
it installs to `~/Applications/Refrain.app`. Run it again after each update.
**Build it on each Mac rather than copying it across**: an app built on the Mac
it runs on opens without warnings, and macOS blocks an unsigned app that arrives
by AirDrop or download.

## Updating

Your settings live in `config.json`, your secrets in `.env`, and your records in
`data/`. Git ignores them and no download contains them, so an update never
touches them.

**Git installs.** **Settings › System › Updates** shows the installed and latest
versions. **Update now** runs `git checkout -- package-lock.json`, `git pull
--ff-only` and `npm install`, and shows you the output. Double-clicking
`scripts/update.command` (or `update.bat`) does the same. The card also has a
copyable command for doing it by hand. Search shows a small nudge when an update
is out, never while performance mode is on.

**ZIP installs.** Download the new ZIP and unzip it into a new folder. Copy
`config.json`, `.env` and the `data` folder from the old folder (and `cache`, to
skip rebuilding the index), then start the new one. `data` holds your flags, day
records, arrangement history, phone sign-ins and the rest.

Either way, **restart Refrain afterwards**. A running Refrain does not reload
its own code or `.env`.

## Stopping and restarting

**Settings › System** has both, each needing a second press:

- **Stop Refrain**, then **Kill**, stops it at once. The page then shows the
  command that starts it again.
- **Restart Refrain**, then **Restart now**, stops and starts it. With Start at
  login on, it restarts through the LaunchAgent; otherwise it starts the same
  script again from its folder. The page reloads once Refrain is back.

Neither touches ProPresenter or the screens. The Return bar's history starts
over.

A Refrain that has stopped answering may not answer its own Stop button. From
Terminal, `launchctl kickstart -k gui/$(id -u)/com.refrain.server` restarts the
LaunchAgent copy, and Ctrl+C stops a copy running in a Terminal window.

## When ProPresenter won't connect

**Settings › System › ProPresenter connection › Diagnose** looks at this Mac and
explains what it finds: whether ProPresenter is running and answering, whether
Refrain is pointed at another machine, leftover ProPresenter helper processes,
recent ProPresenter crash reports, and whether the library folders on disk match
ProPresenter's own list of them. It only reads. Where it suggests a fix, it gives you the command to run
yourself.
