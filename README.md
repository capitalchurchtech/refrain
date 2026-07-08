# Refrain

Find any slide, in any presentation, in your entire ProPresenter library — not just playlist names — and jump straight to it live. Built for the moment someone starts a song mid-service and nobody's sure which one it is.

![Refrain search screenshot](docs/screenshot-placeholder.png)

## What it does

- **Full-text slide search** across your whole ProPresenter library and every playlist, with one-click "Go Live" on any result.
- **Lyrics search-assist** for songs your CCLI library doesn't have — searches lyrics sites via a scoped web search, then helps you paste and auto-format lyrics into slides.
- **Optional: arrangement drift tracking** — compares what your church-management system planned for a song against what actually got run, so you can stop making the same manual edit every week. Fully optional, fully skippable, needs no setup if you don't want it.

## What you need

Just ProPresenter, with its local network API enabled (Preferences → Network). That's the whole requirement for the core search feature.

Everything else — a church-management integration, shared arrangement storage — is optional and configured separately. See [docs/refrain-architecture.md](docs/refrain-architecture.md) for the full picture.

## Large libraries

If your ProPresenter library has hundreds of presentations or playlists,
a full index build can be slow (and on some setups, hammering the API
with many playlists at once can make ProPresenter itself sluggish).
Scope the initial sync down in `config.json`:

```json
"librarySync": {
  "folders": ["Songs", "Messages"],
  "crawlPlaylists": false
}
```

`folders: null` syncs every Library folder. `crawlPlaylists: true` also
crawls every playlist for "which playlist is this in" metadata — the
slowest part of a rebuild, so it's off by default; search still covers
every presentation in the synced folders either way.

## Installation

**Requirements:** [Node.js](https://nodejs.org) (the LTS version) and ProPresenter with its Network API enabled (Preferences → Network).

1. Get the code — either:
   - **Git** (recommended — makes updating a one-line command later): `git clone https://github.com/capitalchurchtech/refrain.git`
   - **ZIP**: on the [GitHub page](https://github.com/capitalchurchtech/refrain), click **Code → Download ZIP**, then unzip it.
2. Double-click `scripts/start.command` (Mac) or `scripts/start.bat` (Windows) — or, from a terminal: `npm install && npm start`.
3. A setup screen opens in your browser. Point it at ProPresenter's host/port, hit Test Connection, and you're in.

No terminal knowledge required for step 2 if you use the launcher script — it installs dependencies on first run automatically and doesn't require Node to already be on your PATH beyond the initial check.

## Updating

Your real settings (`config.json`) and secrets (`.env`) are never part of what git tracks or a ZIP download contains — they live only on your machine and are untouched by an update.

- **If you cloned with Git:**
  1. `git pull`
  2. `npm install` (picks up any dependency changes — safe to run even if nothing changed)
  3. Restart the app: close and re-open the launcher script, or if it's already running, stop it (`Ctrl+C` in its terminal window) and re-run `npm start`.
- **If you downloaded a ZIP:** download the latest ZIP again, unzip it to a new folder, then copy your old folder's `config.json` and `.env` into the new one before starting it — those files aren't part of any download, git or ZIP, so they only exist where you originally set them up.

Either way, a restart is required — the running server doesn't hot-reload its own code or pick up `.env` changes on its own.

## Privacy

Refrain only talks to services you explicitly configure — your own ProPresenter install, and optionally your chosen church-management API or shared storage backend. There's no telemetry, analytics, or phone-home to any project-controlled server.

## Compatibility

| ProPresenter version | Status |
|---|---|
| 7.x | Reference target — verify exact API paths against your version's `http://localhost:<port>/help` before relying on anything version-specific. |

## For developers

Refrain is built to be extended. Church-management integrations, storage backends, lyrics-to-slide splitting logic, and whole new feature modules are all pluggable — see [CONTRIBUTING.md](CONTRIBUTING.md) for worked examples of adding each kind, and [docs/refrain-architecture.md](docs/refrain-architecture.md) for the full architecture.

Stack: Node.js + Express, Tailwind + DaisyUI, Lucide icons. No database anywhere in the stack — plain JSON, in-memory or in Firestore.

## Disclaimer

Refrain is an independent, community-built tool. It is not affiliated with, endorsed by, or supported by Renewed Vision (ProPresenter) or Planning Center.

## License

MIT — see [LICENSE](LICENSE).
