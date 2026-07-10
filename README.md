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

**Lyrics helper.** For a song your library doesn't have yet, Refrain runs a scoped web search across lyrics sites (or copies the search link so you can run it in a full browser window), then helps you paste the words in, clean up the junk that comes with a web copy (hidden characters, odd spacing, curly quotes), and split them into slides in one step instead of breaking them up by hand. It can also spot blocks that repeat word for word (a chorus written out every time) and collapse them into one slide each, with the play order laid out so you can build the arrangement.

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

### Seeing what a pastor changed

A common headache: someone says "I made an update" to a sermon-notes presentation that runs many pages, and you need to find what actually changed. Search gets you to a slide by its text, but it doesn't compare two versions of a document. For that, a diff tool is the right companion. Put the old and new text side by side and it highlights exactly what moved, got added, or got cut.

Keep sermon content on your own machine and use a tool that runs locally rather than a website you paste into (that would send the text off your network, which is the thing this whole project avoids):

- **VS Code** (free, Mac/Windows/Linux): open both files, right click one and pick "Select for Compare", then right click the other and pick "Compare with Selected".
- **Meld** (free, open source) or **WinMerge** (free, Windows only): purpose-built visual diff tools.
- **Beyond Compare** or **Kaleidoscope** (paid): polished options a lot of people like.
- Already in your tools: **Word** has Review, then Compare for two `.docx` files, and macOS ships `diff` in Terminal and FileMerge with Xcode's command line tools.

If the notes live somewhere with version history already (Google Docs, a Word file on OneDrive, anything under Git), its built-in "see version history" or "compare" is usually the fastest path of all.

## Image cropping

Turn it on from the **Image Crop** screen. There's nothing to edit in a config file. Refrain creates a default input and output folder inside its own folder up front (and pre-fills them on the screen), so you can hit **Open**, make an alias of the input folder wherever's handy, and drop pictures straight in. You can still point it at any other folders instead. Drop a picture in the input folder and a few seconds later you'll have one cropped copy per preset in the output folder. The original isn't deleted: it moves into a `processed` subfolder inside the **output** folder, so your input folder stays empty like a proper drop box and everything you'd look at (the crops and the untouched original) is in one place.

You can point the input and output at any folders you like on that screen. On a multi-user machine this follows the same logic as where you installed Refrain: if you installed it in the shared `/Users/Shared/Refrain`, the folders it makes for you are already under there, so every account can reach them. If it's in one account's `~/Refrain`, the folders live there too, which is fine when that account does the cropping. Only if you want other accounts to drop images and collect results should you move the folders to a shared spot (a `/Users/Shared` subfolder), and make sure the account running Refrain can read and write them, since that's the account whose watcher does the work.

It starts with a set of presets aimed at what a service drops straight onto a screen: a 1080p slide background and the lower-third and book graphic sizes.

| Preset | Size | Preset | Size |
|---|---|---|---|
| 1080p (16:9) | 1920x1080 | Thirds tall | 605x808 |
| Thirds square | 693x693 | Book graphic | 515x787 |
| Thirds wide | 777x502 | | |

An **Add common size** picker holds the rest (4K, 1440p, YouTube thumbnail, OG/Facebook, the Instagram shapes, X/Twitter, LinkedIn, Pinterest, Facebook cover, ultrawide) so you never have to look up pixel dimensions, and **Add custom** covers anything else. Delete the ones you don't want. Every preset in the list becomes one output file per picture you drop.

Output files keep the original name plus the preset's label, so `promo.jpg` comes back as `promo_thirds-sq.jpg`, `promo_book.jpg`, and so on. The label is the last box on each preset row and you can edit it to anything (it's cleaned up to be filename safe on save); leave it blank and it's derived from the preset name.

Cropping uses [smartcrop.js](https://github.com/jwagner/smartcrop.js), which picks the most visually important region rather than blindly centering. There's no model to download and no GPU involved, and it holds up across the mix of images a church actually has: portraits, worship graphics, text heavy slides. Face detection is a possible future add for photo heavy work, not something you need to get value now.

### Make it a one drag habit

The idea is that you never open this screen day to day. You drag pictures onto a shortcut and collect the results. After you enable it, click **Open** next to the input folder, then make a shortcut to that folder:

- **macOS:** drag the input folder into the Finder sidebar under Favorites for a permanent drop target, or right click it, choose Make Alias, and move the alias to your Desktop.
- **Windows:** drag the input folder into Quick access in File Explorer, or right click it and choose Send to, then Desktop (create shortcut).

Leave Refrain running (minimized is fine). Drop pictures on the shortcut and the cropped versions show up in the output folder on their own. No clicking, no waiting on a screen. When the watcher is running you'll see a small green dot on the Image Crop icon in the sidebar, so you can tell it's live at a glance.

## QR codes

Open the **QR Codes** screen (it's always there, nothing to set up), pick a type, and a scannable code renders as you type. Download it as a PNG (with an optional logo in the middle) or an SVG, which is the better choice for print because it scales to any size with no blur.

Types covered: website link, plain text, WiFi network (scanning it joins the network, which is handy for a guest WiFi sign), contact card (vCard), email, phone, and SMS. You can set the size, colors, quiet zone, and error correction level (defaults to a light quiet zone and low error correction, since that reads cleanly on a screen and there's no print damage to guard against). Adding a logo bumps error correction up automatically so the code still scans.

If your church always points codes at the same site and logo, set `qrCodeModule.defaultBaseUrl` and `qrCodeModule.defaultLogoUrl` on the Health screen's Configuration form (or directly in `config.json`) so the URL field and the center logo are pre-filled every time instead of retyping and re-uploading them. Either is still replaceable or clearable per code. The logo value can be a local path Refrain already serves (e.g. `img/mylogo.png`) or a full URL.

You can also set a **default QR size** (`qrCodeModule.defaultSize`, on the same form) to the pixel size your screen layout expects. The screen then starts at that size, so a code you make drops onto the screen at the right size with no resizing. It's still adjustable per code.

Every code you download is saved to a **Recent codes** strip at the bottom of the screen. Click any one to bring back its type, content, and appearance so you can re-download it or tweak it, no retyping. A large uploaded logo isn't kept (it would bloat the history), so restoring one of those brings back everything except the logo, which you re-add. Clear the whole strip any time with the Clear button. How many to keep is up to you: set `qrCodeModule.recentLimit` on the Health screen's Configuration form (or in `config.json`), from 0 (turn the strip off) up to 100, defaulting to 20.

It all happens on your machine, and that's the point rather than a technical footnote. A lot of "free" online QR generators encode a link back through their own domain instead of your actual content, which leaves them able to expire the code, throttle it, add tracking, or start charging later. That can quietly break a code you already printed on 500 bulletins. A code made here holds your content directly, with nobody in the middle.

## Appearance

The icon near the bottom of the sidebar cycles the theme: System, Light, Dark, and Blackroom. Dark uses high-contrast text so it stays readable on a plain (non-retina) booth monitor. Blackroom is a true-black, high-contrast option that's easy on the eyes in a dark room and looks good on an OLED screen. Your choice is remembered.

## Installing

You need Node.js and ProPresenter with its network API on (Preferences, then Network).

### Installing Node.js

Get it from [nodejs.org](https://nodejs.org) and pick the **LTS** build, the one the site labels "Recommended for Most Users". LTS stands for long term support, which is the stable line. Don't grab the "Current" build, since that's the bleeding edge and you don't need it.

On a Mac the simplest route is the `.pkg` installer from that page: double click it and click through, no terminal involved. (If the machine already uses Homebrew, `brew install node` works too, but the installer is easier for a shared booth machine.) On Windows, use the `.msi` installer from the same page.

Any LTS release from Node 18 onward works. If you're installing fresh, just take the newest LTS. You can confirm it worked by opening Terminal and running `node -v`.

### Where to put Refrain

Put the folder somewhere stable that belongs to the same user account that runs ProPresenter, so the login item in the next section can start it. A plain folder in your home directory is the easy answer:

- **macOS:** `~/Refrain` (that is, `/Users/<your-account>/Refrain`).
- **Windows:** `C:\Refrain` or a `Refrain` folder inside your user folder.

Two things to avoid. Don't put it on the Desktop or in Downloads, where it's easy to drag by accident or get swept up in a cleanup. And don't put it inside a synced folder like iCloud Drive, Dropbox, OneDrive, or Google Drive. Refrain writes a lot of small files (the search index and the installed dependencies), and syncing all of that is wasteful and can cause file lock errors. On a Mac, note that if you have iCloud's "Desktop and Documents" syncing turned on, then `~/Documents` counts as synced too, which is another reason the plain `~/Refrain` location is the safe pick.

**On a machine with several user accounts:** Refrain saves its settings, index, and dependencies inside its own folder, so the folder has to be writable by whoever runs it and reachable by the account that runs ProPresenter. If only one account operates the booth, the `~/Refrain` above is still the simplest choice. If several accounts run ProPresenter on the same machine and all want Refrain, install it once in a shared spot instead: on macOS that's `/Users/Shared/Refrain`, which every account can read and write. One shared install means one set of settings, which is what you want anyway since it's one machine and one ProPresenter. Each account that should start it on login adds its own Login Item pointing at `/Users/Shared/Refrain/scripts/start.command`. Only one copy should run at a time (it uses a local port), which is normally fine since one account is active at the booth at once. Skip `/Applications` here: it needs admin rights to write to, and Refrain needs to write into its own folder.

### Getting the code and starting it

1. Get the code into that folder, either way works:
   - **Git** (recommended, since updating is then one command): `git clone https://github.com/capitalchurchtech/refrain.git`
   - **ZIP:** on the [GitHub page](https://github.com/capitalchurchtech/refrain), click Code, then Download ZIP, and unzip it into the folder you chose.
2. Double click `scripts/start.command` on a Mac or `scripts/start.bat` on Windows. From a terminal it's `npm install && npm start`.
3. A setup screen opens in your browser. Point it at ProPresenter's host and port, click Test Connection, and you're in.

If you use the launcher script you don't need to touch a terminal. It installs dependencies on the first run for you.

**Do you need Git?** Only if you choose the Git option above. The ZIP download needs no Git, and nothing else does either: the launcher only runs Node, and the dependencies all come from the npm registry. The upside of Git is that updates become a single `git pull` instead of re-downloading and copying files by hand, which is worth it on a machine you'll update now and then. To install it: on macOS, type `git --version` in Terminal and, if it's missing, accept the Command Line Tools prompt that appears (you don't need full Xcode), or run `xcode-select --install` to trigger it directly. On Windows, use the installer from [git-scm.com](https://git-scm.com/download/win) with its defaults.

### Starting it automatically on reboot

There are two different things here, and they need different setups.

For an easy way to start Refrain by hand, make an alias of the launcher: right click `scripts/start.command`, choose Make Alias, and drop the alias on the Desktop, in the Dock (the right side, near the Trash), or in the Finder sidebar. That's a one click manual start. It does nothing on its own after a reboot, though, since nobody is there to click it.

For it to come back on its own after a reboot, add a Login Item. On macOS: System Settings, then General, then Login Items, then add `scripts/start.command` (or the shared path, `/Users/Shared/Refrain/scripts/start.command`). It now starts whenever that account logs in. The one catch is that Login Items run at login, not at boot, so after a restart Refrain only comes back once someone logs into that account. On a booth machine that should recover by itself after a power blip or an update, also turn on automatic login for the booth account (System Settings, Users & Groups, "Automatically log in as"). Then a reboot leads to auto login, the Login Item fires, and Refrain is back with no one touching it.

Two notes. The launcher opens a Terminal window and the server runs inside it, so don't close that window: closing it (or quitting Terminal) stops Refrain, and macOS will usually warn you first with a "terminate running processes" prompt. To get it out of the way without stopping it, minimize the window (Cmd+M) or hide the app (Cmd+H). And on a machine with several accounts, the Login Item is per account, so set it up on whichever account runs the booth.

On Windows the equivalent is a shortcut to `scripts/start.bat` placed in the Startup folder (press Win+R, type `shell:startup`, and drop the shortcut there).

### Running it with no Terminal window (macOS)

If you'd rather not have a Terminal window sitting open at all, run Refrain as a background service with `launchd`. It stays running with nothing to keep open or close by accident, starts at login, and relaunches itself if it ever crashes.

Double-click `scripts/install-launchagent.command`. It finds your Node install, writes a LaunchAgent pointed at wherever you put Refrain, and starts it. From then on Refrain runs quietly in the background, and its output goes to `logs/refrain.out.log` and `logs/refrain.err.log` in the Refrain folder if you ever need to check on it. To undo it, double-click `scripts/uninstall-launchagent.command`.

Two things to know. If you'd already set Refrain up with `start.command` or a Login Item, remove that after installing the service so two copies don't run at once. And a LaunchAgent still only starts once the account logs in, so for a hands-free recovery after a full reboot, turn on automatic login for the booth account as described above.

## Updating

Your real settings (`config.json`) and secrets (`.env`) live only on your machine. Git never tracks them and a ZIP download never contains them, so an update leaves them alone. That includes anything you customized: your crop presets and their labels, QR defaults, folder paths, and the rest all live in `config.json`, so an update never resets them. The flip side is that the new default presets that ship with an update only appear on a fresh install; on an existing machine you add any you want from the "Add common size" picker, which always reflects the latest version.

**The easy way (Git installs):** the Health screen has an **Updates** section that shows your installed version next to the latest one, with an **Update now** button that fetches the latest code and installs any new dependencies in one click. Or double-click `scripts/update.command` (Mac) / `scripts/update.bat` (Windows) to do the same without opening the app. Either way, restart Refrain afterward to finish (or, if you run it as the background service, it picks the update up on its next restart).

If you'd rather do it by hand, or want to know what those do under the hood:

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
