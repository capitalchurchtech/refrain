# Refrain architecture

This describes how Refrain actually works today, for anyone extending it or trying to understand a decision. It's written after the fact, not as a plan, so if the code and this doc ever disagree, trust the code and fix the doc.

## What Refrain is

A web app you run on the same machine as ProPresenter. A small Node and Express server talks to ProPresenter's local network API, keeps a search index, and serves a plain JavaScript front end. Everything runs locally. The only outside services involved are ones the user connects on purpose.

The headline feature is slide search. Everything else is a module: optional, self contained, and off to the side of the core so a church that only wants search is never dragged through setup for features it doesn't care about.

## The one principle everything else bends to

Search plus the lyrics helper have no required dependency beyond ProPresenter itself. A church with one volunteer, no church management software, and no interest in the other tools should be able to clone this, point it at ProPresenter, and get full value from search alone. This has to stay true. If a change makes core search depend on the arrangement module, a specific provider, or any other module, that change is wrong, not a judgment call.

## Stack and layout

Server is Node and Express. Front end is plain JavaScript (no framework) with Tailwind and DaisyUI for styling and Lucide for icons. No database anywhere. Data is plain JSON, held in memory or written to whatever storage backend is configured.

```
server/            Express server, one file per concern
  index.js         routes and wiring
  propresenter-client.js   talks to ProPresenter's local API
  search-index.js  builds and holds the slide index
  config.js        loads config.json and .env, reports module status
  arrangement-diff.js   the compare and save logic for arrangements
  image-crop.js    the watched folder cropper
  qr-code.js       QR generation
  plugin-loader.js discovers providers, storage, splitters, modules
providers/         church management integrations (base, manual, planning-center)
storage/           arrangement history backends (base, local-folder, synced-folder, firestore, sftp)
slide-splitters/   lyrics to slides rules (base, blank-line-delimited, section-label-aware)
modules/           nav level features (search, lyrics-assist, arrangement, image-crop, qr-code)
public/            the front end, one file per screen
docs/              this doc
scripts/           double click launchers for Mac and Windows
```

## Config and secrets

Two files, both kept out of version control:

- `config.json` holds non secret preferences: ProPresenter host and port, the machine's role, theme, which folders to index, and each module's settings. `config.example.json` documents the shape with no real values.
- `.env` holds secrets: API keys and tokens. `.env.example` lists the names it expects, blank.

Config is read once at startup, so changing `.env` or hand editing `config.json` needs a restart to take effect. `config.json` is written atomically (temp file then rename) so a crash mid write can't corrupt it.

## Module status: off, misconfigured, or active

Every optional module reports one of three states from a `getXModuleStatus(config)` function in `server/config.js`:

- **off**: the user hasn't turned it on. Its nav entry doesn't appear.
- **misconfigured**: it's on but something required is missing (a credential, a folder). The nav entry appears with an explanation on the Health screen, and the rest of the app keeps working.
- **active**: on and ready.

A missing credential drops a module to misconfigured, checked fresh on every startup. It never crashes the server or takes an unrelated feature down with it. Adding the missing piece later just works on the next restart.

## The plugin system

Providers, storage backends, splitters, and modules are all discovered by scanning their folders on startup (`server/plugin-loader.js`). There is no central registry file listing them. Adding one is genuinely "drop a file in the right folder", which is the single thing that makes an extension system pleasant to contribute to rather than a merge conflict magnet.

A file exports a default object or class with a known id and interface, and the app finds it. The UI reads friendly names and capabilities off that object rather than hardcoding them, so a new provider or backend gets its label and its buttons for free.

## Search (core)

`search-index.js` pulls the library and slide text from ProPresenter through the local API and holds an in memory index. Search is a plain substring match over slide text, which is simple, fast enough at church library scale, and exactly what everyone actually wants ("find this text on some slide").

The index is cached to disk so a restart doesn't force a full rebuild. A rebuild swaps the live index only when it finishes, so search keeps working against the old index while a new one builds. Rebuilds track how long they took, which the Health screen shows so you can judge whether it's safe to run one right before a service.

You can scope what gets indexed by folder, and optionally crawl playlists for "which playlist is this in" data (off by default because it's the slow part). See the Large libraries section of the README.

## Lyrics helper

For a song the library doesn't have, this runs a scoped web search across a configured list of lyrics sites, then helps paste the words in and split them into slides. The split rule is pluggable (`slide-splitters/`) because churches format differently. It ships with a blank line splitter and a section label aware one.

This never scrapes lyrics sites or search results directly. It opens a scoped search and helps with the paste. That boundary is deliberate and permanent, not a placeholder for a future scraper.

## Arrangement tracking

The problem this solves: a team edits the planned arrangement in their church management system before a service to match how they'll actually run a song, and doing that same edit every week is tedious. Refrain compares the planned arrangement against what's actually in ProPresenter and, for systems that support it, pushes the correction back.

Only pre service editing drift is handled. If a leader improvises an extra chorus live, that isn't captured. That's intentional, since the described problem is the editing, not the live performance.

### Providers

A provider (`providers/`) supplies the planned arrangement for a song. Two exist:

- **Manual**: the user types the arrangement in on the Arrangement screen. No API, no credentials. This is what makes the feature usable with no church management software at all.
- **Planning Center**: pulls the arrangement from Planning Center Services. It supports listing recent plans and pushing a corrected arrangement back.

Providers declare optional capabilities with static flags (`supportsPlanBrowsing`, `supportsPush`) and a `displayName`. Routes and UI check the capability, never the provider's name, so "push to Planning Center" is really "push to whatever provider is configured, if it can". Adding a Rock RMS or CCB provider is a new file, nothing else.

### Planning Center specifics

Verified against a real account. Rather than naming plan IDs by hand every week, the admin sets one Service Type ID in config, and every lookup resolves the plan fresh as the most recent past plan for that service type. The UI can also browse the last few plans and run the comparison against any of them.

Songs are matched between the two systems by normalized title, since there's no shared stable ID. This is a known soft spot: it can misfire on generic or duplicate titles. Section order comes from a plan item's own override when present, otherwise from the linked arrangement's sequence.

Pushing a correction overwrites the shared base arrangement in Planning Center, which affects every future plan that reuses it. So it only ever runs from an explicit, confirmed click, it hands back the previous sequence for a one click undo, and it refuses to push an arrangement that still has unmapped sections.

### Storage

Arrangement history is one JSON file per song. Backends (`storage/`):

- **Local folder**: single machine, zero setup, no sharing.
- **Synced folder**: the same local folder logic pointed at a Google Drive, Dropbox, or OneDrive folder that a desktop app already keeps in sync. This is how two machines share with no server, no OAuth, and no credentials. The desktop sync client handles all of it. The setup screen can auto detect common Drive, Dropbox, and OneDrive locations on Mac and Windows so a volunteer doesn't have to type a path.
- **Firestore** and **SFTP**: stubs. The interface is present, the methods throw. Documented for a contributor to finish if a church needs cross machine sharing without a synced folder.

### Safe writes and multiple machines

Writes stage locally first: the diff is written to a local staging file, then the real backend write is attempted, and the staged copy is cleared only on success. A failed write is left in staging and surfaced on the Health screen, and retried automatically on the next startup, so a network blip never loses a week of data.

Because more than one machine could be set as the writer by accident, each writer machine has a persistent machine ID (a UUID in config, never shown to the user). Before writing history for a given service date, it checks whether a different machine already logged that exact date, and if so it asks for explicit confirmation instead of silently overwriting. It keys on the exact date rather than a rolling window so a church with more than one weekly service doesn't get false conflicts.

### Per comparison controls

Two things a user can flag on a comparison:

- **Ignore this week**: mark one service date's result as an atypical, non representative run (only part of the song, a one off arrangement). It stays in the history for the record but drops out of the "you should update this" suggestions. Reversible.
- **Always differs**: mark a song as one that will never cleanly match (a medley, something the system can't represent well), so it's always flagged for review even when a given week happens to match.

## Image crop

Watches an input folder and, for every image dropped in, writes one cropped copy per configured preset to an output folder, then moves the original into a `processed` subfolder of the output folder (not the input folder, so the input stays empty like a drop box). Nothing is deleted. The output folder isn't watched, so keeping `processed` there can't cause a reprocessing loop.

Design choices worth knowing:

- **Smart crop, not face detection, for now.** It uses smartcrop's saliency heuristic, which needs no model download and handles the church mix (portraits, graphics, text heavy slides) rather than only photos of people. Face detection is a reasonable later add on top, not a requirement.
- **Sequential, not concurrent.** Dropping a folder of hundreds of images fires hundreds of near instant events. Running a full crop pipeline per event at once would spike memory enough to crash a modest booth machine. Files go through a queue one at a time, which is plenty fast and keeps memory flat.
- **Input and output folders can't overlap.** If the output landed in (or above) the watched input folder, each output would retrigger the watcher and get cropped again forever. This is checked when you save and again before the watcher starts.
- **Always navigable, self contained.** Unlike the arrangement module it needs no credentials and no cross machine story, so it isn't gated behind config. Its nav entry is always present because that's where you turn it on. It seeds its own folders and default presets on first enable, so there's nothing to type before it works.
- **Naming.** Outputs keep the original name plus a short tag: `photo_yt.jpg`, `photo_in_sq.jpg`, `photo_hd.jpg`. Each preset carries a short abbreviation, and a custom preset with none falls back to a filename safe, lowercase form of its name. Colliding tags are disambiguated by dimensions. The tag is sanitized server side so a hand edited value can't reach a filename raw.
- **Dimension caps.** Preset width and height are capped so a fat fingered value can't try to allocate a giant image and crash the process.

Presets come from a single catalog on the server. The ones flagged to seed are what a fresh install starts with (4K, 1440p, 1080p, YouTube thumbnail, OG/Facebook, and the three main Instagram shapes). The whole catalog, including extras like X/Twitter and LinkedIn, is offered in an "add a common size" picker. The catalog ships to the UI rather than being duplicated there.

Depends on `sharp` (image work, ships prebuilt binaries), `smartcrop-sharp` (the crop heuristic), and `chokidar` (folder watching). All widely used, none phone home.

## QR codes

Fully local QR generation. The front end builds the encoded string per type (a URL, a `WIFI:` string, a vCard, a `mailto:`, and so on) and posts it to one stateless route that renders it. PNG goes through `sharp` so an optional center logo can be composited in. SVG is emitted directly, which is the right format for print, but it can't carry a raster logo, so the logo option is PNG only and the UI disables SVG when a logo is set.

When a logo is used, error correction is forced to the highest level so the covered modules stay recoverable. This was checked by decoding generated codes back: a logo'd code still scans to the exact original content.

Why local matters here specifically: many free online QR generators encode a redirect through their own domain instead of your content, which leaves them able to expire, throttle, track, or start charging for a code you already printed. A code made here holds your content directly.

It's the simplest module: no saved config, no enable toggle, always available. Content length, output size, margin, colors, and logo size are all capped server side. Depends only on `qrcode` (encoding only), and reuses the already present `sharp` for logos.

## Privacy as a hard constraint

Refrain sends data only to services the user configures. There is no telemetry, no analytics, no update check that leaks usage, nothing phoning home to any project controlled server. This is stated plainly in the README because churches reasonably care, and it's a checkable claim as long as it stays true. Treat it as a constraint on every future change, not a marketing line.

## What deliberately isn't extensible

Being thoughtful about what shouldn't be a plugin matters as much as the plugin system itself. An interface for everything, including things that never vary, just adds indirection.

- The ProPresenter integration stays fixed. It's the product, not a data source you'd swap.
- The core substring search stays fixed. It doesn't vary between churches. A fuzzier search would be a direct upgrade, not a slot left open now.
- The lyrics site list stays a plain config array. There's no per site behavior, just a domain string.

## Not in scope: downloading from YouTube

Frequently requested, deliberately declined. It depends on a fragile external program that chases YouTube's changes, and downloading and redistributing someone else's content is a legal call each church makes for itself, not something this project should bundle and implicitly endorse. The README points users to standalone, actively maintained tools they run separately. Keeping it out is part of what keeps the privacy and "bundles nothing legally fraught" posture intact.

## Distribution and launch

The repo ships double click launchers (`scripts/start.command` on Mac, `scripts/start.bat` on Windows) that install dependencies on first run, start the server, and open the browser, so a non technical volunteer never touches a terminal. On the first run a setup screen collects the ProPresenter host, port, and machine role, then triggers the initial index build.

The server binds to localhost only, since each person runs their own copy and there's no need for one machine's instance to be reachable from another's browser. This can't become a hosted product, because the value depends on talking to ProPresenter's local API on the same network. Self hosted per church is inherent to the problem, not a limitation to fix.
