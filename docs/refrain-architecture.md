# Refrain — Final Architecture & Build Handoff

This document supersedes the earlier incremental requirements doc. It's
written to be handed to a fresh chat/build session with no prior context.
Where earlier discussion left something open, a decision has been made
here — flagged explicitly where it's a judgment call vs. where it's a
genuine unresolved unknown that needs verification during build.

Written with open-source distribution in mind (Section 17): the core
feature works standalone with zero external dependencies beyond
ProPresenter, and anything church-management or shared-storage related
is an optional, swappable module — not a hard requirement baked into
the core.

**Revision note:** this version incorporates an external architecture
review's findings — multi-logger write-conflict detection (8.5), a
time-gate on automatic background reindexing to avoid adding
ProPresenter API load during a mid-service crash-reboot (5.3), and
promoting API-capability verification to Step 0 of the build order
rather than a deferred open item (15). One suggestion from that
review — replacing SFTP with an HTTPS/Basic-Auth web server — was
considered and declined at the time (see 9.6's history for why).

**Second revision:** secrets moved out of `config.json` into `.env`
(Section 4). More significantly, **Firestore replaces SFTP as the
default shared-storage backend** (Section 9) — it solves the reader-
credential-distribution problem more completely than per-machine SSH
keys did, since Firestore's security-rule model means reader machines
need no credential at all. SFTP remains available as a self-hosted
alternate for churches that specifically want it. The privacy tradeoff
this introduces (arrangement data now optionally leaves the local
network to Google's infrastructure) is stated plainly in 9.2 rather
than glossed over.

---

## 0. What This Is, In One Paragraph

Refrain is a small self-hosted web app that runs alongside ProPresenter.
It does three things: (1) full-text search across every slide in the
whole ProPresenter library/playlists — not just item names — with
one-click "go live" on any result; (2) a lyrics search-assist tool for
songs CCLI doesn't have, using scoped web search plus a paste-to-slides
importer; (3) an *optional* weekly comparison between what your
church-management system planned for a song's arrangement and what
actually got run, to reduce recurring manual edits — this church uses
Planning Center and a shared VPS as the reference setup, but both are
swappable (Section 17). Every coworker clones the repo and runs it
locally; one
designated machine also handles the Planning Center comparison and
writes results to shared server space everyone else can read.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Each coworker's machine                                    │
│                                                               │
│   [Browser: localhost:PORT] <--HTTP--> [Node/Express server] │
│                                              |                │
│                                     [Local search cache:      │
│                                      JSON, in-memory]         │
│                                              |                │
│                                     [ProPresenter local API]  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ONE designated "logger" machine (whichever runs live        │
│  service each week) — same app, extra role enabled           │
│                                                               │
│   [Weekly job] --> [Planning Center API]                     │
│                --> [own local search cache, already built]   │
│                --> [diff] --> [SFTP write] --> shared folder  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Hostinger VPS — shared server space                        │
│  /srv/refrain-sftp/data/*.json  (one file per song)          │
│  Reachable only via SFTP, chrooted, key-only auth            │
└─────────────────────────────────────────────────────────────┘
       ^ read-only pull, on-demand or on-refresh, by every
         other coworker's local app instance
```

Two genuinely separate data concerns, kept separate on purpose:

- **Search index** — per-machine, local, disposable, rebuildable anytime
  from ProPresenter directly. No coordination needed across machines.
- **Arrangement history** — the opposite: must persist and accumulate
  across weeks, and needs to be visible to everyone. Lives on shared
  storage, single writer, everyone else reads.

Don't try to unify these into one storage layer — they have opposite
requirements (ephemeral+local vs. persistent+shared).

---

## 2. Finalized Tech Stack (with reasoning, including two changes from earlier discussion)

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | One language end-to-end with the browser UI; `npm install && npm start` is a lower-friction ask for non-developers than Python venv setup. |
| Search cache storage | **Plain JSON file, loaded into memory at startup** (changed from earlier "SQLite" suggestion) | See 2.1 below — this is a deliberate rethink. |
| Arrangement storage | Plain JSON, one file per song, on shared SFTP folder | Already settled — no DB, no GitHub-as-datastore, no R2. No change. |
| Frontend styling | Tailwind CSS + DaisyUI | Component classes on top of utility CSS, fast to build a clean UI without hand-rolling every component. |
| Icons | Lucide | ~1,500+ icons, tree-shakable, standard pairing with Tailwind. |
| Theming | Dark / Light / System via DaisyUI's theme system | Near-free given DaisyUI already supports theme switching. |

### 2.1 Rethink: search cache should be JSON, not SQLite

Earlier discussion suggested SQLite for the search index. Reconsidering
now with the full picture in view: SQLite in Node typically means
`better-sqlite3`, which is a **native compiled dependency** — it needs
build tools present (Xcode command-line tools on Mac, Visual Studio
Build Tools on Windows) or a matching prebuilt binary for the exact
Node/OS/architecture combination. This is one of the single most common
"`npm install` failed on someone's machine" causes for non-developers,
and it directly undermines the "coworkers clone and run it in minutes"
goal that's been a constant theme.

At this data scale (a church's ProPresenter library — realistically
dozens to a few hundred presentations, low thousands of slides), a
single JSON file loaded fully into memory and searched with plain
string operations is completely adequate performance-wise, and removes
an entire category of setup failure. Use JSON for the search cache.
(The arrangement data was already going to be JSON — this just makes
the whole app consistent: no database anywhere in the stack.)

### 2.2 No Electron

Earlier discussion raised whether "dock to the side of the window"
meant OS-level window snapping. **Decision: no** — that would require
Electron (or similar), which reintroduces per-OS packaging/build
complexity that directly conflicts with the plain-clone-and-run goal.
Refrain is a plain browser-based app with a responsive layout (Section
5). If true OS-level docking is later found to be a hard requirement,
that's a distinct, larger redesign — not a tweak.

---

## 3. Repo Structure

```
refrain/
├── README.md                    # quickstart: clone, install, run
├── .gitignore                   # config.json, .env, cache files, keys, node_modules
├── config.example.json          # documents config shape, no real values
├── .env.example                 # documents required secrets, no real values
├── package.json
├── LICENSE                      # MIT
├── CONTRIBUTING.md              # incl. "add a new X" recipes, see 17.11
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── server/
│   ├── index.js                 # Express app entrypoint
│   ├── propresenter-client.js   # talks to ProPresenter local API (core, fixed)
│   ├── search-index.js          # builds/holds the in-memory JSON cache (core, fixed)
│   ├── arrangement-diff.js      # diff logic, ChMS/storage-agnostic
│   ├── config.js                # loads/validates config.json + .env
│   └── plugin-loader.js         # auto-discovers providers/storage/splitters/modules
├── providers/                    # pluggable — see 17.2
│   ├── base.js
│   ├── planning-center.js
│   └── manual.js
├── storage/                      # pluggable — see 17.3, 9
│   ├── base.js
│   ├── firestore.js               # default — see Section 9
│   ├── local-folder.js
│   ├── synced-folder.js           # Google Drive / Dropbox / OneDrive
│   └── sftp.js                    # alternate — see 9.6
├── slide-splitters/               # pluggable — see 17.11
│   ├── base.js
│   ├── blank-line-delimited.js
│   └── section-label-aware.js
├── modules/                       # pluggable feature/nav modules — see 17.11
│   ├── search/
│   ├── lyrics-assist/
│   └── arrangement/
├── public/  (or client/ if bundling)
│   ├── index.html
│   ├── app.jsx / app.js         # nav renders from registered modules, not hardcoded
│   └── styles.css               # Tailwind entry
├── scripts/
│   ├── start.bat                # Windows double-click launcher
│   └── start.command            # macOS double-click launcher
└── docs/
    └── refrain-architecture.md  # this document
```

---

## 4. Configuration — Split Between `config.json` and `.env`

**Revised from earlier discussion.** Secrets and non-secret preferences
now live in separate files, both gitignored:

- **`config.json`** — non-secret preferences and *which* provider/backend
  is selected. Safe to paste into a GitHub issue for debugging without
  leaking anything.
- **`.env`** — actual credentials (SSH keys, Firebase service account,
  Planning Center token). The conventional place for secrets in a
  Node app, and keeping them out of `config.json` means a config file
  pasted for debugging can't accidentally leak a credential alongside
  it.

```json
// config.json — no secrets
{
  "propresenter": {
    "host": "localhost",
    "port": 1025
  },
  "role": "reader",
  "theme": "system",
  "navPinned": false,
  "lyricsSites": ["genius.com", "azlyrics.com"],
  "slideSplitter": "blank-line-delimited",
  "arrangementModule": {
    "enabled": false,
    "provider": "manual",
    "storageBackend": "firestore"
  }
}
```

```bash
# .env — secrets only, never committed
PROPRESENTER_API_KEY=              # if your version requires one

# Only populated on the logger machine — see Section 8.2
PLANNING_CENTER_APP_ID=
PLANNING_CENTER_SECRET=

# Firestore (Section 9 — new default storage backend)
# Logger machine only. Reader machines need none of this — see 9.1.
FIRESTORE_PROJECT_ID=
FIRESTORE_SERVICE_ACCOUNT_KEY_PATH=./keys/firestore-service-account.json

# SFTP (optional alternate backend, Section 9.6 — only if a church
# specifically has and prefers their own server infra)
SFTP_HOST=
SFTP_USERNAME=
SFTP_PRIVATE_KEY_PATH=
SFTP_KNOWN_HOST_FINGERPRINT=
```

- **`role`**: `"logger"` or `"reader"`. Exactly one machine should be
  `"logger"`. Set during the first-run screen (Section 6). This is a
  *different* concern from the SFTP-vs-Firestore choice below — role
  determines who writes, storage backend determines where.
- Planning Center credentials only ever need to exist on the logger
  machine — reader machines never call the PCO API directly.
- **What `.env` does and doesn't protect against, to be precise:**
  keeping secrets out of git (via `.gitignore`, true for both `.env` and
  `config.json`) is what prevents another deployment from ever obtaining
  your credentials. The `.env` split itself is about reducing *accidental
  leakage* (e.g. pasting a config file for support without also pasting
  a key) — it's good practice, but it's solving a different problem than
  "could another church end up pointed at my server," which was already
  fully handled by gitignoring secrets in the first place.

### 4.1 Missing Credentials → Graceful Degradation, Never a Crash

**Decision:** if `arrangementModule.enabled` is `true` in `config.json`
but the required `.env` credentials for the selected provider/backend
aren't present, the module simply doesn't activate — it does not block
startup, and it never takes down the core search/lyrics-assist features,
which must keep working regardless of anything arrangement-related
(consistent with 17.1's "zero required dependencies" principle).

This is checked on **every startup**, not only during the first-run
wizard — a user might clone the repo, run search-only for months, then
later drop Firestore credentials into `.env` directly without ever
re-running setup. The module should pick that up on the next restart
with no reconfiguration needed.

**Three states, not two** — worth distinguishing on the health screen
(Section 7) so "never turned on" and "turned on but broken" don't look
identical to whoever's troubleshooting:

| State | Meaning | Nav entry |
|---|---|---|
| `off` | `enabled: false` — never asked for it | Hidden entirely |
| `misconfigured` | `enabled: true`, but required `.env` vars for the selected backend/provider are missing or invalid | **Shown**, but the screen explains what's missing rather than functioning |
| `active` | `enabled: true` and all required credentials validate | Fully functional |

Applies uniformly to both credential types this module can need —
Firestore backend credentials (`FIRESTORE_PROJECT_ID`, and
`FIRESTORE_SERVICE_ACCOUNT_KEY_PATH` if `role: logger`) and Planning
Center provider credentials (`PLANNING_CENTER_APP_ID`/`SECRET`, logger
only). Missing provider credentials specifically (PCO) doesn't need to
take down the whole module either — falling back to the `manual`
provider while Firestore storage stays active is a reasonable partial
state, not an all-or-nothing gate.

---

## 5. Core Feature: Slide Search

### 5.1 Behavior

- Search scope: **deep search by default** (whole library + all
  playlists), since that matches the dominant real use case (mystery
  song, need answer fast). A filter/checkbox restricts to the current
  playlist only.
- Case-insensitive substring match; normalize slide text (strip line
  breaks, collapse whitespace) before comparing, since slide text
  commonly spans multiple text boxes.
- Each result shows: presentation name, matching slide text/snippet,
  slide index, and which playlist(s) it's in (a presentation can be in
  multiple playlists, or library-only).
- **"Go Live" button** on every result — same action regardless of
  whether the source is a playlist item or library-only, since
  triggering a slide only needs presentation ID + slide index.
- **Date filter**: filter by created/last-modified date range (e.g.
  "October 2025"), for "we taught on this in October" lookups. **Unverified
  — check during build:** whether ProPresenter's API on your version
  exposes a true *created* date, or only *last modified*. These diverge
  for sermon content (edited after the fact). If only last-modified is
  available, label it honestly in the UI rather than implying it's the
  original date, and consider falling back to dated playlist names as a
  proxy if your team's playlists follow a "YYYY-MM-DD Service" naming
  convention.

### 5.2 Search Index (Cache)

- In-memory JSON structure, built by crawling: (a) the Library listing,
  (b) all playlists/folders recursively. Dedupe by presentation UUID
  (a presentation can appear in multiple playlists).
- Shape:
```json
{
  "builtAt": "2026-07-07T14:00:00Z",
  "presentations": {
    "<uuid>": {
      "name": "Way Maker",
      "slides": [{ "index": 0, "text": "Way maker, miracle worker..." }],
      "appearsIn": ["playlist-uuid-1", "playlist-uuid-2"],
      "createdDate": "2025-10-04T00:00:00Z",
      "modifiedDate": "2026-07-01T00:00:00Z"
    }
  }
}
```
- Persist this to a single local file (e.g. `cache/search-index.json`)
  so restart doesn't always require a full rebuild — but see 5.3 for how
  rebuilds/staleness are handled.
- **Write safety:** always write to a temp file and atomically rename
  over the previous cache file, rather than writing in place. Prevents
  a corrupted half-written cache if the app is killed mid-write. On
  load, if the file fails to parse, treat it as "no cache" and trigger a
  fresh rebuild rather than crashing.
- **Concurrent search during rebuild:** rebuild happens against a
  *new* in-memory object; searches continue to run against the *old*
  object until the new one is fully built, then the reference is swapped
  atomically. Never search a partially-built index.

### 5.3 Boot-Time Reindex — Decision on the Skip Default, Plus a Time-Gate

Earlier this was left open. **Decision: default to skip.** Reasoning:
the triggering scenario (Randy needs the tool open *now*, mid-concert)
is a worse failure mode than searching a slightly stale cache — a stale
cache just risks missing something added that morning, which is rare and
low-cost; blocking the tool during an actual live emergency is the
opposite of the point of building this.

- On boot, if a cache already exists on disk: load it immediately and
  make the app usable right away.
- **Time-gate the automatic background rebuild — addition, closes a
  real gap.** Not blocking the UI isn't enough on its own: an
  *automatic* rebuild still means firing a crawl of every presentation
  against ProPresenter's API in the background, which adds real load at
  exactly the worst possible moment — the scenario that actually matters
  here is a mid-service crash-reboot, where the app relaunches and
  should not immediately start hammering ProPresenter's API while it's
  already under live-performance stress. Gate the automatic rebuild on
  cache age: **only auto-trigger a background rebuild if the existing
  cache is older than ~24 hours.** A crash-reboot happening on the same
  day as the last successful build (the realistic case, since most
  churches build/verify the cache at least once on or before service
  day) won't trigger an automatic crawl at all — only a manual "Rebuild
  Now" click will, which puts a human in the loop for exactly the
  moment when automatic background load would be least welcome. If the
  cache genuinely is stale (multiple days old), auto-rebuild proceeds
  as before, still without blocking the UI.
- Rebuild remains visibly skippable/cancelable at any time regardless of
  whether it was auto-triggered or manually started.
- On a **true first run** (no cache file exists at all yet): there's
  nothing to fall back to, so this case must complete an initial build
  before search is usable — this only happens once, during the wizard
  (Section 6), and the time-gate doesn't apply since there's no existing
  cache age to check.
- A persistent small indicator (e.g. in the nav rail) always shows "Index
  last built: [time]" with a one-click "Rebuild Now" — so staleness is
  visible but never blocking, and manual rebuild is always available
  even when the automatic gate holds it back.

This is simpler than the original "countdown + skip button" design and
achieves the same outcome (never block on rebuild) with less UI state to
build and reason about, and the added time-gate specifically protects
against the crash-mid-service scenario without needing the app to know
anything about "service hours" or a schedule.

---

## 6. First-Run Setup — Simplified from "Wizard" to a Single Screen

Earlier discussion called this a multi-step wizard. Reconsidering: there
are only a handful of settings (ProPresenter host/port, role, theme),
which doesn't justify a multi-screen modal flow with its own state
machine. **Simplify to one screen:**

- Shown automatically when `config.json` doesn't exist or is incomplete.
- Fields: ProPresenter host (default `localhost`) + port, with an inline
  "Test Connection" button giving immediate pass/fail feedback (and
  concrete likely-cause guidance on fail: API not enabled in
  Preferences > Network, wrong port, ProPresenter not running,
  firewall).
- Role selector: "Is this the machine that runs ProPresenter live during
  service?" Yes → `role: "logger"` (also prompts for PCO PAT + SFTP
  writer key path). No → `role: "reader"` (prompts for SFTP reader key
  path only).
- On save: writes `config.json`, triggers the one-time full index build
  (progress shown inline — "Indexed 42 of 130..."), then drops straight
  into the app.
- Re-accessible later from the health screen as "Reconfigure," for when
  a port changes or the app moves machines.

---

## 7. Status / Health Screen

One screen, not buried in settings:

- ProPresenter connection status (connected/disconnected, host:port,
  last check-in), with the same actionable guidance as the setup screen
  on failure.
- Search index status: last build time, presentation/slide counts,
  "Rebuild Now" button.
- **Arrangement module status — shows one of the three states from
  4.1** (`off` hides the rest of this section entirely; `misconfigured`
  shows specifically which `.env` variable is missing or invalid, e.g.
  "Firestore: `FIRESTORE_SERVICE_ACCOUNT_KEY_PATH` not set" rather than
  a generic error; `active` shows the details below).
- **If active and role = logger:** storage backend write status (last
  successful write, any pending/queued writes — see Section 8.4),
  provider status (e.g. Planning Center auth valid/invalid, or "using
  manual entry" if no provider configured), "Run Comparison Now" button.
- **If active and role = reader:** storage backend read status (last
  successful pull, "Pull Latest Now" button).
- Version/build info footer.

---

## 8. Extended Feature: Planning Center Arrangement Comparison

### 8.1 Core Insight (unchanged from prior discussion)

The team's pain point is *editing* PCO's planned arrangement to match
what actually gets run — and that editing happens *before* the service.
So the final, edited, ready-to-run ProPresenter presentation already
**is** "actual." No live event capture during the concert is needed.
This is what keeps the whole feature simple.

**Known accepted gap:** in-the-moment live improvisation (leader ad-libs
an extra chorus during the actual performance) isn't captured by this
design — only pre-service editing drift is. That's intentional, since
it's the problem that was actually described.

### 8.2 The Weekly Job (logger machine only)

1. Pull the current week's Plan from Planning Center Services API
   (Personal Access Token auth) — songs + planned arrangement (section
   order).
2. Pull the matching presentation's slide/group structure from the
   **already-built search index** (Section 5.2) — no new ProPresenter
   API capability needed, this data already exists.
3. Map ProPresenter slide groups to PCO arrangement sections (Section
   8.3).
4. Diff planned vs. actual sequence.
5. Read the song's existing JSON file (if any) from local staging
   (Section 8.4), append a new history entry, write back.
6. Push the updated file to shared SFTP storage.

Trigger: a "Run Comparison Now" button (Section 7) for manual runs,
plus an optional scheduled weekly run. Not a live listener — a periodic
batch job, matching the actual cadence of the problem.

### 8.3 Mapping Layer (still the genuinely hard part — unchanged)

PCO section names and ProPresenter slide group labels have no guaranteed
correspondence. Needs a one-time (then ongoing, per new song) manual
mapping step, with fuzzy-match suggestions as a starting point ("Chorus"
~ "Chorus 1"), expected to need human correction especially early on.
Store the mapping inside each song's own JSON file (Section 8.5) so it's
editable by hand with a text editor if needed — no app or tooling
required to fix a bad match.

**Explicitly surface gaps, don't hide them:** if no mapping exists yet
for a song, the recap should show it as "unmapped," not silently skip
it — otherwise coverage gaps go unnoticed.

### 8.4 Local Staging Before Remote Write (new — hardening addition)

If the SFTP write happens directly against the remote file with no
local buffer, a network hiccup during the one weekly write risks losing
that week's data. Add a small local staging step:

1. Compute the week's diff and write it to a local staging file first
   (e.g. `staging/pending/<song-id>.json`).
2. Attempt the SFTP write. On success, remove the staged file.
3. On failure, retry a few times with backoff; if still failing, leave
   it in `staging/pending/` and surface it clearly on the health screen
   ("3 pending uploads — SFTP unreachable since [time]") rather than
   silently dropping it. Retry automatically on next app start or next
   scheduled run.

### 8.5 Storage — One JSON File Per Song, with Multi-Logger Collision Protection

**Addition — a gap in the earlier design.** The earlier version relied
on a manual team convention ("only Randy's booth machine is ever the
logger") with no technical enforcement. That's a real risk: if two
machines both think they're the logger in the same week, one silently
overwrites the other's data with no warning. Add a machine ID and a
per-service-date conflict check — still just two extra fields and one
`if` statement, no new infrastructure:

```json
{
  "songId": "...",
  "songName": "Way Maker",
  "propresenterPresentationId": "...",
  "sectionMapping": {
    "PP: Verse 1": "PCO: Verse 1",
    "PP: Chorus": "PCO: Chorus 1"
  },
  "history": [
    {
      "serviceDate": "2026-06-28",
      "planned": ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"],
      "actual":  ["Verse 1", "Chorus", "Verse 2", "Chorus", "Chorus"],
      "diff": { "skipped": ["Bridge"], "added": [], "reordered": [] },
      "loggedByMachineId": "booth-mac-mini-01"
    }
  ]
}
```

- Each logger instance generates and persists its own `machineId` (a
  UUID, created once, stored in `config.json`, not user-facing) on first
  run in logger role.
- **Conflict check, on write:** before writing a history entry for a
  given `serviceDate`, check whether an entry for that *exact* date
  already exists with a *different* `loggedByMachineId`. If so, don't
  silently overwrite — surface a clear prompt/warning ("Machine
  `booth-mac-mini-01` already logged 2026-06-28 — overwrite with this
  machine's data?") and require explicit confirmation.
- **Deliberately keyed on exact service date, not a rolling day-count
  window.** A rolling "last N days" check would false-positive for any
  church running more than one weekly service (e.g. Wednesday + Sunday)
  — checking the specific date being written avoids that entirely.
- One file per song, on the shared SFTP folder. No database.
- **Recap** is computed on demand by reading all per-song files when the
  Analysis screen loads — trivial at this scale. Cache as a single
  `recap.json` only if this is later found to be slow (unlikely at
  church-library scale); not needed at build time.
- **Reader machines mirror the search-index caching pattern:** rather
  than hitting SFTP live on every screen load, pull the current set of
  song files into a local read cache on refresh/startup (same UX pattern
  as Section 5.3's index rebuild — one consistent mental model reused
  across the app instead of two different subsystems).

---

## 9. Shared Storage: Firestore (new default) — SFTP Kept as an Alternate

**Revised — Firestore is now the recommended default** for the
arrangement module's shared storage, replacing SFTP-to-a-VPS as the
primary implementation. Both remain available behind the same
`StorageBackend` interface (Section 17.3) — this is a clean backend
swap, not an architecture change, which is exactly what that interface
was built for.

### 9.1 Why Firestore Over SFTP as the Default

- **Eliminates the reader-key-distribution problem entirely**, rather
  than just mitigating it. With SFTP, even per-machine keys still mean
  generating, distributing, and eventually revoking a credential per
  reader. With Firestore, reader machines need **no credential at
  all** — Firebase's client-side config values (`apiKey`, `projectId`,
  etc.) are explicitly not meant to be secret; access control is
  enforced server-side by **security rules**, not by hiding
  configuration. A rule like "public read on the `songs` collection,
  write only via the Admin SDK" means every coworker's reader instance
  just reads — nothing to generate, copy to a machine, or later delete.
- **No VPS, no SSH, no chroot jail, no `sshd_config` editing** — removes
  the entire operational surface of Section 9 as it existed before.
  Meaningful both for this church (less to maintain) and for the
  open-source goal (Section 17) — "create a free Firebase project" is a
  lower bar for a volunteer than "acquire and harden a Linux server."
- **Free at this scale.** Firestore's free tier comfortably covers a
  single church's usage (a few dozen songs, written to roughly weekly,
  read occasionally by a handful of coworkers). Each church that adopts
  this gets their *own* free-tier project — no shared quota, no risk of
  one church's usage affecting another's.
- **The data model barely changes.** A Firestore collection where each
  document *is* the per-song JSON blob (Section 8.5's schema, unchanged)
  is nearly a 1:1 mapping of what already existed — this isn't
  reintroducing "a database" in the sense that was deliberately avoided
  earlier (a relational/query-heavy system); it's the same
  one-blob-per-song model, just persisted via the Firestore SDK instead
  of file I/O.
- **No credentials configured → module just doesn't activate.** Per
  Section 4.1, if `FIRESTORE_PROJECT_ID` (and, for the logger,
  `FIRESTORE_SERVICE_ACCOUNT_KEY_PATH`) aren't set in `.env`, the
  arrangement module shows as `misconfigured` on the health screen and
  never engages — it does not block ProPresenter search or lyrics-assist,
  which have zero dependency on any of this. A church can clone the repo
  and use Refrain fully for months with no Firestore project at all, and
  add it later just by dropping credentials into `.env`.

### 9.2 The One Real Tradeoff — Stated Plainly, Not Glossed Over

Choosing Firestore means arrangement data leaves your local network and
is stored on Google's infrastructure. The privacy principle stated
earlier (Section 17.7 — "Refrain sends data only to services you
explicitly configure, no phone-home") still holds in spirit, but it's
worth being explicit: **Firestore is itself one of the services you're
now explicitly configuring**, and for churches with stronger data-
sovereignty preferences, that may matter even though the actual data
(song section names and sequences) isn't sensitive. This is exactly why
`local-folder.js`, `synced-folder.js` (Section 17.3), and `sftp.js`
(9.6) remain available as fully self-hosted, nothing-leaves-the-network
alternatives — the setup screen should present this tradeoff plainly
when a church is choosing a storage backend, not bury it.

### 9.3 Firebase/Firestore Setup

1. Create a free Firebase project at the Firebase console (one-time,
   per church).
2. Enable Firestore (Native mode).
3. **Logger machine:** generate a service account key (Project Settings
   → Service Accounts → Generate New Private Key), save the resulting
   JSON file locally, reference its path via
   `FIRESTORE_SERVICE_ACCOUNT_KEY_PATH` in `.env` (Section 4). This key
   grants full read/write via the Admin SDK — treat it with the same
   care as the SFTP writer key was treated: never committed, tightly
   permissioned on disk, exists only on the logger machine.
4. **Reader machines:** need only the project's public client config
   (`FIRESTORE_PROJECT_ID` and the standard Firebase client config
   values) — no service account, no key file. These aren't secret and
   can live in `config.json` rather than `.env` if preferred, though
   keeping them in `.env` alongside everything else infra-related is
   also fine and arguably simpler to reason about as "one file for
   anything environment-specific."
5. **Security rules** (Firestore console → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /songs/{songId} {
      allow read: if true;
      allow write: if false; // writes only via Admin SDK, which bypasses rules
    }
  }
}
```

This is the whole access-control story — no key rotation, no
`authorized_keys` file to maintain, no chroot jail.

### 9.4 Storage Backend Interface Implementation

```js
// storage/firestore.js
class FirestoreStorage extends StorageBackend {
  async readSongFile(songId) { /* Firestore SDK get() */ }
  async writeSongFile(songId, data) { /* Admin SDK set(), logger only */ }
  async listSongFiles() { /* Firestore SDK collection listing */ }
}
```

Same interface as `local-folder.js` and `sftp.js` — the rest of the app
(diff logic, recap generation, the reader-side local cache pattern from
Section 8.5) doesn't need to know or care which backend is active.

### 9.5 Multi-Logger Collision Protection Still Applies, Unchanged

The machine-ID conflict check from Section 8.5 is backend-agnostic — it
protects against *this church's own* two machines both writing as
logger in the same week, which has nothing to do with which storage
backend is in use. Keep it exactly as designed regardless of Firestore
vs. SFTP.

### 9.6 SFTP — Kept as a Documented Alternate, Not Deleted

For a church that specifically has existing server infrastructure and
prefers to keep data fully self-hosted, SFTP remains a supported
`StorageBackend` implementation. The full hardening setup — chrooted
`refrain-writer`/`refrain-reader` accounts, per-machine reader keys
(revised in the prior round specifically to fix the shared-key
revocation problem), host key pinning — is unchanged from before and
still valid for that use case. It's just no longer the first thing a
new church setting this up is pointed toward; Firestore is.

**In short:** default to Firestore for "I want shared storage and don't
want to run a server." Choose SFTP for "I have server infrastructure
already and want to keep everything fully self-hosted." Both are one
config value away from each other given the shared interface.

## 10. Auto-Launch at Boot ("just always open and run it")

This wasn't explicitly speced before but is implied by "always open and
run" — worth being concrete:

- **Windows:** either a Task Scheduler entry (trigger: at log-on, action:
  run `scripts/start.bat`) or a shortcut to `start.bat` placed in the
  Startup folder (`shell:startup`). `start.bat` should `cd` into the repo
  and run `npm start`, then open the default browser to
  `http://localhost:<port>`.
- **macOS:** a Login Item pointing to `scripts/start.command` (same
  logic — `cd` + `npm start` + open browser).
- Both launcher scripts double as the "no terminal knowledge needed"
  double-click entry point for anyone setting this up, not just for
  boot-time auto-launch.

---

## 11. Distribution / GitHub

- `README.md`: clone → `npm install` → `npm start` (or double-click the
  launcher script) → first-run screen takes over.
- `.gitignore`: `config.json`, `cache/`, `staging/`, `keys/`,
  `node_modules/`.
- `config.example.json`: documents the shape without real values or
  keys.
- Standard fork/branch + PR flow for contributions — no need for
  anything heavier on a small internal team.

---

## 12. Edge Cases & Hardening Checklist

- **Arrangement module enabled but `.env` credentials missing/invalid**
  → graceful degradation, not a crash (Section 4.1): module shows
  `misconfigured` on the health screen with the specific missing
  variable named, core search/lyrics-assist keep working unaffected.
  Re-checked on every startup, so adding credentials later just works
  on next restart with no reconfiguration needed.
- **Cache corruption on disk** → atomic write (temp file + rename),
  treat unparseable cache as absent and rebuild rather than crash.
- **Search during rebuild** → old index stays live until new one
  finishes building; swap reference only on full completion.
- **ProPresenter unreachable** → clear, actionable message (not a raw
  error) on both the first-run screen and health screen.
- **ProPresenter API version differences** → treat all documented
  endpoint paths in this doc as illustrative; verify against
  `http://localhost:<port>/help` on the actual installed version before
  building against them.
- **Created vs. last-modified date** → verify which is actually exposed;
  label the UI honestly if only last-modified is available (Section
  5.1).
- **SFTP network failure during weekly write** → local staging +
  retry + visible pending-upload indicator (Section 8.4), so a
  transient outage never silently loses a week of data.
- **SFTP host key changes** (server rebuilt/migrated) → connections
  should fail loudly on fingerprint mismatch, not silently proceed —
  surfaces as a clear "host key changed, verify and update config"
  error rather than a security hole.
- **Reader key leak** → limited blast radius by design (read-only,
  filesystem-enforced, chrooted) — acceptable risk for a broadly
  distributed credential.
- **Writer key leak** → higher stakes (write access to shared history);
  keep it off git, tightly permissioned (600) on disk, and only on the
  one logger machine.
- **Mapping gaps** (new song, no PCO-to-ProPresenter mapping yet) →
  surfaced explicitly as "unmapped" in the recap, never silently
  skipped.
- **Multiple machines accidentally both set to `role: logger`** →
  **now enforced, not just a convention** (Section 8.5): each write
  checks the target service date's existing `loggedByMachineId` before
  overwriting, and prompts for explicit confirmation on a mismatch. A
  team convention ("only Randy's booth machine is the logger") is still
  worth documenting in the README as the normal expectation, but it's
  no longer the only thing standing between two machines and silently
  destroying each other's history.
- **Theme flash on load** → apply the persisted/system theme before
  first paint to avoid a flash of the wrong theme on page load.
- **Local server binding** → bind to `localhost` (127.0.0.1) by default,
  not `0.0.0.0`, since each coworker runs their own instance; there's no
  current requirement for one machine's instance to be reachable from
  another machine's browser.
- **Narrow window / extreme resize** → nav rail should have CSS
  min-widths so it never visually breaks even at extreme narrow window
  sizes, independent of the manual expand/collapse state (Section 13).

---

## 13. Navigation Layout — Simplified from Earlier Discussion

Earlier discussion proposed automatic breakpoint-based expand/collapse
*plus* a manual override — two behaviors that can conflict (does
resizing the window override a user's manual choice? at what exact
width?). **Simplify: manual toggle only.** One button/keyboard shortcut
expands the icon-rail into a full labeled sidebar; there's no automatic
width-triggered switching to keep in sync with the manual state. This
removes a whole category of "which one wins" edge cases for a modest
loss in convenience — the user just clicks once if they've made the
window bigger and want the fuller layout.

- Narrow (default, ~56-64px): icon rail, tooltips on hover.
- Wide (toggled): icon + label sidebar, main content area gets more
  room (e.g. search results can show more columns).
- Persist the toggle state in `config.json` (`navPinned`).
- CSS min-widths ensure neither mode visually breaks at extreme window
  sizes, independent of this toggle.

---

## 14. Lyrics Search-Assist (unchanged from prior discussion, restated for completeness)

- Search box → constructs a scoped search URL
  (`site:genius.com OR site:azlyrics.com <song> <artist>`) → opens in a
  new browser tab. The app never fetches or parses search results or
  lyrics pages itself — scraping either Google's results page or a
  lyrics site would violate their respective ToS. This is a deliberate,
  permanent boundary, not a placeholder for a future scraper.
- Lyrics site list configurable in `config.json`.
- User manually copies lyrics from the page they open, pastes into
  Refrain's paste-to-slides tool.
- Paste-to-slides: splits on blank lines into slide blocks (configurable),
  optionally detects Verse/Chorus/Bridge labels if present in the pasted
  text, shows a preview before creating the presentation in ProPresenter.
  **Unverified — check during build:** whether your ProPresenter
  version's API supports creating a new presentation programmatically,
  or only reading/triggering existing ones. If creation isn't supported,
  this step ends at "here are your formatted slides, add them manually,"
  which is still a real time-save over starting from scratch.

---

## 15. API Verification — Step 0, Not a Deferred Open Item

**Revised from earlier discussion.** These were previously listed as
"open items to check during build," which risks a developer discovering
a load-bearing gap halfway through implementing a feature that assumes
it — specifically, Section 14's paste-to-slides importer is only as
automated as the answer to item 2 below allows. Verify all of these
**before writing any application code**, not during the relevant
feature's build step:

1. Does ProPresenter's local API (your installed version) expose a true
   *created* timestamp, or only *last modified*? Affects Section 5.1's
   date filter honesty.
2. Does the API support programmatic presentation *creation*, or only
   read/trigger? **This directly determines Section 14's scope** — with
   creation support, paste-to-slides can go end-to-end (paste → format →
   one-click create in ProPresenter); without it, it ends at "here are
   your formatted slides, add them manually," which is a smaller but
   still real time-save. Know which version you're building before
   starting, not partway through.
3. Confirm exact endpoint paths against `http://localhost:<port>/help`
   on the actual installed ProPresenter version — every endpoint named
   in this document is illustrative, not guaranteed to match your
   version's exact routes.

**Practically: open Postman/curl and hit `/help` on the real machine
before any architecture decisions from this document are treated as
final.** Everything else here is a made decision, not an open
question — but these three sit underneath multiple sections' worth of
design, so confirm them first.

---

## 16. Build Order

0. **API verification (Section 15)** — confirm all three items above
   against the actual installed ProPresenter version before writing any
   application code. If item 2 comes back "no creation support," revise
   Section 14's scope before it's built, not after.
1. Local search index (Section 5.2) + basic search UI + Go Live —
   validates ProPresenter API basics first. **Build this with zero
   dependency on the arrangement module from the start** — this is the
   feature that needs to work standalone for the open-source goal
   (Section 17.1).
2. Boot-time behavior (5.3), health screen (7), first-run screen (6) —
   do this early since it's what makes the tool actually shareable, not
   a personal script.
3. Date filter (5.1) — already verified in Step 0.
4. Nav layout (13) + theming (2) — cheap, do alongside UI work rather
   than retrofitting.
5. GitHub packaging: README, `.gitignore`, `config.example.json`,
   launcher scripts (10, 11), plus OSS scaffolding (17.5) — do this
   before inviting outside contributors, not after.
6. Lyrics search-assist + paste-to-slides (14), scoped per Step 0's
   findings.
7. Arrangement module, built against the provider/backend interfaces
   from day one (17.2, 17.3) rather than hardcoding Planning Center or
   SFTP directly — implement `manual.js` and `local-folder.js` as the
   default/simplest pairing first, then `planning-center.js` and
   `sftp.js` as this church's specific configuration on top of the same
   interface. SFTP hardening setup (9), including per-machine reader
   keys, can happen in parallel any time, since it's independent
   server-side work.


---

## 17. Open-Sourcing Refrain for Other Churches

Two decisions made earlier are specific to this church and would block
adoption elsewhere: Planning Center as *the* church-management
integration, and a Hostinger VPS as *the* shared-storage answer. Neither
is actually load-bearing to the design — they were just the first
concrete implementation. Generalizing both, and adding the scaffolding
a public repo needs to accept outside contributions.

### 17.1 Core Design Principle Going Forward

**The core search + lyrics-assist feature has zero required external
dependencies beyond ProPresenter itself.** This needs to stay true and
be the headline of the project. Everything Planning-Center-shaped or
SFTP-shaped is an *optional module* a church can enable, skip entirely,
or swap for a different backend that fits their situation. A small
church with one volunteer and no ChMS subscription should be able to
clone this, connect it to ProPresenter, and get full value from search
alone — never blocked or confused by setup screens for a feature they
don't want.

### 17.2 Pluggable "Planned Arrangement Source" Interface

Replace the hardcoded Planning Center client with a small provider
interface. Planning Center becomes the *reference implementation*, not
the only option — other churches use Rock RMS, Church Community
Builder, Elvanto/Tithely, a spreadsheet, or nothing formal at all.

```js
// providers/base.js — interface every provider implements
class ArrangementProvider {
  async getPlannedArrangement(songId, serviceDate) {
    // returns: { sectionSequence: ["Verse 1", "Chorus", ...] }
    throw new Error("Not implemented");
  }
  async testConnection() { throw new Error("Not implemented"); }
}
```

```
providers/
├── base.js
├── planning-center.js   # reference implementation, ships in core
├── manual.js            # user just types in the planned arrangement —
│                         # the zero-integration option for churches
│                         # with no ChMS at all
└── (community-contributed: rock-rms.js, ccb.js, elvanto.js, ...)
```

- `manual.js` matters more than it looks — it's the option that makes
  the feature usable by a church with *no* church-management software
  at all, and it's the natural first thing a new contributor can add a
  second/third provider alongside.
- Document the interface clearly in `CONTRIBUTING.md` (17.5) so adding a
  new ChMS is a self-contained, reviewable PR — implement two methods,
  register it, done.

### 17.3 Pluggable Storage Backend Interface (single-machine default: plain local folder; cross-machine default: Firestore)

Same problem, same fix. SFTP-to-a-VPS was this church's answer because
they happened to have spare server space — most churches won't. Make
**a plain local folder the default for churches that don't need
cross-machine sharing at all** (single computer, single volunteer), and
**Firestore the default for churches that do** (Section 9 has the full
reasoning — no VPS, no SSH, no key distribution, free at this scale).
SFTP/network-share/synced-folder remain available for churches with
specific infra preferences or self-hosting requirements.

```js
// storage/base.js
class StorageBackend {
  async readSongFile(songId) { throw new Error("Not implemented"); }
  async writeSongFile(songId, data) { throw new Error("Not implemented"); }
  async listSongFiles() { throw new Error("Not implemented"); }
}
```

```
storage/
├── base.js
├── local-folder.js   # default for single-machine churches — zero
│                      # setup, no cross-machine sharing possible
├── firestore.js       # DEFAULT for cross-machine sharing — see Section 9
│                       # for full reasoning. No VPS, no SSH keys; reader
│                       # machines need zero credentials thanks to
│                       # Firestore security rules.
├── synced-folder.js   # FIRST-CLASS, built now, not left community-only.
│                       # Points local-folder.js's exact same logic at a
│                       # folder that happens to be synced by something
│                       # else — Google Drive for Desktop, Dropbox,
│                       # OneDrive. No API, no OAuth, no credentials:
│                       # the sync client handles all of that invisibly.
│                       # Google Drive is the headline documented
│                       # example, since it's free and most churches
│                       # already have it running for other things.
├── sftp.js            # opt-in alternate for churches with their own
│                       # server space who specifically want everything
│                       # self-hosted — see 9.6
└── smb-share.js       # community-contributable: point at a mapped
                        # network drive, plain fs calls
```

**Decision on Google Drive specifically:** implement it as
`synced-folder.js` pointed at wherever Drive for Desktop mounts its
synced folder (`G:\My Drive\...` on Windows, `~/Google Drive/...` /
`~/Library/CloudStorage/GoogleDrive-.../My Drive/...` on macOS) —
**not** a direct Drive API integration. The API route would need an
OAuth consent flow, a registered Google Cloud project, and refresh-token
storage for meaningfully more code and more secrets to manage, and
still wouldn't help a headless/server-only machine (which would need
its own separate solution anyway). The desktop-sync route gets "Google
Drive support" with almost no new code — it's the same `local-folder.js`
logic, just documented with a setup guide for finding the right synced
path per OS. A true Drive API backend (useful specifically for a
headless machine with no desktop sync client installed) is a good
candidate to leave as a **community-contributed enhancement** later,
once/if someone actually needs it — no reason to build the heavier
version speculatively when the lighter version solves the real case.

**Setup helper:** on the storage-backend config screen, when a user
picks "Google Drive / synced folder," attempt to auto-detect common
Drive-for-Desktop mount paths for their OS and offer them as a
one-click default, falling back to manual path entry if nothing's
found. Small touch, meaningfully lowers setup friction for non-technical
volunteers.

### 17.4 Generalized Setup Flow

Restructure the first-run screen (Section 6) into clearly separated
required vs. optional steps, so a church that only wants search is never
confronted with Planning-Center-shaped questions:

1. **Required:** ProPresenter connection + test.
2. **Optional, clearly skippable:** "Want to compare planned vs. actual
   arrangements? This needs a church-management system integration and
   somewhere to store shared results." → if yes: pick a provider (17.2)
   from a dropdown, pick a storage backend (17.3) from a dropdown
   (defaulting to "local folder — simplest, no sharing across
   machines"), configure that provider/backend's specific fields. If no:
   skip straight to the app, that module simply never appears in the nav.
3. Theme (defaults sanely, doesn't need to block anything).

### 17.5 Repo Scaffolding for Public Contributions

- **`LICENSE`** — MIT. Permissive, well-understood, no legal review
  needed by a volunteer church IT person, and it's the de facto standard
  for this category of small utility tool.
- **`CONTRIBUTING.md`** — how to file issues/PRs, how to add a new
  provider (17.2) or storage backend (17.3) with a concrete worked
  example, basic code style expectations. This is the single highest-
  leverage doc for turning "other churches found it" into "other
  churches contributed to it."
- **`CODE_OF_CONDUCT.md`** — standard Contributor Covenant. Worth having
  from day one given the audience (volunteers across many organizations,
  varying technical backgrounds) — sets an inclusive, low-friction tone
  before it's ever needed.
- **`SECURITY.md`** — responsible disclosure process. Relevant here
  specifically because the app handles SSH keys and API tokens; a
  security researcher or another church's IT person needs a clear,
  non-public channel to report an issue rather than filing it as a
  public GitHub issue.
- **Issue templates** (bug report, feature request) and a **PR
  template** — lowers friction for first-time contributors, keeps
  reports actionable.
- **Basic CI** (GitHub Actions): lint + whatever minimal tests exist, run
  on every PR. Doesn't need to be elaborate — its job is catching
  obviously broken PRs from well-meaning first-time contributors, not
  full coverage.

### 17.6 README Structure for Broad Approachability

Given the range of technical skill among church volunteers who might
find this repo, structure the README in that order:

1. One-paragraph pitch + a screenshot or short GIF of the search-and-go-
   live flow — the thing that sells it in five seconds.
2. **Non-technical quickstart**: clone, run the launcher script,
   done — assume no terminal familiarity.
3. **What you need**: ProPresenter with the local API enabled. That's
   it for the core feature. Optional modules and their extra
   requirements clearly separated out, not front-loaded.
4. **Privacy/self-hosting note** (17.7).
5. **Compatibility table**: ProPresenter versions tested against, since
   this is the one thing likely to vary and cause confusion.
6. **For developers**: architecture overview, how to add a provider or
   storage backend, link to `CONTRIBUTING.md`.
7. **Disclaimer** (17.8).

### 17.7 Privacy Principle — State This Explicitly

Worth stating plainly in the README, since churches will reasonably care
about data leaving their network: **Refrain sends data only to services
you explicitly configure** (your own ProPresenter install, optionally
your chosen ChMS's API, optionally your chosen storage backend). There
is no telemetry, analytics, or phone-home to any project-controlled
server. This is a real, checkable claim as long as it stays true — worth
treating as a hard constraint on future PRs, not just a marketing line.

### 17.8 Disclaimer

Standard OSS practice, worth including verbatim-ish in the README:
*Refrain is an independent, community-built tool and is not affiliated
with, endorsed by, or supported by Renewed Vision (ProPresenter) or
Planning Center.* Protects the project and is simply accurate — this
integrates with public APIs, it isn't an official partnership.

### 17.9 One Thing Worth Doing Before Public Launch (can't verify from here)

Search GitHub and a general web search for existing projects or
trademarks named "Refrain" in a similar space before making the repo
public — it's a common enough word that a collision is plausible, and
it's a five-minute check worth doing rather than assuming.

### 17.10 What Deliberately Doesn't Generalize

Worth stating so a future contributor doesn't propose it: **this can't
become a hosted SaaS product**, because the core value depends on
talking to ProPresenter's *local* API on the same network — there's no
way to centrally host a service that reaches into someone else's
building's local network. Self-hosted-per-church is inherent to the
problem, not a limitation of this implementation.

### 17.11 Broader Extensibility Architecture

Two interfaces (provider, storage backend) cover the arrangement
module, but "make most components extensible" should apply more
broadly, with real judgment about *which* pieces genuinely benefit from
being pluggable versus which should stay fixed. Being thoughtful here
matters as much as the extensibility itself — a plugin interface for
everything, including things with no real variation, just adds
indirection for no benefit.

**What becomes pluggable, newly:**

- **Nav / feature modules.** Instead of hardcoding each feature (search,
  lyrics-assist, arrangement module) directly into the nav component and
  router, each feature registers itself:
  ```js
  // modules/search/module.js
  export default {
    id: "search",
    navLabel: "Search",
    icon: "search",
    route: "/search",
    component: SearchScreen,
    enabledByDefault: true
  };
  ```
  This is what makes the arrangement module's "entirely skippable, no
  nav entry if disabled" behavior (17.4) a natural consequence of the
  architecture rather than a special case, and it means a contributor
  adding a genuinely new feature (not just a new provider/backend) —
  say, a slide-transition checker, or a media/background organizer —
  does so as a self-contained module folder, without editing core
  nav/router files at all.

- **Lyrics-to-slides splitting logic.** The algorithm that turns pasted
  lyrics into slide breaks (Section 14) is a real point of church-to-
  church variation — some want one line per slide, some want stanza
  grouping, some want a fixed max-lines-per-slide. Make this pluggable
  too:
  ```js
  // slide-splitters/base.js
  class SlideSplitter {
    split(pastedText) { throw new Error("Not implemented"); }
    // returns: string[] — one entry per resulting slide
  }
  ```
  Ship `blank-line-delimited.js` (default) and `section-label-aware.js`
  (splits on detected Verse/Chorus/Bridge markers) as reference
  implementations; a fixed-line-count splitter or anything else is a
  natural, self-contained community contribution.

**Auto-discovery convention (reduces merge-conflict-prone central
registries):** rather than requiring a contributor to edit one shared
"list of providers" file (which causes PR conflicts as the project
grows), have the app scan `providers/`, `storage/`, `slide-splitters/`,
and `modules/` at startup and auto-register anything matching the
expected interface shape. Adding a new one is then genuinely just "add
one new file in the right folder" — no other file needs to change,
which is the single biggest thing that makes a plugin ecosystem
actually pleasant to contribute to versus merely theoretically
extensible.

**What deliberately stays fixed, not pluggable — and why:**

- **The ProPresenter integration itself.** This isn't a swappable data
  source — talking to ProPresenter *is* the product. There's no other
  target that would make sense to plug in instead, so abstracting this
  away would just add indirection with no real second implementation
  ever likely to exist.
- **The core slide-text search algorithm** (Section 5.1's substring
  match). This is simple enough, and central enough to every feature,
  that turning it into a swappable interface would add a layer of
  abstraction for a piece of logic that doesn't actually vary between
  churches — everyone wants "find this text in these slides," full
  stop. If fuzzy/semantic search is ever wanted, that's a genuine
  upgrade to build directly, not a plugin slot to leave open
  speculatively.
- **Lyrics site list** stays a plain config array (Section 4), not a
  class-based plugin — there's no differing *behavior* per site, only a
  differing domain string for the scoped search URL. A full interface
  here would be over-engineering a list of strings.

**Update `CONTRIBUTING.md` to include a worked "add a new X" example
for each of:** provider, storage backend, slide splitter, and nav
module — four short, concrete recipes are what actually turns "open
source" into "other churches contribute," more than any amount of
architectural elegance without documentation to match.

---

## 18. Updated `config.example.json` and `.env.example`

```json
// config.example.json — no secrets, safe to commit
{
  "propresenter": {
    "host": "localhost",
    "port": 1025
  },
  "theme": "system",
  "navPinned": false,
  "lyricsSites": ["genius.com", "azlyrics.com"],
  "slideSplitter": "blank-line-delimited",
  "arrangementModule": {
    "enabled": false,
    "role": "reader",
    "provider": "manual",
    "storageBackend": "firestore"
  }
}
```

```bash
# .env.example — documents required secrets, no real values, safe to commit
PROPRESENTER_API_KEY=

# Only needed if role=logger
PLANNING_CENTER_APP_ID=
PLANNING_CENTER_SECRET=

# Only needed if storageBackend=firestore
FIRESTORE_PROJECT_ID=
# Logger only — reader machines don't need this at all (Section 9.1)
FIRESTORE_SERVICE_ACCOUNT_KEY_PATH=

# Only needed if storageBackend=sftp
SFTP_HOST=
SFTP_USERNAME=
SFTP_PRIVATE_KEY_PATH=
SFTP_KNOWN_HOST_FINGERPRINT=
```

- `arrangementModule.enabled: false` is the default — the module and its
  nav entry simply don't exist for a church that skips it in setup.
- `provider` and `storageBackend` are swappable strings, auto-resolved
  against whatever's found in `providers/` and `storage/` at startup
  (Section 17.11's auto-discovery convention) — not a hardcoded list to
  maintain centrally. Each provider/backend defines its own required
  `.env` variables, documented alongside its implementation.
- `storageBackend: "firestore"` is the recommended default for any
  church wanting cross-machine sharing (Section 9); `"local-folder"` for
  single-machine setups; `"synced-folder"` and `"sftp"` remain available
  per-church choices.
- `slideSplitter` is similarly a swappable string resolved against
  `slide-splitters/` (Section 17.11).
