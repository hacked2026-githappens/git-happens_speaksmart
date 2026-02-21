from __future__ import annotations

import json
import logging
import os
import re
import uuid

from groq import Groq

from dotenv import load_dotenv

load_dotenv()


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
- strengths: 2-3 items; improvements: 2-4 items"""

FOLLOW_UP_QUESTION_SYSTEM_PROMPT = """You are a public speaking coach.

You receive context from a user's presentation:
- transcript excerpt
- summary feedback
- strengths
- improvements

Return ONLY valid JSON:
{
  "question": "<one concise follow-up practice question>"
}

Rules:
- Generate exactly one question.
- Keep it specific to the provided context.
- Make the question answerable in 30-90 seconds.
- Focus on presentation CONTENT first: main claim, evidence, audience takeaway, example, or trade-off.
- Do NOT ask about delivery mechanics (pace, body language, eye contact, fillers, confidence language) unless the presentation itself is about delivery.
- Do NOT ask self-improvement/meta questions like "What specific adjustments can you make..."
- Prefer direct prompts such as:
  - "What is your main claim and what evidence best supports it?"
  - "What action should your audience take next, and why?"
- No markdown. No extra fields. No explanation."""

FOLLOW_UP_ANSWER_EVAL_SYSTEM_PROMPT = """You are an evaluator for presentation follow-up answers.

You receive:
- the follow-up question
- the user's answer transcript
- reference context from the original presentation

Return ONLY valid JSON with this exact shape:
{
  "is_correct": <true or false>,
  "verdict": "<one of: correct, partially_correct, incorrect, insufficient_information>",
  "correctness_score": <integer 0-100>,
  "reason": "<short explanation>",
  "missing_points": ["<optional missing point>"],
  "suggested_improvement": "<one concrete way to improve the answer>"
}

Evaluation rules:
- Judge primarily on whether the answer addresses the question accurately using the provided reference context.
- If reference context is weak or unavailable, use "insufficient_information" unless the answer is clearly on/off topic.
- "correct" means the key claim is accurate and supported.
- "partially_correct" means some key points are right but important details are missing.
- "incorrect" means core claim is wrong or off-topic.
- Keep reason concise and specific.
- Do not add extra keys.
- No markdown and no explanation text outside JSON."""


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


def _parse_follow_up_question(raw: str) -> str | None:
    data = _strip_and_parse(raw)
    if not data:
        return None

    question = data.get("question")
    if not isinstance(question, str):
        return None

    cleaned = question.strip()
    if not cleaned:
        return None
    return cleaned


def _is_delivery_mechanics_question(question: str) -> bool:
    text = question.lower()
    blocked_phrases = [
        "what specific adjustments can you make",
        "speaking pace",
        "body language",
        "eye contact",
        "filler words",
        "delivery",
        "confidence and clarity while presenting",
    ]
    return any(phrase in text for phrase in blocked_phrases)


def _safe_follow_up_answer_eval_defaults() -> dict:
    return {
        "is_correct": False,
        "verdict": "insufficient_information",
        "correctness_score": 50,
        "reason": "Could not confidently evaluate the answer with the available information.",
        "missing_points": [],
        "suggested_improvement": "Answer the question directly and include one concrete supporting detail.",
    }


def _validate_follow_up_answer_eval(data: dict) -> bool:
    required = {
        "is_correct",
        "verdict",
        "correctness_score",
        "reason",
        "missing_points",
        "suggested_improvement",
    }
    if not required.issubset(data.keys()):
        logger.warning("Follow-up answer eval missing keys: %s", required - data.keys())
        return False

    verdict = data.get("verdict")
    if verdict not in {"correct", "partially_correct", "incorrect", "insufficient_information"}:
        return False

    score = data.get("correctness_score")
    if not isinstance(score, int) or score < 0 or score > 100:
        return False

    if not isinstance(data.get("is_correct"), bool):
        return False
    if not isinstance(data.get("reason"), str):
        return False
    if not isinstance(data.get("missing_points"), list):
        return False
    if not isinstance(data.get("suggested_improvement"), str):
        return False
    return True


def analyze_with_llm(words: list[dict]) -> dict:
    """
    Call Groq API with the indexed transcript and return coaching results.

    Never raises — always returns a valid dict (safe defaults on failure).

    Args:
        words: list of {"word": str, "start": float, "end": float, "index": int}

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

    messages = [
        {"role": "system", "content": COACH_SYSTEM_PROMPT},
        {"role": "user", "content": indexed_transcript},
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


def generate_follow_up_question(
    transcript: str,
    summary_feedback: list[str] | None = None,
    strengths: list[str] | None = None,
    improvements: list[str] | None = None,
) -> str:
    fallback = (
        "In 60-90 seconds, restate your core message and support it with one concrete example."
    )

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY not set")
        return fallback

    transcript_excerpt = " ".join((transcript or "").split()[:900]).strip()
    payload = {
        "transcript_excerpt": transcript_excerpt,
        "summary_feedback": (summary_feedback or [])[:5],
        "strengths": (strengths or [])[:4],
        "improvements": (improvements or [])[:5],
    }

    client = Groq(api_key=api_key)
    messages = [
        {"role": "system", "content": FOLLOW_UP_QUESTION_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload)},
    ]

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=180,
        )
        raw = response.choices[0].message.content or ""
        parsed = _parse_follow_up_question(raw)
        if parsed and not _is_delivery_mechanics_question(parsed):
            return parsed
    except Exception as exc:
        logger.error("Follow-up question generation failed on first attempt: %s", exc)

    try:
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "Return only JSON with one non-empty field: "
                    '{"question": "..."}'
                ),
            }
        ]
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=retry_messages,
            response_format={"type": "json_object"},
            max_tokens=180,
        )
        raw = response.choices[0].message.content or ""
        parsed = _parse_follow_up_question(raw)
        if parsed and not _is_delivery_mechanics_question(parsed):
            return parsed
    except Exception as exc:
        logger.error("Follow-up question generation retry failed: %s", exc)

    return fallback


def evaluate_follow_up_answer(
    question: str,
    answer_transcript: str,
    presentation_transcript: str = "",
    presentation_summary_feedback: list[str] | None = None,
    presentation_strengths: list[str] | None = None,
    presentation_improvements: list[str] | None = None,
) -> dict:
    if not question.strip() or not answer_transcript.strip():
        return _safe_follow_up_answer_eval_defaults()

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY not set")
        return _safe_follow_up_answer_eval_defaults()

    payload = {
        "question": question.strip(),
        "answer_transcript": " ".join(answer_transcript.split()[:1200]),
        "presentation_context": {
            "transcript_excerpt": " ".join((presentation_transcript or "").split()[:1200]),
            "summary_feedback": (presentation_summary_feedback or [])[:6],
            "strengths": (presentation_strengths or [])[:5],
            "improvements": (presentation_improvements or [])[:6],
        },
    }

    client = Groq(api_key=api_key)
    messages = [
        {"role": "system", "content": FOLLOW_UP_ANSWER_EVAL_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload)},
    ]

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=300,
        )
        raw = response.choices[0].message.content or ""
        parsed = _strip_and_parse(raw)
        if parsed and _validate_follow_up_answer_eval(parsed):
            return parsed
    except Exception as exc:
        logger.error("Follow-up answer evaluation failed on first attempt: %s", exc)

    try:
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "Return only valid JSON with keys: "
                    "is_correct, verdict, correctness_score, reason, missing_points, suggested_improvement."
                ),
            }
        ]
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=retry_messages,
            response_format={"type": "json_object"},
            max_tokens=300,
        )
        raw = response.choices[0].message.content or ""
        parsed = _strip_and_parse(raw)
        if parsed and _validate_follow_up_answer_eval(parsed):
            return parsed
    except Exception as exc:
        logger.error("Follow-up answer evaluation retry failed: %s", exc)

    return _safe_follow_up_answer_eval_defaults()


# Keep old name as alias so main.py import doesn't break
analyze_with_ollama = analyze_with_llm


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
