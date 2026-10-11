# Service feed

A Refrain console can report to **your own** announcement server: which slide is
showing right now, and its diagnostics log afterwards. Off until a church turns
it on, and it only ever talks to the address the church typed in. Nothing goes
to the Refrain project. Core search does not depend on it.

Code: `server/service-feed.js`. Status on the Health screen (Modules tile).
Todoist task: Announce App > "Telemetry for services using refrain app".

## Set up (Refrain side)

1. Open **Settings > Telemetry**. Turn it on, name the station (for example
   `Main Campus FOH`; the announcement server uses the name to tell stations
   apart), paste the console address from the announcement server (https), and
   choose the send windows. Save.
2. Put the key the announcement server issued for this console in Secrets as
   `SERVICE_FEED_TOKEN`.
3. Refrain makes a stable `consoleId` for itself the first time it is turned on.
   A missing address, name or key shows as "misconfigured" with a sentence
   saying which.

**Send windows** (default one: Sunday 09:00 to 14:00, this machine's local time;
add more, or change the days and times) are the only times Refrain sends status.
Outside them it is silent, so a console left on all week is quiet. Clearing every
window restores the default; it never means "always".

**The log is sent by a person**, with the **Send log** button on Service > Day,
after the service. The log is for reviewing a service afterwards (was Refrain
involved when ProPresenter stalled; how does this Sunday compare with a good
one), not for watching live, so nothing about it is automatic. The button works
outside the windows, is refused during performance mode, and only sends days the
server does not already have.

`includeSlideText` (default `false`) adds the words on the slide to the status.
Leave it off unless the other side needs them: a prayer or care slide can carry
a name.

## Contract, version 1

Every request carries `Authorization: Bearer <SERVICE_FEED_TOKEN>` and
`X-Console-Id: <consoleId>`. The key identifies the console; the id is a
cross-check, not a credential. `{url}` is the configured address, without a
trailing slash.

### `POST {url}/status`

Sent when anything below changes (at most every 2 s) and every 30 s otherwise as
proof of life. Latest wins: a failed push is dropped, the next carries newer
truth.

```json
{
  "v": 1,
  "consoleId": "uuid",
  "name": "Main Campus FOH",
  "appVersion": "0.25.0",
  "seq": 41,
  "sentAt": "2026-10-04T15:02:11.000Z",
  "connected": true,
  "live": true,
  "liveSince": "2026-10-04T15:01:50.000Z",
  "performanceMode": false,
  "slide": {
    "presentationName": "Amazing Grace",
    "arrangementName": null,
    "slideIndex": 2,
    "slideCount": 6,
    "text": "only present when includeSlideText is on",
    "imageKey": "only present when picture sending is on"
  },
  "tz": "America/Denver",
  "history": {
    "graceMs": 300000,
    "items": [
      { "id": "mgx1k2-0", "name": "Amazing Grace", "startedAt": "2026-10-04T15:01:50.000Z", "endedAt": null, "current": true, "blank": false },
      { "id": "mgx0ab-1", "name": "Welcome Loop", "startedAt": "2026-10-04T14:55:00.000Z", "endedAt": "2026-10-04T15:01:50.000Z", "current": false, "blank": false }
    ]
  }
}
```

### Item history in `/status` (added 2026-10-11; `v` stays 1)

`tz` and `history` are **additive**: a receiver that reads only the fields it
names keeps working, and an older console simply does not send them. They tell
the other side exactly when each item changed, in the terms of the phone's
History page.

- `history.items` is a **snapshot**, newest first, at most 30. Status is latest
  wins, so a dropped push loses nothing: the next one carries the whole list.
  The whole status stays under 8 KB; if it ever would not, the oldest items are
  dropped first. A name is at most 200 characters.
- Each item is one **stay**: a presentation comes up and stays until a
  different one comes up, or the screens stay blank for more than `graceMs`
  (five minutes). Coming back to a song later is a new item. A long item (a
  sermon) that goes blank for a minute or two, or whose slide cannot be read for
  a beat, is still one item.
- `id` is unique per console and the same every time that item is sent (it is
  made from the moment the item opened). **It is not stable across a Refrain
  restart**: see "A restart" below.
- `startedAt` and `endedAt` are UTC ISO times. `endedAt` is null while the item
  is open, and `current` is true for the one open item (always the first).
  `endedAt` is when the item went off, which is when the screens went blank if
  they did before the next item came up. A blank gap needs no entry of its own:
  it is the time between one item's `endedAt` and the next item's `startedAt`.
- `blank` is true only on the open item, while the screens are empty and the
  gap is still being forgiven. Do not call it live then.
- Elapsed time is not sent (it would change every second). For the open item it
  is `sentAt` minus `startedAt` plus the time since the status arrived; for
  closed items it is `endedAt` minus `startedAt`.
- `tz` is the console's own IANA time zone, the one its day files are cut by.
  Show times in it, not the viewer's.
- Presentation names only (the same kind of name as `slide.presentationName`).
  No slide text and no presentation ids, whether or not `includeSlideText` is
  on, and nothing about who did anything (the phone take-over log is not sent).

`slide` is `null` when nothing is live. `connected: false` means Refrain cannot
reach ProPresenter (the console is up; the rig is not). No heartbeat for ~90 s
means Refrain itself, or its network, is down.

When a send window closes while something is live, Refrain sends one last status
with `live: false` and `slide: null`, then goes quiet, so the server reads the
end of a service as ended, not lost.

### `PUT {url}/image` (only if the church turned on "Picture of the slide")

Sent right after a status whose `slide.imageKey` is set, once per slide. The body
is the JPEG (about 25 KB, never over 200 KB), `Content-Type: image/jpeg`, with
header `X-Slide-Key` equal to that status's `slide.imageKey`. Latest wins per
console: keep one image, replace it, and show it only while its key matches the
console's current `slide.imageKey`. Refrain never draws a slide for this, so a
slide with no picture ready simply has none; `404`/`4xx` here is ignored and
never affects status.

### `PUT {url}/logs/{YYYY-MM-DD}.jsonl`

The body is that day's diagnostics file, `application/x-ndjson`, one JSON object
per line (`t`, `event`, ...). **Idempotent: a later PUT for the same day replaces
the earlier one**, because today's file can be sent again after more was added.
Refrain sends it only when a person presses Send log: every day file whose size
changed since the server last accepted it, oldest first, and nothing during
performance mode. The files hold timings, counts,
ProPresenter call paths and `item` lines (below). They do not hold slide text.

### `item` lines in the day file

One line when an item **opens** and another, with the same `id`, when it
**closes**, so an item still on the screens when someone presses Send log is
there as an open line (often the last item of the service). The later `t` wins
per `id`.

```json
{"t":"2026-10-11T16:41:00.000Z","event":"item","id":"mgx0ab-1","name":"Welcome Loop","startedAt":"2026-10-11T16:41:00.000Z","endedAt":null,"reason":null,"tz":"America/Denver"}
{"t":"2026-10-11T16:47:00.000Z","event":"item","id":"mgx0ab-1","name":"Welcome Loop","startedAt":"2026-10-11T16:41:00.000Z","endedAt":"2026-10-11T16:47:00.000Z","reason":"moved","tz":"America/Denver"}
```

- `reason` is null while open, then `moved` (a different item came up),
  `blank-timeout` (the screens stayed blank past `graceMs`; `endedAt` is when
  they went blank) or `restart` (see below). There is no separate `cleared`: a
  clear is a blank, and it only ends an item once it has lasted past the grace.
- Times are UTC. The day file is the **local** day (a Saturday service can run
  into the next UTC day), so `tz` travels on every line.
- Same privacy rules as the snapshot: names only.
- These lines are written to the local day file as items change, whether or not
  telemetry is on. Nothing leaves the Mac until a person presses Send log.

### A restart

Items live in memory, so a restart mid-service forgets the open one. Within a
second of starting, Refrain reads yesterday's and today's day files, finds each
`item` whose latest line is still open, and writes one close line for it:
`reason: "restart"`, `endedAt` the last moment the previous run wrote anything
(at most about a minute before the restart, since a `minute` line is written
every minute). What is on the screens afterwards opens as a new item with a **new
`id`**, even if it is the same presentation, and the phone's own History starts
again. A crash is the same as a restart.

### Answers

`2xx` accepted. `401` bad key. `403` the key is bound to a different console id (a reinstalled Refrain needs an admin to Reset key).  `400` the body is not version 1 or its `consoleId` differs from the header. `404` wrong
address. `413` too large (Refrain skips files over 10 MB rather than truncate).
`408`, `429` and `5xx` are treated as "try later". Any other `4xx` is treated as
a setup problem: Refrain says so on Health and backs off for five minutes.

## Staff requests, version 1 (the other direction)

Settings > Features > **Staff requests** (off by default) lets staff send a
message from the announcement app that someone at this console approves before
anything reaches the screens. It uses the address, key and console id above, so
Telemetry has to be set up first (its on/off switch can stay off).

Refrain asks; nothing connects in to the console. Every five seconds, and only inside the send windows set under Telemetry (the same quiet-all-week rule as the status feed), it calls,
with the same `Authorization: Bearer <key>` and `X-Console-Id` headers:

- `GET <console address>/requests` answers `{ "requests": [{ "id", "text", "from"?, "createdAt"? }] }`.
  `id` is the announcement server's own, up to 64 letters, digits, `_` or `-`.
  `text` is one line, 80 characters at most. `from` is shown on the card (a
  department; 40 characters). `createdAt` is an ISO time.
- `POST <console address>/requests/<id>/result` with `{ "status": "shown" | "declined" | "expired" }`,
  once the request has been answered. Refrain tells it again on the next poll if
  that call did not get through.

What Refrain guarantees: a request is only ever a card on **Now**; "Post it"
puts the text into the first ProPresenter message that has a Text field (or the
one named in `liveModule.requestMessageId`), "Decline" posts nothing. A request is good for eight
minutes from `createdAt` (a time in the future counts as now); an older one is
never shown and is reported `expired`. Each `id` is handled once, remembered on
disk, so a restart or a repeat poll never shows it twice. At most five wait at a
time; any more stay on the server until there is room. The text is never
written to a log or sent anywhere but the result call above, which carries no
text.

What the announcement app needs: a form for staff to send one (a code or a short
line), a list of pending requests per console, the two endpoints above, and a
state for each request (waiting, shown, declined, expired) so the sender can see
what happened. Keep the server's own expiry at eight minutes or less.

## Handoff prompt: Announce side (`cc-announce`)

Paste into a session opened in the `cc-announce` repo. Read its `AGENTS.md`
first; its non-negotiables apply.

> Refrain (the ProPresenter console tool, repo `refrain`) now has a "service
> feed" that pushes to this app. Read `docs/service-feed.md` in the refrain repo
> for the exact contract; it is the source of truth, do not change it without
> telling me. Build the receiving side here.
>
> **Consoles.** A console registry per account, **at most four**. An admin page
> (follow the existing admin nav and its one-heading-per-list rule; ask me which
> group it belongs in if it is not obvious) to add a console by name, issue its
> key once (show it once, store only a hash), reset a key, and remove a console.
> A fifth gets a plain sentence, not an error page. Keys follow the `staff-key`
> idea: nothing per key is stored beyond what is needed to verify it, and
> removing a console ends its key at once.
>
> **Intake.** `POST /api/consoles/status` and `PUT /api/consoles/logs/{day}.jsonl`
> exactly as the contract describes. Unauthenticated routes are written like
> `/api/crash`: only named fields read, each capped, bounded request size, rate
> limited, and a bad key answers `401` without saying why. A console's key is
> checked against the `X-Console-Id` it claims. `403` for a fifth console trying
> to register by sending status. Renders must not write; the intake routes do.
>
> **Storage.** Latest status per console (one row, replaced, with `last_seen`).
> No history of slides unless I ask. Logs go to R2 or the data volume (match how
> attachments are stored), keyed account/console/day, **replaced on each PUT for
> the same day**, with a retention window (default 60 days, ask me) and a size
> cap of 10 MB. Everything scoped by `account_id`. Add the tables to `schema.sql`
> and the additive `ALTER` list, per AGENTS.md.
>
> **Screen.** A "Consoles" view for staff: one card per console showing name,
> app version, connected / live / performance-mode state, the live slide
> (presentation name and "slide 3 of 6", and its text only if the console sent
> it), and how long since it was last heard from. Green under 45 s, amber under
> 90 s, red beyond that, with the word as well as the colour. It refreshes by
> polling every few seconds; no new dependency. A second tab lists each console's
> log days with a download link and a plain-language summary read from the
> `minute` / `slow-call` / `stall` lines (slow calls, stalls, performance mode
> on/off), so a review does not mean reading JSON.
>
> **Hard constraints.** Slide text is sensitive: never write it to a log, the
> audit log, an email or a crash report; show it only to signed-in staff. This is
> the church's own server, but treat the content as congregant-adjacent. Nothing
> here may auto-publish or change any announcement; this is read-only
> observation. Add tests (the intake validation, the four-console limit, the
> key check, the staleness colours); `npm test` and `npm run build` must pass.
> Update AGENTS.md (map, schema count, non-negotiables) and RUNBOOK.md (a
> Pulsetic/uptime note is not needed; note where the keys are issued and how to
> reset one).
>
> **Don't build** a live push channel (websockets), remote control of Refrain,
> or anything that sends a command back to a console. Say so if you think one is
> needed.
>
> Report what you ran versus what you believe, and what you left undone.

## Left undone / not yet verified

- Item history (2026-10-11) is unit-tested only. It has not been seen in a real
  service, and nothing has received it yet: the first check is a real Send log
  and a live status from a real service.
- `reason: "cleared"` is not emitted (see above). The overnight `live: true`
  and index-start-in-a-pre-service-window observations from the announce side
  are answered in the handoff, not fixed.
- Refrain side only has been exercised against a local test server and its unit
  tests. It has not been run against the real announcement server, because the
  receiving side does not exist yet.
- The Health screen shows the module in the Modules tile; there is no settings
  form for it yet (edit `config.json` and `.env`). A form is the next step if
  churches other than this one use it.
- "Register up to four consoles" is enforced by the announcement server; Refrain
  only identifies itself.
