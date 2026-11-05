# Notes for AI agents working in Refrain

This is for Claude or any other AI coding agent making changes here. Human contributors want [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/refrain-architecture.md](docs/refrain-architecture.md) instead, or as well. If you're an agent about to change something, read this first. The repo has a real architecture with real invariants, the fast obvious way to add a feature is often the wrong way here, and if you're running without a human reviewing each step there's nothing else to catch it before it merges.

## Three things that must never break

1. **Core search stays free of everything else.** The core (`server/propresenter-client.js`, `server/search-index.js`, and the search and lyrics screens) must keep working with nothing but ProPresenter. A church with no church management software and no interest in the other tools should get full value from search with zero setup for features it didn't ask for. If a change makes core search depend on the arrangement module, a specific provider, or any module, it's wrong. This is not a judgment call.
2. **No telemetry, ever.** No analytics, no phoning home to anything the project controls. Not "off by default", not present in the code at all. The README states this plainly and it's a checkable claim. Don't be the change that quietly breaks it with an error reporting SDK or an update check that leaks usage. The one automatic outbound request today is the update check (`/api/version-check` in `server/index.js`): a plain GET of this repo's `package.json` from `raw.githubusercontent.com`, cached six hours, carrying no identifier, version or usage. Keep it that way. The README's Privacy section lists every connection Refrain makes; if you add or change one, change that list in the same commit.
3. **Never lose data silently.** Config writes are atomic (temp file then rename, see `saveConfig` in `server/config.js`). Writes to shared arrangement storage stage locally first and retry on failure rather than dropping data on a network blip (see `stageAndWrite` and `retryPendingUploads` in `server/arrangement-diff.js`). If you add a new place that writes something a volunteer would be upset to lose, follow that pattern, not a bare `fs.writeFile`.

## Where new code goes

The project uses auto discovery, not central registries. Dropping a file in the right folder is meant to be the whole integration step. If you find yourself editing a list of providers or a list of modules somewhere, stop. You're fighting the architecture instead of using it.

| Kind of thing | Goes in | Worked example | Interface |
|---|---|---|---|
| Church management integration | `providers/your-name.js` | `providers/planning-center.js` | `providers/base.js` |
| Storage backend | `storage/your-name.js` | `storage/local-folder.js` | `storage/base.js` |
| Lyrics splitter | `slide-splitters/your-name.js` | `slide-splitters/blank-line-delimited.js` | `slide-splitters/base.js` |
| Where the day summary goes | `delivery/your-name.js` | `delivery/email.js`, `delivery/folder.js` | `delivery/base.js` |
| A whole new nav feature | `modules/your-feature/module.js` plus `server/your-feature.js` plus `public/your-feature.js` | `modules/image-crop/`, `modules/qr-code/` | none |
| Native macOS window behaviour | `mac/Refrain/` (Swift, built by `scripts/build-mac-app.command`) | `WebController.swift` | none. It only shows the front end, so a feature still goes in `modules/`, never only here. |

CONTRIBUTING.md has the exact method signatures for each.

Where discovery stops, so you don't go looking for magic that isn't there:

- **A module's server routes are not discovered.** `module.js` gives the menu
  entry, the screen and the Settings › Features switch. The `/api/...` routes
  still get added by hand in `server/index.js`, or as a router mounted there
  the way Bundles mounts `server/probundle.js`. That is the expected edit, not
  fighting the architecture.
- **Constructor arguments are built per id** in `getArrangementProvider` and
  `getStorageBackend` (`server/index.js`). A new provider gets
  `new Provider({ storage })` and a new storage backend gets `new Backend()`; one
  that needs credentials or settings needs a branch there.
- **Load timing differs.** Providers and delivery backends are imported at
  start-up with top-level await, so one that throws on import stops the server.
  Storage backends and splitters are imported when a route needs them, so one
  that throws breaks only those routes. A broken module is skipped.
- **`getPlanSongs(planId)`** is called on any provider with
  `supportsPlanBrowsing` but isn't declared in `providers/base.js`. Read
  `providers/planning-center.js` for its shape before writing a second
  plan-browsing provider.

## Don't hardcode a vendor name in shared code

This was a real bug class here. Early on, the "push to church management system" feature hardcoded "PCO" and "Planning Center" in button labels, route paths (`/api/arrangement/pco/push-arrangement`), and field names (`pcoSongId`). It got found and fixed. Don't bring it back:

- If a screen or route needs a provider or backend's name, read `Provider.displayName` or `Backend.displayName`. Never write the vendor's name as a literal outside that provider's own file.
- If a screen or route needs to know whether a provider can do something (push an update, browse plans), add a `static supportsX = false` flag to the base class and check `Provider.supportsX`, the way `requireProviderCapability()` in `server/index.js` does. Never write `if (providerId === "planning-center")` in code that isn't that provider's own file.
- Name fields and routes for the thing, not the vendor: `externalSongId`, not `pcoSongId`. `/api/arrangement/push-arrangement`, not `.../pco/...`.
- The one fair exception is a provider's own config field, like "Planning Center Service Type ID" on Settings, which is inherently specific to that system. The test: would this string need to change if someone swapped in a different provider? If yes, it's hardcoded, so read it from the capability or the display name instead.

## Config, secrets, and module status

- Non secret preferences go in `config.json` (gitignored, real values). `config.example.json` documents the shape.
- Secrets go in `.env` (gitignored). `.env.example` lists the names, blank.
- **Both templates are user-facing, not just developer notes.** Refrain reads `config.example.json` when there is no `config.json`, and setup saves what it read, so its `_comment` keys land in every new church's `config.json`. The Secrets screen (Settings › Features › Options › Secrets) shows one field per name in `.env.example`. Keep the comments true and the names live.
- Every optional module reports off, misconfigured, or active from a `get<Name>ModuleStatus(config)` function in `server/config.js` (some return `{ status, problems }` instead of a string). A missing credential or unset folder should degrade to misconfigured with a clear message on Settings › Status, never crash the server or take down an unrelated feature.
- Most switches come from a module's own `feature` in `module.js`, read by `server/features.js`; `featureOn(config, id)` is the check. Phones (`networkModule.enabled`), the day summary (`reportModule.enabled`) and the service feed (`serviceFeedModule.enabled`) are switched in their own blocks instead.

### The screen called Health is Settings

The rail and every page say **Settings**, with tabs Status, Search, Features,
System, and More (Phones, Customize, Telemetry, Audit). The code still calls it
`health`: `public/health.js`, the `health` view, `#health`. Plenty of comments and a
few strings still say "Health screen" and mean Settings. Write "Settings ›
<tab>" in anything a person reads, and use the More path (Settings › More ›
Phones) in docs.

## The main app answers only to this computer's own name

The main app listens on 127.0.0.1 and refuses, with 421, any request whose Host
isn't 127.0.0.1, localhost, [::1] or a `*.localhost` name (`hostRefused` in
`server/request-guard.js`, the first middleware). It closes DNS rebinding: a
web page pointing its own name at 127.0.0.1 could otherwise read the index,
slides and flags. Anything that calls the main app, a script or Refrain.app,
uses `http://127.0.0.1:9999` or `localhost`, never the Mac's network name. The
phone listener is a separate app on the network and isn't affected.

## Don't make ProPresenter work during a service

Two safeguards exist because heavy reads through ProPresenter's API make it
sluggish (Go Live, Clear and macros lag) and make it write to its own workspace
database, about 13 KB per presentation read. Anything new that reads
presentations, playlists or slide pictures from ProPresenter has to respect both:

- **Performance mode** (`server/performance-mode.js`). Armed after two minutes
  of something live, or by hand, or when ProPresenter can't be reached.
  Background work must not start while it is armed, and bulk work should
  refuse with the shared "Performance mode is on, so Refrain is holding
  still…" message. The heartbeat is the exception, and new live-state features
  should read the heartbeat's cached state rather than add calls.
- **Protect ProPresenter** (`protectProPresenter`, on unless `false`). While
  on, nothing reads presentations through the API in bulk: Quality Control,
  the pre-service checks and Get slide pictures all refuse,
  and the index runs from `.pro` files only. It is on in every fresh install,
  so a feature that needs bulk API reads will refuse out of the box. Say so in
  its docs and its refusal message rather than discovering it in a booth.

Prefer reading `.pro` files with `propresenter-bundle` (see
`server/presentation-files.js`) to asking the API. The same goes for pictures:
a ProPresenter thumbnail writes about 30 KB into its workspace database, so
every slide picture on the desktop is Refrain's own drawing from
`server/slide-drawing.js` (safe slides, Quality Control, Flags). ProPresenter is
asked for one slide's thumbnail only when Quality Control or a flag needs a
slide that can't be drawn. Phones get the slide's words, never a picture, and
the service feed sends no picture. Don't add a thumbnail path back. Never write to
ProPresenter's library or workspace. The old Library Sync feature did, and is
switched off with `SHARE_LIBRARY_REMOVED` in `server/index.js` (every route
answers 410); don't revive it and don't document it as a feature.

The ProPresenter API paths are verified against 21.3 (see the top of
`server/propresenter-client.js`). `/help` answers 404 on that version, so don't
send people there to check an endpoint; `docs/propresenter-verification.md` has
`curl` captures instead.

Two API behaviours that read wrong until measured:

- **The live slide index counts within the arrangement that is playing**, not
  the whole file. But for an item played from a playlist that chose an
  arrangement, `GET /v1/presentation/active` leaves `current_arrangement`
  empty; the arrangement is `playlist_item.presentation_info.arrangement_uuid`
  from `GET /v1/playlist/active` (its name can be empty; look it up in the
  presentation), and it only appears about half a second after the trigger.
  `server/playing-slide.js` still resolves such a deck across all its slides
  for the live words and count; the service log's per-slide timing already
  uses the playlist's arrangement.
- **Testing by triggering slides fires their actions**: macros switch stage
  layouts and Looks, start timers and messages. Read the slide's actions from
  its file first (`describeAction` in `server/mcp/actions.js`), note the Look,
  stage layouts and timers, and put them back afterwards, not just the layers.
  `GET /v1/trigger/next` is global and can move to other content; step a
  presentation with `/v1/presentation/active/next/trigger`.

## Tailwind is a runtime JIT here, not a compiled stylesheet

`public/vendor/tailwind-cdn.js` is the browser JIT, vendored so the app works
offline. It still generates utility rules at runtime by scanning the DOM, which
has one consequence worth knowing before you debug a layout for an hour:

**A Tailwind class that exists only as a JavaScript string has no rule until
the MutationObserver notices it.** `element.classList.toggle("w-36")` applies a
class the scanner never saw at boot, so the rule arrives a frame late or not at
all, and anything measuring in the same tick reads the old value. An inline
`width: … !important` appears not to work, which sends you chasing specificity
when the problem is timing.

So: **any class applied from JS needs a static home in `refrain.css`.** The rail
width and the matching content margin already do —
`#nav-rail.w-12 { width: 3rem }` and `#main-content.ml-12 { margin-left: 3rem }`.
Those rules look redundant next to the utility class; they are not. Do not
"clean them up".

All the JS-applied utilities have static homes: `w-12`, `ml-12`,
`opacity-50`, `pointer-events-none`, the key bank's
`lg:grid-cols-4` and `xl:grid-cols-5`, and Health's status strip
`sm:grid-cols-2` and `lg:grid-cols-4`. Keep it that way. When you add a class
from JS, add its rule here in the same change.

The rail is one fixed width now (3rem, 48px; it was 3.5rem as `w-14`/`ml-14`
before the design match). If you change that width again, pick the Tailwind
class whose name matches the value and rename every reference (the two static
homes and the right-hand variant in `refrain.css`, and the two initial classes
in `index.html`). Redefining `w-12` to mean something other than 3rem would be
worse than the rename: these names are only safe as conventions while they are
still true.

The utility names are the convention rather than semantic hooks like `.pinned`.
That is deliberate: the static homes work, and renaming would churn markup for
readability alone. The comment above is what protects them.

## A rule that exists can still lose

The JIT trap above is about a rule that was never generated. This is the
opposite failure and it has bitten harder: a rule that exists, reads correctly,
and silently loses the cascade.

Both instances came from `refrain.css` using an ID or attribute selector that
outranked something elsewhere:

- `#nav-rail { position: relative }` at 1,1,0 beat Tailwind's `.fixed` at
  0,1,0, dropping the rail into normal flow while `main` kept the margin that
  exists *because* it is out of flow. The rail's width was charged twice and
  every screen rendered into under half its column.
- A touch-target floor selecting `#nav-items .nav-item` at 1,1,0 lost to tier
  heights selecting `[data-theme="dark"] #nav-rail .nav-item` at 1,2,0.
  **A media query contributes no specificity**, so `@media (hover: none)` does
  not help a weaker selector win.

Neither is visible by reading the file that contains the rule. Both read as
though they work.

Two habits that prevent it:

- **Co-locate a rule with the rule it modifies.** The touch floor now sits
  directly beneath the tier heights it relaxes, same selectors, equal
  specificity plus later position. The next person changing a height sees the
  floor three lines down. A comment in another file is a footgun with a warning
  label on it.
- **For anything set in two places, assert the computed value, not the
  stylesheet.** Reading the sheet tells you what was declared. Only the
  computed value tells you what won.

Measuring heights: use `offsetHeight`. `getBoundingClientRect()` is
post-transform, and a scaled preview pane will report 41.8px for a box that is
44px in layout.

## Design work, and the handoff between sessions

Design and copy on this project run through a standing brief and a single
handoff file, because the planning and the editing usually happen in two
different sessions.

- **`.claude/creative-direction.md`** is the standing brief: palette, materials,
  elevation, buttons, type, the voice zones, the quality floor, and the three
  questions every review has to answer yes to. Read it before changing anything
  a person looks at. It is not a style suggestion; a change that contradicts it
  is wrong the same way a change that breaks core search is wrong.
- **`.claude/handoff.md`** is always the current work order. It carries the
  phases, the sequencing, and any decision that is still open. If you are the
  editing session, this is your brief and anything outside it is not in scope
  yet. Append to its Status log as tasks land, so the planning session can see
  what happened without asking.
- Superseded handoffs move to `.claude/handoffs/`. Never work from one that has
  been moved there, and never work from a Todoist task that is already marked
  complete — retired findings get retired for a reason, usually that a later
  decision made them the wrong work.
- **Findings go in `.claude/handoff.md`, not a tracker.** They are written where
  the work happens, with the severity in the heading: BLOCKER (unusable or
  unsafe to run live), CRAFT (works, but below the bar), POLISH (batch these),
  NOTE (no action). One file, current, self-contained — a finding that needs a
  second system to make sense of it is a finding nobody will read.
- There is an older Todoist project, **IT › Refrain Feature Request**, holding
  the first weeks of findings. Treat it as archive. Do not add to it, and do not
  assume a task there is still live; the handoff and its Status log are the
  record.

## Before you commit

- `npm run lint` has to be clean. If your change broke it, fix the change. Don't paper over it with an eslint disable unless you can say why the rule is genuinely wrong for that line.
- `npm test` has to pass. The suite (Node's built-in runner, files in `test/`) covers the pure logic and the data-safety writers: spell-check flagging, slide-text cleanup and splitting, arrangement diffing, slide indexing, and the atomic `saveConfig`. If you touch any of those, add or update a test. If you add new pure logic worth protecting (especially anything that writes files a volunteer would hate to lose), give it a test rather than relying on a manual check that won't survive the next change. There is no fake ProPresenter server: tests stub `globalThis.fetch`, and route tests start Express on port 0. `stageAndWrite`/`retryPendingUploads` and `saveRecord`/`retryPending` have no tests yet, so add them if you touch those.
- CI runs `npm run lint` only, on Node 18, while `package.json` needs Node 20. It does not run the tests, so a green check is not a passing suite. Run `npm test` yourself.
- Run `node --check` on every file you touched. This is plain ESM with no build step, so a syntax error otherwise only shows up at runtime.
- If the change is visible in the browser (a new screen, a changed flow, a route the UI calls), exercise it against a running dev server before you call it done. This repo's history is full of bugs a syntax check wouldn't catch: races on fast clicks, a route path that didn't match the front end's fetch, a config field the UI never wired up. Don't claim something works without having run it.
- Never commit real church data: sermon content, real names, real keys or tokens, or a screenshot from a live search that happens to surface sermon notes. If you need a doc screenshot, use clearly generic content (hymn lyrics, not sermon notes) or ask first.

## Be honest in the docs

If you ship something partly stubbed (interface there, methods throwing, like `storage/firestore.js` and `storage/sftp.js`), say so plainly where you'd otherwise claim it works. The README's "What's finished and what isn't" section is the format. Don't let a stub read as a shipped feature because the change description didn't mention it. If you add a stub, add it to that section.

### Keep the docs true as you go

The docs were rebuilt from the code at v0.38.0 because they had drifted into
85 KB of release notes that contradicted it. Don't let that happen again: a
change to anything a person sees updates its page in the same commit.

| If you change | Update |
|---|---|
| Install, launchers, Start at login, Refrain.app, updating | `docs/install.md` (and README's Installing or Updating if the steps change) |
| What a new church does on day one | `docs/first-setup.md` |
| Indexing, performance mode, Protect ProPresenter | `docs/indexing.md` |
| Search, Go Live, Return, keyboard | `docs/search.md` |
| Now, Day, Flags, End the day, summary | `docs/service.md` |
| The phone page, its permissions, slide pictures | `docs/phones.md` and SECURITY.md |
| Quality Control, Lyrics, Scripture, Image Crop, QR | `docs/prep-tools.md` |
| Arrangement tracking, providers, storage | `docs/arrangements.md` |
| Bundles, the MCP server or its tools | `docs/bundles-and-mcp.md` |
| A Settings tab, a feature switch, a config key, a `.env` name, a file under `data/` | `docs/configuration.md`, `config.example.json` comments, `.env.example` |
| Any outbound connection | README's Privacy section |
| The service feed or staff requests contract | `docs/service-feed.md` |
| A ProPresenter endpoint | `docs/propresenter-verification.md` |
| Structure, an extension point, a rule | `docs/refrain-architecture.md`, CONTRIBUTING.md, this file |

Some names are load-bearing. Scripts and error messages send people to the
README's **Installing** and **Updating** sections, and this file and the PR
template point at **What's finished and what isn't**. Code comments cite
`docs/refrain-architecture.md`, `docs/service-feed.md` and `docs/ideas.md` by
path. Rename any of those and fix every reference in the same change.

Docs are the warm voice zone in `.claude/creative-direction.md`: plain, sentence
case, active voice, no em dashes. Name buttons and menus exactly as the UI
spells them, and write paths as **Settings › More › Phones**. Describe the
current version only; what changed belongs in the release notes. A claim you
couldn't check (a measurement, a ProPresenter behaviour) says so rather than
reading as fact.

## Git

- Commit only when asked. Push only when asked. Finishing a feature is not, on its own, permission to commit it.
- Every release gets a GitHub release page, always. `npm version X --no-git-tag-version`, commit "Release vX", `git tag -a vX`, push both, then `gh release create vX` with notes. A tag without a release page is an incomplete release: the release page is where a church admin actually looks to see what changed and whether to update.
- Don't force push, don't rewrite history on `main`, don't skip CI or lint to get something through.
- If you're running autonomously with no human reviewing before merge, be more careful than you would with a backstop, not less. The checks above exist because real church infrastructure and real (if small) user trust ride on this staying honest and stable.
