# Refrain

[![CI](https://github.com/capitalchurchtech/refrain/actions/workflows/ci.yml/badge.svg)](https://github.com/capitalchurchtech/refrain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Find the slide. Send it. Sit back down.

ProPresenter knows what is in your slides. It just will not tell you. Refrain
asks nicely.

Refrain is a small web app that runs on the same Mac as ProPresenter. Type any
word and it finds every slide that says it, across your whole library, then puts
that slide on the screens with one press. Around search it keeps the other small
tools a church production booth ends up needing: a service timeline, a way to
flag slides to fix later, pre-service checks, a phone page for the back of the
room, and a handful of prep tools.

It runs entirely on your own computer. Nothing is hosted for you, there is no
account and no subscription, and nothing about your church is sent to the
project.

> **Use at your own risk.** Refrain is provided "as is", without warranty of any kind. By downloading, installing or using it you accept sole responsibility for its use and for any result, and the owners and contributors of this repository accept no liability for any loss, damage or interruption it causes, including during a live service or event. Read [Warranty and liability](#warranty-and-liability) before you rely on it.

## What it does

**Search.** Every word on every slide, in the libraries you choose. Go Live puts
the slide up; Show opens it in ProPresenter's editor without touching the
screens. A typo is retried against your library's own words, so "ocenas" still
finds Oceans. This is the core of Refrain and it needs nothing but ProPresenter.

**Now.** A booth panel for the things that come up mid-service: posting a pager
code into a ProPresenter message, stage messages for the band, and, if you
switch them on, your Looks and Macros and up to four safe slides to cut to in a
hurry.

**Day.** A timeline of what went live in each service, when, and for how long.
Pre-service checks on a playlist (typos, past dates, missing media, arrangement
problems), a checklist, a list of songs whose arrangement changed during the
service, and End the day, which writes a summary you can email or save.

**Flags.** One press marks the slide on the screens as something to fix after
the service. The Flags screen is where you work through them.

**Phones.** An optional page anyone on the church network can open to flag a
slide from the back of the room. With permission, a phone can also search,
send a stage message, or go live.

**Prep tools**, each off until you switch it on: Lyrics (a scoped web search and
a paste-and-split helper), Scripture (Bible Gateway and Blue Letter Bible links,
and the same splitter), Image Crop (a drop folder that crops to every size you
need), QR Codes (made on your own machine), Arrangement tracking (compare what
you ran with what your planning system planned), and Bundles (open and check
ProPresenter files).

**Quality Control.** Pick a playlist and Refrain lists likely typos, dates that
have passed and media that isn't on this Mac, slide by slide.

Search, Quality Control and Now are always there. Nearly everything else is a
switch on **Settings › Features**, and a feature that is off has no screen and
its routes refuse. The [user guide](docs/README.md) covers each one.

## What's finished and what isn't

Working today:

- Search, Go Live, Show, the library filter, typo retry and Deep Search.
- Indexing from ProPresenter's library files, reindexing changed presentations
  on its own, performance mode and Protect ProPresenter.
- Now, Day, Flags, Quality Control, Lyrics, Scripture, Image Crop and QR Codes.
- The phone page, including alerts and going live from a phone.
- Arrangement tracking with the Manual and Planning Center providers, stored in
  a local folder or a synced folder (Google Drive, Dropbox, OneDrive).
- The day summary, delivered by email or to a folder.

Built and tested, but not yet proven in a real service:

- **Refrain.app**, the optional native Mac window.
- **Bundles** and the **MCP server** for assistants. Nothing an assistant edits
  has yet been imported into ProPresenter and checked by eye. The script builder
  places a reused title slide for you but not a reused verse or logo slide.
- **The service feed** and **staff requests** have only been run against a test
  server. The announcement app on the other end is not built yet.

Stubs (the interface exists, the methods refuse to run):

- The **Firestore** and **SFTP** storage backends for arrangement history.
  They appear in the settings, but every read and write throws "Not
  implemented". A synced folder is the working way to share between machines.

Not built:

- Church management providers other than Manual and Planning Center. Rock RMS,
  Elvanto and the rest are a new file in `providers/` away, and nobody has
  written one yet.

## What you need

- A Mac running ProPresenter, with its network API turned on (ProPresenter's
  Preferences › Network). Refrain is tested against ProPresenter 21.3.
- Node.js 20 or newer.

Windows can run Refrain with `scripts/start.bat`, but several features are Mac
only: Start at login, Refrain.app, opening folders and files from the app, and
noticing that ProPresenter has quit.

## Installing

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org) (the LTS
   build). No administrator password? [Install Node into your home
   folder](docs/install.md#no-administrator-password) instead.
2. Get Refrain into a folder of its own, such as `~/Refrain`:

   ```bash
   git clone https://github.com/capitalchurchtech/refrain.git ~/Refrain
   ```

   Or download the ZIP from GitHub and unzip it there.
3. Double-click `scripts/start.command`. It installs what it needs the first
   time, starts Refrain, and opens it in your browser at
   `http://localhost:9999`.
4. On the setup screen, press **Detect ProPresenter**, then **Test
   connection**, say whether this is the machine that runs ProPresenter live,
   and press **Save and continue**.

Refrain waits for ProPresenter to settle, then builds its search index. Setting
up a booth for the first time? [Setting up Refrain for your
church](docs/first-setup.md) is the checklist from here to a ready Sunday. The
[install guide](docs/install.md) covers where to put the folder, starting at
login, giving Refrain its own window, and stopping or restarting it.

## Updating

On a Git install, **Settings › System › Updates** shows whether a new version is
out and has an **Update now** button. `scripts/update.command` does the same
without opening the app. Either way, restart Refrain afterwards.

From a ZIP: download the new ZIP, unzip it into a new folder, and copy your
`config.json`, `.env` and `data` folder across (and `cache`, to skip rebuilding
the index). They hold your settings, secrets and records, and no download ever
contains them.

More in [the install guide](docs/install.md#updating).

## Privacy

There is no telemetry and no analytics. Refrain makes these connections, and no
others:

- **ProPresenter**, at the address you set.
- **GitHub, to check for a new version.** Refrain downloads this repository's
  `package.json` from `raw.githubusercontent.com` at start-up, then at most
  every six hours (or when you press **Check again**). The request carries no
  identifier, version or usage. It can't currently be turned off.
- **npm and GitHub**, when you first install and when you update.
- **Your local network**, only when you press **Search the network anyway**
  during setup to find a ProPresenter on another computer.
- **Services you set up yourself**, and only once you do: Planning Center for
  arrangement tracking, your own mail server for the day summary, and your own
  announcement server for the service feed (the **Settings › More › Telemetry** tab,
  which is a feed to your church's server, not to this project).

Scripture and Lyrics open links in your browser; Refrain never fetches those
pages itself. Logs and diagnostics stay in the Refrain folder (unless you turn
on the service feed, which sends the diagnostics to your own server), and
diagnostics are deleted after 14 days. The details are in [the configuration
reference](docs/configuration.md#what-refrain-writes-to-disk).

## What Refrain won't do

- **Edit your slides.** ProPresenter's API can't, so Refrain flags and opens the
  slide, and you fix it in ProPresenter.
- **Write to ProPresenter's library or database.** The index reads `.pro` files
  and never writes to them. Bundles and the MCP server work on copies.
- **Download from YouTube, or scrape lyrics or scripture sites.** Each is a
  legal call your church makes for itself, and each depends on a site that
  changes under you. Refrain builds a link and hands you off.

## For developers

Refrain is plain Node and Express with a plain JavaScript front end. There is
no build step and no database. Church management providers, storage backends,
lyrics splitters, day summary delivery and whole new screens are each a file
(or a small folder) the app finds when it starts.

- [CONTRIBUTING.md](CONTRIBUTING.md): setting up, the extension points, and the
  rules.
- [docs/refrain-architecture.md](docs/refrain-architecture.md): how it fits
  together.
- [CLAUDE.md](CLAUDE.md): for AI coding agents, covering the same ground plus
  the mistakes this codebase has already had to fix.

## Not affiliated

Refrain is an independent community project. It is not affiliated with,
endorsed by or supported by Renewed Vision (ProPresenter) or Planning Center.

## Warranty and liability

Refrain is licensed under the MIT License, and the disclaimer of warranty and limitation of liability in [LICENSE](LICENSE) apply in full. This section states those terms more fully. It adds to them and does not narrow them. If you do not accept these terms, do not download, install or use the software.

**No warranty.** The software is provided "as is" and "as available", with all faults, and without warranty or condition of any kind, whether express, implied or statutory. This includes, without limitation, any warranty of merchantability, fitness for a particular purpose, title, non-infringement, accuracy, compatibility, security, or uninterrupted or error-free operation. No statement made by the owners or contributors, whether in this README, the documentation, an issue, a pull request, a release note or anywhere else, creates any warranty or obligation.

**You assume all risk.** You download, install, configure, modify, distribute and use the software entirely at your own risk. You alone are responsible for deciding whether it is suitable for your purposes, for testing it before you rely on it, for keeping backups of your data (including your ProPresenter libraries, media, playlists and settings), and for every consequence of its use. Refrain runs alongside live production software. It can put content on screens, read and write files on your computer, and connect to services you configure. Any error, interruption, loss or corruption of data, or content shown or not shown during a service, event, recording or broadcast is your responsibility and no one else's.

**No liability.** To the maximum extent permitted by applicable law, in no event will the owners of this repository, the copyright holders, the contributors, or their respective churches, employers, affiliates, staff, volunteers or agents be liable to you or to any third party for any claim, loss or damages of any kind. This includes direct, indirect, incidental, special, consequential, exemplary or punitive damages, and loss of data, revenue, goodwill or use, or the interruption of any service, event or broadcast. This applies however the loss is caused, under any theory of liability, whether in contract, tort (including negligence), strict liability or otherwise, arising out of or in connection with the software or its use or inability to use it, even if any of them were told such loss was possible.

**You hold them harmless.** To the maximum extent permitted by applicable law, you agree to hold harmless and indemnify the owners, copyright holders and contributors from and against any claim, loss, liability, damage, cost or expense (including reasonable legal fees) brought by any third party or arising from your use of the software, your modification or distribution of it, or your breach of these terms.

**No support and no duty to update.** No one is obliged to provide support, maintenance, updates, security fixes or notice of any defect. Any help that is offered is given voluntarily, without obligation, and may stop at any time.

**Where the law limits this.** Some jurisdictions do not allow certain warranties to be excluded or certain liability to be limited. Where that is so, these exclusions and limitations apply to the fullest extent the law allows, and the rest of these terms remain in effect.

## License

MIT. See [LICENSE](LICENSE). The terms under [Warranty and liability](#warranty-and-liability) apply to every use of the software.

Bundled third-party files are listed with their licences in
[public/vendor/README.md](public/vendor/README.md). Three of them are not MIT
and matter if you fork Refrain: the panel textures in `public/img/textures/`
(`black_linen_v2.png` and `dark_leather.png` by Atle Mo, `noisy_net.png` by Tom
McArdle) are from Subtle Patterns under **CC BY-SA 3.0**, a share-alike
licence. To drop them, set the three `--t-` custom properties at the top of the
texture section in `public/refrain.css` to `none` and no texture loads. The fonts Archivo
and Martian Mono are OFL 1.1.
