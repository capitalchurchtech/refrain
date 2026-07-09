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

## Before you commit

- `npm run lint` has to be clean. If your change broke it, fix the change. Don't paper over it with an eslint disable unless you can say why the rule is genuinely wrong for that line.
- Run `node --check` on every file you touched. This is plain ESM with no build step, so a syntax error otherwise only shows up at runtime.
- If the change is visible in the browser (a new screen, a changed flow, a route the UI calls), exercise it against a running dev server before you call it done. This repo's history is full of bugs a syntax check wouldn't catch: races on fast clicks, a route path that didn't match the front end's fetch, a config field the UI never wired up. Don't claim something works without having run it.
- Never commit real church data: sermon content, real names, real keys or tokens, or a screenshot from a live search that happens to surface sermon notes. If you need a doc screenshot, use clearly generic content (hymn lyrics, not sermon notes) or ask first.

## Be honest in the docs

If you ship something partly stubbed (interface there, methods throwing, like `storage/firestore.js` and `storage/sftp.js`), say so plainly where you'd otherwise claim it works. The README's "What's finished and what isn't" section is the format. Don't let a stub read as a shipped feature because the change description didn't mention it. If you add a stub, add it to that section.

## Git

- Commit only when asked. Push only when asked. Finishing a feature is not, on its own, permission to commit it.
- Don't force push, don't rewrite history on `main`, don't skip CI or lint to get something through.
- If you're running autonomously with no human reviewing before merge, be more careful than you would with a backstop, not less. The checks above exist because real church infrastructure and real (if small) user trust ride on this staying honest and stable.
