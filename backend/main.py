from __future__ import annotations

import logging
import math
import os
import random
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client as SupabaseClient
from supabase import create_client
from pydantic import BaseModel, Field

from job_runner import run_analysis_job
from llm import (
    analyze_with_ollama,
    evaluate_follow_up_answer,
    generate_content_specific_plan,
    generate_follow_up_question,
    map_llm_events,
)
from non_verbal.vision import analyze_nonverbal

logger = logging.getLogger(__name__)

_supabase: SupabaseClient | None = None


def get_supabase() -> SupabaseClient:
    global _supabase
    if _supabase is None:
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        _supabase = create_client(url, key)
    return _supabase


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
    title="SpeakSmart API",
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


class ContentImprovement(BaseModel):
    title: str
    content_issue: str
    specific_fix: str
    example_revision: str


class PersonalizedContentPlan(BaseModel):
    topic_summary: str
    audience_takeaway: str
    improvements: list[ContentImprovement] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    transcript: str
    metrics: dict[str, Any]
    summary_feedback: list[str]
    markers: list[TimelineMarker]
    llm_analysis: dict[str, Any]
    personalized_content_plan: PersonalizedContentPlan
    notes: list[str]


class FollowUpQuestionRequest(BaseModel):
    transcript: str = ""
    summary_feedback: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    preset: str = "general"


class FollowUpQuestionResponse(BaseModel):
    question: str


class FollowUpAnswerEvalRequest(BaseModel):
    question: str
    answer_transcript: str
    presentation_transcript: str = ""
    presentation_summary_feedback: list[str] = Field(default_factory=list)
    presentation_strengths: list[str] = Field(default_factory=list)
    presentation_improvements: list[str] = Field(default_factory=list)


class FollowUpAnswerEvalResponse(BaseModel):
    is_correct: bool
    verdict: str
    correctness_score: int = Field(ge=0, le=100)
    reason: str
    missing_points: list[str] = Field(default_factory=list)
    suggested_improvement: str


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "SpeakSmart API is running."}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/followup-question", response_model=FollowUpQuestionResponse)
async def followup_question(payload: FollowUpQuestionRequest) -> FollowUpQuestionResponse:
    if (
        not payload.transcript.strip()
        and not payload.summary_feedback
        and not payload.improvements
        and not payload.strengths
    ):
        raise HTTPException(
            status_code=400,
            detail="Provide transcript or feedback context to generate a follow-up question.",
        )

    question = generate_follow_up_question(
        transcript=payload.transcript,
        summary_feedback=payload.summary_feedback,
        strengths=payload.strengths,
        improvements=payload.improvements,
        preset=payload.preset,
    )
    return FollowUpQuestionResponse(question=question)


@app.post("/evaluate-followup-answer", response_model=FollowUpAnswerEvalResponse)
async def evaluate_followup_answer(
    payload: FollowUpAnswerEvalRequest,
) -> FollowUpAnswerEvalResponse:
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="question is required.")
    if not payload.answer_transcript.strip():
        raise HTTPException(status_code=400, detail="answer_transcript is required.")

    result = evaluate_follow_up_answer(
        question=payload.question,
        answer_transcript=payload.answer_transcript,
        presentation_transcript=payload.presentation_transcript,
        presentation_summary_feedback=payload.presentation_summary_feedback,
        presentation_strengths=payload.presentation_strengths,
        presentation_improvements=payload.presentation_improvements,
    )
    return FollowUpAnswerEvalResponse(**result)


# ── Static content for drill modes ────────────────────────────────────────────

_READING_PARAGRAPHS = [
    {
        "title": "The Deep Ocean",
        "text": (
            "The deep ocean remains one of the least explored places on Earth. "
            "Scientists estimate that more than eighty percent of our oceans have never been mapped or observed. "
            "Strange and wondrous creatures live miles beneath the surface, adapted to crushing pressure and total darkness. "
            "Every expedition into the deep returns with discoveries that challenge what we thought we knew about life on this planet."
        ),
    },
    {
        "title": "The Art of Listening",
        "text": (
            "Most people do not listen with the intent to understand — they listen with the intent to reply. "
            "True listening requires patience, presence, and a willingness to set aside your own assumptions. "
            "When someone feels genuinely heard, it builds trust faster than almost anything else you can do. "
            "The best communicators in any field are, first and foremost, exceptional listeners."
        ),
    },
    {
        "title": "Morning Light",
        "text": (
            "There is something quietly powerful about the first hour of the day before the rest of the world wakes up. "
            "The light is softer, the air is still, and your mind has not yet been pulled in a dozen directions. "
            "Many writers, athletes, and leaders guard this time fiercely, treating it as the most productive part of their day. "
            "How you begin the morning often shapes the entire tone of what follows."
        ),
    },
    {
        "title": "The Science of Sleep",
        "text": (
            "Sleep is not a passive state — your brain is remarkably active while you rest. "
            "During deep sleep, memories are consolidated, waste products are cleared from neural tissue, and the body repairs itself at a cellular level. "
            "Chronic sleep deprivation is linked to impaired judgment, weakened immunity, and increased risk of serious disease. "
            "Despite this, modern culture often treats sleep as an inconvenience rather than a biological necessity."
        ),
    },
    {
        "title": "Cities After Dark",
        "text": (
            "A city at night reveals a different character than it shows by day. "
            "The crowds thin out, the neon signs reflect off wet pavements, and the usual urgency of urban life softens into something more contemplative. "
            "Night workers, street vendors, and late-night wanderers occupy a version of the city that most people never see. "
            "There is a quiet beauty in these hours that belongs entirely to those willing to stay awake for it."
        ),
    },
    {
        "title": "The Power of Small Habits",
        "text": (
            "Dramatic transformations rarely happen overnight. "
            "More often, they are the invisible result of small decisions compounded over months and years. "
            "A person who reads ten pages each day will finish dozens of books by year's end. "
            "A person who walks for twenty minutes each morning will, in time, transform their health. "
            "The habits that shape us most profoundly are usually the ones so modest they barely seem worth noticing."
        ),
    },
    {
        "title": "What Leaders Actually Do",
        "text": (
            "Leadership is far less about authority than most people assume. "
            "The most effective leaders spend the majority of their time asking questions, removing obstacles for their teams, and creating conditions where talented people can do their best work. "
            "They are clear about direction but humble about method, knowing that the people closest to the problem usually have the best solutions. "
            "Genuine influence is earned, not assigned."
        ),
    },
    {
        "title": "The Changing Climate",
        "text": (
            "Climate change is not a distant threat — its effects are already reshaping ecosystems, agriculture, and coastal communities around the world. "
            "Rising temperatures are altering migration patterns, intensifying storms, and accelerating the melting of polar ice. "
            "The decisions made in the next decade will determine the severity of changes that unfold over the next century. "
            "Understanding the science is the first step toward meaningful action."
        ),
    },
    {
        "title": "Technology and Connection",
        "text": (
            "We have never been more connected to information, and yet many people report feeling more isolated than ever before. "
            "Smartphones allow us to reach anyone on earth instantly, but they also fragment attention and replace face-to-face moments with curated highlights. "
            "The challenge of our era is not building faster networks, but learning to use the networks we have in ways that genuinely bring us closer together."
        ),
    },
    {
        "title": "The Value of Failure",
        "text": (
            "Failure is not the opposite of success — it is part of the process. "
            "Every expert in any field has a history of mistakes that shaped their competence. "
            "The difference between those who improve and those who stagnate is not talent, but the willingness to examine what went wrong and try again with new understanding. "
            "A culture that punishes failure too harshly ends up punishing the curiosity that drives growth."
        ),
    },
]

_TOPIC_PROMPTS = [
    {
        "topic": "A skill you wish you had learned earlier",
        "prompt": "Talk about a skill — practical, creative, or interpersonal — that you now wish someone had taught you sooner. Why does it matter to you?",
    },
    {
        "topic": "Your ideal morning routine",
        "prompt": "Describe what your perfect morning looks like from the moment you wake up. What habits or rituals would it include, and why?",
    },
    {
        "topic": "A book, film, or show that changed your perspective",
        "prompt": "Tell us about a piece of media that genuinely shifted how you see the world, other people, or yourself. What made it so impactful?",
    },
    {
        "topic": "The most important quality in a leader",
        "prompt": "If you had to name just one quality that separates great leaders from average ones, what would it be? Make your case.",
    },
    {
        "topic": "A challenge you overcame",
        "prompt": "Share a time when you faced a significant obstacle — professional, personal, or academic. How did you get through it, and what did it teach you?",
    },
    {
        "topic": "What 'success' means to you",
        "prompt": "Define success in your own terms. How has your definition changed over time, and what benchmarks actually matter to you now?",
    },
    {
        "topic": "The role of technology in everyday life",
        "prompt": "How has technology changed the way you work, communicate, or spend your free time? Are those changes mostly positive or negative, in your view?",
    },
    {
        "topic": "A place you would love to visit",
        "prompt": "Describe a place — city, country, or natural landscape — that you have always wanted to experience. What draws you to it?",
    },
    {
        "topic": "How you stay motivated when things get hard",
        "prompt": "Walk us through your real strategies for maintaining momentum when a project, relationship, or goal feels like it is stalling.",
    },
    {
        "topic": "The biggest lesson from the past year",
        "prompt": "Looking back at the last twelve months, what is the single most valuable thing you have learned — about yourself, others, or the world?",
    },
    {
        "topic": "What makes a great team",
        "prompt": "Based on your experience, what ingredients consistently separate high-performing teams from ones that struggle? Be specific.",
    },
    {
        "topic": "If you could change one thing about education",
        "prompt": "What is the biggest gap or flaw in the way we educate people today? What would you change, and how would it make a difference?",
    },
    {
        "topic": "The impact of social media on communication",
        "prompt": "Has social media made us better or worse communicators? Argue your position with examples from everyday life.",
    },
    {
        "topic": "An everyday object you are grateful for",
        "prompt": "Pick something ordinary — a tool, appliance, or material — and make a compelling case for why it deserves far more appreciation than it gets.",
    },
    {
        "topic": "Your favourite season and why",
        "prompt": "Make an enthusiastic argument for one season of the year. What do you love about how it looks, feels, and what it makes possible?",
    },
]


@app.get("/random-paragraph")
def get_random_paragraph() -> dict:
    return random.choice(_READING_PARAGRAPHS)


@app.get("/random-topic")
def get_random_topic() -> dict:
    return random.choice(_TOPIC_PROMPTS)


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
            "gesture_energy": 0.0,
            "activity_level": "unknown",
            "avg_velocity": 0.0,
            "samples": 0,
            "eye_contact_score": 0.0,
            "eye_contact_level": "unknown",
            "posture_score": 0.0,
            "posture_level": "unknown",
        },
        "audio_delivery": {
            "monotone": {
                "label": "unknown",
                "is_monotone": False,
                "mean_pitch_hz": None,
                "pitch_variance_hz": None,
                "pitch_std_semitones": None,
                "voiced_frames": 0,
            },
            "volume": {
                "consistency_label": "unknown",
                "mean_dbfs": None,
                "dbfs_std": None,
                "too_quiet": False,
                "trailing_off_events": 0,
                "trailing_off_ratio": 0.0,
                "trailing_off_examples": [],
            },
            "silence": {
                "pause_quality": "unknown",
                "effective_pauses": 0,
                "awkward_silences": 0,
                "effective_examples": [],
                "awkward_examples": [],
            },
        },
    }


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _is_sentence_boundary(word: str) -> bool:
    return bool(re.search(r"[.!?][\"')\]]*$", (word or "").strip()))


def extract_audio_samples_for_analysis(
    media_path: Path,
    sample_rate: int = 16000,
) -> tuple[Any | None, int, list[str]]:
    notes: list[str] = []
    ffmpeg_binary = shutil.which("ffmpeg")
    if ffmpeg_binary is None:
        notes.append("ffmpeg not found. Audio tonal analysis was skipped.")
        return None, sample_rate, notes

    try:
        import numpy as np
    except ImportError:
        notes.append("numpy is not installed. Audio tonal analysis was skipped.")
        return None, sample_rate, notes

    command = [
        ffmpeg_binary,
        "-v",
        "error",
        "-i",
        str(media_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-",
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True)
        if not result.stdout:
            notes.append("Audio extraction returned no samples. Tonal analysis was skipped.")
            return None, sample_rate, notes

        samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size < int(sample_rate * 0.75):
            notes.append("Audio sample was too short for reliable tonal analysis.")
            return None, sample_rate, notes
        return samples, sample_rate, notes
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
        notes.append(
            "ffmpeg failed during audio extraction. Tonal analysis unavailable."
            + (f" ({stderr[:120]})" if stderr else "")
        )
        return None, sample_rate, notes


def analyze_pitch_variance(samples: Any, sample_rate: int) -> dict[str, Any]:
    try:
        import numpy as np
    except ImportError:
        return {
            "label": "unknown",
            "is_monotone": False,
            "mean_pitch_hz": None,
            "pitch_variance_hz": None,
            "pitch_std_semitones": None,
            "voiced_frames": 0,
        }

    frame_size = int(0.04 * sample_rate)
    hop_size = max(1, int(0.02 * sample_rate))
    min_lag = max(1, int(sample_rate / 320))
    max_lag = max(min_lag + 1, int(sample_rate / 75))
    if len(samples) < frame_size + 1:
        return {
            "label": "unknown",
            "is_monotone": False,
            "mean_pitch_hz": None,
            "pitch_variance_hz": None,
            "pitch_std_semitones": None,
            "voiced_frames": 0,
        }

    window = np.hanning(frame_size).astype(np.float32)
    pitches: list[float] = []

    for start in range(0, len(samples) - frame_size, hop_size):
        frame = samples[start : start + frame_size]
        frame = frame - float(np.mean(frame))
        rms = float(np.sqrt(np.mean(frame * frame)))
        if rms < 0.008:
            continue

        weighted = frame * window
        autocorr = np.correlate(weighted, weighted, mode="full")[frame_size - 1 :]
        if autocorr.size <= max_lag:
            continue
        zero_lag = float(autocorr[0])
        if zero_lag <= 0:
            continue

        search = autocorr[min_lag : max_lag + 1]
        if search.size == 0:
            continue
        peak_rel = int(np.argmax(search))
        peak_idx = peak_rel + min_lag
        peak_val = float(autocorr[peak_idx])
        periodicity = peak_val / (zero_lag + 1e-9)
        if periodicity < 0.30:
            continue

        f0 = sample_rate / peak_idx
        if 75 <= f0 <= 320:
            pitches.append(float(f0))

    if len(pitches) < 8:
        return {
            "label": "unknown",
            "is_monotone": False,
            "mean_pitch_hz": None,
            "pitch_variance_hz": None,
            "pitch_std_semitones": None,
            "voiced_frames": len(pitches),
        }

    pitch_arr = np.asarray(pitches, dtype=np.float32)
    mean_pitch = float(np.mean(pitch_arr))
    pitch_variance = float(np.var(pitch_arr))
    semitone_std = float(np.std(np.log2(np.clip(pitch_arr, 1e-6, None))) * 12.0)

    if semitone_std < 1.8:
        label = "monotone"
    elif semitone_std < 3.0:
        label = "some_variation"
    else:
        label = "dynamic"

    return {
        "label": label,
        "is_monotone": label == "monotone",
        "mean_pitch_hz": round(mean_pitch, 1),
        "pitch_variance_hz": round(pitch_variance, 2),
        "pitch_std_semitones": round(semitone_std, 2),
        "voiced_frames": len(pitches),
    }


def _build_sentence_spans(words: list[dict], duration_seconds: float) -> list[tuple[float, float]]:
    if not words:
        return []

    spans: list[tuple[float, float]] = []
    span_start = _safe_float(words[0].get("start"), 0.0)
    prev_end = _safe_float(words[0].get("end"), span_start)

    for idx in range(1, len(words)):
        prev_word = str(words[idx - 1].get("word", ""))
        current_start = _safe_float(words[idx].get("start"), prev_end)
        current_end = _safe_float(words[idx].get("end"), current_start)
        gap = max(0.0, current_start - prev_end)

        if _is_sentence_boundary(prev_word) or gap >= 1.0:
            spans.append((span_start, prev_end))
            span_start = current_start

        prev_end = max(prev_end, current_end)

    spans.append((span_start, prev_end))

    cleaned: list[tuple[float, float]] = []
    clip_end = max(0.0, duration_seconds)
    for start, end in spans:
        s = max(0.0, start)
        e = min(max(s, end), clip_end if clip_end > 0 else end)
        if e - s >= 0.4:
            cleaned.append((s, e))
    return cleaned


def analyze_volume_consistency(
    samples: Any,
    sample_rate: int,
    words: list[dict],
    duration_seconds: float,
) -> dict[str, Any]:
    try:
        import numpy as np
    except ImportError:
        return {
            "consistency_label": "unknown",
            "mean_dbfs": None,
            "dbfs_std": None,
            "too_quiet": False,
            "trailing_off_events": 0,
            "trailing_off_ratio": 0.0,
            "trailing_off_examples": [],
        }

    frame_size = max(1, int(0.05 * sample_rate))
    hop_size = max(1, int(0.025 * sample_rate))
    db_values: list[float] = []

    for start in range(0, len(samples) - frame_size, hop_size):
        frame = samples[start : start + frame_size]
        rms = float(np.sqrt(np.mean(frame * frame)))
        db_values.append(20.0 * math.log10(max(rms, 1e-7)))

    if not db_values:
        return {
            "consistency_label": "unknown",
            "mean_dbfs": None,
            "dbfs_std": None,
            "too_quiet": False,
            "trailing_off_events": 0,
            "trailing_off_ratio": 0.0,
            "trailing_off_examples": [],
        }

    mean_dbfs = float(np.mean(db_values))
    dbfs_std = float(np.std(db_values))
    too_quiet = mean_dbfs < -33.0

    trailing_examples: list[dict[str, Any]] = []
    spans = _build_sentence_spans(words, duration_seconds)
    for start_sec, end_sec in spans:
        span_dur = end_sec - start_sec
        if span_dur < 0.9:
            continue

        start_idx = int(start_sec * sample_rate)
        end_idx = int(end_sec * sample_rate)
        if end_idx <= start_idx + 10:
            continue

        segment = samples[start_idx:end_idx]
        tail_seconds = min(0.35, span_dur * 0.35)
        tail_len = int(tail_seconds * sample_rate)
        if tail_len <= 10 or tail_len >= len(segment):
            continue

        body = segment[:-tail_len]
        tail = segment[-tail_len:]
        body_rms = float(np.sqrt(np.mean(body * body)))
        tail_rms = float(np.sqrt(np.mean(tail * tail)))
        if body_rms <= 1e-7:
            continue

        ratio = tail_rms / body_rms
        if ratio < 0.62:
            trailing_examples.append(
                {
                    "start": round(max(start_sec, end_sec - tail_seconds), 2),
                    "end": round(end_sec, 2),
                    "ratio": round(ratio, 2),
                }
            )

    trailing_count = len(trailing_examples)
    trailing_ratio = trailing_count / max(len(spans), 1) if spans else 0.0

    if too_quiet:
        consistency_label = "too_quiet"
    elif trailing_ratio >= 0.35 or dbfs_std > 7.5:
        consistency_label = "inconsistent"
    else:
        consistency_label = "consistent"

    return {
        "consistency_label": consistency_label,
        "mean_dbfs": round(mean_dbfs, 2),
        "dbfs_std": round(dbfs_std, 2),
        "too_quiet": too_quiet,
        "trailing_off_events": trailing_count,
        "trailing_off_ratio": round(trailing_ratio, 2),
        "trailing_off_examples": trailing_examples[:5],
    }


def analyze_silence_quality(words: list[dict]) -> dict[str, Any]:
    if len(words) < 2:
        return {
            "pause_quality": "unknown",
            "effective_pauses": 0,
            "awkward_silences": 0,
            "effective_examples": [],
            "awkward_examples": [],
        }

    effective_examples: list[dict[str, Any]] = []
    awkward_examples: list[dict[str, Any]] = []

    for idx in range(1, len(words)):
        previous = words[idx - 1]
        current = words[idx]

        prev_end = _safe_float(previous.get("end"), 0.0)
        curr_start = _safe_float(current.get("start"), prev_end)
        gap = max(0.0, curr_start - prev_end)
        if gap < 0.25:
            continue

        after_boundary = _is_sentence_boundary(str(previous.get("word", ""))) or gap >= 0.95
        pause_sample = {
            "start": round(prev_end, 2),
            "end": round(curr_start, 2),
            "duration": round(gap, 2),
        }

        if after_boundary and 0.35 <= gap <= 1.4:
            effective_examples.append(pause_sample)
            continue

        if (not after_boundary and gap >= 0.7) or (after_boundary and gap > 1.8):
            awkward_examples.append(pause_sample)

    if awkward_examples and len(awkward_examples) >= len(effective_examples):
        pause_quality = "needs_work"
    elif effective_examples and not awkward_examples:
        pause_quality = "effective"
    elif effective_examples or awkward_examples:
        pause_quality = "mixed"
    else:
        pause_quality = "unknown"

    return {
        "pause_quality": pause_quality,
        "effective_pauses": len(effective_examples),
        "awkward_silences": len(awkward_examples),
        "effective_examples": effective_examples[:6],
        "awkward_examples": awkward_examples[:6],
    }


def analyze_audio_delivery(
    media_path: Path,
    words: list[dict],
    duration_seconds: float,
) -> tuple[dict[str, Any], list[str]]:
    base = {
        "monotone": {
            "label": "unknown",
            "is_monotone": False,
            "mean_pitch_hz": None,
            "pitch_variance_hz": None,
            "pitch_std_semitones": None,
            "voiced_frames": 0,
        },
        "volume": {
            "consistency_label": "unknown",
            "mean_dbfs": None,
            "dbfs_std": None,
            "too_quiet": False,
            "trailing_off_events": 0,
            "trailing_off_ratio": 0.0,
            "trailing_off_examples": [],
        },
        "silence": analyze_silence_quality(words),
    }

    samples, sample_rate, notes = extract_audio_samples_for_analysis(media_path)
    if samples is None:
        return base, notes

    base["monotone"] = analyze_pitch_variance(samples, sample_rate)
    base["volume"] = analyze_volume_consistency(samples, sample_rate, words, duration_seconds)
    if base["monotone"]["label"] == "unknown":
        notes.append("Could not estimate pitch variation confidently for this recording.")
    return base, notes


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

    audio = metrics.get("audio_delivery", {})
    monotone = audio.get("monotone", {}) if isinstance(audio, dict) else {}
    if str(monotone.get("label")) == "monotone":
        markers.append(
            TimelineMarker(
                second=round(duration * 0.4, 2),
                category="tone",
                severity="warning",
                message="Low pitch variation detected. Add more vocal inflection on key points.",
            )
        )

    volume = audio.get("volume", {}) if isinstance(audio, dict) else {}
    trailing_examples = volume.get("trailing_off_examples", []) if isinstance(volume, dict) else []
    trailing_ts = duration * 0.75
    if trailing_examples and isinstance(trailing_examples, list):
        trailing_ts = _safe_float(trailing_examples[0].get("start"), trailing_ts)
    if bool(volume.get("too_quiet")):
        markers.append(
            TimelineMarker(
                second=round(max(0.0, trailing_ts), 2),
                category="volume",
                severity="warning",
                message="Overall volume is low. Project your voice more consistently.",
            )
        )
    elif _safe_float(volume.get("trailing_off_ratio"), 0.0) >= 0.35:
        markers.append(
            TimelineMarker(
                second=round(max(0.0, trailing_ts), 2),
                category="volume",
                severity="warning",
                message="You tend to trail off at sentence endings. Maintain volume through the final word.",
            )
        )

    silence = audio.get("silence", {}) if isinstance(audio, dict) else {}
    awkward_examples = silence.get("awkward_examples", []) if isinstance(silence, dict) else []
    awkward_ts = duration * 0.55
    if awkward_examples and isinstance(awkward_examples, list):
        awkward_ts = _safe_float(awkward_examples[0].get("start"), awkward_ts)
    if int(silence.get("awkward_silences", 0) or 0) > 0:
        markers.append(
            TimelineMarker(
                second=round(max(0.0, awkward_ts), 2),
                category="silence",
                severity="warning",
                message="Awkward mid-sentence silence detected. Pause after complete thoughts instead.",
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

    audio = metrics.get("audio_delivery", {})
    monotone = audio.get("monotone", {}) if isinstance(audio, dict) else {}
    if str(monotone.get("label")) == "monotone":
        feedback.append("Your pitch variation is limited. Emphasize key words with intentional inflection.")
    elif str(monotone.get("label")) == "dynamic":
        feedback.append("Vocal inflection is dynamic and helps keep attention.")

    volume = audio.get("volume", {}) if isinstance(audio, dict) else {}
    trailing_ratio = _safe_float(volume.get("trailing_off_ratio"), 0.0)
    if bool(volume.get("too_quiet")):
        feedback.append("Overall volume is quiet. Increase projection so every sentence lands clearly.")
    elif trailing_ratio >= 0.35:
        feedback.append("You trail off at sentence endings. Keep your volume steady through the final phrase.")

    silence = audio.get("silence", {}) if isinstance(audio, dict) else {}
    awkward_count = int(silence.get("awkward_silences", 0) or 0)
    effective_count = int(silence.get("effective_pauses", 0) or 0)
    if awkward_count > 0:
        feedback.append(
            f"{awkward_count} awkward mid-sentence silence(s) detected. Pause after complete thoughts."
        )
    elif effective_count > 0:
        feedback.append(f"{effective_count} effective pause(s) detected after sentence boundaries.")

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
    preset: str = Form(default="general"),
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
        audio_delivery, audio_notes = analyze_audio_delivery(temp_path, words, duration_seconds)
        metrics["audio_delivery"] = audio_delivery
        notes.extend(audio_notes)

        nv_result = analyze_nonverbal(str(temp_path))
        metrics["non_verbal"] = nv_result["non_verbal"]

        markers = build_timeline_markers(metrics)
        summary_feedback = build_summary_feedback(metrics)

        analysis_context = {
            "pace_label": metrics.get("pace_label"),
            "words_per_minute": metrics.get("words_per_minute"),
            "filler_word_count": metrics.get("filler_word_count", 0),
            "non_verbal": metrics.get("non_verbal", {}),
        }
        llm_result = analyze_with_ollama(words, analysis_context, preset=preset)
        llm_events = map_llm_events(llm_result.get("feedbackEvents", []), words)
        llm_result["feedbackEvents"] = llm_events
        content_plan = generate_content_specific_plan(
            transcript=transcript,
            summary_feedback=summary_feedback,
            llm_improvements=llm_result.get("improvements", []),
            preset=preset,
        )

        if not transcript:
            notes.append("Transcript is empty. Speaking metrics may be limited.")

        return AnalyzeResponse(
            transcript=transcript,
            metrics=metrics,
            summary_feedback=summary_feedback,
            markers=markers,
            llm_analysis=llm_result,
            personalized_content_plan=content_plan,
            notes=notes,
        )
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to delete temp file %s", temp_path)
        await file.close()


@app.post("/api/analyze")
async def create_analysis_job(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    preset: str = Form(default="general"),
) -> dict:
    ensure_supported_media(video)
    temp_path = save_upload_to_temp(video)
    supabase = get_supabase()
    response = supabase.table("jobs").insert({"status": "pending"}).execute()
    job_id = response.data[0]["id"]
    background_tasks.add_task(
        run_analysis_job,
        job_id=job_id,
        temp_path=temp_path,
        duration_seconds=duration_seconds,
        preset=preset,
        supabase=supabase,
    )
    return {"jobId": job_id}


@app.get("/api/results/{job_id}")
async def get_analysis_results(job_id: str) -> dict:
    supabase = get_supabase()
    response = (
        supabase.table("jobs")
        .select("status,results,error_message")
        .eq("id", job_id)
        .single()
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Job not found")
    row = response.data
    if row["status"] in ("pending", "processing"):
        return {"status": row["status"]}
    if row["status"] == "done":
        return {"status": "done", "results": row["results"]}
    return {"status": "error", "error_message": row.get("error_message", "Unknown error")}
