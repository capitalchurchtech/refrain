# Follow (experimental)

Groundwork for auto-advancing ProPresenter slides by listening to the live
vocal feed and transcribing it **on-device** with Whisper (Apple Silicon /
MLX).

> **Status: Phase 1 — transcription harness only.** It does not advance
> slides. It captures audio, transcribes it live, and shows the text next to
> what ProPresenter currently has live, so we can judge whether on-device
> Whisper is good enough on real, sung, band-backed vocals before building
> song matching and slide following (Phase 2). It's an unvalidated
> experiment, built to be cheap to remove.

## Why

Cloud streaming speech-to-text falls apart on sung vocals over a band.
Whisper handles music much better but is batch-only, which historically
ruled it out live. Running Whisper locally on Apple Silicon via MLX is fast
enough to transcribe short overlapping chunks in near-real-time — that's the
bet. No audio ever leaves the machine.

## Requirements

- **macOS on Apple Silicon (M-series).** MLX is Apple-Silicon-only.
  Elsewhere the module stays inert: the Health toggle appears but reports
  it can't run, and nothing is started (`getFollowModuleStatus` →
  `misconfigured`).
- **ffmpeg** — audio capture/resampling: `brew install ffmpeg`
- **Python 3 + `mlx-whisper`** — the transcriber: `pip3 install mlx-whisper numpy`
- **A Whisper model, pre-downloaded.** The sidecar runs fully offline, so
  fetch the model once first, e.g.:
  `huggingface-cli download mlx-community/whisper-small-mlx`
  (match the model chosen on the Follow screen; `small` is the default).

None of these are Refrain dependencies. They are **not** in `package.json`
or the install scripts, and `npm install && npm start` never needs them.
They're detected lazily, only when the Follow screen asks or on Start.

## Enabling

1. **Health → Configuration → Follow → Enable Follow** (or set
   `followModule.enabled` to `true` in `config.json`).
2. A **Follow** entry appears in the sidebar (after a reload, same as the
   other gated modules). Open it, pick an input, press **Start**.

On the Follow screen:

- **Source** — a live input device, or a recorded **WAV file** (offline
  mode) to replay a service without being at church.
- **Input device / Channel** — pick the interface and, optionally, isolate a
  single channel (a vocal-only aux off the board) instead of the L/R mix.
- **Model** — `small` by default.
- **Input level** confirms audio is arriving.
- **Live transcript** (Whisper) sits next to **Live in ProPresenter**
  (`/api/live-state`) so you can see whether the transcription tracks the
  song that's actually on the screens.
- **Export** downloads the whole session (deduped chunks + every raw window)
  as JSON — the raw material for deciding whether Phase 2 is worth building.

## Files

- `modules/follow/module.js` — nav metadata (gated, off by default).
- `modules/follow/stt_sidecar.py` — the Python/MLX transcriber. PCM in on
  stdin, newline-JSON out. No network.
- `server/follow.js` — audio capture, sidecar lifecycle, overlap dedup, the
  SSE stream; `/api/follow/*` routes live in `server/index.js`.
- `public/follow.js` — the screen.
- `getFollowModuleStatus()` in `server/config.js` — the off/misconfigured/
  active gate.

## How it works

```
ffmpeg (capture + resample to 16kHz mono s16le)
   → server/follow.js (level meter, pipe)
      → stt_sidecar.py (rolling 4s window every 1s, Whisper via MLX)
         → JSON transcript lines
   → dedup overlapping windows → SSE → the Follow screen
```

Phase 2 plugs in downstream of these transcript chunks: match them against
the existing search index to identify the song, use `/api/live-state` for
current position, and trigger the next slide through ProPresenter.

## Privacy

No network at runtime. Audio is processed entirely on-device; the Whisper
stack is forced offline. The only network access ever involved is the
**one-time** manual model download above, which you run yourself.

## Removing it

- **Turn it off:** untick the Health toggle (or set
  `followModule.enabled: false`). The sidebar entry disappears (on reload)
  and any capture is torn down immediately — no lingering processes.
- **Remove it entirely:** delete `modules/follow/`, `server/follow.js`,
  `public/follow.js`, and the Follow lines in `server/index.js`,
  `server/config.js`, and `public/main.js` / `public/health.js` /
  `public/index.html`. Then delete the `followModule` (and `_followModule`)
  keys from `config.json` / `config.example.json`. Nothing in core search
  depends on it.
