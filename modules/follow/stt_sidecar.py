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

# Whisper was trained only on 30 s segments, and accuracy improves as input
# length approaches that — a bare 4 s slice sits near the worst point on the
# length curve and invites the decoder to invent speech into the padding.
# Every production streaming Whisper (whisper.cpp `stream`, WhisperKit) uses a
# long accumulating buffer with a short hop instead, so we do too: the window
# is what each transcription SEES, the hop is how often we run.
WINDOW_SECONDS = float(os.environ.get("REFRAIN_FOLLOW_WINDOW", "10.0"))
HOP_SECONDS = float(os.environ.get("REFRAIN_FOLLOW_HOP", "1.0"))
READ_SECONDS = 0.25          # stdin read granularity

# Language is pinned rather than detected. Whisper's per-window language
# detection on sung audio is unreliable and costs real accuracy (on the
# Jam-ALT lyrics benchmark, simply declaring the language moved large-v2 from
# 37.8 to 27.9 WER). It also removes a class of "decided this was Welsh and
# hallucinated" failures. Override for a non-English service.
LANGUAGE = os.environ.get("REFRAIN_FOLLOW_LANGUAGE", "en") or None

# Whisper hallucinates confidently on non-speech audio — instrumental pads,
# reverb tails and room noise all read as singing, and a blank slide can fire
# repeatedly off pure invention. A cheap RMS gate in front of the decoder is
# the single most effective mitigation here, and RMS thresholding is MORE
# reliable on an isolated vocal aux than on a full mix. Below this level the
# window is treated as silence and never reaches the model at all.
SILENCE_RMS = float(os.environ.get("REFRAIN_FOLLOW_SILENCE_RMS", "0.005"))

# A degenerate, looping transcription compresses far better than real text.
# Whisper's own fallback uses this signal, but only when a temperature TUPLE
# is supplied — a scalar temperature disables the fallback loop entirely, so
# we both pass the tuple and check the ratio ourselves.
MAX_COMPRESSION_RATIO = 2.2
TEMPERATURE_FALLBACK = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)

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
    "large-v2": "mlx-community/whisper-large-v2-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    # Qwen3-ASR is the only mainstream open ASR model that lists singing as a
    # supported audio type, and it beats Whisper on every published singing
    # benchmark. Those benchmarks are mostly Mandarin, so treat it as the
    # experiment worth running on real worship vocals, not a settled upgrade.
    # Runs through mlx-audio rather than mlx-whisper (a separate install).
    "qwen3-asr-0.6b": "mlx-community/Qwen3-ASR-0.6B-8bit",
    "qwen3-asr-1.7b": "mlx-community/Qwen3-ASR-1.7B-8bit",
}


def backend_for(model_name, repo):
    """Which Python stack a model needs: mlx-whisper, or mlx-audio for Qwen3-ASR."""
    probe = f"{model_name} {repo}".lower()
    return "qwen3" if "qwen3-asr" in probe else "whisper"


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


def looks_degenerate(result):
    """
    True when a window's segments look like a repetition loop rather than
    real singing. Whisper's text compresses unusually well when it has gotten
    stuck repeating a phrase, which is the classic music-hallucination shape.
    """
    for seg in result.get("segments") or []:
        ratio = seg.get("compression_ratio")
        if ratio is not None and ratio > MAX_COMPRESSION_RATIO:
            return True
    return False


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "small"
    model_repo = resolve_model(model_name)

    backend = backend_for(model_name, model_repo)

    try:
        import numpy as np
    except Exception as err:  # noqa: BLE001
        emit({"t": int(time.time() * 1000), "error": f"import_failed: numpy ({err})"})
        log("Failed to import numpy. Install with: pip3 install numpy")
        return 3

    # Each backend is imported only if it's the one selected, so trying Qwen3
    # never requires mlx-whisper and vice versa.
    if backend == "qwen3":
        try:
            import mlx.core as mx
            from mlx_audio.stt.utils import load_model
        except Exception as err:  # noqa: BLE001
            emit({"t": int(time.time() * 1000), "error": f"import_failed: mlx-audio ({err})"})
            log(f"Failed to import mlx-audio: {err}")
            log("Install with: pip3 install -U mlx-audio")
            return 3
        try:
            qwen_model = load_model(model_repo)
        except Exception as err:  # noqa: BLE001
            emit({"t": int(time.time() * 1000), "error": f"model_load_failed: {err}"})
            log(f"Failed to load {model_repo}: {err}")
            log(f"Is it downloaded? One-time: huggingface-cli download {model_repo}")
            return 4

        def run_model(audio_f32):
            """
            mlx-audio's generate_transcription() accepts `audio` as a path OR an
            mx.array and simply forwards it to model.generate(), so we hand it
            samples directly rather than writing a WAV every hop. Qwen3-ASR
            exposes no per-segment logprobs, so confidence is unavailable.
            """
            out = qwen_model.generate(mx.array(audio_f32))
            # Streaming-capable models yield; batch ones return a single result.
            if hasattr(out, "__iter__") and not hasattr(out, "text"):
                out = "".join(getattr(part, "text", "") or "" for part in out)
            text = out if isinstance(out, str) else (getattr(out, "text", "") or "")
            return text.strip(), None, None
    else:
        try:
            import mlx_whisper
        except Exception as err:  # noqa: BLE001
            emit({"t": int(time.time() * 1000), "error": f"import_failed: mlx-whisper ({err})"})
            log(f"Failed to import mlx-whisper: {err}")
            log("Install with: pip3 install mlx-whisper numpy")
            return 3

        def run_model(audio_f32):
            result = mlx_whisper.transcribe(
                audio_f32,
                path_or_hf_repo=model_repo,
                language=LANGUAGE,
                # A temperature TUPLE (not a scalar) is what arms Whisper's
                # fallback loop, which is what makes its compression-ratio and
                # logprob hallucination checks fire at all.
                temperature=TEMPERATURE_FALLBACK,
                condition_on_previous_text=False,
                fp16=True,
            )
            return (result.get("text") or "").strip(), mean_confidence(result), result

    log(f"Ready. model={model_name} ({model_repo}) backend={backend}, lang={LANGUAGE or 'auto'}, "
        f"window={WINDOW_SECONDS}s hop={HOP_SECONDS}s, silence_rms={SILENCE_RMS}, offline=1")

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

        # Silence gate, before the model sees anything. Whisper will happily
        # transcribe a reverb tail or an instrumental pad into confident
        # nonsense, so a window with no real signal is simply never decoded.
        rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
        if rms < SILENCE_RMS:
            return

        try:
            text, conf, result = run_model(audio)
        except Exception as err:  # noqa: BLE001
            # Most likely: model not in the local cache while offline.
            emit({"t": int(time.time() * 1000), "error": f"transcribe_failed: {err}"})
            log(f"Transcription failed: {err}")
            log(f"Is '{model_repo}' downloaded? See modules/follow/README.md "
                f"(one-time: huggingface-cli download {model_repo}).")
            return

        if not text:
            return
        # Drop a degenerate window rather than feeding a repetition loop
        # downstream. Confidence is NOT a usable filter here: hallucinated
        # segments frequently carry high avg_logprob and low no_speech_prob,
        # so the compression ratio is the signal that actually separates them.
        # Whisper-only: Qwen3-ASR returns no segments to measure.
        if result is not None and looks_degenerate(result):
            log(f"Dropped a degenerate window (compression ratio): {text[:60]!r}")
            return
        emit({"t": int(time.time() * 1000), "text": text, "conf": conf})

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
