from __future__ import annotations

import json
import logging
import os
import re
import uuid

from groq import Groq

logger = logging.getLogger(__name__)

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
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
- strengths: 2-3 items; improvements: 2-4 items

Non-verbal context rules (applies when a "--- Context ---" block is provided):
- If activity_level is "unknown", do NOT mention gestures or body language anywhere in your response.
- If activity_level is "low", include one improvement about using more deliberate hand gestures.
- If activity_level is "moderate", acknowledge good physical engagement in strengths or body_feedback.
- If activity_level is "high", note energetic delivery and suggest channeling gestures with intention."""


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
                "actionable_tip": "Try re-uploading the video or check your GROQ_API_KEY.",
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
    """Strip markdown fences, then parse JSON."""
    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()

    # Extract the first {...} block in case there's surrounding text
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


def _build_context_block(analysis_context: dict) -> str:
    """Build a compact context string to append to the user message."""
    nv = analysis_context.get("non_verbal", {})
    lines = ["--- Context ---"]
    lines.append(f"pace: {analysis_context.get('pace_label', 'unknown')} ({analysis_context.get('words_per_minute', '?')} WPM)")
    lines.append(f"filler_words: {analysis_context.get('filler_word_count', 0)} total")
    lines.append(
        f"non_verbal: gesture_energy={nv.get('gesture_energy', 'unknown')}, "
        f"activity_level={nv.get('activity_level', 'unknown')}, "
        f"avg_velocity={nv.get('avg_velocity', 'unknown')}, "
        f"samples={nv.get('samples', 0)}"
    )
    return "\n".join(lines)


def analyze_with_llm(words: list[dict], analysis_context: dict | None = None) -> dict:
    """
    Call Groq API with the indexed transcript and return coaching results.

    Never raises — always returns a valid dict (safe defaults on failure).

    Args:
        words: list of {"word": str, "start": float, "end": float, "index": int}
        analysis_context: optional dict with keys: pace_label, words_per_minute,
                          filler_word_count, non_verbal (gesture_energy, activity_level,
                          avg_velocity, samples)

    Returns:
        dict with keys: scores, strengths, improvements, structure, feedbackEvents, stats
    """
    if not words:
        return _safe_defaults()

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY not set")
        return _safe_defaults()

    client = Groq(api_key=api_key)

    # Truncate very long transcripts to avoid excessive latency
    truncated = words[:MAX_TRANSCRIPT_WORDS]
    was_truncated = len(words) > MAX_TRANSCRIPT_WORDS

    indexed_transcript = " ".join(f"[{w['index']}]{w['word']}" for w in truncated)
    if was_truncated:
        indexed_transcript += f" [...transcript truncated at {MAX_TRANSCRIPT_WORDS} words]"

    if analysis_context:
        user_content = indexed_transcript + "\n\n" + _build_context_block(analysis_context)
    else:
        user_content = indexed_transcript

    messages = [
        {"role": "system", "content": COACH_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    # First attempt
    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=2048,
        )
        raw = response.choices[0].message.content or ""
        data = _strip_and_parse(raw)
        if data and _validate(data):
            return data
        logger.warning("LLM response missing keys on first attempt, retrying...\nRaw snippet: %s", raw[:300])
    except Exception as exc:
        logger.error("Groq first attempt failed: %s", exc)

    # Second attempt — stricter instruction
    try:
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "Your previous response was missing required fields. "
                    "Return the COMPLETE JSON object with ALL fields: "
                    "scores, strengths, improvements, structure, feedbackEvents, stats. "
                    "No markdown fences, no explanation."
                ),
            }
        ]
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=retry_messages,
            response_format={"type": "json_object"},
            max_tokens=2048,
        )
        raw = response.choices[0].message.content or ""
        data = _strip_and_parse(raw)
        if data and _validate(data):
            return data
        logger.error("LLM returned invalid JSON on retry, falling back to safe defaults")
    except Exception as exc:
        logger.error("Groq retry failed: %s", exc)

    return _safe_defaults()


def analyze_with_ollama(words: list[dict], analysis_context: dict | None = None) -> dict:
    """Backward-compatible alias for analyze_with_llm."""
    return analyze_with_llm(words, analysis_context)


def map_llm_events(llm_events: list[dict], words: list[dict]) -> list[dict]:
    """
    Convert LLM feedbackEvents (which have word_index but no timestamp)
    into pipeline events with actual timestamps looked up from the words array.

    Called by job_runner.py after analyze_with_llm().
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
