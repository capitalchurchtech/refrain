#!/usr/bin/env python3
"""
Follow module — on-device speech-to-text sidecar (Phase 1).

Reads raw 16 kHz / mono / signed-16-bit-LE PCM from stdin and emits
newline-delimited JSON transcript objects to stdout:

    {"t": <epoch ms>, "text": "...", "conf": <float 0..1 or null>}

Design notes (see modules/follow/README.md):

- Whisper (via Apple-Silicon MLX) handles sung vocals over a band far
  better than cloud streaming STT, but it's batch-only. We approximate
  "live" by transcribing a rolling ~4 s window every ~1 s, so a phrase
  is never split across a hard chunk boundary. Consecutive windows
  overlap heavily on purpose; the Node side dedupes that overlap.
- No network, ever. Hugging Face hub access is forced offline below, so
  the model must be present in the local cache before first use (the
  module's dependency check and README cover that one-time download).
  This keeps Refrain's "nothing phones home" guarantee intact at runtime.
- Everything that isn't a transcript line goes to stderr, which the Node
  backend forwards into the Refrain logs — stdout stays a clean JSON
  stream.

Phase 2 (song matching / slide following) lives entirely on the Node
side and downstream of this stream; this sidecar stays a dumb, private
"PCM in, text out" pipe with no knowledge of songs or ProPresenter.
"""

import json
import os
import sys
import time

# Force the Hugging Face stack offline *before* importing anything that
# touches it, so a missing model fails fast and locally instead of
# silently reaching out to the network. This is what lets the module
# honestly claim "no network calls, ever" at runtime.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

SAMPLE_RATE = 16000          # must match the ffmpeg resample on the Node side
BYTES_PER_SAMPLE = 2         # s16le
WINDOW_SECONDS = 4.0         # how much audio each transcription sees
HOP_SECONDS = 1.0            # how often we transcribe
READ_SECONDS = 0.25          # stdin read granularity

WINDOW_SAMPLES = int(WINDOW_SECONDS * SAMPLE_RATE)
HOP_SAMPLES = int(HOP_SECONDS * SAMPLE_RATE)
READ_BYTES = int(READ_SECONDS * SAMPLE_RATE) * BYTES_PER_SAMPLE

# Short model names -> the community MLX Whisper repos on Hugging Face.
# An unrecognized value is passed through verbatim, so a user can point
# at any local path or repo id they've already downloaded.
MODEL_REPOS = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large": "mlx-community/whisper-large-v3-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


def log(msg):
    """Diagnostics to stderr; stdout is reserved for the JSON stream."""
    print(f"[stt_sidecar] {msg}", file=sys.stderr, flush=True)


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def resolve_model(name):
    return MODEL_REPOS.get(name, name)


def mean_confidence(result):
    """
    Rough 0..1 confidence from Whisper's per-segment average log-prob.
    Whisper doesn't expose a calibrated probability, so this is only a
    relative signal (useful later for Phase 2 gating), not a guarantee.
    Returns None when there are no segments to derive it from.
    """
    import math

    segments = result.get("segments") or []
    logprobs = [s.get("avg_logprob") for s in segments if s.get("avg_logprob") is not None]
    if not logprobs:
        return None
    avg = sum(logprobs) / len(logprobs)
    try:
        return max(0.0, min(1.0, math.exp(avg)))
    except OverflowError:
        return None


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "small"
    model_repo = resolve_model(model_name)

    try:
        import numpy as np
        import mlx_whisper
    except Exception as err:  # noqa: BLE001 - surface any import failure to Node
        emit({"t": int(time.time() * 1000), "error": f"import_failed: {err}"})
        log(f"Failed to import dependencies: {err}")
        log("Install with: pip3 install mlx-whisper numpy")
        return 3

    log(f"Ready. model={model_name} ({model_repo}), "
        f"window={WINDOW_SECONDS}s hop={HOP_SECONDS}s, offline=1")

    # Rolling buffer of the most recent WINDOW_SAMPLES samples, as int16.
    buffer = np.zeros(0, dtype=np.int16)
    total_samples = 0
    last_transcribed_at = 0

    def transcribe_window():
        window = buffer[-WINDOW_SAMPLES:]
        if window.size == 0:
            return
        # mlx-whisper expects float32 in [-1, 1].
        audio = window.astype(np.float32) / 32768.0
        try:
            result = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=model_repo,
                # Deterministic, low-latency settings for short windows.
                temperature=0.0,
                condition_on_previous_text=False,
                fp16=True,
            )
        except Exception as err:  # noqa: BLE001
            # Most likely: model not in the local cache while offline.
            emit({"t": int(time.time() * 1000), "error": f"transcribe_failed: {err}"})
            log(f"Transcription failed: {err}")
            log(f"Is '{model_repo}' downloaded? See modules/follow/README.md "
                f"(one-time: huggingface-cli download {model_repo}).")
            return

        text = (result.get("text") or "").strip()
        if text:
            emit({"t": int(time.time() * 1000), "text": text, "conf": mean_confidence(result)})

    stdin = sys.stdin.buffer
    try:
        while True:
            data = stdin.read(READ_BYTES)
            if not data:
                break  # upstream (ffmpeg) closed — capture stopped

            import numpy as np  # local ref; already imported above
            samples = np.frombuffer(data, dtype=np.int16)
            buffer = np.concatenate([buffer, samples])[-WINDOW_SAMPLES:]
            total_samples += samples.size

            if total_samples - last_transcribed_at >= HOP_SAMPLES:
                last_transcribed_at = total_samples
                transcribe_window()
    except KeyboardInterrupt:
        pass
    except Exception as err:  # noqa: BLE001
        log(f"Fatal loop error: {err}")
        return 1

    # Flush whatever's left in the final partial window on a clean EOF.
    if buffer.size:
        transcribe_window()
    log("stdin closed — exiting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
