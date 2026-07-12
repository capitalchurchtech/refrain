# Follow (experimental)

Auto-advance ProPresenter slides by listening to the live vocal feed and
transcribing it **on-device** with Whisper (Apple Silicon / MLX).

> **Status: Phase 1 — transcription harness only.** This does not advance
> slides yet. It captures audio, transcribes it live, and shows you the
> text so we can judge whether on-device Whisper is good enough on real,
> sung, band-backed vocals before building song matching and slide
> following (Phase 2). It is an unvalidated experiment, built to be cheap
> to remove.

## Why this exists

Cloud streaming speech-to-text (Soniox, Deepgram, …) falls apart on sung
vocals over a band. Whisper handles music much better, but it's batch-only,
which historically ruled it out for live use. Running Whisper locally on
Apple Silicon via MLX is fast enough to transcribe short overlapping chunks
in near-real-time — that's the bet this module tests. No audio ever leaves
the machine.

## Requirements

- **macOS on Apple Silicon (M-series).** MLX is Apple-Silicon-only. On any
  other platform the module stays inert: the Health toggle appears but
  explains it can't run, and nothing is loaded or started.
- **ffmpeg** — audio capture and resampling: `brew install ffmpeg`
- **Python 3 with `mlx-whisper`** — the transcriber:
  `pip3 install mlx-whisper numpy`
- **A Whisper model, pre-downloaded.** The sidecar runs fully offline (no
  network, ever), so fetch the model once first, e.g.:
  ```
  huggingface-cli download mlx-community/whisper-small-mlx
  ```
  (Match the model you pick on the Follow screen — `small` is the default.)

None of these are Refrain dependencies. They are **not** in `package.json`
or the install scripts, and `npm install && npm start` never needs them. A
church that doesn't use Follow never installs any of this.

## Enabling it

1. Open **Health → Configuration → Experimental modules**.
2. Tick **Enable Follow**. (Or set `followModule.enabled` to `true` in
   `config.json`.)
3. A **Follow** entry appears in the sidebar. Open it, pick your input, and
   press **Start**.

On the Follow screen:

- **Source** — a live input device, or a recorded **WAV file** (offline
  mode) so you can replay a service and iterate without being at church.
- **Input device / Channel** — pick the interface, and optionally isolate a
  single channel (e.g. a vocal-only aux off the board) instead of the L/R mix.
- **Model** — `small` by default; larger is more accurate but slower.
- **Input level** meter confirms audio is actually arriving.
- **Export session log** downloads every transcript chunk (deduped and raw)
  as JSON — that's the raw material for deciding whether Phase 2 is worth it.

## How it works

```
ffmpeg (capture + resample to 16kHz mono s16le)
   → Node backend (level meter, pipe)
      → stt_sidecar.py (rolling 4s window every 1s, Whisper via MLX)
         → JSON transcript lines
   → Node dedupes overlapping windows → SSE → the Follow screen
```

- `stt_sidecar.py` — the Python transcriber. PCM in on stdin, newline JSON
  out on stdout. No network.
- `backend.js` — audio capture, sidecar lifecycle, overlap dedup, the SSE
  stream, and all `/api/module/follow/*` routes. Loaded lazily by the
  generic module host and only while the module is enabled.
- `public/follow.js` — the screen.
- `module.js` — nav metadata + the platform gate + the enable flag key.

## Privacy

No network calls at runtime. Audio is processed entirely on-device; the
Whisper stack is forced offline. The only network access ever involved is
the **one-time** manual model download above, which you run yourself.

## Removing it

Follow is built to be killed cheaply.

- **Turn it off:** untick the Health toggle (or set
  `followModule.enabled: false`). The sidebar entry disappears and the
  sidecar/ffmpeg are torn down immediately — no lingering processes.
- **Remove it entirely:** delete the `modules/follow/` folder. Refrain keeps
  working with no change; the generic module host simply stops finding it.
  Then, to tidy up:
  - delete the `followModule` key from `config.json` (and
    `config.example.json`),
  - delete the `data/follow/` folder (saved device/model settings), if present.

Nothing in Refrain's core imports this module, so its removal can't break
search or anything else.
