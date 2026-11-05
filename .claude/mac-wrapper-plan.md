# Plan: Refrain on the Mac, the wrapper and what comes after it

Status, 2026-11-04: **Phase B (Refrain.app) is on main** (PRs #57, #58), and
updates rebuild it (step 1's last part). Owner, 2026-11-04: steps 1 to 3
approved; Phase A starts after the `drawn-only` branch merges, which changes
the same heartbeat and live-page code. Everything else here is a proposed
next step. Not yet the handoff.

There is nothing to branch. Windows keeps using the Chrome or Edge app window
from the README, on the same code. The Mac gets an optional native window
plus macOS-only features behind their own switches.

## Done: Phase B, Refrain.app

- `mac/Refrain/`: `Routing.swift` (pure rules: what stays in the window, what
  goes to the browser, where a download lands), `WebController.swift`
  (WKWebView, alert/confirm/prompt sheets, file picker, downloads, the
  not-running page, and a title bar that follows the theme), `AppDelegate.swift`
  (window, menus, Keep on Top), `main.swift`, `Info.plist`.
- `scripts/build-mac-app.command` builds with the Command Line Tools only,
  takes the port from the Start at login job, makes the icon, signs ad hoc
  and installs to ~/Applications.
- **Checked:** 22 checks in a scratch harness that compiles the app's own
  `Routing` and `WebController` and drives them against the live server: the
  routing rules, every screen loading, `confirm()` OK and Cancel through a real
  sheet, the title bar for dark and light (this caught the light theme's
  colour being `oklch()`, which a plain `rgb()` parser missed), and the
  not-running page recovering once a server appears. The built app was also
  launched and captured: 455×932, the dark title bar matching the page.
- **Not tried by hand:** a QR download, the Bundles file picker, the Copy
  buttons, external links opening the browser (the rule is tested, the
  click isn't), Keep on Top, and a full service docked beside ProPresenter.
- **Not measured:** memory or energy against Chrome. The app process is 96MB.
  WebKit's helper processes are shared with Safari and other apps, so their
  share needs a booth Mac with nothing else open.
- The harness lives in the session scratchpad. Turning it into
  `mac/Tests/` is a small next step if the app is kept.

## Next steps, in order

| # | Step | Size | What it gets | Platforms |
|---|---|---|---|---|
| 1 | **Hand-check the app** on the booth Mac: the untried items above, then one Sunday docked beside ProPresenter, with Chrome closed. Then have the in-app update rerun the build script when `mac/` changes | an hour, then a service, then half a day | Confidence before it replaces Chrome, and no stale app after an update | Mac |
| 2 | **Phase A: push the live feed.** Live-check the ProPresenter stream with rehearsal content, then stream into the heartbeat and SSE to the page | 1 to 2 days plus the live check | Most of the battery and wakeup savings: ProPresenter calls fall to roughly zero when nothing changes, and the 2 to 5 second page polls stop | Both |
| 3 | **Platform field on features** (`platforms: ["darwin"]`) | half a day, with tests | Lets steps 4 and 6 ship as macOS-only switches without hardcoding ids | Both (Windows shows them locked) |
| 4 | **Phase C: words in pictures, in Quality Control.** A `refrain-vision` helper plus `server/image-text.js` | 1 to 2 days | Past dates and typos inside announcement graphics, which no check sees today (700 images with text, 21 with dates) | Mac |
| 5 | **Phase C, part two: search the words in pictures** | 1 day | 852 slides in 130 decks become findable | Mac |
| 6 | **Phase D experiment: listen for the song.** Record two minutes of rehearsal from the board, measure offline. Go or stop | half a day once there's a recording | Decides whether speech-to-lyrics is worth building at all | Mac |
| 7 | Phase D build, only if 6 says go: self-signed signing so permissions survive rebuilds, then the Listen module | several days | Suggestions for an unplanned song or a repeated bridge, with spoken scripture as a likely easier win | Mac |
| 8 | Smaller native extras, each only if measured worth it: Vision crop with face detection, occlusion-aware polling, a menu bar lamp | each about a day | Better crops and no `sharp` install failures, fewer wakeups when hidden | Mac |

Steps 2 and 3 are independent and can run at the same time. Step 4 needs step
3. Step 5 needs step 4. Step 7 needs step 6's go. Step 8 doesn't block
anything.

## What was checked (2026-11-04, on this Mac)

**The ProPresenter status stream exists and works on 21.3 (API v1).**
`POST /v1/status/updates` with a JSON array of endpoint names returns HTTP 200
and keeps the connection open, sending newline-separated JSON objects shaped
`{"url": "<endpoint>", "data": …}`. It first sends one snapshot of each
endpoint asked for, then pushes updates. Seen in an 8-second run with nothing
live:

- `presentation/active` → `{"presentation": null}`
- `status/layers` → the same object `GET /v1/status/layers` returns
- `presentation/slide_index` → `{"presentation_index": null}`
- `timer/system_time` → pushed again while the stream was open
- `status/slide` → sent nothing while nothing was live

**Not verified:** that slide changes, layer changes and presentation changes
are pushed when they happen. Checking that means putting rehearsal content on
the screens, which I did not do without asking. That run is the first task in
Phase A.

**The current UI runs in WKWebView without changes.** A scratch Swift probe
(`wkprobe.swift` in the session scratchpad, not in the repo) loaded the dev
server in a real WKWebView at 455×900 and visited every rail screen: search,
spellcheck, service/live, prep/probundle and settings. It found:

- 0 JS errors, unhandled rejections or `console.error` calls.
- The rail is 48px and `position: fixed`, the content margin is 48px, and
  nothing scrolls sideways. All of these match Chromium exactly.
- The snapshots look the same as the Chrome window.

The probe only navigated. It did not press anything, so dialogs, downloads,
file pickers and the clipboard were not exercised. Phase B covers those below.

**Polling today.** With a window open, the page polls on five timers: live
readout every 2s, return bar every 3s, status cluster every 4s, history every
4s and service every 5s. Live adds requests at 3s and a paint tick at 1s.
Every poll also keeps the server's heartbeat at its fast 4-second pace (two
ProPresenter calls per beat; see `server/heartbeat-pacing.js`). A window
docked beside ProPresenter is never hidden, so none of this is throttled.

**Memory (one sample, not a benchmark).** ProPresenter: 1.2GB RSS and 38% CPU
with nothing live. Node server: 65 to 126MB. Chrome's share can't be separated
on this Mac because it is also the everyday browser. ProPresenter dominates the
machine whatever Refrain does.

## Phase A: push the live feed (shared, both platforms)

1. **Live check of the stream** with rehearsal content, away from a service:
   does each slide change, clear and new presentation arrive as an event, and
   how fast? What happens to the stream when ProPresenter quits or restarts
   (end of stream, error, or silence)? Write the results into
   `docs/propresenter-verification.md`, as the other endpoints are.
2. **`subscribeStatus(endpoints, onEvent)` in `server/propresenter-client.js`.**
   It uses `fetch` with a streamed body and splits on newlines, keeping any
   partial line across chunks. Reconnect with backoff. Pure line-splitting
   goes in its own function with tests in `test/`: a chunk ending mid-object,
   two objects in one chunk, blank keep-alive lines.
3. **The heartbeat follows the stream.** Events drive the same `liveState`
   update `heartbeat()` already makes. The timed beat stays as the liveness
   check and the fallback, at its idle pace while the stream is healthy, and
   drops back to today's behaviour if the stream fails or isn't supported.
   Performance mode keeps reading layers exactly as it does now, just from the
   event. Co-locate the new pacing rule in `heartbeat-pacing.js` with a test.
4. **Server to page: one SSE endpoint** (`/api/live/events`, say) that sends
   `liveState` when it changes. `live-readout.js`, `return-bar.js`,
   `status-cluster.js` and `history-flyout.js` subscribe through one shared
   `EventSource`, and each keeps its poll as a fallback if the connection
   drops. Count an open SSE connection as a browser being present, the way
   `lastClientAt` counts a poll now.
5. **Measure before and after** on a quiet booth Mac: ProPresenter requests per
   hour with a window open, and wakeups (`top -stats pid,command,cpu,idlew,power`)
   for Node and the window's web process.

Risk to watch: a long-held connection to a live production tool. If step 1
shows the stream misbehaving when ProPresenter is busy, Phase A stops there and
the polling stays.

## Phase B: Refrain.app (macOS only). Built 2026-11-04, design kept for reference

### What it is

- An AppKit app with one `NSWindow` holding a `WKWebView` pointed at
  `http://127.0.0.1:<port>`, with `NSAllowsLocalNetworking` in Info.plist.
  As built, the port comes from `--url`, then the `RefrainURL` user default,
  then the Start at login job's `PORT` (read by the build script), then 9999.
- It remembers its frame and has no minimum width, so it docks at about 455px
  beside ProPresenter, as the Chrome app window does today.
- It does not start Node. The existing **Start at login** LaunchAgent owns the
  server. If the port doesn't answer, the app shows a native "Refrain isn't
  running" page with a Start button that runs the same launchctl kickstart
  `server/panic.js` already builds.
- No update check and no network access except localhost. The no-telemetry
  rule applies to the app too.

### Parity work the scan turned up (the real work in Phase B)

| Page uses | Where | WKWebView needs |
|---|---|---|
| `confirm()` | `arrangement.js:324`, `arrangement.js:749` | A `WKUIDelegate` confirm panel. **Without one, `confirm()` silently returns false**, so "Overwrite it with this computer's data?" could never be accepted. |
| `window.open`, `target="_blank"` | lyrics-assist, scripture, health | `createWebViewWith` → open in the default browser with `NSWorkspace`. |
| `<a download>` | health, qr-code | `WKDownloadDelegate`, saving to ~/Downloads. |
| `<input type="file">` | qr-code, probundle | `runOpenPanelWith` → `NSOpenPanel`. |
| `navigator.clipboard` | five screens | Works from a user gesture; test each Copy button. |
| `dataTransfer` drag | live.js | Inside the page, should work; test it. |
| `localStorage` | fold states, dismissed notices | Not carried over from Chrome. These reset once, which is harmless. |

### Optional native extras, only if measured worth it

- When the window is fully hidden behind another, the app tells the page so the
  page can slow its polling. Chrome can't report this for a docked window.
- A menu bar item with link and live lamps, read from the same SSE feed.
- Snapping beside ProPresenter's window.

Deliberately not in Phase B: moving FSEvents, process watching, image crop or
spell check out of Node. Each moves logic out of the shared core and would make
Windows drift. Revisit one at a time only if a measurement says it matters.

### Size

Roughly 300 to 500 lines of Swift: the window, the four delegates, the
not-running page and Info.plist. Most of the time goes on testing every screen
and flow in WebKit, not on writing code.

## Phase C: the breakthrough, reading the words inside pictures

### Why this one

Most of what Swift could do here, Node already does about as well. Watching
files, decoding `.pro` and hashing files are no faster natively by any amount
that matters. The exception is anything Apple's on-device frameworks do that
has no good Node equivalent. Vision's text recognition is the clearest one:
it is built into macOS, runs on the Neural Engine, needs no model download and
sends nothing anywhere. The Node alternative, tesseract.js, is a large
dependency and is slower and less accurate.

It matters because **every check Refrain runs is blind to text inside an
image.** `findPastDates` and `findTypos` read only text boxes. An announcement
graphic that says "Game night Friday, June 27" as part of the picture is
exactly the stale slide `server/stale-dates.js` exists to catch, and today it
can't. The same goes for a typo in a designed graphic, which is the costliest
kind to fix on a Sunday morning because it means going back to the designer.

### What was measured (2026-11-04, this MacBook, Vision via `ocrprobe.swift`)

- Random sample of 100 of the 1,649 images in `~/Documents/ProPresenter/Media`:
  45 hold readable text (12 or more characters).
- Accurate mode: 141ms per image on average, 593ms at most, 14.1s for 100.
  Fast mode: 36ms on average, 3.6s for 100, finding text in 43 of the 45.
- Whole library, accurate mode: 1,645 images read (4 couldn't be opened) in
  213s, 129ms each on average. 700 hold readable text. 21 hold a month-name
  date ("Aug 3" style, spread across nine months), which today's checks can't
  see. Not yet known: how many of those 21 are on presentations still in use,
  or are actually past. The scan answers that per playlist, which is the
  point. A first run is a one-off of about 3.5 minutes. After that, only new
  or changed images are read.
- **It asks ProPresenter for nothing.** The images are files on disk, so it
  costs no API calls, which matters more here than any speed figure.

The probe printed only counts, timings and the matched date strings, never
the recognised text.

### The change (small on both sides)

1. **`helpers/refrain-vision.swift`**, about 80 lines, built by
   `scripts/build-mac-app.command` alongside the app. It's a command-line tool:
   it reads image paths on stdin and writes one JSON line per image (path,
   size, mtime, recognised lines with their confidence). Read-only, with no
   network access and no privacy permissions.
2. **`server/image-text.js`**, which runs the helper with `execFile` in
   batches and keeps `cache/image-text.json` keyed by path, size and mtime. It
   is a cache, not a record, written temp-then-rename like `thumb-store.js`.
   Pure functions for matching cache entries get tests. It runs only while
   performance mode is off, because Vision uses the GPU and Neural Engine that
   ProPresenter is drawing with.
3. **Quality Control scan** (`server/index.js`, the loop near
   `findPastDates`). It already decodes each `.pro` and gets each slide's media
   refs from `slideMediaRefs`. For each image on a slide it looks up the cached
   text and runs the same `findPastDates` and `findTypos` on it. Findings are
   marked "in the picture" so the person knows the fix is in the graphic, not
   in a text box. On Windows, or with the helper not built, the scan says
   "couldn't read pictures" and never shows that as a pass, the rule
   service-checks already follows.
4. **Module status** comes from `getImageTextModuleStatus(config)` in
   `server/config.js`, with Health messages: off, or misconfigured when the
   helper isn't built, isn't macOS, or the Command Line Tools are missing.

Core search is untouched. Nothing in it reads the image text, so the first
of the three invariants holds by construction.

The recognised text can include real names (a staff photo caption, a baptism
graphic). It stays in `cache/`, which is gitignored, and never goes into logs,
`diag()` lines, test fixtures or the day summary. Tests use invented images.

### Next, once the scan has proved itself

- **Search the words in pictures**, as a separate, clearly labelled result
  group that appears only while the module is active. Keep it out of
  `search-index.js` so core search never depends on it. Measured against the
  live index (`/Users/Shared/Refrain`, 668 presentations, 32,550 slides,
  2026-11-04):
  - 9,145 slides (28%) have no words for search to find. 7,446 of those
    show an image, 465 show a video, and 1,234 show neither (blanks and
    shapes).
  - Those image slides use 475 different images on this Mac. Vision reads text
    in 232 of them, in 51s.
  - So **852 slides in 130 decks that search can't find today would become
    findable.** Images missing from this Mac weren't counted, and neither
    were the 465 video slides.
  - Pictures repeat: the top five readable images cover 43, 39, 36, 28 and 22
    slides. Results need grouping by picture ("on 43 slides in 6 decks"), or
    one graphic fills the results list.
  - Designed lettering misreads more than text boxes do. Label these results
    "words in the picture", and let the existing typo-tolerant matching
    absorb the misreads.
- **Announcement videos** (365 on this Mac): `AVAssetImageGenerator` takes a
  few frames from each loop, and the same OCR runs on those.
- **Image crop with Vision.** Use saliency plus face rectangles in place of
  smartcrop. `server/image-crop.js` already names face detection as the
  planned upgrade, and it would end the `sharp` native-module install
  failures on Macs. It is second because it improves a crop, where OCR finds
  a problem nobody can see today.

## Phase D: listen for the song (speech to lyrics), an experiment first

### The idea

The band goes into a song that isn't on the playlist, or repeats the bridge.
Today the operator has to recognise it and type a search. With this, Refrain
listens to the board feed, turns the last few seconds of singing into words,
and puts the two or three most likely slides at the top of Search or Now. **A
person still presses Go Live.** It suggests and never fires, the same line
`remote-live.js` holds for phones.

### Checked on this Mac (2026-11-04)

- Both speech APIs are in the free Command Line Tools SDK. `SFSpeechRecognizer`
  reports `supportsOnDeviceRecognition: true` for en-US and can take a custom
  vocabulary (`SFCustomLanguageModelData`). The macOS 26 `SpeechTranscriber`
  supports 30 locales, and its English models are already installed here.
- Neither permission has been asked for yet (speech recognition status 0).
- **Not checked, and it's the question that decides everything:** how
  accurate either API is on *singing over a band*. They are built for speech.
  Sung vowels, reverb and drums make the error rate far higher than for
  dictation. Nothing on this Mac holds sung vocals to test with.

### Why it could still work when transcription is poor

It doesn't need a correct transcript, only enough words to pick one slide out
of the library. That is a much easier problem:

- Matching runs against the church's own index (38,561 slides measured in
  `stale-dates.js`), not the whole English language. Search already retries a
  typo against the library's own words ("ocenas" finds Oceans), so a window of
  eight to twelve recognised words, half of them wrong, may still pick out one
  song.
- `SFCustomLanguageModelData` can be built from the index's own lyrics, which
  biases recognition toward the words this church actually sings.
- A song already on today's playlist ranks higher, and so does the next group
  of the song that's live.

### Shape

- **Inside `Refrain.app`, not a separate helper**, because the microphone and
  speech permissions belong to an app the person opened. The app streams
  recognised words to Node over localhost, and Node matches them with the
  existing search code. The dependency points from this feature to core
  search, never the other way, so core search is unaffected.
- **On-device only, enforced.** Set `requiresOnDeviceRecognition = true`, and
  if on-device recognition isn't available the feature reports
  "misconfigured" rather than falling back to Apple's servers. Sending
  worship audio to a server would break the no-telemetry promise in spirit,
  whoever runs the server.
- **Nothing kept.** The room includes the sermon, prayers and announcements
  with names. Recognised words live in a rolling window of a few seconds, in
  memory only: never in logs, `diag()` lines, the day summary or a test
  fixture. macOS shows its orange microphone dot while it listens, and the
  rail should show a lamp too, so nobody is recorded without knowing.
- **Input:** a feed from the board through the Mac's audio interface, chosen
  in Settings. The laptop's built-in mic in a loud room is the worst case.
- **Off by default**, as its own module with a status in `server/config.js`.
  It never starts listening on its own.

### This changes the signing decision

Microphone and speech permissions are tied to the app's signature. An ad hoc
signature changes on every rebuild, so macOS would ask again after every
update. The fix that stays free: the build script creates a self-signed
code-signing certificate in the login keychain the first time it runs, and
signs every build with it. Permissions then survive rebuilds. This needs
trying, since it's the one part of the build plan that hasn't been run.

### The experiment (do this before any code)

1. Record two minutes of a rehearsal from the board feed: two songs, one
   bridge repeated. Use rehearsal audio, not a service with a sermon in it.
2. Run both APIs over the file offline, with and without a custom language
   model built from the index. Measure how often the right song is in the
   top three within five seconds of the first sung line, and how often the
   right group is.
3. **Go or stop:** if the right song isn't in the top three most of the time,
   stop there. A suggestion that's usually wrong is worse than none in the
   booth, and the plan records why so nobody tries again blind.

Separately, and likely easier: the same listening could catch a **spoken**
scripture reference ("turn with me to John 3") for the scripture module.
Speech is what these APIs are built for, so it's probably far more accurate
than singing. It's also unmeasured.

## Feature switches for C and D (owner, 2026-11-04: one each, macOS only)

Two switches on Settings › Features, both **off by default**, both marked
**macOS only**:

| Switch | Module | Covers | Needs |
|---|---|---|---|
| Words in pictures (macOS only) | `modules/image-text/module.js` | Quality Control's date and spelling checks on picture text, then the "words in the picture" search group | The `refrain-vision` helper built |
| Listen for the song (macOS only) | `modules/listen/module.js` | Speech-to-lyrics suggestions, and later spoken scripture | Refrain.app running, with microphone and speech permission granted |

### How the switches work, using what's already there

Features are declared by each module in its own `module.js` and read by
`server/features.js`, with no central list. That stays true. The one addition
is a generic platform field, so no module id is ever hardcoded:

```js
// modules/image-text/module.js
feature: {
  label: "Words in pictures",
  summary: "Read the text inside images for Quality Control and Search.",
  default: false,
  platforms: ["darwin"],
  apiPrefixes: ["/api/image-text/"],
}
```

- `moduleFeatures()` carries `platforms` through, and a new pure
  `featureAvailable(feature, platform)` says whether it can run here. Tests in
  `test/` cover: no `platforms` means everywhere, a listed platform, an
  unlisted one, and a bad value.
- `featureOn` returns false on an unlisted platform **whatever config.json
  says**. A `true` copied from a Mac's config to a Windows one must not switch
  anything on, and the route guard (`featureForPath`) refuses those
  `/api/` prefixes the same way it refuses a switched-off feature.
- Settings › Features shows "macOS only" beside the label, taken from
  `platforms`, not typed into the label, so a future Windows-only feature
  needs no new code. On Windows both rows are shown switched off and locked,
  saying "macOS only", so the Windows build tells the truth about what the
  Mac version does rather than hiding it.
- **Switch and status are separate.** The switch is the person's choice. Each
  module's `getImageTextModuleStatus(config)` / `getListenModuleStatus(config)`
  in `server/config.js` says whether it can run: off, misconfigured (helper
  not built, Command Line Tools missing, app not running, permission
  refused, on-device speech unavailable) or active. Health gives the exact
  reason. A switched-on feature that's misconfigured never takes down
  Quality Control or Search: the scan says "couldn't read pictures", and
  Search shows its normal results.
- Listen gets one more rule from its own module: switching it on never starts
  the microphone. It shows a Listen button where it's used, and listening
  stops when the app closes.
- `config.example.json`'s `_features` note gets both ids and their defaults,
  in the same change.

## Decisions that are yours

1. **Where the Swift lives: decided 2026-11-04.** `mac/Refrain/` in this repo,
   built by `swiftc` from a script, with no Xcode project, so the
   Command Line Tools are enough. CLAUDE.md's "Where new code goes" table and
   the architecture doc's layout now list it.
2. **Signing: decided 2026-11-04, no Developer ID. Each Mac builds its own
   app.** Gatekeeper only checks files that carry the quarantine flag, which
   macOS puts on downloads. An app compiled on the machine never has it, and
   the linker signs it ad hoc on its own, which is all Apple Silicon needs.
   Checked here: `wkprobe` was built with only the Command Line Tools
   (`/Library/Developer/CommandLineTools`, no Xcode), shows `Signature=adhoc`,
   has no quarantine flag, and ran. The clone at `/Users/Shared/Refrain` has
   no quarantine flag either, since git doesn't set it.
   - The build is a script, `scripts/build-mac-app.command`, run by
     double-click like the other launchers, so every Mac gets the same build
     whether a person, Claude Code or the updater runs it. It runs
     `swiftc`, assembles `Refrain.app`, signs it with `codesign --sign -`,
     and copies it to ~/Applications.
   - Each Mac needs the Command Line Tools once (`xcode-select --install`,
     free). The script checks for them and says how to get them instead of
     failing midway.
   - **Built 2026-11-04:** Update now (`/api/update`) and
     `scripts/update.command` rerun the build script when `mac/` or the script
     changed since the commit the app was built from (stamped in its
     Info.plist as `RefrainSourceCommit`), and only on a Mac that already has
     the app (`server/mac-app.js`). A failed build is a note on the update,
     never a failed update, and the next update tries again.
   - Never copy a built app to another Mac. AirDrop and downloads quarantine
     it, and Gatekeeper then blocks an unsigned app. Each Mac builds its own.
   - A rebuild changes the ad hoc signature, so macOS would forget any
     privacy permission granted to the app. The wrapper asks for none:
     loopback traffic is exempt from Local Network privacy. Keep it that way,
     or each rebuild prompts again.
3. **Whether the app should ever start Node itself.** That means bundling a
   Node binary and `sharp`'s native module inside a notarized app. It's more
   work, and it's what would finally remove the "Install Node.js" step. Phase B
   leaves this out.
4. **Order: settled for B.** The owner had the wrapper built first. For battery,
   Phase A is the next thing worth doing. It needs one live check with
   rehearsal content on the screens, which needs the owner's OK.
