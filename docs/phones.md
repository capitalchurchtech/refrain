# Phones

Refrain can serve a separate page that phones on your church network open. A
volunteer at the back of the room can flag a slide, see where the service is
and, with permission, search, send a stage message or go live. Refrain's own
screens never leave the booth computer; only this page is on the network.

## Turning it on

**Settings › More › Phones › Open the Phone panel**, then **Turn on phones**. The panel
shows the address, a QR code to scan, today's PIN, this month's device code and
the phones that have signed in. Today's PIN also shows on the Flags screen.

- The page runs on port **9997** on every network interface of this computer,
  over plain HTTP. Set `networkModule.host` to one address to limit it, or
  `networkModule.port` to move it.
- **Turn off phones** stops it at once.

## Signing in

A phone opens the page, types **today's PIN** and a name ("the booth sees it"),
and presses **Continue**. The PIN is four digits and changes at midnight.
**Trust this phone for 30 days** keeps it signed in; otherwise it is signed out
at midnight.

In `config.json`, `networkModule.pin` can be `"daily"` (the default), a fixed
PIN of 4 to 8 digits, or empty for no PIN. `networkModule.pinHint` replaces the
line on the sign-in screen that says where to find the PIN.

## What a phone can do

| | With the PIN | Plus this month's device code | Plus approved by name |
|---|---|---|---|
| See what's on and where the service is | ✓ | ✓ | ✓ |
| Add a flag, view flags, see History | ✓ | ✓ | ✓ |
| Search | | ✓ | ✓ |
| Go live (if switched on) | | ✓ | ✓ |
| Send alerts | | | ✓ |

- **The device code** is four digits shown in the Phone panel and changes on the
  1st of each month. A phone types it once a month after pressing **Allow**. A
  phone signed in only until midnight is a new phone each day, so it is asked
  again.
- **Approving by name**: **Allow alerts** beside a phone in the panel. **Stop
  alerts** takes it back and **Remove** signs it out.
- **Sign out all phones** signs every phone out and changes today's PIN (unless
  you set a fixed one) and this month's device code.

A phone can never Clear, run a Look or a Macro, move to the next or previous
slide, fire a safe slide, or change a setting. Switching **Flags** or
**Messages** off in Settings › Features switches them off on phones too.

## The phone page

Five keys along the bottom:

- **Service**: what's on the screens and where the service is ("item 2 of 9 · up
  3:12"), **Add flag** and **View flags**.
- **Search**: words from a slide, with **Flag this** on each result (and **Go
  live**, when allowed).
- **Alert**: a **Stage message** (a preset or your own line) or **Variables**
  (ProPresenter messages with a field to fill in, such as a pager code). Every
  alert needs a second tap to confirm, within six seconds.
- **History**: each item that was on the screens, when it started, how long it
  was up and when it left. Looking only.
- **Phone**: the link status, what this phone may do, and **Forget this phone**.

### Adding a flag

Choose the slide on the screens or one a few slides back or ahead (or any slide
from Search), what's wrong, an optional note (the **Note** type needs one), and
send it. A flag that can't send waits on the phone and retries. A picture of the
slide is taken when the flag is added, so it still shows the right slide after
the presentation changes.

The slides of the presentation on the screens are numbered as ProPresenter's
screens show them, counting from 1, in the arrangement that is actually playing.
Search results are numbered in the arrangement the index reads, which can
differ.

## Going live from a phone

Off until you switch on **Let phones go live** in the Phone panel. Then a phone
with the month's device code can go live from Search:

1. The phone shows a fresh code; the person types it back (this stops a pocket
   press).
2. A confirm sheet shows what is on the screens now, with **Take over the
   screen** and **Not now**.

It takes the screens even if someone at the booth is using them. Each go-live is
logged by phone name in `data/phone-golive-log.json` and listed in the panel.
Switching it off stops phones at once.

## Limits

- Sign-in: 5 tries a minute per address, and sign-in stops for the day after 30
  wrong PINs across all phones.
- Device code and go-live codes: 3 wrong in a row locks that phone for five
  minutes, and 30 wrong device codes in a day across all phones stops them for
  the day.
- Search: 40 a minute per phone, 150 across all phones.
- Flags: 20 a minute per address.

## Security

The phone page is the one part of Refrain that anyone on your network can reach,
so treat the network as part of the setup:

- It is **plain HTTP**. The PIN, the device code and the sign-in token cross
  your Wi-Fi unencrypted. Run it on a network you trust, such as a staff network
  rather than open guest Wi-Fi.
- **With no PIN**, anyone on the network can see what is on the screens, read
  the words of every slide in that presentation, read open flags and their notes,
  and add flags, without signing in. Search, alerts and going live still need a
  PIN.
- The secret behind the PIN, the tokens and the device code is in
  `data/remote-secret.json`, readable only by the account running Refrain.
  **Sign out all phones** replaces it.

## Slide pictures

A slide picture can come from two places. On the booth computer, Refrain draws
**Quality Control's** slides and the **safe slide** keys itself, from the
presentation's file on this Mac, in the arrangement ProPresenter has selected.
That asks nothing of ProPresenter. It uses this Mac's fonts, so a slide set in a
font this Mac doesn't have won't match, and Quality Control says which fonts are
missing. A slide Refrain can't draw falls back to ProPresenter's picture, then to
its words. Nothing new is drawn during a service.

Every other picture is drawn by ProPresenter, which writes to its workspace
database for each one and keeps memory for it until it restarts. So Refrain is
careful about asking:

- **Settings › More › Phones › Slide pictures** is **Words only** by default.
  While it is, Refrain asks ProPresenter for no slide picture except the ones
  listed below, and shows a slide's words where a picture would go. This switch
  doesn't affect the pictures Refrain draws from files.
- **Show pictures** lets Refrain draw a picture when a screen needs one. Each is
  drawn once and kept on disk in `data/slide-pictures/`.
- During performance mode, no screen asks ProPresenter for a new picture. Only
  pictures already on disk are shown.
- A phone never causes a picture to be drawn, except when it adds a flag (below).

Drawn whatever that setting says, because a person asked:

- The picture taken when a phone adds a flag (`slidePictures.flagged`, on unless
  `false`). This one can be drawn even during performance mode, with a
  six-second limit. **Get slide pictures** on Flags draws the rest.
- Quality Control's pictures of the slides it flags, where Refrain can't draw
  them itself.
- **Safe slide pictures** (on by default; **Names** shows words instead): where
  Refrain can't draw a safe slide itself, ProPresenter's picture is taken once
  when it is kept.

**Update pictures** on Day draws pictures for today's service playlists and keeps
any slide whose words, group and place haven't changed. It needs Show pictures
on and Protect ProPresenter off, and refuses during performance mode.

**Draw ahead of time** would draw today's playlists while nothing is happening.
It is **paused** for now while ProPresenter 22 beta is slow on rich slides:
Refrain draws nothing on its own, and Settings says so.
