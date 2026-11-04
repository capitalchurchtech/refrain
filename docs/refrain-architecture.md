# Refrain architecture

How Refrain is put together, for anyone extending it or trying to understand a
decision. It describes the code as it is. If the code and this page disagree,
trust the code and fix the page.

## The shape of it

A Node and Express server runs on the same Mac as ProPresenter. It talks to
ProPresenter's local API, reads ProPresenter's library files, keeps a search
index in memory, and serves a plain JavaScript front end. There is no build step
and no database: state is JSON files written atomically, in memory or on disk.

- The **booth screens** are served on `127.0.0.1:9999` (`PORT` overrides it).
  Nothing else on the network can reach them. A guard refuses cross-site
  requests that change anything.
- The **phone page** is a second, separate Express app (`server/remote.js`) on
  port 9997 by default (`networkModule.port`), started only when phones are
  switched on. It has its own sign-in and
  exposes a small, fixed set of routes. See [phones](phones.md#security).
- The **MCP server** (`server/mcp/`, `npm run mcp`) is a third entry point. It
  runs over stdio for an assistant, works only on files, and shares no state with
  the web server.
- **Refrain.app** (`mac/Refrain/`, Swift) is an optional native window onto the
  booth screens. It doesn't run the server; when Refrain isn't answering it can
  ask the Start at login job to start it.

## The rules everything else bends to

1. **Core search stays free of everything else.** Search, Go Live, Show,
   Quality Control and Now work with nothing but ProPresenter. Nothing in
   `server/propresenter-client.js` or `server/search-index.js` may depend on a
   module, provider or backend.
2. **No telemetry.** No analytics and nothing that reports usage to the project.
   The only automatic outbound request is the update check, which fetches
   `package.json` from GitHub and sends nothing about the church. Every other
   connection is to something the church configured.
3. **Never lose data silently.** Writes go to a temporary file and are renamed
   into place. Writes to a shared folder or storage backend go local first and
   are retried.
4. **Don't make ProPresenter work during a service.** Performance mode, Protect
   ProPresenter and the file-based index exist because heavy API reads make
   ProPresenter sluggish and write to its database.

## Directory map

```
server/            the Express server, one file per concern
  index.js         wiring and nearly every route
  propresenter-client.js   ProPresenter's API
  search-index.js  builds, holds and searches the index
  presentation-files.js    reads .pro files for the index
  index-fingerprint.js     decides what a reindex re-reads
  library-watch.js         reindexes after a save
  performance-mode.js      when Refrain holds still
  config.js        config.json and .env, module status
  features.js      feature switches from module.js files
  plugin-loader.js discovers providers, storage, splitters, delivery, modules
  remote*.js       the phone page and its sign-in
  service-*.js     Day: records, checks, summary, feed
  mcp/             the MCP server
providers/         church management integrations
storage/           arrangement history backends
slide-splitters/   lyrics and scripture to slides
delivery/          where the day summary goes
modules/           one folder per screen, each a module.js
public/            the front end, one script per screen
mac/Refrain/       Refrain.app
mac/icon/          make-icon.swift, which draws the app's icon from Archivo at build time
scripts/           launchers, updaters, Start at login, the Mac app build
test/              node --test suites
docs/              these pages
```

At runtime Refrain writes `cache/`, `data/`, `staging/` and `logs/`, all
gitignored, plus `config.json` and `.env`.

## Configuration and status

`config.json` holds preferences and `.env` holds secrets. Both are read at
start-up. `saveConfig` in `server/config.js` writes `config.json` through a
temporary file and a rename, one save at a time.

Each optional part has a `get<Name>ModuleStatus(config)` function in
`server/config.js` that returns off, misconfigured or active (some also return
the problems as sentences). A missing credential or folder gives misconfigured,
with a sentence on Settings, and never stops the server or another feature.

Feature switches come from the modules themselves (below). `featureOn(config,
id)` uses `config.features[id]` when it is a boolean, else the module's default.
A request to an API prefix of a switched-off feature gets a 404 saying it is
switched off.

## Plugins

`server/plugin-loader.js` imports every `.js` file except `base.js` in
`providers/`, `storage/`, `slide-splitters/` and `delivery/`, and every
`modules/<name>/module.js`. There is no registry to edit. It doesn't validate
what it finds. Providers and delivery backends load at start-up, so one that
throws on import stops the server starting; storage backends and splitters load
when a route needs them, so one that throws breaks those routes; a broken module
is skipped.

Each kind has a base class with the interface; [CONTRIBUTING.md](../CONTRIBUTING.md)
has the exact signatures. The UI reads names and capabilities from the class
(`displayName`, `supportsPush`, `supportsPlanBrowsing`, `requiredEnv`,
`sendsOffMachine`), never from a vendor name, so a new provider gets its label
and buttons for free.

Two things still need an edit in `server/index.js`: a module's API routes (the
loader finds the screen and the switch, not the server routes), and constructor
arguments for a new provider or storage backend, which are built in
`getArrangementProvider` and `getStorageBackend`.

## The front end

`public/index.html` is the shell. `public/main.js` fetches `/api/modules`,
imports each module's `client.file`, calls its `init` function, and keeps the
`render` it returns for when the screen opens. Screens are routed by the URL
hash (`#search`, `#settings/search`), and moving between screens replaces the
history entry rather than adding one. Styling is Tailwind and
DaisyUI plus `refrain.css`, with Lucide icons, all vendored in `public/vendor/`
so Refrain works offline.

Tailwind runs as a browser JIT here. A class added only from JavaScript has no
rule until the JIT notices it, so every class applied from JavaScript has a
static rule in `refrain.css`. [CLAUDE.md](../CLAUDE.md) explains this and the
cascade traps that have bitten before.

## Search and the index

The index is one JSON file, `cache/search-index.json`, held in memory. Refrain
lists each library through the API and reads each presentation's `.pro` file
with the `propresenter-bundle` package, falling back to the API when it must. A
rebuild swaps the live index only when it finishes, so search keeps working
meanwhile.

Each slide is stored with an anchor (its group and its place in the group) as
well as its number, under one arrangement per song. Go Live re-finds the slide by
its anchor in the arrangement ProPresenter has selected at that moment, because a
slide number only means something inside one arrangement. Groups the indexed
arrangement skips are stored too, for Deep Search.

`SCHEMA_VERSION` in `server/search-index.js` marks the index format. Changing it
makes every church's next reindex a full rebuild, so only change it when an entry
gains a field the app relies on. `sameBuildOptions` in
`server/index-fingerprint.js` forces a full rebuild when preferred arrangements
or playlist crawling change.

Search is a case-insensitive substring match with apostrophe folding, a typo
retry against the library's own words, and repeated lines collapsed.

See [the search index](indexing.md) for the behaviour.

## Slide pictures

A ProPresenter thumbnail writes about 30 KB into its workspace database, so the
booth screens draw their own where they can. `server/slide-drawing.js` draws a
whole presentation from its `.pro` file in a worker, in the arrangement
ProPresenter has selected, keeps the last 30 files drawn in memory, and serves
them to `public/slide-drawing.js`. Quality Control and the safe slide keys use
it; a slide it can't draw falls back to ProPresenter's thumbnail, then to its
words. Bundles shares the same drawing code. Everything else that needs a
picture (phones, Update pictures, flag pictures) asks ProPresenter, under the
rules in [phones](phones.md#slide-pictures).

## The heartbeat

Every 4 seconds while a browser has checked in within two minutes, or a service
window or lock-in is open (30 seconds otherwise), Refrain asks ProPresenter for
its layer status and the live slide index. When something new goes live it also
reads that presentation once, for its arrangement and words. That heartbeat
drives the rail lamps, performance mode, the Return bar's history, Day's
timeline, flagging and the service feed, so none of them adds traffic of its
own. Day also reads a service's playlist when its window opens.

## Data safety

- **Atomic writes**: `saveConfig`, `server/append-store.js` (`writeAtomic`),
  the index, the storage backends.
- **One file per record**: Day's events and flags are each a new small file,
  never an edit, so two machines sharing a synced folder can't overwrite each
  other. `saveRecord` writes locally first, then to the shared folder, and
  `retryPending` copies anything left behind.
- **Staged arrangement writes**: `stageAndWrite` in `server/arrangement-diff.js`
  writes `staging/pending/<song>.json`, then the backend, and clears the staged
  copy only on success. `retryPendingUploads` runs at start-up.
- **Conflict check**: a comparison for a date another machine already logged asks
  before overwriting. Each logger has a machine id in `config.json`.

## Arrangement tracking

A provider supplies the planned arrangement; a storage backend keeps one JSON
file of history per song. Manual and Planning Center are the providers. Local
Folder and Synced Folder are the working backends; Firestore and SFTP are stubs
whose methods throw. Songs are matched across systems by normalised title,
which can misfire on duplicate titles. A push to the planning system only runs
from a confirmed press, returns the previous sequence for undo, and refuses
unmapped sections.

## Switched-off code

`server/library-sync.js` and its routes belong to a library copying feature that
wrote into ProPresenter's library folder. It is switched off
(`SHARE_LIBRARY_REMOVED` in `server/index.js`): every route answers 410 and it
never runs on its own, whatever `config.json` says.

## What deliberately isn't a plugin

- The ProPresenter integration. It is the product.
- The search itself. It doesn't vary between churches; a better search is a
  direct upgrade.
- The lyrics site list. It's a list of domains in config.
