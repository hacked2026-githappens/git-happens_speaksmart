from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from llm import analyze_with_ollama, map_llm_events

logger = logging.getLogger(__name__)


def bootstrap_ffmpeg_path() -> None:
    """Best-effort PATH fix for common Windows winget FFmpeg install locations."""
    if shutil.which("ffmpeg"):
        return

    candidates: list[Path] = []
    env_bin = os.getenv("FFMPEG_BIN")
    if env_bin:
        candidates.append(Path(env_bin))

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        winget_packages = Path(local_appdata) / "Microsoft" / "WinGet" / "Packages"
        if winget_packages.exists():
            candidates.extend(winget_packages.glob("Gyan.FFmpeg_*\\ffmpeg-*\\bin"))

    for candidate in candidates:
        if candidate.exists():
            os.environ["PATH"] = f"{candidate};{os.environ.get('PATH', '')}"
            if shutil.which("ffmpeg"):
                logger.info("FFmpeg discovered at %s", candidate)
                return


bootstrap_ffmpeg_path()

app = FastAPI(
    title="Presentation Coach API",
    version="0.1.0",
    description="Analyze recorded speaking sessions and return coaching feedback.",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]
allow_credentials = "*" not in allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

FILLER_WORDS = {
    "um",
    "uh",
    "like",
    "you know",
    "actually",
    "basically",
    "literally",
    "so",
}
PACE_SLOW_WPM = 110
PACE_FAST_WPM = 170


class TimelineMarker(BaseModel):
    second: float = Field(ge=0)
    category: str
    severity: str = Field(pattern="^(info|warning|critical)$")
    message: str


class AnalyzeResponse(BaseModel):
    transcript: str
    metrics: dict[str, Any]
    summary_feedback: list[str]
    markers: list[TimelineMarker]
    llm_analysis: dict[str, Any]
    notes: list[str]


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Presentation Coach API is running."}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def tokenize(text: str) -> list[str]:
    return re.findall(r"\b[\w']+\b", text.lower())


def count_filler_words(text: str) -> dict[str, int]:
    lowered = text.lower()
    words = tokenize(lowered)
    counts = Counter(word for word in words if word in FILLER_WORDS)

    # Track two-word filler separately from token-level counting.
    phrase = "you know"
    phrase_count = lowered.count(phrase)
    if phrase_count:
        counts[phrase] = phrase_count

    return dict(sorted(counts.items(), key=lambda item: item[1], reverse=True))


def count_stutter_events(words: list[str]) -> int:
    if len(words) < 2:
        return 0
    return sum(1 for idx in range(1, len(words)) if words[idx] == words[idx - 1])


def classify_pace(wpm: float | None) -> str:
    if wpm is None:
        return "unknown"
    if wpm < PACE_SLOW_WPM:
        return "slow"
    if wpm > PACE_FAST_WPM:
        return "fast"
    return "good"


def build_speech_metrics(transcript: str, duration_seconds: float) -> dict[str, Any]:
    words = tokenize(transcript)
    word_count = len(words)
    filler_counts = count_filler_words(transcript)
    filler_total = sum(filler_counts.values())
    stutter_events = count_stutter_events(words)
    wpm = (word_count / duration_seconds) * 60 if duration_seconds > 0 else None

    return {
        "duration_seconds": round(duration_seconds, 2),
        "word_count": word_count,
        "words_per_minute": round(wpm, 1) if wpm is not None else None,
        "pace_label": classify_pace(wpm),
        "filler_word_count": filler_total,
        "filler_words": filler_counts,
        "stutter_events": stutter_events,
        "non_verbal": {
            "status": "not_analyzed_yet",
            "eye_contact": "unknown",
            "posture": "unknown",
            "gesture_energy": "unknown",
        },
    }


def build_timeline_markers(metrics: dict[str, Any]) -> list[TimelineMarker]:
    duration = float(metrics.get("duration_seconds", 0) or 0)
    duration = duration if duration > 0 else 30.0

    markers: list[TimelineMarker] = []

    pace = metrics.get("pace_label")
    if pace == "fast":
        markers.append(
            TimelineMarker(
                second=round(duration * 0.25, 2),
                category="pace",
                severity="warning",
                message="Pace is fast here. Add short pauses to improve clarity.",
            )
        )
    elif pace == "slow":
        markers.append(
            TimelineMarker(
                second=round(duration * 0.25, 2),
                category="pace",
                severity="warning",
                message="Pace is slow here. Tighten sentence openings and transitions.",
            )
        )

    filler_words = metrics.get("filler_words", {})
    for idx, (word, count) in enumerate(list(filler_words.items())[:3]):
        markers.append(
            TimelineMarker(
                second=round(duration * (0.35 + idx * 0.18), 2),
                category="filler_words",
                severity="warning" if count >= 3 else "info",
                message=f'Filler word "{word}" appears often ({count} times).',
            )
        )

    stutter_events = int(metrics.get("stutter_events", 0) or 0)
    if stutter_events > 0:
        markers.append(
            TimelineMarker(
                second=round(duration * 0.65, 2),
                category="fluency",
                severity="warning",
                message=f"Repeated-word stutters detected ({stutter_events}).",
            )
        )

    if not markers:
        markers.append(
            TimelineMarker(
                second=round(duration * 0.5, 2),
                category="overall",
                severity="info",
                message="Great baseline delivery. Keep practicing for consistency.",
            )
        )

    return sorted(markers, key=lambda marker: marker.second)


def build_summary_feedback(metrics: dict[str, Any]) -> list[str]:
    feedback: list[str] = []

    pace = metrics.get("pace_label")
    wpm = metrics.get("words_per_minute")
    if pace == "fast":
        feedback.append(
            f"You are speaking quickly (~{wpm} WPM). Aim for 120-160 WPM and pause at key points."
        )
    elif pace == "slow":
        feedback.append(
            f"You are speaking slowly (~{wpm} WPM). Try shorter phrases and more vocal energy."
        )
    elif pace == "good":
        feedback.append(f"Your pace is in a strong range (~{wpm} WPM).")

    filler_count = int(metrics.get("filler_word_count", 0) or 0)
    if filler_count >= 6:
        feedback.append("High filler-word usage detected. Replace fillers with short silent pauses.")
    elif filler_count > 0:
        feedback.append("Some filler words detected. Practice intentional pauses before key points.")
    else:
        feedback.append("Filler-word usage looks clean in this sample.")

    stutter_events = int(metrics.get("stutter_events", 0) or 0)
    if stutter_events > 0:
        feedback.append("Minor stutter patterns detected. Slow down sentence starts and breathe between points.")

    feedback.append("Non-verbal analysis is currently placeholder-only. Add MediaPipe to score posture and eye contact.")
    return feedback


def ensure_supported_media(upload: UploadFile) -> None:
    content_type = (upload.content_type or "").lower()
    if content_type and not (content_type.startswith("video/") or content_type.startswith("audio/")):
        raise HTTPException(status_code=400, detail="Upload must be an audio or video file.")


def save_upload_to_temp(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        shutil.copyfileobj(upload.file, tmp_file)
        return Path(tmp_file.name)


@lru_cache(maxsize=1)
def get_whisper_model():
    from faster_whisper import WhisperModel

    model_name = os.getenv("WHISPER_MODEL", "base")
    return WhisperModel(model_name, device="cpu", compute_type="int8")


def transcribe_with_whisper(media_path: Path) -> tuple[str, list[dict], list[str]]:
    """Returns (transcript, words, notes).

    words is a list of {"word", "start", "end", "index"} dicts for Ollama.
    """
    notes: list[str] = []
    if shutil.which("ffmpeg") is None:
        notes.append(
            "ffmpeg is not installed or not on PATH. Install ffmpeg to enable Whisper transcription."
        )
        return "", [], notes

    try:
        model = get_whisper_model()
        segments, _ = model.transcribe(str(media_path), word_timestamps=True)

        words: list[dict] = []
        transcript_parts: list[str] = []
        for segment in segments:
            for w in (segment.words or []):
                words.append({
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                    "index": len(words),
                })
                transcript_parts.append(w.word)

        transcript = "".join(transcript_parts).strip()
        return transcript, words, notes
    except ImportError:
        notes.append("faster-whisper is not installed. Transcript unavailable.")
    except Exception as exc:
        logger.exception("Whisper transcription failed: %s", exc)
        notes.append("Whisper failed on this file. Returning analysis with empty transcript.")
    return "", [], notes


def detect_media_duration_seconds(media_path: Path) -> tuple[float | None, list[str]]:
    notes: list[str] = []
    ffprobe_binary = shutil.which("ffprobe")
    if ffprobe_binary is None:
        notes.append("ffprobe not found. Could not auto-detect media duration.")
        return None, notes

    command = [
        ffprobe_binary,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        raw_value = result.stdout.strip()
        duration = float(raw_value)
        if duration <= 0:
            notes.append("ffprobe returned non-positive duration. Could not auto-detect media duration.")
            return None, notes
        return duration, notes
    except (subprocess.CalledProcessError, ValueError) as exc:
        logger.exception("ffprobe duration detection failed: %s", exc)
        notes.append("ffprobe failed to read media duration.")
        return None, notes


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_session(
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    transcript_override: str | None = Form(default=None),
) -> AnalyzeResponse:
    ensure_supported_media(file)
    temp_path = save_upload_to_temp(file)
    notes: list[str] = []

    try:
        if duration_seconds is None or duration_seconds <= 0:
            detected_duration, duration_notes = detect_media_duration_seconds(temp_path)
            notes.extend(duration_notes)
            if detected_duration is not None:
                duration_seconds = detected_duration
                notes.append(f"Auto-detected media duration: {round(duration_seconds, 2)} seconds.")
            else:
                duration_seconds = 30.0
                notes.append("No valid duration provided. Defaulted to 30 seconds.")

        words: list[dict] = []
        if transcript_override and transcript_override.strip():
            transcript = transcript_override.strip()
            notes.append("Used transcript override from client. Word timestamps unavailable — LLM will use plain text.")
        else:
            transcript, words, whisper_notes = transcribe_with_whisper(temp_path)
            notes.extend(whisper_notes)

        metrics = build_speech_metrics(transcript, duration_seconds)
        markers = build_timeline_markers(metrics)
        summary_feedback = build_summary_feedback(metrics)

        llm_result = analyze_with_ollama(words)
        llm_events = map_llm_events(llm_result.get("feedbackEvents", []), words)
        llm_result["feedbackEvents"] = llm_events

        if not transcript:
            notes.append("Transcript is empty. Speaking metrics may be limited.")

        return AnalyzeResponse(
            transcript=transcript,
            metrics=metrics,
            summary_feedback=summary_feedback,
            markers=markers,
            llm_analysis=llm_result,
            notes=notes,
        )
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to delete temp file %s", temp_path)
        await file.close()
