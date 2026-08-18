#!/usr/bin/env python3
"""Long-lived JSONL bridge between Vellium and a pinned TeraTTSv2 snapshot."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import io
import json
import re
import sys
import wave
from pathlib import Path
from typing import Any

# These imports are intentionally explicit so PyInstaller includes the runtime
# dependencies used by the model's dynamically loaded, commit-pinned code.
import num2words  # noqa: F401
import numpy as np
import onnxruntime  # noqa: F401
from transformers import AutoTokenizer  # noqa: F401


RUNTIME_VERSION = "2"
SAMPLE_RATE = 44_100
VOICES = {
    "ru_f1", "ru_m5", "ru_f2", "ru_m1", "eng_f3", "eng_f4_whisper",
    "eng_f5", "eng_m2_whisper", "eng_m3", "eng_m4",
}
LANGUAGE_TAG = re.compile(r"<(?:ru|en)>.*?</(?:ru|en)>", re.DOTALL)
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
SENTENCE = re.compile(r"[^\n.!?…]+(?:[.!?…]+|$)|\n+", re.UNICODE)


def configure_utf8_stdio() -> None:
    """Keep the JSONL protocol UTF-8 even under a Windows system code page."""
    stdin_reconfigure = getattr(sys.stdin, "reconfigure", None)
    if callable(stdin_reconfigure):
        stdin_reconfigure(encoding="utf-8", errors="strict")
    stdout_reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(stdout_reconfigure):
        stdout_reconfigure(
            encoding="utf-8", errors="strict", newline="\n", write_through=True
        )
    stderr_reconfigure = getattr(sys.stderr, "reconfigure", None)
    if callable(stderr_reconfigure):
        stderr_reconfigure(
            encoding="utf-8", errors="backslashreplace", newline="\n", write_through=True
        )


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def tag_text(value: str) -> str:
    """Supply the mandatory Tera language tags without exposing them in UI."""
    text = str(value or "").strip()
    if not text:
        raise ValueError("TTS input is empty")
    if LANGUAGE_TAG.search(text):
        return text
    # Unsupported markup is not meaningful model input and would make the
    # upstream language-tag validator reject an otherwise speakable message.
    text = text.replace("<", " ").replace(">", " ")
    segments: list[str] = []
    for match in SENTENCE.finditer(text):
        segment = match.group(0)
        if not segment.strip():
            continue
        language = "ru" if CYRILLIC.search(segment) else "en"
        segments.append(f"<{language}>{segment.strip()}</{language}>")
    if not segments:
        language = "ru" if CYRILLIC.search(text) else "en"
        segments.append(f"<{language}>{text}</{language}>")
    return " ".join(segments)


def load_teratts(model_dir: Path):
    entrypoint = model_dir / "teratts.py"
    if not entrypoint.is_file():
        raise FileNotFoundError(f"TeraTTS model snapshot is missing {entrypoint.name}")
    sys.path.insert(0, str(model_dir))
    spec = importlib.util.spec_from_file_location("teratts", entrypoint)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load the pinned TeraTTS model code")
    module = importlib.util.module_from_spec(spec)
    sys.modules["teratts"] = module
    spec.loader.exec_module(module)
    return module


def wav_bytes(waveform: np.ndarray) -> bytes:
    pcm = np.rint(np.clip(waveform, -1.0, 1.0) * 32767.0).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(pcm.tobytes())
    return output.getvalue()


def pcm_bytes(waveform: np.ndarray) -> bytes:
    return np.rint(np.clip(waveform, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def serve(model_dir: Path, threads: int, ruaccent_mode: str) -> None:
    teratts = load_teratts(model_dir)
    loaded = teratts.load_model(
        model_dir,
        model="distilled",
        provider="CPUExecutionProvider",
        threads=threads,
        russian_stress=True,
        ruaccent_mode=ruaccent_mode,
    )
    emit({"type": "ready", "runtimeVersion": RUNTIME_VERSION, "sampleRate": SAMPLE_RATE})
    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("id") or "")
            if not request_id:
                raise ValueError("request id is required")
            voice = str(request.get("voice") or "ru_f1")
            if voice not in VOICES:
                raise ValueError(f"Unknown TeraTTS voice: {voice}")
            text = tag_text(str(request.get("text") or ""))
            duration_scale = float(request.get("durationScale") or 1.0)
            if not 0.5 <= duration_scale <= 2.0:
                raise ValueError("durationScale must be between 0.5 and 2.0")
            if request.get("stream") is True:
                for chunk in teratts.generate_speech_stream(
                    loaded, text, voice, duration_scale=duration_scale, chunk_frames=8
                ):
                    emit({
                        "id": request_id,
                        "type": "audio",
                        "format": "pcm",
                        "sampleRate": SAMPLE_RATE,
                        "audioBase64": base64.b64encode(pcm_bytes(chunk)).decode("ascii"),
                    })
            else:
                waveform = teratts.generate_speech(
                    loaded, text, voice, duration_scale=duration_scale
                )
                emit({
                    "id": request_id,
                    "type": "audio",
                    "contentType": "audio/wav",
                    "audioBase64": base64.b64encode(wav_bytes(waveform)).decode("ascii"),
                })
            emit({"id": request_id, "type": "done"})
        except Exception as error:  # keep the loaded process alive after bad input
            emit({"id": request_id, "type": "error", "message": str(error)[:2000]})


def main() -> None:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Vellium TeraTTSv2 runtime")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--protocol-self-test", action="store_true")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--ruaccent-mode", choices=("full", "dictionary"), default="full")
    parser.add_argument("command", nargs="?", choices=("serve",))
    args = parser.parse_args()
    if args.version:
        print(RUNTIME_VERSION)
        return
    if args.protocol_self_test:
        line = sys.stdin.readline()
        request = json.loads(line)
        emit({"type": "protocol-self-test", "text": str(request.get("text") or "")})
        return
    if args.command != "serve" or args.model_dir is None:
        parser.error("serve requires --model-dir")
    if not 1 <= args.threads <= 32:
        parser.error("--threads must be between 1 and 32")
    serve(args.model_dir.resolve(), args.threads, args.ruaccent_mode)


if __name__ == "__main__":
    main()
