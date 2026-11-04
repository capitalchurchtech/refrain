# Contributing to Refrain

Thanks for thinking about it. Most of the ways you'd want to extend Refrain are
a file (or a small folder) dropped into the right place. This page covers
setting up, each extension point, and the rules that keep the project honest.

If an AI coding agent is writing or helping with your change, point it at
[CLAUDE.md](CLAUDE.md) first. It covers the same ground plus the mistakes this
codebase has already had to fix.

## Setting up

You need Node 20 or newer (`.nvmrc` says 20) and, for anything live, a
ProPresenter with its network API on.

```bash
git clone https://github.com/capitalchurchtech/refrain.git
cd refrain
npm install
npm run dev
```

`npm run dev` restarts the server when a file changes. Open
`http://localhost:9999` and finish setup. Your `config.json` and `.env` are
gitignored, as are `cache/`, `data/`, `staging/` and `logs/`.

Run the server from the repository root: the plugin folders are found relative
to the working directory.

| Command | Does |
|---|---|
| `npm start` | Run Refrain |
| `npm run dev` | Run it and restart on changes |
| `npm test` | The test suite (Node's built-in runner, files in `test/`) |
| `npm run lint` | ESLint |
| `npm run mcp` | The MCP server over stdio |

## Ground rules

- **Open an issue before a big pull request**, so we can agree on the approach.
- **Core search stays free of everything else.** Search, Go Live, Show, Quality
  Control and Now must work with nothing but ProPresenter. If your change makes
  them depend on a module, a provider or a backend, it's the wrong change.
- **No telemetry.** No analytics, no error-reporting service, nothing that
  reports usage to anyone. This is a hard rule, and the README's privacy section
  is a promise people check.
- **Never lose data silently.** Write files through a temporary file and a
  rename. Writes to a shared folder or remote backend go local first and retry.
  `saveConfig` in `server/config.js`, `writeAtomic` and `saveRecord` in
  `server/append-store.js`, and `stageAndWrite` in `server/arrangement-diff.js`
  are the patterns.
- **No vendor names in shared code.** Read `displayName` and capability flags
  from the provider or backend class. Name fields and routes for the thing
  (`externalSongId`, `/api/arrangement/push-arrangement`), not the vendor.
- **A new dependency needs a real reason.** Prefer Node's own modules and
  `fetch`.
- **Be honest in the docs.** If you ship something partly built, say so in the
  README's "What's finished and what isn't".

## Before you open a pull request

- `npm test` passes, and anything you touched that has tests still has them.
  New pure logic, and anything that writes files a volunteer would hate to lose,
  gets a test.
- `npm run lint` is clean.
- `node --check` passes on every file you touched. There is no build step, so a
  syntax error otherwise only shows up at runtime.
- If it's visible in the browser, you've used it against a running Refrain, not
  only checked that it parses.
- No real church data in code, tests, fixtures or screenshots: no sermon
  content, real names, keys or tokens.

CI runs lint on every pull request. It doesn't run the tests yet, so run them
yourself.

## Extension points

Each kind lives in its own folder with a `base.js` holding the interface.
`server/plugin-loader.js` imports every other `.js` file in the folder. There is
no list to edit. Providers and delivery backends are imported when Refrain
starts, so one that throws on import stops the server. Storage backends and
splitters are imported when a route needs them, so one that throws breaks those
routes. Keep imports cheap and safe.

### A church management provider (`providers/`)

A provider answers: for this song and service date, what arrangement did the
planning system plan? `providers/manual.js` is the simplest (the user types it
in); `providers/planning-center.js` implements everything.

```js
// providers/base.js
export class ArrangementProvider {
  static get displayName() {}            // defaults to a title-cased providerId
  static supportsPush = false;
  static supportsPlanBrowsing = false;
  static requiredEnv = [];               // [{ name, roles? }], roles like ["logger"]

  async getPlannedArrangement(songId, serviceDate, songName, planId = null) {}
                                         // → { sectionSequence: string[] }
  async testConnection() {}              // → boolean

  // Only if supportsPlanBrowsing:
  async getRecentPlans(count) {}         // → [{ id, dates }]
  async getPlanSongs(planId) {}          // → [{ title, sectionSequence, externalSongId,
                                         //      externalArrangementId, section? }]
                                         // not declared in base.js yet; the plan screens call it
  // Only if supportsPush:
  async getArrangementSequence(songId, arrangementId) {}       // → string[]
  async updateArrangementSequence(songId, arrangementId, sequence) {}
}
```

1. Make `providers/your-system.js` exporting a class that extends
   `ArrangementProvider`, with `static providerId = "your-system"`. That is the
   value of `arrangementModule.provider` in `config.json`.
2. Implement the two required methods, and the optional ones behind their flags.
   Routes check the flag (`requireProviderCapability` in `server/index.js`), never
   the id.
3. List the `.env` names you need in `requiredEnv`, and add them, blank, to
   `.env.example`. Settings then reports the provider misconfigured when one is
   missing, without shared code knowing your provider exists.
4. A new provider is constructed as `new Provider({ storage })` in
   `getArrangementProvider` (`server/index.js`). If yours needs credentials or
   settings passed in, that function needs a branch for it.

### A storage backend (`storage/`)

Where per-song arrangement history lives. `storage/local-folder.js` is the
reference; `storage/synced-folder.js` is the same class with a different id.
`storage/firestore.js` and `storage/sftp.js` are stubs waiting for someone to
finish them.

```js
// storage/base.js
export class StorageBackend {
  static get displayName() {}            // defaults to a title-cased backendId
  async readSongFile(songId) {}          // → object | null
  async writeSongFile(songId, data) {}   // write atomically
  async listSongFiles() {}               // → string[] of songIds
}
```

1. Make `storage/your-backend.js` extending `StorageBackend`, with
   `static backendId`. That is `arrangementModule.storageBackend`.
2. Set `static displayName` if the default reads badly (`sftp.js` sets "SFTP").
3. A new backend is constructed with no arguments in `getStorageBackend`
   (`server/index.js`), and storage has no `requiredEnv` yet. If yours needs
   settings or credentials, add a branch there and a status check in
   `getArrangementModuleStatus` (`server/config.js`). If only the logger needs
   the credentials, say so: reader machines should need no setup.

### A lyrics splitter (`slide-splitters/`)

Turns pasted text into slides. Churches format differently, so this is a real
point of variation. `slide-splitters/blank-line-delimited.js` is the reference.

```js
// slide-splitters/base.js
export class SlideSplitter {
  static displayName = null;   // what a volunteer reads in "Split by"
  split(pastedText) {}         // → string[], one per slide (synchronous)
}
```

Set `static splitterId` and a `displayName` phrased for a volunteer ("Blank
lines", not "Blank Line Delimited"). Without one, the screen shows a title-cased
id.

### A day summary delivery backend (`delivery/`)

Where the day summary goes when someone presses Send. `delivery/email.js` and
`delivery/folder.js` are the references.

```js
// delivery/base.js
export class DeliveryBackend {
  static get displayName() {}            // defaults to a title-cased backendId; email.js sets "Email"
  static sendsOffMachine = false;        // true if it leaves this machine
  static takesRecipients = false;        // true to edit reportModule.recipients in Settings
  static requiredEnv = [];
  static problems(moduleConfig, env) {}  // → sentences; empty means ready
  async deliver({ day, subject, markdown, moduleConfig, env }) {}
                                         // → { ok: true, detail }, throw a sentence on failure
}
```

Set `static backendId` (`reportModule.deliveryBackend`). Be honest with
`sendsOffMachine`: the Send button says so beside it. Report missing settings
from `problems()` so the module shows as misconfigured rather than failing when
someone presses Send. `delivery/email.js` speaks SMTP through `server/smtp.js`
on Node's own `net` and `tls`, with no dependency.

### A new screen (`modules/`)

A module is a folder with a `module.js`. It gives Refrain the menu entry, its
place, the screen, and the switch on Settings › Features:

```js
// modules/your-feature/module.js
export default {
  id: "your-feature",
  navLabel: "Your Feature",
  icon: "lucide-icon-name",
  // "service" for screens used during a service, "prep" for everything else.
  // Prep screens are tabs on the Prep page. Lower order comes first.
  nav: { group: "prep", order: 10 },
  // public/your-feature.js, exporting initYourFeature(). Return { render } to be
  // called each time the screen opens.
  client: { file: "your-feature.js", init: "initYourFeature" },
  route: "/your-feature",
  component: null,
  feature: {
    default: false,
    label: "Your Feature",
    summary: "Shown on the switch's row",
    description: "Shown as the row's tooltip.",
    apiPrefixes: ["/api/your-feature"],   // answer "switched off" while off
  },
};
```

- `client.file` must be a plain file name in `public/`.
- `features: [{ id, label, summary, description, default, apiPrefixes }]` adds
  switches for parts of one screen, the way `modules/live/` switches Now's
  Messages, Macros, Looks, Safe slides and Staff requests separately.
- A module with neither `feature` nor `enabledByDefault: true` never shows.
  Search, Quality Control and Now use `enabledByDefault`; everything else should
  be switchable, and off by default unless most churches would want it on the
  day they install.
- **Server routes are not discovered.** Add your `/api/your-feature/*` routes to
  `server/index.js` (or a router mounted there, as Bundles does with
  `server/probundle.js`), and keep the logic in `server/your-feature.js`.

`modules/image-crop/` (with `server/image-crop.js` and `public/image-crop.js`)
is a good template for a feature with real setup. `modules/qr-code/` is the
simplest: a tool with a handful of routes and a small history file.

### Classes applied from JavaScript

Tailwind runs as a browser JIT. A utility class added only from JavaScript may
not have a rule yet when you measure it. Give every such class a static rule in
`public/refrain.css` in the same change. CLAUDE.md has the details.

## What we won't make a plugin

- **The ProPresenter integration.** It is the product, not a data source.
- **Search.** It doesn't vary between churches. A better search is a direct
  upgrade.
- **The lyrics site list.** A list of domains in config.

Not sure whether something belongs in core or as a plugin? Open an issue and ask.

## Changing the index format

Each church's index lives in `cache/search-index.json`, and an update leaves it
alone: the next reindex re-reads only changed presentations.

`SCHEMA_VERSION` in `server/search-index.js` breaks that. Change it and every
church's next reindex is a full rebuild, which takes minutes to over an hour
through the API and makes ProPresenter sluggish.

- Only change it when an index entry gains a field the app relies on.
- A new build option that changes what an entry contains belongs in
  `sameBuildOptions` in `server/index-fingerprint.js`, not a version change.
- Say so in the release notes, so nobody updates the day before a service.
- Add a test for the reindex plan, as `test/index-fingerprint.test.js` does.

## Releasing

Maintainers only. Every release gets a GitHub release page, because that is where
a church admin looks to decide whether to update.

1. `npm version X.Y.Z --no-git-tag-version`
2. Commit "Release vX.Y.Z" and merge it.
3. `git tag -a vX.Y.Z` and push the tag.
4. `gh release create vX.Y.Z` with notes written for a church admin: what
   changed, and anything to know before updating near a service.

## Security issues

Please don't file them as public issues. See [SECURITY.md](SECURITY.md).
