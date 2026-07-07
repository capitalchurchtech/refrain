# Contributing to Refrain

Thanks for considering a contribution. Refrain is built so that most extension points don't require touching core code — you add one file in the right folder, following a small interface, and it's picked up automatically at startup. This doc covers the four most common kinds of contribution.

Before diving in, skim `docs/refrain-architecture.md` — specifically Section 17.11 (extensibility) — for the reasoning behind what's pluggable and what deliberately isn't.

## Ground rules

- Open an issue before a large PR, so we can agree on approach first.
- Keep the core (`server/propresenter-client.js`, `server/search-index.js`) dependency-free of anything church-management or storage-backend specific. Core search must always work with zero external dependencies beyond ProPresenter.
- No telemetry, analytics, or phone-home of any kind. This is a hard rule, not a preference — see the README's privacy section.
- New dependencies should have a real reason. Prefer plain Node/fetch over adding a package where reasonable.

## Adding a new church-management provider

Providers live in `providers/` and answer one question: given a song and a service date, what did the church-management system plan for its arrangement?

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

1. Create `providers/your-system-name.js`, extend `ArrangementProvider`, implement both methods.
2. Export a `providerId` (e.g. `"rock-rms"`) — this is the string users will set as `arrangementModule.provider` in `config.json`.
3. Document any required `.env` variables in a comment block at the top of the file, and add them (blank) to `.env.example`.
4. That's it — no central registry file to edit. The app scans `providers/` at startup and picks up anything matching the interface.

`providers/manual.js` is a good reference for the simplest possible implementation (no API call at all — just lets the user type in the arrangement).

## Adding a new storage backend

Storage backends live in `storage/` and answer: where do the per-song arrangement history files live, and how do we read/write them?

```js
// storage/base.js
class StorageBackend {
  async readSongFile(songId) { throw new Error("Not implemented"); }
  async writeSongFile(songId, data) { throw new Error("Not implemented"); }
  async listSongFiles() { throw new Error("Not implemented"); }
}
```

1. Create `storage/your-backend-name.js`, extend `StorageBackend`, implement all three methods.
2. Export a `backendId` string, used as `arrangementModule.storageBackend` in `config.json`.
3. Document required `.env` variables (if any) the same way as above.
4. If your backend needs credentials only for writers (not readers), say so clearly in your file's comments — this matters for the "reader machines need zero setup" goal (see `storage/firestore.js` for the reference pattern: readers need only a public project ID, writers need a service account key).

## Adding a new slide splitter

Slide splitters live in `slide-splitters/` and turn pasted lyrics text into an array of slide-sized chunks. Churches vary on formatting conventions (one line per slide, stanza grouping, fixed line counts) — this is a genuine point of variation worth supporting.

```js
// slide-splitters/base.js
class SlideSplitter {
  split(pastedText) { throw new Error("Not implemented"); }
  // returns: string[] — one entry per resulting slide
}
```

Create `slide-splitters/your-splitter-name.js`, extend `SlideSplitter`, implement `split()`. See `slide-splitters/blank-line-delimited.js` for the reference implementation.

## Adding a whole new feature module

Modules live in `modules/` and are how new nav-level features get added without touching router/nav code.

```js
// modules/your-feature/module.js
export default {
  id: "your-feature",
  navLabel: "Your Feature",
  icon: "your-lucide-icon-name",
  route: "/your-feature",
  component: YourFeatureScreen,
  enabledByDefault: false
};
```

This is the right shape for something genuinely new — not a provider, not a storage backend, not a splitter, but a whole new thing Refrain doesn't do yet (a media/background organizer, a slide-transition checker, whatever else another church finds useful). Self-contained folder, no core files touched.

## What we won't add as a plugin, and why

- **The ProPresenter integration itself.** It's the product, not a swappable data source.
- **The core slide-text search algorithm.** No real variation between churches here — if fuzzy/semantic search is ever wanted, build it as a direct upgrade, not a plugin slot.
- **The lyrics site list.** It's a plain config array, not a class — there's no differing behavior per site, just a different domain string.

If you're not sure whether something belongs as a plugin or in core, open an issue and ask before building it — happy to talk it through.

## Code style

Nothing elaborate — match what's already there, keep functions small, prefer plain `async`/`await` over callback chains. CI runs lint on every PR.

## Security issues

Please don't file security issues as public GitHub issues — see [SECURITY.md](SECURITY.md).
