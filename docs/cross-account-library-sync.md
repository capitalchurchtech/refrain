# Syncing one library between two macOS accounts

The situation this solves: ProPresenter runs under two macOS user accounts on
the same Mac, and you want the Songs library to appear in both, kept up to
date from one of them, without dragging every other library along with it.

Everything below was tested against a real ProPresenter 21.3 install before
being written down. The results are in the table further down, including the
approach that looks obvious and does not work. The scripts were run too, on a
throwaway copy of a real 184 song library: the snapshots hard link as claimed
(two full snapshots of a 4.8 MB library cost 4.8 MB, not 9.6 MB), the file
count guard refuses a near empty source without touching the good copy, and an
overwritten song really does land in the dated backup folder.

## The built-in way (easiest)

Refrain has an optional **Library Sync** screen that does all of this for you.
It is off by default and hidden from the sidebar entirely, so a single machine
church never sees it. Switch it on from that screen, then set:

- **Library**: which library to sync, e.g. `Songs`.
- **This machine**: *Sends* on the machine that owns the library, *Receives* on
  the other one.
- **Shared folder**: a path both sides can reach, e.g.
  `/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE`.
- **Refuse below this many files**: the safety floor described below.
- **Snapshots to keep**: how many restore points to hold.

It shows what a sync *would* do before you run one, takes a snapshot first,
never deletes anything, and keeps the previous version of any file it replaces.
It finds the library on disk by asking ProPresenter where its presentations
live, so there is no path to type and nothing to keep in step by hand.

What it deliberately does not do is schedule itself. Use the LaunchAgent below
for that, or just press the button when you have changed songs.

## Where a library actually lives

```
~/Library/Application Support/RenewedVision/ProPresenter/
    UserWorkspaces/ProPresenter/Libraries/Songs/
```

Each library is a plain folder of `.pro` files, one folder per library. That is
why a single library can be synced on its own: the unit of sync is a directory.
On the library this was tested against, Songs was 184 files and 4.8 MB, while
Messages alone was 59 MB, so syncing only Songs is also much cheaper.

## What was tested

| Test | Result |
|---|---|
| New library folder dropped into `Libraries/` | Picked up live, no ProPresenter restart |
| File copied into an **existing** library folder | Picked up live, fully readable |
| File deleted from a library folder | Removal shows up live |
| Library folder as a **symlink** to a shared folder | **Does not work.** The library name appears but it reports zero presentations |

Two things worth knowing from that: you never have to restart ProPresenter for
it to notice synced files, and you cannot take the shortcut of symlinking one
shared folder into both accounts. It has to be a real copy on each side.

## The shared handoff folder

Both accounts need somewhere they can both reach, because each account's
`~/Library` is `drwx------` and genuinely unreadable by the other user.
`/Users/Shared` already exists for this.

Name it so that nobody deletes it during a cleanup:

```
/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/
```

It is worth the ugly name. A folder in `/Users/Shared` called something like
`pp-songs` looks like leftover scratch space and will eventually get thrown
out by someone tidying up, which silently breaks the sync.

Then put a plain text file inside it, so anyone who opens the folder finds out
what it is before deciding its fate:

`/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/README-what-is-this.txt`

```
DO NOT DELETE THIS FOLDER OR ANYTHING IN IT.

This is the handoff point that copies the ProPresenter *Songs* library from
one macOS account on this Mac to the other. A scheduled job writes into it
from one account and another scheduled job reads out of it into the second
account's ProPresenter library.

It also holds dated snapshots of the song library, which are the safety net if
a song is ever lost or damaged.

Delete it and the second account stops receiving song updates, and the
snapshots go with it. Nothing will warn you; the songs will just quietly stop
arriving.

Owner / who to ask: <your name and contact>
Set up: <date>
```

So the shared folder ends up looking like this:

```
/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/
    README-what-is-this.txt      the note above
    send-songs.sh                the sending account's job
    receive-songs.sh             the receiving account's job
    songs/                       the handoff copy of the library
    snapshots/                   dated snapshots, cheap and restorable
        2026-08-23_0900/
        latest -> 2026-08-23_0900
```

## Back it up before you sync anything

A song library is years of accumulated work, and a sync job is a program that
writes into it on a schedule. Set the backup up first, then the sync.

Snapshots are almost free here because `.pro` files are tiny (the whole tested
Songs library was 4.8 MB). `--link-dest` hard links anything that has not
changed, so a month of daily snapshots costs little more than one copy:

```bash
#!/bin/bash
set -euo pipefail
SRC="$HOME/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter/Libraries/Songs/"
SNAPS="/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/snapshots"
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$SNAPS"
rsync -a --link-dest="$SNAPS/latest" "$SRC" "$SNAPS/$STAMP/"
ln -snf "$SNAPS/$STAMP" "$SNAPS/latest"
```

Each snapshot is a complete, ordinary folder of `.pro` files. Recovering one
song is a drag and drop out of a dated folder, with no tool required.

**These snapshots are not a real backup.** They live on the same disk, so they
protect you from a bad sync, a mistaken delete, or a song someone mangled last
Tuesday. They do not protect you from that disk dying. Keep Time Machine or an
off machine copy running for that, and confirm the ProPresenter library folder
is actually included in it.

## The sync itself

Deliberately **without** `--delete`. A mirror is the dangerous choice here: if
the source is ever empty, renamed, or half written when the job fires, the
mirror faithfully erases the other account's copy too. Copy only, never delete:

```bash
#!/bin/bash
set -euo pipefail
SRC="$HOME/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter/Libraries/Songs/"
OUT="/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/songs/"

# Refuse to run if the source does not look like a real library. Cheap
# insurance against syncing out an empty or half migrated folder.
count="$(find "$SRC" -maxdepth 1 -name '*.pro' | wc -l | tr -d ' ')"
if [ "$count" -lt 50 ]; then
  echo "Refusing to sync: only $count .pro files found in the source" >&2
  exit 1
fi

mkdir -p "$OUT"
rsync -a "$SRC" "$OUT"
```

Receiving account, same shape, and note the extra safety of keeping any file
it is about to overwrite:

```bash
#!/bin/bash
set -euo pipefail
IN="/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/songs/"
DEST="$HOME/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter/Libraries/Songs/"
OVERWRITTEN="$HOME/ProPresenter-Songs-Overwritten"

count="$(find "$IN" -maxdepth 1 -name '*.pro' | wc -l | tr -d ' ')"
if [ "$count" -lt 50 ]; then
  echo "Refusing to receive: only $count .pro files in the handoff folder" >&2
  exit 1
fi

mkdir -p "$DEST" "$OVERWRITTEN/$(date +%Y-%m-%d)"
rsync -a --backup --backup-dir="$OVERWRITTEN/$(date +%Y-%m-%d)" "$IN" "$DEST"
```

`--backup --backup-dir` means an incoming song never destroys the version it
replaced: the old copy lands in a dated folder in the receiving account's home.
If a sync ever brings across something wrong, the previous version is right
there.

Set both file-count floors to something comfortably below your real song count
and comfortably above zero. The number matters less than having one.

What you give up by dropping `--delete`: songs deleted or renamed on the
sending side stay behind on the receiving side, so the receiving library slowly
accumulates strays. That is the right trade. Prune it by hand once or twice a
year, with a snapshot taken first, rather than letting a scheduled job hold the
power to delete anything.

Each job runs as its own user, so nothing needs root and neither account ever
reads the other's home folder. Give the shared folder to the sending account
with `755` so the receiving account can read but not write back, which is what
makes it one directional.

Schedule each side as a LaunchAgent in that account's
`~/Library/LaunchAgents/`, for example every 15 minutes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>church.propresenter.songs-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE/send-songs.sh</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardErrorPath</key><string>/tmp/songs-sync.err</string>
</dict>
</plist>
```

A LaunchAgent only runs while that account is logged in, which is normally
fine with fast user switching. Check `/tmp/songs-sync.err` occasionally: that
is where a refused run will tell you it refused, and a sync that has been
quietly failing for a month is its own kind of data loss.

## Things that will bite you

- **Never sync `LibraryData`.** It sits next to the library folders and is a
  single binary index covering *every* library, storing absolute `file://`
  paths with the username in them. Copying it to the other account points it
  at a home folder that does not exist and drags in references to libraries
  you deliberately left behind. Sync only the `Songs/` folder.
- **Songs with their own background media.** Most song files are
  self contained (183 of 184 in the tested library), but one referenced a
  video under `.../Media/Assets/` by absolute path. Songs like that need their
  media synced too, or the background will be missing on the other account.
- **Prefer syncing while the receiving ProPresenter is closed.** It picks
  changes up live, so this is not required, but writing into a library that a
  running ProPresenter is actively using is a good way to have one side
  overwrite the other.
- **Refrain's search index is a cache.** ProPresenter sees synced songs
  immediately, but they will not be findable in Refrain's search until its
  index is rebuilt. See the rebuild warnings in the README before starting one
  near a service.
