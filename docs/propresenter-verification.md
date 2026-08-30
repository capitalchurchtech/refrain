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

**Do not run any of this, and above all do not rebuild the index, anywhere near
a service.** A rebuild crawls every presentation and can run for well over an
hour, and while it does ProPresenter goes sluggish and may stop responding to
Go Live, Clear, and macros altogether. Even this checklist puts slides on your
real output. Give yourself a window where nothing crucial is happening for the
next hour or two.

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

**Verified 2026-08-30 on the live rig.** The wrong-slide correction works, and
it was tested with a real divergence rather than a contrived one:

- A song whose arrangement reorders groups was found by scanning: THIRDS puts a
  slide at flat index 19 that raw group order puts at 58. Firing 19 with the
  live selection also on THIRDS put the expected slide on the screens.
- Then the stale case, which is what an arrangement switch actually produces:
  index **58** was sent with the correct `(group, offset)` anchor, and the
  server re-pointed it to **19** and fired the right slide. `corrected: true`,
  and a 39-slide error was absorbed silently.
- Repeated groups collapse as claimed: a chorus reported "sung 10x", "sung 13x"
  and "sung 6x" on distinct rows, each distinct lyric appearing once at its
  first occurrence.

**Still needs a person:** switching the arrangement in ProPresenter's own UI
between the two Go Live presses. The stale-index test above drives the identical
code path with the identical input, so this is a belt-and-braces confirmation
rather than an open risk.

**Resolved 2026-08-30: ProPresenter counts disabled slides, and Refrain is
right to count them too.** Measured on the live rig against a presentation with
a disabled slide at flat index 25: firing index 27 put index 27 on the screens,
with the expected text. Had ProPresenter skipped the disabled slide, that call
would have landed on the following slide instead, and it did not.

Also worth correcting: this is not rare. 16 of 45 presentations sampled contain
at least one disabled slide, one of them six. So the behaviour matters far more
than "a few slides" implied, which is why it is now measured rather than left
open.

**A note on speed.** On the machine this was tested against, ProPresenter took
2 to 5 seconds to answer a trigger, focus, or status call, and appeared to
serialize requests. Refrain allows 20 seconds for live-output calls and no
longer waits on focusing the editor. If Go Live feels slow, it is very likely
ProPresenter's own response time rather than Refrain. Timing a bare
`curl -s -o /dev/null -w "%{time_total}" http://HOST:PORT/v1/presentation/slide_index`
will show it.

---

## 2c. Reindex changed only

The claim is that editing one presentation costs one API read, not hundreds.
This is the check that proves the fingerprinting actually notices real edits —
if it silently missed them, search would keep serving the old lyrics with no
sign anything was wrong.

Run this on a weekday, because step 1 is a full rebuild. Give ProPresenter a
few minutes after launching before you start: a rebuild begun while it is still
indexing its own media loses most of its reads (measured: 221 of 445 failed,
then succeeded in 15-30ms each once it had settled).

1. On the Health screen, open **Rebuild everything instead** and press
   **Rebuild Everything**. Let it finish. Note the duration it reports.
2. Press **Reindex changed only** without touching anything in ProPresenter.
   Expect it to finish in seconds and report `0 changed, 0 new` with everything
   unchanged. If it reports a large number changed, the fingerprints are not
   stable across runs — stop and report it, because it means every reindex is
   really a full rebuild.
3. In ProPresenter, edit the text of one slide in one song and save it.
4. Press **Reindex changed only** again. Expect `1 changed` and a run of a few
   seconds.
5. Search for the words you just typed. They should be found, in that song.
   Search for the words you replaced — they should be gone.
6. Click **Go Live** on the edited slide and confirm the right slide fires.
   (The slide anchors are re-read as part of the reindex, so this catches the
   case where the entry was carried over when it should not have been.)
7. Without pressing anything, edit another slide in ProPresenter and save it,
   then wait about fifteen seconds and look at the Health screen. The index
   should have picked up the change on its own, and the watcher line should say
   what it did. This is the automatic path; if it never fires, the manual button
   still works, so report it rather than treating search as broken.
8. Now change **Preferred arrangements** under Settings > Search & indexing and
   press **Reindex changed only**. It should say a full rebuild was needed
   rather than reindexing — the arrangement choice changes what every entry
   means, so carrying entries over would leave the index a mix of two
   arrangements. Expect it to take as long as step 1.

**Step 2 verified 2026-08-30, which is the claim that carries the feature.**
With nothing touched in ProPresenter, "Reindex changed only" finished in **68ms**
and reported **445 carried over, 0 changed, 0 added, 0 unverifiable**. So the
fingerprints are stable across runs and an incremental reindex genuinely re-reads
nothing. Had this reported a large number changed, every incremental reindex
would in truth have been a full rebuild.

**Steps 1, 3–8 still need a person, for two different reasons.** Steps 3–7 need a
slide edited and saved in ProPresenter, which its API cannot do. Steps 1 and 8
both force a full rebuild, and they were deliberately not run the evening before
a service: a rebuild that fails or half-completes would degrade search on the
Sunday, and the index was known-good at 445 presentations. Run them on a
weekday, as the top of this section says.

If ProPresenter is configured on another machine (host is not localhost),
reindexing has no files to check and should always report a full rebuild.

---

## 2d. Performance mode

The claim is that Refrain holds completely still while you are live.

1. With nothing on the screens, open **Live**. Performance mode should read
   *Off*, and say when it last checked.
2. Put something on the screens and leave it there for three minutes. It should
   turn itself **On** without you touching it, and say it is on because
   ProPresenter is showing something.
3. Open **Health**. The Search Index card should say plainly that it is not
   indexing in the background, and search should still work normally.
4. Clear the screens and wait. It should stand down on its own after about
   twenty minutes.
5. Press **Turn on** by hand with the screens clear, then wait a few minutes.
   It must stay on — a manual choice is not undone by a timer. Press **Turn
   off** to release it.
6. Quit ProPresenter. Within a minute performance mode should go **On** by
   itself, saying it cannot tell whether you are live. Start ProPresenter
   again and it should stand down once it can see the screens are clear.

**Steps 1, 2, 3 and 5 verified 2026-08-30 on the live rig.**

- Step 1: with the screens clear it read Off, source `null`.
- Step 2: **it armed itself.** After two minutes of continuous output it went
  On with source `auto` and the explanation "On because ProPresenter is showing
  something". Worth knowing that it survived the live slide *changing* partway
  through: performance mode tracks whether the rig is live, not which slide is,
  so its timer does not restart when the operator advances. The live readout's
  elapsed clock does restart, and that difference is correct in both cases.
- Step 3: search kept working normally while armed (300 results), and the
  **Reindex changed only** button still worked — an operator who explicitly
  asks for a reindex gets one; the mode suppresses what Refrain would do on its
  own, not what it is told to do.
- Step 5: a manual arm outlasted clearing the screens, staying On with source
  `manual`, and released only when told to.

**Steps 4 and 6 not run.** Step 4 needs a twenty-minute wait. Step 6 means
quitting the church's ProPresenter, which is not something to do to someone
else's rig without asking. The unknown-state arm behind step 6 does have unit
coverage in `test/performance-mode.test.js`.

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
