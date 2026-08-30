# Notes for AI agents working in Refrain

This is for Claude or any other AI coding agent making changes here. Human contributors want [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/refrain-architecture.md](docs/refrain-architecture.md) instead, or as well. If you're an agent about to change something, read this first. The repo has a real architecture with real invariants, the fast obvious way to add a feature is often the wrong way here, and if you're running without a human reviewing each step there's nothing else to catch it before it merges.

## Three things that must never break

1. **Core search stays free of everything else.** The core (`server/propresenter-client.js`, `server/search-index.js`, and the search and lyrics screens) must keep working with nothing but ProPresenter. A church with no church management software and no interest in the other tools should get full value from search with zero setup for features it didn't ask for. If a change makes core search depend on the arrangement module, a specific provider, or any module, it's wrong. This is not a judgment call.
2. **No telemetry, ever.** No analytics, no phoning home to anything the project controls. Not "off by default", not present in the code at all. The README states this plainly and it's a checkable claim. Don't be the change that quietly breaks it with an error reporting SDK or an update check that leaks usage.
3. **Never lose data silently.** Config writes are atomic (temp file then rename, see `saveConfig` in `server/config.js`). Writes to shared arrangement storage stage locally first and retry on failure rather than dropping data on a network blip (see `stageAndWrite` and `retryPendingUploads` in `server/arrangement-diff.js`). If you add a new place that writes something a volunteer would be upset to lose, follow that pattern, not a bare `fs.writeFile`.

## Where new code goes

The project uses auto discovery, not central registries. Dropping a file in the right folder is meant to be the whole integration step. If you find yourself editing a list of providers or a list of modules somewhere, stop. You're fighting the architecture instead of using it.

| Kind of thing | Goes in | Worked example | Interface |
|---|---|---|---|
| Church management integration | `providers/your-name.js` | `providers/planning-center.js` | `providers/base.js` |
| Storage backend | `storage/your-name.js` | `storage/local-folder.js` | `storage/base.js` |
| Lyrics splitter | `slide-splitters/your-name.js` | `slide-splitters/blank-line-delimited.js` | `slide-splitters/base.js` |
| A whole new nav feature | `modules/your-feature/module.js` plus `server/your-feature.js` plus `public/your-feature.js` | `modules/image-crop/`, `modules/qr-code/` | none |

CONTRIBUTING.md has the exact method signatures for each.

## Don't hardcode a vendor name in shared code

This was a real bug class here. Early on, the "push to church management system" feature hardcoded "PCO" and "Planning Center" in button labels, route paths (`/api/arrangement/pco/push-arrangement`), and field names (`pcoSongId`). It got found and fixed. Don't bring it back:

- If a screen or route needs a provider or backend's name, read `Provider.displayName` or `Backend.displayName`. Never write the vendor's name as a literal outside that provider's own file.
- If a screen or route needs to know whether a provider can do something (push an update, browse plans), add a `static supportsX = false` flag to the base class and check `Provider.supportsX`, the way `requireProviderCapability()` in `server/index.js` does. Never write `if (providerId === "planning-center")` in code that isn't that provider's own file.
- Name fields and routes for the thing, not the vendor: `externalSongId`, not `pcoSongId`. `/api/arrangement/push-arrangement`, not `.../pco/...`.
- The one fair exception is a provider's own config field, like "Planning Center Service Type ID" on the Health screen, which is inherently specific to that system. The test: would this string need to change if someone swapped in a different provider? If yes, it's hardcoded, so read it from the capability or the display name instead.

## Config, secrets, and module status

- Non secret preferences go in `config.json` (gitignored, real values). `config.example.json` documents the shape.
- Secrets go in `.env` (gitignored). `.env.example` lists the names, blank.
- Every optional module reports off, misconfigured, or active from a `getXModuleStatus(config)` function in `server/config.js`. A missing credential or unset folder should degrade to misconfigured with a clear Health screen message, never crash the server or take down an unrelated feature.

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
`#nav-rail.w-36 { width: 9rem }` and `#main-content.ml-36 { margin-left: 9rem }`.
Those rules look redundant next to the utility class; they are not. Do not
"clean them up".

All eight JS-applied utilities have static homes: `w-14`, `w-36`, `ml-14`,
`ml-36`, `opacity-50`, `pointer-events-none`, and the key bank's
`lg:grid-cols-4` and `xl:grid-cols-5`. Keep it that way. When you add a class
from JS, add its rule here in the same change.

The collapsed pair was `w-16`/`ml-16` until the rail narrowed to 3.5rem. If you
change that width again, pick the Tailwind class whose name matches the value
and rename all four references (both `classList.toggle` calls in `nav.js`, the
two static homes, the two initial classes in `index.html`, the `.rf-group-label`
selector, and the ultra-narrow media block). Redefining `w-16` to mean something
other than 4rem would be worse than the rename: these names are only safe as
conventions while they are still true.

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
- `npm test` has to pass. The suite (Node's built-in runner, files in `test/`) covers the pure logic and the data-safety writers: spell-check flagging, slide-text cleanup and splitting, arrangement diffing, slide indexing, and the atomic `saveConfig`. If you touch any of those, add or update a test. If you add new pure logic worth protecting (especially anything that writes files a volunteer would hate to lose), give it a test rather than relying on a manual check that won't survive the next change.
- Run `node --check` on every file you touched. This is plain ESM with no build step, so a syntax error otherwise only shows up at runtime.
- If the change is visible in the browser (a new screen, a changed flow, a route the UI calls), exercise it against a running dev server before you call it done. This repo's history is full of bugs a syntax check wouldn't catch: races on fast clicks, a route path that didn't match the front end's fetch, a config field the UI never wired up. Don't claim something works without having run it.
- Never commit real church data: sermon content, real names, real keys or tokens, or a screenshot from a live search that happens to surface sermon notes. If you need a doc screenshot, use clearly generic content (hymn lyrics, not sermon notes) or ask first.

## Be honest in the docs

If you ship something partly stubbed (interface there, methods throwing, like `storage/firestore.js` and `storage/sftp.js`), say so plainly where you'd otherwise claim it works. The README's "What's finished and what isn't" section is the format. Don't let a stub read as a shipped feature because the change description didn't mention it. If you add a stub, add it to that section.

## Git

- Commit only when asked. Push only when asked. Finishing a feature is not, on its own, permission to commit it.
- Every release gets a GitHub release page, always. `npm version X --no-git-tag-version`, commit "Release vX", `git tag -a vX`, push both, then `gh release create vX` with notes. A tag without a release page is an incomplete release: the release page is where a church admin actually looks to see what changed and whether to update.
- Don't force push, don't rewrite history on `main`, don't skip CI or lint to get something through.
- If you're running autonomously with no human reviewing before merge, be more careful than you would with a backstop, not less. The checks above exist because real church infrastructure and real (if small) user trust ride on this staying honest and stable.
