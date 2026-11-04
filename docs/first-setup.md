# Setting up Refrain for your church

A checklist for the person setting Refrain up, from an empty Mac to a booth
that's ready for Sunday. Allow an hour, away from any service. Each step links
to the page with the detail.

## Before you start

- [ ] The booth Mac runs ProPresenter (Refrain is tested against 21.3), under the
      account the booth uses.
- [ ] ProPresenter's network API is on: ProPresenter › Preferences › Network.
      Note the port it shows.
- [ ] Node.js 20 or newer is installed: `node -v` in Terminal. No administrator
      password? [Install Node into your home
      folder](install.md#no-administrator-password).

## 1. Install and connect

- [ ] Put Refrain in `~/Refrain`, or `/Users/Shared/Refrain` if several accounts
      use the booth. Not on the Desktop and not in a synced folder. ([Where to
      put Refrain](install.md#where-to-put-refrain))
- [ ] Double-click `scripts/start.command`. The first run takes a minute.
- [ ] On the setup screen, press **Detect ProPresenter**, then **Test
      connection**.
- [ ] Answer **Yes, this machine (logger)** on the booth Mac. A second computer
      that only searches is a reader.
- [ ] **Save and continue**. Refrain waits for ProPresenter to settle, then
      builds the index. The bar along the bottom shows progress.

## 2. Make it come back on its own

- [ ] **Settings › More › Customize › Start at login › Turn on**. Refrain now runs
      in the background with no Terminal window and restarts if it crashes.
- [ ] Turn on automatic login for the booth account (System Settings › Users &
      Groups), so a power cut or an overnight update brings the booth back with
      nobody there.
- [ ] Give Refrain a window of its own beside ProPresenter: install it as a
      Chrome app, or build Refrain.app with `scripts/build-mac-app.command` and
      turn on Window › Keep on Top. ([Its own window](install.md#giving-refrain-its-own-window))

## 3. Tell it about your library

- [ ] **Settings › Search › Libraries to search**: choose the libraries worth
      searching. Leaving out archives keeps results short.
- [ ] **Settings › Features › Options › Search & indexing › Preferred
      arrangements**: the arrangement names your team plays from, in order, for
      example `FS` then `T`. Each song is indexed in the first one it has.
- [ ] Search for a lyric you know, and check **Show** opens it in ProPresenter.

## 4. Decide about Protect ProPresenter

Protect ProPresenter is on in a fresh install. It stops Refrain reading
presentations through ProPresenter's API in bulk, which is the safe default.
It also means Quality Control and the pre-service checks refuse to run.

- [ ] If you want those two (most booths do), turn protection off in **Settings ›
      Search › Advanced › Allow library reads**, on this Mac, away from a service.
      Restart ProPresenter afterwards if you run a large scan.
- [ ] Otherwise leave it on. Search, Go Live, Now and Flags work either way.

([Protect ProPresenter](indexing.md#protect-propresenter))

## 5. Switch on what you'll use

Search, Quality Control, Now, Flags and Day are ready already. Everything else is
off until you switch it on in **Settings › Features**:

- [ ] **Looks** and **Macros**, to put your ProPresenter Looks and macros on Now.
- [ ] **Safe slides**, then put your logo or blank on the screens and press
      **Keep current** under Safe slides on Now.
- [ ] Any prep tools your team wants: Lyrics, Scripture, QR Codes, Image Crop.
- [ ] Arrangement tracking, if you want to compare what you ran with Planning
      Center or a plan you type in. ([Arrangement tracking](arrangements.md))

## 6. Set up the service day

- [ ] If you run the same services each week, add them to `config.json` so Day
      expects them and watches the screens closely around each start. ([Today's
      services](service.md#todays-services))
- [ ] If you want the day summary emailed, add your mail server in **Settings ›
      Features › Options › Secrets (.env)** (`SMTP_HOST`, `SMTP_FROM`, and a login
      if it needs one), then turn on **Send the summary by email** under Day
      summary and add recipients. ([Sending the
      summary](service.md#sending-the-summary))
- [ ] Restart Refrain after changing `config.json` or `.env` by hand
      (**Settings › System › Restart Refrain**).

## 7. Phones (optional)

- [ ] **Settings › More › Phones › Open the Phone panel › Turn on phones**.
- [ ] Use a staff network you trust rather than open guest Wi-Fi: the phone page
      is plain HTTP. ([Security](phones.md#security))
- [ ] Scan the QR code with a phone, sign in with today's PIN, and add a test
      flag. It appears on the Flags screen.
- [ ] Approve any phone that should send stage messages with **Allow alerts**.
      Leave **Let phones go live** off unless you need it.

## 8. A dress rehearsal

- [ ] Work through the [ProPresenter verification
      checklist](propresenter-verification.md) with a throwaway playlist. It
      puts slides on your real outputs, so do it with nobody watching.
- [ ] On Day, press **Run pre-service checks** on a service with a playlist, and
      **End the day** afterwards to see the summary.
- [ ] Show the volunteers the welcome card (**Settings › More › Customize ›
      Welcome**). It covers the three things they need: Search, Go Live or Show,
      and Return.

## Afterwards

- Updates: **Settings › System › Updates** says when one is out. Update between
  services, and restart Refrain afterwards. ([Updating](install.md#updating))
- If ProPresenter won't connect: **Settings › System › ProPresenter connection ›
  Diagnose**.
- Something wrong? Open an issue with your Refrain and ProPresenter versions.
  Leave out PINs, keys and anything from your congregation.
