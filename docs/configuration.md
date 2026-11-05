# Configuration

Most settings are on the **Settings** screen. Everything it saves lands in two
files in the Refrain folder, both kept out of Git and out of every download:

- **`config.json`**: preferences. `config.example.json` shows its shape. Refrain
  writes it atomically (a temporary file, then a rename), so a crash can't leave
  it half written. **Settings › Features › Options › Back up config** downloads
  a copy.
- **`.env`**: secrets, such as passwords and API keys. `.env.example` lists the
  names. Edit them in **Settings › Features › Options › Secrets (.env)**, which
  keeps the previous file as `.env.previous`.

Refrain reads both when it starts. After editing either by hand, restart it.

## The Settings screen

| Tab | What's there |
|---|---|
| **Status** | What's on the screens, and a health check: ProPresenter link, the status feed, performance mode (**Turn on** / **Turn off**), the search index (**Refresh**), any feature that is set up wrong, and a **Refrain's folder** warning when this account can't use the copy it is running (see [several accounts on one Mac](install.md#several-accounts-on-one-mac)) |
| **Search** | Libraries to search, the Search index card, Arrangement drift tracking folders (when that feature is on), and Advanced (Protect ProPresenter) |
| **Features** | A switch for each optional feature, and Options: ProPresenter, Search & indexing, Lyrics, Secrets (.env), plus QR codes, Arrangement tracking and Day summary while those features are on |
| **System** | Index notices, Stop and Restart Refrain, ProPresenter connection (**Diagnose**), Updates |
| **More › Phones** | Open the Phone panel, Slide pictures |
| **More › Customize** | Theme, which side the menu sits on, keyboard shortcuts, the command for a window of its own, the welcome card, Start at login |
| **More › Telemetry** | The service feed to your own announcement server |
| **More › Audit** | Read-only reports: presentation names used in more than one library, entries not on your preferred arrangement, decks using a different theme from the rest of their library, and unused media in ProPresenter's Media folder (Refrain never deletes anything) |

Themes are System, Light, Dark and Blackroom. Refrain is designed for a dark
booth; Light gets the same colours, contrast and indicators but not the machined
look.

## Feature switches

Search, Quality Control and Now are always on. Everything else is a switch on
**Settings › Features**. A feature that is off has no screen, and its routes
answer "switched off". In `config.json` the switches are the `features` block,
and a feature left out follows its default.

| `features` id | Settings label | Default |
|---|---|---|
| `messages` | Messages | on |
| `safe-slides` | Safe slides | off |
| `requests` | Staff requests | off |
| `macros` | Macros | off |
| `looks` | Looks | off |
| `slide-flags` | Flags | on |
| `service` | Service day | on |
| `lyrics-assist` | Lyrics | off |
| `qr-code` | QR Codes | off |
| `image-crop` | Image Crop | off |
| `scripture` | Scripture | off |
| `arrangement` | Arrangement tracking | off |
| `probundle` | Bundles | off |

```json
"features": { "looks": true, "macros": true, "qr-code": true }
```

Three things are switched on in their own place rather than here: phones (the
Phone panel, `networkModule.enabled`), sending the day summary
(`reportModule.enabled`) and the service feed (`serviceFeedModule.enabled`).

Each optional part reports **off**, **misconfigured** or **active**. A missing
folder or credential makes it misconfigured, with a sentence on Settings › Status
saying what's missing. It never stops Refrain starting or takes another feature
down.

## config.json

Defaults are what Refrain uses when a key is missing. "On unless false" means
the setting is on unless it is set to `false`.

### General

| Key | Default | What it is |
|---|---|---|
| `propresenter.host`, `propresenter.port` | `localhost`, `1025` | Where ProPresenter's API is |
| `role` | `reader` | `logger` on the machine that runs ProPresenter live, `reader` elsewhere |
| `theme` | `dark` | `system`, `light`, `dark` or `blackroom` |
| `welcomeDismissed` | `false` | Stop showing the welcome card |

### Search and indexing

| Key | Default | What it is |
|---|---|---|
| `librarySync.folders` | `null` | Library folders to index; `null` is all of them |
| `librarySync.crawlPlaylists` | `false` | Also record playlist membership (slow) |
| `preferredArrangements` | `["FS", "T"]` | Which arrangement of each song to index, in order |
| `autoReindex` | on unless false | Reindex a presentation a few seconds after it is saved |
| `indexFromFiles` | on unless false | Read `.pro` files rather than the API when ProPresenter is on this Mac |
| `protectProPresenter` | on unless false | Never read presentations from the API in bulk |
| `searchLibrariesOff` | `[]` | Libraries switched off in Search's filter |

See [the search index](indexing.md).

### Now and phones

| Key | Default | What it is |
|---|---|---|
| `liveModule.hiddenMacros`, `liveModule.hiddenMessages` | `[]` | Hidden on Now |
| `liveModule.stageMessages` | the three presets | Stage message presets |
| `liveModule.safeSlides` | `[]` | Safe slides |
| `liveModule.requestMessageId` | none | Which ProPresenter message staff requests go into; otherwise the first with a text field |
| `networkModule.enabled` | `false` | Phones on |
| `networkModule.host`, `networkModule.port` | `0.0.0.0`, `9997` | Where the phone page listens |
| `networkModule.pin` | `daily` | `daily`, a fixed 4 to 8 digit PIN, or empty for none |
| `networkModule.pinHint` | none | The sign-in screen's line about where to find the PIN |
| `networkModule.phoneGoLive` | `false` | Let phones go live |
| `slidePictures.quickSlides` | on unless false | The safe slide keys show the slide drawn, or `false` for its name |
| `slidePictures.flagged` | on unless false | Ask ProPresenter for a picture of a flagged slide Refrain can't draw |

See [phones](phones.md).

### Day, flags and the summary

| Key | Default | What it is |
|---|---|---|
| `serviceModule.schedule` | `[]` | Weekly services: `{ "day", "time", "name", "playlistMatch" }` |
| `serviceModule.leadMinutes`, `trailMinutes` | `15`, `150` | How long before and after its start a service is watched |
| `serviceModule.phases` | `null` | Your own checklist |
| `serviceModule.folder` | `null` (uses `./data/service-days`) | Where day records go; can be a synced folder |
| `serviceModule.summaryFolder` | `null` | Also save each summary here |
| `serviceModule.autoEnd` | off; 120 and 15 minutes | End the day on its own |
| `slideFlagsModule.folder` | `null` (uses `./data/slide-flags`) | Where flags go; can be a synced folder |
| `slideFlagsModule.types` | the built-in list | Your own flag types |
| `slideFlagsModule.keepResolvedDays` | `14` | When resolved flags drop off the list |
| `reportModule.enabled` | `false` | Send the day summary |
| `reportModule.deliveryBackend` | `email` | `email` or `folder` |
| `reportModule.recipients` | `[]` | Email addresses |
| `reportModule.folder` | `null` | For the folder backend |
| `reportModule.requireReview` | `true` | When `false`, a manual End sends straight away |
| `serviceFeedModule` | off | See [the service feed](service-feed.md) |

See [Now, Day and Flags](service.md).

### Prep tools and arrangements

| Key | Default | What it is |
|---|---|---|
| `spellcheckModule.allowlist` | `[]` | Ignored words |
| `lyricsSites` | five sites | Up to five, from Refrain's list |
| `slideSplitter` | `blank-line-delimited` | Default splitter for Lyrics |
| `scriptureModule.biblegatewayVersion` | `NIV` | |
| `scriptureModule.blueletterTranslation` | `KJV` | Fallback for versions Blue Letter Bible lacks |
| `imageCropModule.inputFolder`, `outputFolder` | set when switched on | Image Crop's folders |
| `imageCropModule.presets` | five screen sizes | Crop sizes |
| `qrCodeModule.defaultBaseUrl`, `defaultLogoUrl`, `defaultSize` | none | QR defaults |
| `qrCodeModule.recentLimit` | `20` | Recent codes to keep, 0 to 100 |
| `arrangementModule.provider` | `manual` | `manual` or `planning-center` |
| `arrangementModule.storageBackend` | `local-folder` | `local-folder` or `synced-folder` (`firestore` and `sftp` are listed but are stubs) |
| `arrangementModule.localFolderPath` | `./data/arrangements` | The history folder |
| `arrangementModule.folders` | `null` | Library folders to track; `null` is all |
| `arrangementModule.planningCenterServiceTypeId` | `null` | |
| `probundleModule.packsDir` | `null` | Bundles' packs folder |

## .env

| Name | For |
|---|---|
| `PLANNING_CENTER_APP_ID`, `PLANNING_CENTER_SECRET` | Arrangement tracking with Planning Center, on the logger |
| `SMTP_HOST`, `SMTP_FROM` | Emailing the day summary (both required) |
| `SMTP_PORT` | Default 587 (STARTTLS); 465 for implicit TLS |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | If your mail server needs a login |
| `SERVICE_FEED_TOKEN` | The key your announcement server issued for this console |

`.env.example` also lists names for the unfinished Firestore and SFTP backends,
and `PROPRESENTER_API_KEY`, which nothing reads yet.
`PORT`, set in the environment rather than `.env`, moves Refrain off 9999.

## What Refrain writes to disk

Everything stays in the Refrain folder unless you point a setting elsewhere.

| Where | What |
|---|---|
| `cache/search-index.json` | The search index |
| `data/service-days/` | Each day's records and summaries |
| `data/slide-flags/`, `data/flag-pictures/` | Flags, and their pictures |
| `data/slide-pictures/` | Slide pictures, redrawn when more than 20 hours old |
| `data/known-good.json` | Changed songs' remembered group order |
| `data/arrangements/` | Arrangement history (Local Folder) |
| `data/image-crop/` | Image Crop's default folders |
| `data/qr-history.json` | Recent QR codes |
| `data/remote-secret.json`, `data/remote-devices.json`, `data/phone-golive-log.json` | Phones; readable only by the account running Refrain |
| `data/probundle-packs/`, `data/probundle-staging/` | Bundles and the MCP server (the packs folder holds `themes/`, the theme library and which themes are ticked) |
| `data/diagnostics/` | A line a minute of timings and counts, the ProPresenter calls that were slow, and the name and times of each item that went live (no slide words), kept 14 days |
| `data/service-feed/`, `data/staff-requests/` | What the service feed has sent, and which staff requests were handled |
| `data/*-pending/`, `staging/` | Writes waiting to reach a shared folder or storage backend |
| `logs/` | Output when Refrain runs at login |

The diagnostics exist so that after a bad Sunday there is a record of what
Refrain was doing. Nothing reads them but you, unless you turn on the [service
feed](service-feed.md), which sends them to your own server.
