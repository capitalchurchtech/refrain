# ProPresenter verification checklist

Most of Refrain has only been exercised against fake ProPresenter servers
during development. Everything that reads or changes live output was built
to ProPresenter's documented v1 API, but a few endpoints have not been
confirmed against a real machine. This checklist walks through each live
feature so you can confirm it on your own rig in about twenty minutes, and
tells you exactly what to capture if something does not work so it can be
fixed quickly.

Run this on the machine that runs ProPresenter live, with ProPresenter open
and its Network API enabled (Preferences, then Network). Have a throwaway
presentation and playlist handy so you are not experimenting on real service
content.

Two endpoints are the least certain and are called out below with a
**CAPTURE** note: the current-slide read behind the Return bar, and the
message token shape behind the Live message poster. If either misbehaves,
grab the raw response as described and it is a small fix.

Throughout, replace `HOST:PORT` with the host and port you set during setup
(see the Health screen, or `config.json`). ProPresenter serves its API over
plain HTTP on your local network.

---

## 1. Connection

- [ ] Open the **Health** screen. The ProPresenter Connection card shows
      **Connected** with the right host and port.
- [ ] The Search screen does not show the yellow "can't reach ProPresenter"
      banner.

Relies on: `GET /v1/status/layers`. If this fails, nothing else will work;
fix the host, port, and Network API setting first.

---

## 2. Search, Go Live, and Show in Editor

- [ ] On **Search**, type a word you know is on a slide. Results appear.
- [ ] Click **Go Live** on a result. That slide goes live on the screens.
- [ ] Click **Show in Editor** on a result. ProPresenter's own editor
      switches to that presentation without changing what is live.

Relies on: `GET /v1/presentation/{uuid}/{index}/trigger` (Go Live) and
`GET /v1/presentation/{uuid}/focus` (Show in Editor). Confirm the slide that
goes live is the exact slide you clicked, including for a presentation that
has an arrangement selected (the trickiest indexing case).

---

## 2b. Arrangements (the wrong-slide check)

A song can hold several arrangements, and an arrangement reorders and repeats
groups, so the same slide sits at a different flat number under each one. Since
Go Live sends only that number, this is the check that matters most.

Confirmed on a real library: 80 of 184 songs have more than one arrangement and
75 of those have differing slide counts, so this is not a rare edge case.

- [ ] Pick a song with two arrangements of different lengths (the Health
      screen's preferred-arrangements hint lists the names your library uses).
- [ ] Search for a lyric in it and note the arrangement badge shown on the
      result. Click **Go Live** and confirm the exact slide you clicked is what
      appears on the screens.
- [ ] Now switch that song to its *other* arrangement in ProPresenter, without
      re-indexing in Refrain. Search the same lyric and click **Go Live** again.
      **The same slide should still go live**, because Refrain re-reads the
      current arrangement and re-points the slide number before triggering.
- [ ] Search a lyric from a chorus that repeats. It should appear once with a
      "sung N times" note rather than once per repeat, and Go Live should land
      on the first time it is sung.

Relies on: `GET /v1/presentation/{uuid}` (read live at click time to resolve the
current arrangement) plus the trigger endpoint from section 2.

**Open question worth confirming here:** a few slides in a real library had
`enabled: false`. Whether ProPresenter counts disabled slides in the flat
trigger index is unverified, and Refrain currently counts them. If a song with a
disabled slide fires one slide off, that is the cause. Capture the song and
say which slide is disabled.

**A note on speed.** On the machine this was tested against, ProPresenter took
2 to 5 seconds to answer a trigger, focus, or status call, and appeared to
serialize requests. Refrain allows 20 seconds for live-output calls and no
longer waits on focusing the editor. If Go Live feels slow, it is very likely
ProPresenter's own response time rather than Refrain. Timing a bare
`curl -s -o /dev/null -w "%{time_total}" http://HOST:PORT/v1/presentation/slide_index`
will show it.

---

## 3. The Return bar

This is the feature most worth confirming, because it depends on reading the
currently live slide.

- [ ] Put any slide live in ProPresenter by hand (not through Refrain).
- [ ] In Refrain, Go Live to a different presentation from Search.
- [ ] A **Return** bar appears at the top naming the slide you were on
      before the jump.
- [ ] Advance a few slides by hand in ProPresenter. The Return bar does not
      change.
- [ ] Click **Return**. ProPresenter's editor reopens the presentation you
      were on before the jump (it does not force it live).

Relies on: `GET /v1/presentation/slide_index` to capture the pre-jump slide.

**CAPTURE if the Return bar never appears, or names the wrong slide:** with a
slide live, run this and paste the output into an issue:

```bash
curl -s http://HOST:PORT/v1/presentation/slide_index
```

Refrain expects a shape like
`{ "presentation_index": { "index": N, "presentation_id": { "uuid": "...", "name": "..." } } }`.
If your ProPresenter returns something different, that is the fix.

---

## 4. Live page: Clear

- [ ] Put something on each layer in ProPresenter (a slide, a background
      media item, a message).
- [ ] On the **Live** screen, tap **Slide**. The slide layer clears; media
      and messages stay.
- [ ] Tap **Media**, then **Messages**, and confirm each clears only its own
      layer.
- [ ] Tap **Clear All**. Everything visible clears.

Relies on: `GET /v1/clear/layer/{slide|media|props|messages|announcements|video_input}`.

---

## 5. Live page: Looks and Macros

- [ ] The **Looks** section lists the Looks you have set up in ProPresenter,
      by their real names.
- [ ] Tap one. The screens switch to that Look.
- [ ] The **Macros** section lists your Macros, and tapping one runs it.

Relies on: `GET /v1/looks` and `GET /v1/look/{uuid}/trigger`; `GET /v1/macros`
and `GET /v1/macro/{uuid}/trigger`. If a section is empty but you do have
Looks or Macros, capture:

```bash
curl -s http://HOST:PORT/v1/looks
curl -s http://HOST:PORT/v1/macros
```

Refrain expects each entry to carry `id.uuid` and `id.name`.

---

## 6. Live page: the message poster (urgent codes)

This is the other endpoint worth confirming carefully.

First, in ProPresenter, set up a Message with a single text token if you do
not already have one (this is the "come to childcare" style code). Then in
Refrain:

- [ ] The **Message on screen** section appears at the top of the Live page
      with a text box.
- [ ] Type a code and tap **Post to screen**. Your text appears on the
      output as that message.
- [ ] Tap **Clear**. The message comes off the screen.
- [ ] If you have more than one text-token message, a small picker lets you
      choose between them.

Relies on: `GET /v1/messages` (to list and read token names),
`POST /v1/message/{uuid}/trigger` (to show), and
`GET /v1/message/{uuid}/clear` (to hide).

**CAPTURE if the message section never appears, or Post does nothing:** the
token shape in the messages list is the least certain part. Grab:

```bash
curl -s http://HOST:PORT/v1/messages
```

Refrain reads each message's `id.uuid` and `id.name`, and looks for its text
tokens inside `message_components` (or a `tokens` array), each carrying a
`name`. On Post it sends an array of `{ "name": "<token>", "text": { "text": "<your code>" } }`.
If your ProPresenter names or nests tokens differently, that response tells
us exactly how to map it.

---

## 7. Spell check

- [ ] On **Spell Check**, the playlist picker lists your playlists.
- [ ] Pick a playlist and tap **Check spelling**. It scans and lists any
      candidate typos, grouped by presentation.
- [ ] On a flagged word, **Go Live** puts that slide up and **Show in
      Editor** opens it. (These are the same actions as Search, so if
      section 2 passed, these will too.)
- [ ] **Ignore** on a word removes it from the results and it stays ignored
      on the next scan.

Relies on: `GET /v1/playlists`, `GET /v1/playlist/{uuid}`, and
`GET /v1/presentation/{uuid}`.

---

## 8. Arrangement module (only if you use it)

If you have the arrangement module configured with a provider and storage:

- [ ] The **Arrangement** screen loads this weekend's plan and your songs.
- [ ] Running a comparison on a song produces a diff and saves without
      error, and a repeated run does not lose or duplicate the record.

---

## Reporting

For anything that fails, the raw `curl` output from the relevant **CAPTURE**
step is the single most useful thing to include. With it, correcting the
endpoint shape is usually a one-line change.
