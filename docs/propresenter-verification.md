# ProPresenter verification checklist

Refrain is tested against ProPresenter 21.3. If you run another version, or just
want to see the live features work on your own rig before a Sunday depends on
them, this checklist takes about twenty minutes. Where something can fail because
ProPresenter answers differently, it says exactly what to capture, so an issue
can be fixed quickly.

Run it on the machine that runs ProPresenter, with ProPresenter open and its
Network API on (Preferences › Network). Use a throwaway presentation and
playlist. **Several steps put slides on your real outputs**, so do this when
nothing is happening for an hour or two, never near a service.

Replace `HOST:PORT` below with the host and port from setup (Settings › Features ›
Options › ProPresenter). ProPresenter serves its API over plain HTTP.

## 1. Connection

- [ ] The **LINK** lamp at the top of the rail is lit, and **Settings › Status**
      shows ProPresenter as Linked.

Relies on `GET /v1/status/layers`. If this fails nothing else will work: check
the host, the port and the Network API setting first, then try **Settings ›
System › ProPresenter connection › Diagnose**.

## 2. Search, Go Live and Show

- [ ] On **Search**, type a word you know is on a slide. Results appear.
- [ ] **Go Live** on a result puts exactly that slide on the screens.
- [ ] **Show** on a result switches ProPresenter's editor to that presentation
      without changing what is live.

Relies on `GET /v1/presentation/{uuid}/{index}/trigger` and
`GET /v1/presentation/{uuid}/focus`.

## 3. Arrangements

A song's arrangements reorder and repeat groups, so the same slide has a
different number in each. Go Live sends a number, so this is the check that
matters most.

- [ ] Pick a song with two arrangements of different lengths. Search a lyric in
      it and **Go Live**: the slide you clicked goes up.
- [ ] Switch the song to its other arrangement in ProPresenter, without
      reindexing. Search the same lyric and **Go Live** again. The same slide
      should go up, because Refrain reads the selected arrangement at click time
      and finds the slide by its group and place.
- [ ] Search a lyric from a repeated chorus. It appears once, marked "sung N×",
      and Go Live lands on the first time it is sung.
- [ ] In a presentation with a disabled slide, **Go Live** on a slide after it.
      The right slide goes up. (Refrain counts disabled slides, as ProPresenter
      does. If yours doesn't, every slide after a disabled one fires one off.)

Relies on `GET /v1/presentation/{uuid}`, read when you click.

## 4. Reading from files

- [ ] **Settings › Search**, Search index card: the line "Read from
      ProPresenter's library files: N presentations" appears, with no warning
      about presentations not found in the library folders.
- [ ] Edit a slide's words in ProPresenter and save. About ten seconds later,
      search for the new words: they are found without pressing anything.

If that warning appears, capture its text and the path of your library folders
in Finder.

## 5. The Return bar

- [ ] Put a slide live in ProPresenter by hand.
- [ ] In Refrain, **Go Live** on a different presentation. The Return bar names
      the slide you were on.
- [ ] Advance a few slides by hand. The Return bar doesn't change.
- [ ] **Return** opens the earlier presentation in the editor and does not put it
      live.

Relies on `GET /v1/presentation/slide_index`. **If the bar never appears or names
the wrong slide**, capture this with a slide live and paste it into an issue:

```bash
curl -s http://HOST:PORT/v1/presentation/slide_index
```

Refrain expects
`{ "presentation_index": { "index": N, "presentation_id": { "uuid": "...", "name": "..." } } }`.

## 6. Now: the message poster

Set up a message with a text token in ProPresenter first (the "come to
childcare" kind).

- [ ] **Now › Message to the screens** shows a box for the token.
- [ ] Type a code and **Post**. It appears on the outputs.
- [ ] **Clear** takes it off, and nothing else.

Relies on `GET /v1/messages`, `POST /v1/message/{uuid}/trigger` and
`GET /v1/message/{uuid}/clear`. **If the poster never appears or Post does
nothing**, capture:

```bash
curl -s http://HOST:PORT/v1/messages
```

Refrain reads each message's `id.uuid` and `id.name`, finds its text tokens in
`message_components` (or a `tokens` array), and posts
`[{ "name": "<token>", "text": { "text": "<your code>" } }]`.

## 7. Now: stage message

- [ ] A preset shows on the stage screens' Stage Message box, and not to the
      audience.
- [ ] **Clear stage message** takes it down.

Relies on `GET`, `PUT` and `DELETE /v1/stage/message`.

## 8. Now: Looks, Macros and safe slides

Switch on Looks, Macros and Safe slides in **Settings › Features** first.

- [ ] **Looks** lists your Looks by name, the heading names the current one, and
      a press switches to it.
- [ ] **Macros** lists your macros in their colours, and a press runs one.
- [ ] With a slide on the screens, **Keep current** under Safe slides keeps it,
      and a press later puts it back up.

Relies on `GET /v1/looks`, `GET /v1/look/current`, `GET /v1/look/{uuid}/trigger`,
`GET /v1/macros` and `GET /v1/macro/{uuid}/trigger`; safe slides on
`GET /v1/presentation/{uuid}` and `GET /v1/presentation/{uuid}/{index}/trigger`. If a list is empty when you have Looks or macros,
capture `curl -s http://HOST:PORT/v1/looks` (or `/v1/macros`). Refrain expects
each entry to carry `id.uuid` and `id.name`.

## 9. Performance mode

- [ ] Put a slide up and leave it. After about two minutes the **PERF** lamp
      lights.
- [ ] **Settings › Status › Performance mode › Turn off**, then **Turn on**: it
      stays on until you turn it off by hand.
- [ ] Clear the screens with performance mode turned on by itself. About 20
      minutes later it goes off on its own.
- [ ] Quit ProPresenter. The **LINK** lamp goes out and performance mode turns
      on; reopen it and both recover.

## 10. Quality Control

Turn protection off in **Settings › Search › Advanced** for this step, and back
on afterwards.

- [ ] **Quality Control** lists your playlists. Pick one and **Check spelling**.
- [ ] Findings appear slide by slide with a picture of each slide.
- [ ] **Fix in ProPresenter** opens the presentation in the editor.

Relies on `GET /v1/playlists`, `GET /v1/playlist/{uuid}`,
`GET /v1/presentation/{uuid}`,
`GET /v1/presentation/{uuid}/thumbnail/{index}` and
`GET /v1/presentation/{uuid}/focus`.

## 11. Phones (if you use them)

- [ ] **Settings › More › Phones › Open the Phone panel › Turn on phones**. Scan the QR
      code with a phone on the same network and sign in with today's PIN.
- [ ] **Service** shows what is on the screens and where the service is.
- [ ] **Add flag** on the slide on the screens. It appears on the booth's
      **Flags** screen with a picture.
- [ ] Approve the phone with **Allow alerts**, type the device code on the phone,
      and send a stage message. It needs a second tap and then shows on stage.

## Reporting

Open an issue with your ProPresenter version, the step that failed, and the
`curl` output from the step's capture note. With that, fixing an endpoint is
usually a small change.
