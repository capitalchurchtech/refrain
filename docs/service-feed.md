# Service feed

A Refrain console can report to **your own** announcement server: what is on the
screens during a service, and its diagnostics log afterwards. It can also read
staff requests back from that server. It is off until a church turns it on, it
only ever talks to the address the church typed in, and nothing goes to the
Refrain project. Core search does not depend on it.

This page is the contract for the server side. The code is
`server/service-feed.js` and `server/staff-requests.js`.

## Setting it up

1. On **Settings › More › Telemetry**, turn it on, name the station (for example
   `Main Campus FOH`; the server tells stations apart by name), paste the
   announcement server's address (`https://`, except for `localhost`), and choose
   the send windows. Save.
2. Put the key the server issued for this console in Secrets as
   `SERVICE_FEED_TOKEN`.
3. Refrain makes a `consoleId` for itself the first time the feed is turned on.

A missing address, name or key shows as misconfigured, with a sentence saying
which.

**Send windows** are the only times Refrain sends status. The default is Sunday
09:00 to 14:00, this machine's local time; add more or change them. Clearing
every window brings the default back; it never means "always".

**The log goes each night** at 02:00 local time, or another time you choose, or
only when someone presses **Send log** (on Day or the Telemetry tab). It never
goes inside a send window or during performance mode; it waits for both to end.
A computer asleep at that time sends when it wakes. A failed night is tried
twice more, ten minutes apart, then left for the next night, and Day says it
failed. **Send log** sends at once, outside the windows too, and is refused
during performance mode or while the feed is switched off.

**Words on the slide** (off by default, `includeSlideText`) adds the slide's text
to the status. Leave it off unless the other side needs it: a prayer or care
slide can carry a name. **Picture of the slide** (off by default,
`includeSlideImage`) sends a picture of the slide. It needs Slide pictures set to
Show pictures. During performance mode it sends only pictures already on disk;
outside it, ProPresenter may be asked to draw one.

## Contract, version 1

Every request carries `Authorization: Bearer <SERVICE_FEED_TOKEN>` and
`X-Console-Id: <consoleId>`. The key identifies the console; the id is a
cross-check, not a credential. `{url}` is the configured address without a
trailing slash.

### `POST {url}/status`

Sent when anything below changes (at most every 2 seconds) and every 30 seconds
otherwise as proof of life, inside the send windows only. Latest wins: a failed
push is dropped, and the next carries newer truth.

```json
{
  "v": 1,
  "consoleId": "uuid",
  "name": "Main Campus FOH",
  "appVersion": "0.38.0",
  "seq": 41,
  "sentAt": "2026-10-04T15:02:11.000Z",
  "connected": true,
  "live": true,
  "liveSince": "2026-10-04T15:01:50.000Z",
  "performanceMode": false,
  "slide": {
    "presentationName": "Amazing Grace",
    "arrangementName": "FS",
    "slideIndex": 2,
    "slideNumber": 3,
    "slideCount": 6,
    "text": "only when includeSlideText is on",
    "imageKey": "only when includeSlideImage is on"
  },
  "tz": "America/Denver",
  "history": {
    "graceMs": 300000,
    "items": [
      { "id": "mgx1k2-0", "name": "Amazing Grace", "startedAt": "2026-10-04T15:01:50.000Z", "endedAt": null, "current": true, "blank": false },
      { "id": "mgx0ab-1", "name": "Welcome", "startedAt": "2026-10-04T14:55:00.000Z", "endedAt": "2026-10-04T15:01:50.000Z", "current": false, "blank": false }
    ]
  }
}
```

- `slide` is `null` when nothing is live.
- `connected: false` means Refrain can't reach ProPresenter: the console is up,
  the rig isn't. No status for about 90 seconds means Refrain itself, or its
  network, is down.
- When a send window closes while something is live, Refrain sends one last
  status with `live: false` and `slide: null`, so the server reads the end of a
  service as ended, not lost.

#### The slide

Every field describes the arrangement that is **playing**: the one selected in
ProPresenter, read from the live presentation.

- `slideIndex` is ProPresenter's zero-based index. `slideNumber` is the number a
  person sees on ProPresenter's screens (`slideIndex + 1`). Show that one.
- When the live presentation can't be read, `text`, `slideCount` and
  `arrangementName` are `null` rather than guessed.

#### Item history

`history.items` is a snapshot, newest first, of at most 30 items. Because status
is latest-wins, a dropped push loses nothing. The whole status stays under 8 KB;
if it wouldn't, the oldest items are dropped. A name is at most 200 characters.

- Each item is one **stay**: a presentation comes up and stays until a different
  one comes up, or until the screens stay blank for more than `graceMs` (five
  minutes). Coming back to a song later is a new item. A sermon that goes blank
  for a minute is still one item.
- `id` is unique per console and the same every time that item is sent. It is
  **not** stable across a Refrain restart (see below).
- `startedAt` and `endedAt` are UTC. `endedAt` is `null` while the item is open.
  `current` is true for the one open item, which is always first. When the
  screens went blank before the next item came up, `endedAt` is when they went
  blank; the gap needs no entry of its own.
- `blank` is true only on the open item, while the screens are empty and the gap
  is still being forgiven. Don't call it live then.
- Elapsed time isn't sent. For the open item it is `sentAt` minus `startedAt`
  plus the time since the status arrived; for a closed item, `endedAt` minus
  `startedAt`.
- `tz` is the console's IANA time zone, the one its day files are cut by. Show
  times in it, not the viewer's.
- Names only: no slide text and no presentation ids, whatever
  `includeSlideText` says, and nothing about who did what.

### `PUT {url}/image`

Only when **Picture of the slide** is on. Sent right after a status whose
`slide.imageKey` is set, once per slide. The body is the JPEG (about 25 KB, never
over 200 KB) as `Content-Type: image/jpeg`, with an `X-Slide-Key` header equal to
that `imageKey`. Keep one image per console, replace it, and show it only while
its key matches the console's current `imageKey`. A slide with no picture ready
simply has none, and with Slide pictures on Words only, `imageKey` is set but no
image is ever sent. A `4xx` here is ignored and never affects status.

### `PUT {url}/logs/{YYYY-MM-DD}.jsonl`

The body is that day's diagnostics file as `application/x-ndjson`, one JSON
object per line (`t`, `event`, ...). **A later PUT for the same day replaces the
earlier one**, because today's file can be sent again after more was added.
Refrain sends every day file whose size changed since the server last accepted
it, oldest first. Files over 10 MB are skipped rather than truncated. The files
hold timings, counts, ProPresenter call paths and `item` lines. They don't hold
slide text.

#### `item` lines

One line when an item **opens** and another, with the same `id`, when it
**closes**. An item still on the screens when the log is sent is there as an
open line. The later `t` wins per `id`.

```json
{"t":"2026-10-11T16:41:00.000Z","event":"item","id":"mgx0ab-1","name":"Welcome Loop","startedAt":"2026-10-11T16:41:00.000Z","endedAt":null,"reason":null,"tz":"America/Denver"}
{"t":"2026-10-11T16:47:00.000Z","event":"item","id":"mgx0ab-1","name":"Welcome Loop","startedAt":"2026-10-11T16:41:00.000Z","endedAt":"2026-10-11T16:47:00.000Z","reason":"moved","tz":"America/Denver"}
```

- `reason` is `null` while open, then `moved` (a different item came up),
  `blank-timeout` (the screens stayed blank past `graceMs`; `endedAt` is when
  they went blank) or `restart`. A clear is a blank, so it only ends an item once
  it has lasted past the grace.
- Times are UTC, but the day file is the **local** day, so `tz` travels on every
  line.
- These lines are written to the local day file whether or not the feed is on.
  Nothing leaves the Mac until the nightly send or a press of **Send log**.

#### A restart

Items live in memory, so a restart forgets the open one. Within a second of
starting, Refrain reads yesterday's and today's day files, finds each item whose
latest line is still open, and writes a close line for it with `reason:
"restart"` and `endedAt` the last moment the previous run wrote anything (at
most about a minute before). What is on the screens afterwards opens as a new
item with a new `id`, even if it is the same presentation. A crash counts as a
restart.

### Answers

| Status | Refrain treats it as |
|---|---|
| `2xx` | Accepted |
| `401` | Bad key |
| `403` | The key belongs to a different console id (a reinstalled Refrain needs its key reset on the server) |
| `400` | The body isn't version 1, or its `consoleId` differs from the header |
| `404` | Wrong address |
| `413` | Too large |
| `408`, `429`, `5xx` | Try later |
| any other `4xx` | A setup problem: Settings says so, and status pushes back off for five minutes (log uploads and staff request polls don't) |

## Staff requests

Settings › Features › **Staff requests** (off by default) lets staff send a short
message from the announcement app that someone at this console approves before
anything reaches the screens. It uses the address, key and console id above, so
the feed has to have been turned on once to make the id; its switch can then
stay off.

Refrain asks; nothing connects in to the console. Every five seconds, inside the
send windows only, it calls, with the same headers:

- `GET {url}/requests`, answering
  `{ "requests": [{ "id", "text", "from"?, "createdAt"? }] }`.
  - `id` is the server's own, up to 64 letters, digits, `_` or `-`.
  - `text` is one line of at most 80 characters.
  - `from` is shown on the card (a department; at most 40 characters).
  - `createdAt` is an ISO time.
- `POST {url}/requests/{id}/result` with
  `{ "status": "shown" | "declined" | "expired" }`, once the request has been
  answered. If that call doesn't get through, Refrain tells it again on the next
  poll.

What Refrain guarantees:

- A request is only ever a card on **Now**. **Post it** puts the text,
  upper-cased and cut to 60 characters, into the ProPresenter message named in
  `liveModule.requestMessageId`, or else the first message with a text field
  that isn't hidden on Now. It needs Messages switched on. **Decline** posts
  nothing. Keep requests to 60 characters if you don't want them cut.
- A request is good for eight minutes from `createdAt` (a time in the future
  counts as now). An older one is never shown and is reported `expired`.
- Each `id` is handled once and remembered on disk, so a restart or a repeat poll
  never shows it twice.
- At most five wait at a time; any more stay on the server until there is room.
- The text is never written to a log or sent anywhere but the result call, which
  carries no text.

What the announcement app needs: a way for staff to send one, a list of pending
requests per console, the two endpoints above, and a state per request (waiting,
shown, declined, expired) so the sender can see what happened. Keep the server's
own expiry at eight minutes or less.

## Not yet proven

Refrain's side has run against a local test server and its unit tests, not a
real announcement server, because the receiving side isn't built yet. The
nightly send and the item history haven't been seen in a real service.
