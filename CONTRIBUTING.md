# Contributing to Refrain

Thanks for thinking about contributing. Most of the ways you'd want to extend Refrain don't need you to touch the core at all. You add one file (or a small folder) that follows a short interface, and the app picks it up when it starts. This doc covers the common kinds of contribution and the rules that keep the project honest.

If an AI coding agent is writing or helping write your change, read [CLAUDE.md](CLAUDE.md) first. It covers this same ground plus the specific mistakes this codebase has already had to fix, like vendor names leaking into shared code.

## Ground rules

- Open an issue before a big pull request so we can agree on the approach first.
- Keep the core (`server/propresenter-client.js`, `server/search-index.js`, and the search and lyrics screens) free of anything specific to a church management system or a storage backend. Search has to keep working with nothing but ProPresenter.
- No telemetry, analytics, or phoning home of any kind. This is a hard rule, not a preference. See the privacy section of the README.
- A new dependency needs a real reason. Prefer plain Node and `fetch` over pulling in a package where that's reasonable.

## Adding a church management provider

Providers live in `providers/`. A provider answers one question: for a given song and service date, what arrangement did the church management system plan?

```js
// providers/base.js
class ArrangementProvider {
  async getPlannedArrangement(songId, serviceDate) {
    // return: { sectionSequence: ["Verse 1", "Chorus", ...] }
    throw new Error("Not implemented");
  }
  async testConnection() { throw new Error("Not implemented"); }
}
```

1. Make `providers/your-system.js`, extend `ArrangementProvider`, and implement both methods.
2. Set a `providerId` (for example `"rock-rms"`). That's the string a user puts in `config.json` under `arrangementModule.provider`.
3. Document any `.env` variables you need in a comment at the top of the file, and add them, blank, to `.env.example`.
4. That's it. There's no central list to edit. The app scans `providers/` on startup and registers anything that matches the interface.

Optional capabilities, which you only implement if they apply, and which you flag with a static property so the UI knows to offer them (nothing in the UI ever hardcodes a vendor name):

- `static displayName` gives a readable name for UI text, like "Push to Planning Center" or the provider picker. It defaults to a title cased version of `providerId`, so it's optional.
- `static supportsPlanBrowsing = true` plus `getRecentPlans(count)` if your system has a "plan" concept (a named, dated set of songs for a service) that can be listed. This drives the "this weekend" one button workflow.
- `static supportsPush = true` plus `getArrangementSequence(...)` and `updateArrangementSequence(...)` if your system can accept a corrected arrangement back. This drives the "push to (provider)" button, which only ever fires from an explicit confirmation, never on its own.

`providers/planning-center.js` implements all of these and is the reference. `providers/manual.js` is the opposite end: no API at all, the user just types the arrangement in, which is the option for a church with no church management software.

## Adding a storage backend

Storage backends live in `storage/`. A backend answers: where do the per song arrangement history files live, and how do we read and write them?

```js
// storage/base.js
class StorageBackend {
  async readSongFile(songId) { throw new Error("Not implemented"); }
  async writeSongFile(songId, data) { throw new Error("Not implemented"); }
  async listSongFiles() { throw new Error("Not implemented"); }
}
```

1. Make `storage/your-backend.js`, extend `StorageBackend`, implement all three methods.
2. Set a `backendId`, used in `config.json` under `arrangementModule.storageBackend`.
3. Optionally set `static displayName` for the picker and health screen. It defaults to a title cased `backendId`, so set it only when that would look wrong. `storage/sftp.js` sets `"SFTP"` because the default would give "Sftp".
4. Document any `.env` variables the same way as for providers.
5. If your backend needs credentials only for the machine that writes and not for the ones that read, say so clearly in your comments. That matters for the goal that reader machines need no setup. `storage/firestore.js` is the reference for that pattern.

`storage/firestore.js` and `storage/sftp.js` are stubs right now: the interface is there, the methods throw. Both are good things to pick up if you want cross machine sharing without a synced folder.

## Adding a lyrics splitter

Splitters live in `slide-splitters/`. A splitter turns pasted lyrics into an array of slide sized chunks. Churches format differently (one line per slide, grouped by stanza, a fixed line count), so this is a genuine point of variation.

```js
// slide-splitters/base.js
class SlideSplitter {
  split(pastedText) { throw new Error("Not implemented"); }
  // returns: string[], one entry per slide
}
```

Make `slide-splitters/your-splitter.js`, extend `SlideSplitter`, implement `split()`. See `slide-splitters/blank-line-delimited.js` for the reference.

## Adding a whole new feature

Modules live in `modules/`. This is how a new nav level feature gets added without touching the router or the nav code.

```js
// modules/your-feature/module.js
export default {
  id: "your-feature",
  navLabel: "Your Feature",
  icon: "your-lucide-icon-name",
  route: "/your-feature",
  component: null,
  enabledByDefault: false,
};
```

This is the right shape for something genuinely new, not a provider or a backend or a splitter, but a whole new thing Refrain doesn't do yet. Self contained folder, no core files touched.

Two shipped modules are worth reading as templates, both added exactly the way a contribution would be, with nothing in core special cased for them:

- `modules/image-crop/` (with `server/image-crop.js` and `public/image-crop.js`) is a watched folder image cropper. It owns its own saved config, its own screen, and its own `/api/image-crop/*` routes. Read it when your feature has real setup state.
- `modules/qr-code/` (with `server/qr-code.js` and `public/qr-code.js`) is a fully local QR generator. It's the simplest possible module: no saved config, one stateless route, always available. Read it when your feature is a pure tool.

## What we won't make a plugin, and why

- **The ProPresenter integration itself.** It's the product, not a swappable data source. There's no second thing that would sensibly plug in instead.
- **The core slide text search.** It's simple and central, and it doesn't vary from church to church. If fuzzy or semantic search is ever wanted, that's a direct upgrade to build, not a slot to leave open now.
- **The lyrics site list.** It's a plain array in config. There's no differing behavior per site, just a different domain, so a class based plugin would be over engineering a list of strings.

If you're not sure whether something belongs in core or as a plugin, open an issue and ask before you build it. Happy to think it through with you.

## Code style

Nothing elaborate. Match what's already there, keep functions small, prefer plain `async`/`await`. CI runs the linter on every pull request, so run `npm run lint` before you push.

## Security issues

Please don't file security issues as public GitHub issues. See [SECURITY.md](SECURITY.md).
