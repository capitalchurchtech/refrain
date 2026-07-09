# Refrain

[![CI](https://github.com/capitalchurchtech/refrain/actions/workflows/ci.yml/badge.svg)](https://github.com/capitalchurchtech/refrain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Refrain is a small web app you run on the same machine as ProPresenter. Its headline feature is instant search across every slide in your library (the actual slide text, not just playlist and file names) with a one click "Go Live". Around that it collects the other small tools a church production team ends up needing, and it's built so your team can add the next one without rewriting anything.

It runs entirely on your own machine. Nothing is hosted for you, there is no subscription, and no data leaves your network unless you connect something to it yourself.

![Refrain search screenshot](docs/screenshot.png)

## If you're about to build your own, read this first

Every so often a church tech lead sits down to build "a little ProPresenter tool", or hands the idea to a volunteer, or asks a chatbot to do it. The feature you actually want is usually the easy part. The slow part is everything underneath it: working out ProPresenter's local API, deciding how an outside integration should plug in, building a setup screen a non technical volunteer can use, and getting the unglamorous things right (keeping secrets out of version control, writing files without losing data, coping with two machines running at once).

Refrain already did that groundwork, and it did it as a plugin system rather than one big tangle you'd have to unpick. If what you want is one more capability (a different church management integration, a new report, whatever your team keeps asking for), the fast path is usually to fork this and add a module. You don't start from a blank file and rediscover all of the above. The developer section near the bottom has the details.

## What it does

**Slide search.** Type any word and Refrain finds every slide that contains it, anywhere in your library and across playlists, then lets you send it live or open it in the editor with one click. This is the core feature and it works on its own with nothing more than ProPresenter.

**Lyrics helper.** For a song your library doesn't have yet, Refrain runs a scoped web search across lyrics sites, then helps you paste the words in and split them into slides in one step instead of breaking them up by hand.

**Arrangement tracking (optional).** Compares the arrangement your church management system planned for a song against what actually got run in ProPresenter, and can push the correction back so you stop making the same edit every week. Skippable, and it needs no setup if you don't want it.

**Image cropping.** Drop a photo in a folder and get it back cropped to every size you need at once (a slide background, a YouTube thumbnail, a square social post, whatever you set up), with smart cropping that keeps the important part of the picture in frame.

**QR codes.** Generate a scannable code for a link, a WiFi network, a contact card and more, all on your own machine, with no third party generator that could expire your printed code or start charging later.

**A real plugin system under all of it.** Church management integrations, storage backends, lyrics splitting rules, and whole new screens are all things you add as files in a folder, not core surgery. When your team hits something Refrain doesn't do yet, the answer is "add a module", not "wait for a rewrite".

## What's finished and what isn't

Being straight about this, since "plugin system" can promise more than it delivers.

Working today:

- Slide search, Go Live, Show in Editor, and the date and library filters.
- The lyrics helper and paste to slides.
- Arrangement tracking end to end, with the Manual provider (you type the arrangement in) and the Planning Center provider (pulled automatically, including the one button "compare this weekend" workflow and pushing a fix back).
- Arrangement storage on a Local Folder (single machine) or a Synced Folder (a Google Drive, Dropbox, or OneDrive folder your desktop app already keeps in sync, which is how two machines share without any server).
- Image cropping, end to end.
- QR codes, end to end.

Wired up but not finished (the interface exists, the methods currently refuse to run):

- The Firestore and SFTP storage backends. They show up in the config and the plugin system recognizes them, but their read and write methods are stubs. If you need true multi machine sharing and a synced folder won't do, finishing one of these is the next job, not a switch you can flip today. CONTRIBUTING.md describes the interface.
- Only two church management providers exist so far (Manual and Planning Center). Rock RMS, Church Community Builder, Elvanto and the rest are documented as places to plug in, not built integrations.

Not independently checked:

- Only tested against ProPresenter 7.x on the machines that built it. Other versions may need small path adjustments. See Compatibility below.

## What you need

ProPresenter, with its local network API turned on (Preferences, then Network). That's the whole requirement for search.

Everything else (a church management integration, shared storage, image cropping, QR codes) is optional and set up separately, and none of it asks you to change or restart ProPresenter.

## Large libraries

If your library runs to hundreds of presentations or playlists, a full index build can take a while, and on some setups hitting the API with lots of playlists at once can make ProPresenter itself sluggish. You can narrow what gets indexed in `config.json`:

```json
"librarySync": {
  "folders": ["Songs", "Messages"],
  "crawlPlaylists": false
}
```

Set `folders` to `null` to index every library folder. Set `crawlPlaylists` to `true` to also record which playlist each presentation belongs to, which is the slowest part of a build, so it's off by default. Search still covers every presentation in the chosen folders either way.

## Image cropping

Turn it on from the **Image Crop** screen. There's nothing to edit in a config file. The first time you enable it, Refrain makes an input and output folder for you. Drop a picture in the input folder and a few seconds later you'll have one cropped copy per preset in the output folder. The original moves into a `processed` subfolder rather than getting deleted, so nothing is lost.

It starts with a set of presets that covers most needs in one pass:

| Preset | Size | Preset | Size |
|---|---|---|---|
| 4K UHD (16:9) | 3840x2160 | Instagram square | 1080x1080 |
| 1440p / 2.5K (16:9) | 2560x1440 | Instagram portrait | 1080x1350 |
| 1080p (16:9) | 1920x1080 | Instagram story / Reels | 1080x1920 |
| YouTube thumbnail | 1280x720 | OG / Facebook share | 1200x630 |

An **Add common size** picker offers more standard sizes (X/Twitter share and header, LinkedIn, Pinterest, Facebook cover, ultrawide banner) so you never have to look up pixel dimensions, and **Add custom** covers anything else. Delete the ones you don't want. Every preset in the list becomes one output file per picture you drop.

Output files keep the original name plus a short tag so a folder of results is easy to read. `promo.jpg` comes back as `promo_yt.jpg`, `promo_in_sq.jpg`, `promo_hd.jpg` and so on, and each row shows its tag. Custom presets get a lowercase, filename safe tag made from their name.

Cropping uses [smartcrop.js](https://github.com/jwagner/smartcrop.js), which picks the most visually important region rather than blindly centering. There's no model to download and no GPU involved, and it holds up across the mix of images a church actually has: portraits, worship graphics, text heavy slides. Face detection is a possible future add for photo heavy work, not something you need to get value now.

### Make it a one drag habit

The idea is that you never open this screen day to day. You drag pictures onto a shortcut and collect the results. After you enable it, click **Open** next to the input folder, then make a shortcut to that folder:

- **macOS:** drag the input folder into the Finder sidebar under Favorites for a permanent drop target, or right click it, choose Make Alias, and move the alias to your Desktop.
- **Windows:** drag the input folder into Quick access in File Explorer, or right click it and choose Send to, then Desktop (create shortcut).

Leave Refrain running (minimized is fine). Drop pictures on the shortcut and the cropped versions show up in the output folder on their own. No clicking, no waiting on a screen. When the watcher is running you'll see a small green dot on the Image Crop icon in the sidebar, so you can tell it's live at a glance.

## QR codes

Open the **QR Codes** screen (it's always there, nothing to set up), pick a type, and a scannable code renders as you type. Download it as a PNG (with an optional logo in the middle) or an SVG, which is the better choice for print because it scales to any size with no blur.

Types covered: website link, plain text, WiFi network (scanning it joins the network, which is handy for a guest WiFi sign), contact card (vCard), email, phone, and SMS. You can set the size, colors, quiet zone, and error correction level. Adding a logo bumps error correction up automatically so the code still scans.

It all happens on your machine, and that's the point rather than a technical footnote. A lot of "free" online QR generators encode a link back through their own domain instead of your actual content, which leaves them able to expire the code, throttle it, add tracking, or start charging later. That can quietly break a code you already printed on 500 bulletins. A code made here holds your content directly, with nobody in the middle.

## Installing

You need [Node.js](https://nodejs.org) (the LTS version) and ProPresenter with its network API on (Preferences, then Network).

1. Get the code, either way works:
   - **Git** (recommended, since updating is then one command): `git clone https://github.com/capitalchurchtech/refrain.git`
   - **ZIP:** on the [GitHub page](https://github.com/capitalchurchtech/refrain), click Code, then Download ZIP, and unzip it.
2. Double click `scripts/start.command` on a Mac or `scripts/start.bat` on Windows. From a terminal it's `npm install && npm start`.
3. A setup screen opens in your browser. Point it at ProPresenter's host and port, click Test Connection, and you're in.

If you use the launcher script you don't need to touch a terminal. It installs dependencies on the first run for you.

## Updating

Your real settings (`config.json`) and secrets (`.env`) live only on your machine. Git never tracks them and a ZIP download never contains them, so an update leaves them alone.

If you cloned with Git:

1. `git pull`
2. `npm install` (picks up any new dependencies, and is safe to run when nothing changed)
3. Restart the app: close and reopen the launcher, or if it's running in a terminal, stop it with Ctrl+C and run `npm start` again.

If you downloaded a ZIP: download the latest ZIP, unzip it into a new folder, then copy your old `config.json` and `.env` into the new folder before you start it. Those two files aren't part of any download, so they only exist where you first set them up.

Either way you have to restart. The running server doesn't reload its own code or pick up `.env` changes on its own.

## Privacy

Refrain talks only to services you set up yourself: your own ProPresenter, and optionally your chosen church management API or storage backend. Image cropping and QR generation never leave your machine at all. There is no telemetry, no analytics, and no phoning home to anything the project controls. This is a real, checkable claim, and we intend to keep it that way.

## Compatibility

| ProPresenter version | Status |
|---|---|
| 7.x | The version this was built and tested against. Check exact API paths against your own version at `http://localhost:<port>/help` before you rely on anything version specific. |

## Not on the roadmap: downloading from YouTube

This gets asked a lot, so to be clear: Refrain won't bundle a YouTube or video downloader, and that's on purpose rather than a "someday". Two reasons.

First, the legal side. Downloading and re showing YouTube content generally goes against YouTube's terms of service, and the content is usually someone else's copyrighted work. That's a call each church has to make for its own content and licenses. It isn't something this project should bake in and quietly bless for everyone.

Second, upkeep. Downloaders stay alive by constantly chasing YouTube's changes. They break every few weeks and lean on a heavy external program. Wiring that in would make Refrain fragile in a way its other features aren't.

If you have a legitimate need (your own church uploads, or content you're licensed to use), the right tool is a dedicated one you run separately. It stays out of Refrain's way and gets updated far more often than we could keep up with:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp), the actively maintained standard. One command line program, no install ceremony.
- [yt-dlp-gui](https://github.com/dsymbol/yt-dlp-gui) or [Open Video Downloader](https://github.com/StefanLobbenmeier/youtube-dl-gui), friendly desktop front ends over it if the command line isn't your thing.

Keeping this out of Refrain is what lets the privacy promise above stay true.

## For developers

Refrain is built to be extended. Church management integrations, storage backends, lyrics to slide splitters, and whole new feature modules are all things you add as a file (or a small folder) that the app discovers on startup. Nothing central needs editing. Image Crop and QR Codes are both real examples of the "new module" pattern, added after launch without touching the core.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for worked examples of each kind, and [docs/refrain-architecture.md](docs/refrain-architecture.md) for how the whole thing fits together.

The stack is Node.js and Express on the server, plain JavaScript with Tailwind and DaisyUI on the front end, and Lucide for icons. There's no database anywhere. Data is plain JSON, either in memory or on whatever storage backend you pick.

If an AI coding agent is doing the work, point it at [CLAUDE.md](CLAUDE.md) first. It covers the same ground plus the specific mistakes this codebase has already had to fix.

## Not affiliated

Refrain is an independent, community built tool. It is not affiliated with, endorsed by, or supported by Renewed Vision (ProPresenter) or Planning Center.

## License

MIT. See [LICENSE](LICENSE).
