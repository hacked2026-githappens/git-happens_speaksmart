from __future__ import annotations

import json
import logging
import os
import re
import uuid

import ollama

logger = logging.getLogger(__name__)

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
MAX_TRANSCRIPT_WORDS = 2000  # truncate to avoid latency on very long videos

COACH_SYSTEM_PROMPT = """You are an expert public speaking coach. You will be given a numbered transcript in the format:
[0]word [1]word [2]word ...

Analyze the speech and return ONLY a valid JSON object with this exact shape — no markdown, no explanation, no extra text:

{
  "scores": {
    "clarity": <integer 1-10>,
    "pace_consistency": <integer 1-10>,
    "confidence_language": <integer 1-10>,
    "content_structure": <integer 1-10>,
    "filler_word_density": <integer 1-10>
  },
  "strengths": ["<strength sentence>", "<strength sentence>"],
  "improvements": [
    { "title": "<short title>", "detail": "<explanation>", "actionable_tip": "<specific advice>" }
  ],
  "structure": {
    "has_clear_intro": <true or false>,
    "has_clear_conclusion": <true or false>,
    "body_feedback": "<one sentence about the body of the speech>"
  },
  "feedbackEvents": [
    {
      "type": "<one of: weak_language, confidence, grammar, content>",
      "word_index": <integer — the [N] index of the flagged word>,
      "severity": "<one of: low, medium, high>",
      "title": "<short title>",
      "message": "<actionable coaching message>"
    }
  ],
  "stats": {
    "flagged_sentences": <integer>
  }
}

Analyze for: hedging language ("I think", "maybe", "kind of"), missing evidence, unclear transitions, grammar issues, weak confidence markers, and content quality.

Rules:
- Respond with the JSON object ONLY. No markdown code fences. No explanation before or after.
- filler_word_density score: 10 = no fillers detected, 1 = excessive fillers throughout
- word_index in feedbackEvents must be an integer matching a [N] index from the transcript
- Limit feedbackEvents to the 10 most important issues
- strengths: 2-3 items; improvements: 2-4 items"""


def _safe_defaults() -> dict:
    return {
        "scores": {
            "clarity": 5,
            "pace_consistency": 5,
            "confidence_language": 5,
            "content_structure": 5,
            "filler_word_density": 5,
        },
        "strengths": ["Analysis could not be completed — please try again"],
        "improvements": [
            {
                "title": "Analysis unavailable",
                "detail": "The coaching model did not return a valid response.",
                "actionable_tip": "Try re-uploading the video or check that Ollama is running.",
            }
        ],
        "structure": {
            "has_clear_intro": False,
            "has_clear_conclusion": False,
            "body_feedback": "Analysis unavailable.",
        },
        "feedbackEvents": [],
        "stats": {"flagged_sentences": 0},
    }


def _strip_and_parse(raw: str) -> dict | None:
    """Strip qwen3 <think> blocks + markdown fences, then parse JSON."""
    # 1. Strip <think>...</think> reasoning blocks (qwen3-specific)
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()

    # 3. Extract the first {...} block in case there's surrounding text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _validate(data: dict) -> bool:
    """Check all required top-level keys and score sub-keys are present."""
    required_keys = {"scores", "strengths", "improvements", "structure", "feedbackEvents", "stats"}
    if not required_keys.issubset(data.keys()):
        logger.warning("LLM response missing keys: %s", required_keys - data.keys())
        return False
    score_keys = {"clarity", "pace_consistency", "confidence_language", "content_structure", "filler_word_density"}
    if not score_keys.issubset(data.get("scores", {}).keys()):
        logger.warning("LLM scores missing keys: %s", score_keys - data.get("scores", {}).keys())
        return False
    return True


def analyze_with_ollama(words: list[dict]) -> dict:
    """
    Call local Ollama LLM with the indexed transcript and return coaching results.

    Never raises — always returns a valid dict (safe defaults on failure).

    Args:
        words: list of {"word": str, "start": float, "end": float, "index": int}

    Returns:
        dict with keys: scores, strengths, improvements, structure, feedbackEvents, stats
    """
    if not words:
        return _safe_defaults()

    # Truncate very long transcripts to avoid excessive latency
    truncated = words[:MAX_TRANSCRIPT_WORDS]
    was_truncated = len(words) > MAX_TRANSCRIPT_WORDS

    indexed_transcript = " ".join(f"[{w['index']}]{w['word']}" for w in truncated)
    if was_truncated:
        indexed_transcript += f" [...transcript truncated at {MAX_TRANSCRIPT_WORDS} words]"

    messages = [
        {"role": "system", "content": COACH_SYSTEM_PROMPT},
        {"role": "user", "content": indexed_transcript},
    ]

    # First attempt
    try:
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=messages,
            format="json",
            think=False,
        )
        raw = response["message"]["content"]
        data = _strip_and_parse(raw)
        if data and _validate(data):
            return data
        logger.warning("LLM returned invalid/incomplete JSON on first attempt, retrying...")
    except Exception as exc:
        logger.error("Ollama first attempt failed: %s", exc)

    # Second attempt — stricter instruction appended
    try:
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "Your previous response was not valid JSON. "
                    "Return ONLY the JSON object. "
                    "No markdown fences, no <think> blocks, no explanation."
                ),
            }
        ]
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=retry_messages,
            format="json",
            think=False,
        )
        raw = response["message"]["content"]
        data = _strip_and_parse(raw)
        if data and _validate(data):
            return data
        logger.error("LLM returned invalid JSON on retry, falling back to safe defaults")
    except Exception as exc:
        logger.error("Ollama retry failed: %s", exc)

    return _safe_defaults()


def map_llm_events(llm_events: list[dict], words: list[dict]) -> list[dict]:
    """
    Convert LLM feedbackEvents (which have word_index but no timestamp)
    into pipeline events with actual timestamps looked up from the words array.

    Called by job_runner.py after analyze_with_ollama().
    """
    word_map = {w["index"]: w for w in words}
    result = []
    for ev in llm_events:
        wi = int(ev.get("word_index", 0))
        w = word_map.get(wi, words[0] if words else {"start": 0.0, "index": 0})
        result.append({
            "id": str(uuid.uuid4()),
            "timestamp": w["start"],
            "type": ev.get("type", "content"),
            "severity": ev.get("severity", "low"),
            "title": ev.get("title", ""),
            "message": ev.get("message", ""),
            "wordIndex": wi,
        })
    return result
