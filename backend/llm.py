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
- strengths: 2-3 items; improvements: 2-4 items

Non-verbal context rules (applies when a "--- Context ---" block is provided):
- If activity_level is "unknown", do NOT mention gestures or body language anywhere in your response.
- If activity_level is "low", include one improvement about using more deliberate hand gestures.
- If activity_level is "moderate", acknowledge good physical engagement in strengths or body_feedback.
- If activity_level is "high", note energetic delivery and suggest channeling gestures with intention."""

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

CONTENT_IMPROVEMENTS_SYSTEM_PROMPT = """You are a presentation coach focused on CONTENT quality.

You receive:
- transcript excerpt
- summary feedback
- prior generic improvements
- presentation preset

Return ONLY valid JSON with this exact shape:
{
  "topic_summary": "<one concise sentence describing the topic and claim>",
  "audience_takeaway": "<one sentence for what the audience should remember or do>",
  "improvements": [
    {
      "title": "<short improvement title>",
      "content_issue": "<what is weak in this specific transcript>",
      "specific_fix": "<how to fix it with topic-specific guidance>",
      "example_revision": "<1-2 sentence rewrite/example tailored to this topic>"
    }
  ]
}

Rules:
- Infer the topic from transcript content first.
- Keep improvements specific to this topic and claims.
- Prioritize content logic, evidence quality, specificity, and audience relevance.
- Do NOT focus on delivery mechanics (pace, fillers, body language) unless the transcript topic itself is about delivery.
- Return 3-4 improvements.
- No markdown. No extra keys. No text outside JSON."""


PRESET_CONTEXT: dict[str, str] = {
    "general": "",
    "pitch": (
        "Context: This is a startup or investor PITCH. "
        "Prioritise: confident, hedge-free language; crisp evidence; a strong opening hook; "
        "a clear ask or CTA in the conclusion. "
        "Score confidence_language and content_structure more strictly. "
        "Flag any hedging (I think / maybe / kind of) as high severity."
    ),
    "classroom": (
        "Context: This is a CLASSROOM or educational presentation. "
        "Prioritise: clarity of explanation, logical step-by-step structure, appropriate pacing "
        "for audience comprehension, and helpful examples or analogies. "
        "Score content_structure and clarity more strictly. "
        "Pace is more forgiving — slower delivery (100-140 WPM) is acceptable."
    ),
    "interview": (
        "Context: This is a JOB INTERVIEW or professional panel. "
        "Prioritise: direct answers, concrete examples (prefer STAR structure), "
        "confident and specific language, no rambling. "
        "Score confidence_language and clarity more strictly. "
        "Flag vague or unsupported claims as high severity."
    ),
    "keynote": (
        "Context: This is a KEYNOTE or large-audience talk. "
        "Prioritise: storytelling, audience engagement, energy and variation, "
        "memorable phrases, and a powerful open and close. "
        "Score content_structure and pace_consistency more strictly. "
        "Reward energetic delivery in strengths when gesture_energy is moderate or high."
    ),
}


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


def _safe_content_plan_defaults(transcript: str) -> dict:
    excerpt = " ".join((transcript or "").split()[:18]).strip()
    topic_summary = excerpt if excerpt else "Topic could not be inferred from the transcript."
    return {
        "topic_summary": topic_summary[:160],
        "audience_takeaway": "State one clear claim and support it with one concrete evidence point.",
        "improvements": [
            {
                "title": "Clarify the core claim",
                "content_issue": "The main argument is not explicit enough early in the talk.",
                "specific_fix": "Open with one direct thesis sentence, then support it with two concrete points.",
                "example_revision": "My main point is X because of Y and Z. First, ... Second, ...",
            },
            {
                "title": "Strengthen supporting evidence",
                "content_issue": "Some statements are broad and not anchored in specific proof.",
                "specific_fix": "Add one number, example, or case detail for each major claim.",
                "example_revision": "Instead of saying 'this works well,' cite one concrete result and why it matters.",
            },
            {
                "title": "Tighten audience takeaway",
                "content_issue": "The ending does not clearly tell the audience what to remember or do next.",
                "specific_fix": "Close with one action-oriented takeaway linked to your main claim.",
                "example_revision": "So the key action is ____, because it directly improves ____ for ____.",
            },
        ],
    }


def _validate_content_plan(data: dict) -> bool:
    required = {"topic_summary", "audience_takeaway", "improvements"}
    if not required.issubset(data.keys()):
        logger.warning("Content plan missing keys: %s", required - data.keys())
        return False

    if not isinstance(data.get("topic_summary"), str):
        return False
    if not isinstance(data.get("audience_takeaway"), str):
        return False
    improvements = data.get("improvements")
    if not isinstance(improvements, list) or not improvements:
        return False

    for item in improvements[:4]:
        if not isinstance(item, dict):
            return False
        for key in ("title", "content_issue", "specific_fix", "example_revision"):
            if not isinstance(item.get(key), str):
                return False
    return True


def _normalize_content_plan(data: dict) -> dict:
    improvements = []
    for item in (data.get("improvements") or [])[:4]:
        if not isinstance(item, dict):
            continue
        improvements.append(
            {
                "title": str(item.get("title", "")).strip(),
                "content_issue": str(item.get("content_issue", "")).strip(),
                "specific_fix": str(item.get("specific_fix", "")).strip(),
                "example_revision": str(item.get("example_revision", "")).strip(),
            }
        )

    return {
        "topic_summary": str(data.get("topic_summary", "")).strip(),
        "audience_takeaway": str(data.get("audience_takeaway", "")).strip(),
        "improvements": improvements,
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
    lines.append(
        f"eye_contact_proxy: score={nv.get('eye_contact_score', 'unknown')}, "
        f"level={nv.get('eye_contact_level', 'unknown')}"
    )
    lines.append(
        f"posture_proxy: score={nv.get('posture_score', 'unknown')}, "
        f"level={nv.get('posture_level', 'unknown')}"
    )
    return "\n".join(lines)


NON_VERBAL_TERMS_PATTERN = re.compile(
    r"\b(gesture|gestures|hand|hands|body language|non[- ]verbal|posture|physical engagement)\b",
    flags=re.IGNORECASE,
)


def _remove_non_verbal_mentions(text: str) -> str:
    """Remove explicit non-verbal references from a generated text field."""
    if not text:
        return text
    cleaned = NON_VERBAL_TERMS_PATTERN.sub("", text)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,.-")
    if not cleaned:
        return "Focus on verbal clarity and structure."
    return cleaned


def _enforce_unknown_non_verbal_policy(data: dict, analysis_context: dict | None) -> dict:
    """Deterministically enforce no non-verbal claims when activity_level is unknown."""
    nv = (analysis_context or {}).get("non_verbal", {})
    if str(nv.get("activity_level", "")).lower() != "unknown":
        return data

    strengths = data.get("strengths") or []
    data["strengths"] = [_remove_non_verbal_mentions(str(s)) for s in strengths]

    improvements = data.get("improvements") or []
    sanitized_improvements: list[dict] = []
    for imp in improvements:
        if not isinstance(imp, dict):
            continue
        sanitized_improvements.append(
            {
                "title": _remove_non_verbal_mentions(str(imp.get("title", ""))),
                "detail": _remove_non_verbal_mentions(str(imp.get("detail", ""))),
                "actionable_tip": _remove_non_verbal_mentions(str(imp.get("actionable_tip", ""))),
            }
        )
    data["improvements"] = sanitized_improvements

    structure = data.get("structure") or {}
    if isinstance(structure, dict):
        structure["body_feedback"] = _remove_non_verbal_mentions(str(structure.get("body_feedback", "")))
        data["structure"] = structure

    events = data.get("feedbackEvents") or []
    sanitized_events: list[dict] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        ev_title = str(ev.get("title", ""))
        ev_message = str(ev.get("message", ""))
        if NON_VERBAL_TERMS_PATTERN.search(ev_title) or NON_VERBAL_TERMS_PATTERN.search(ev_message):
            continue
        sanitized_events.append(ev)
    data["feedbackEvents"] = sanitized_events
    return data


def analyze_with_llm(words: list[dict], analysis_context: dict | None = None, preset: str = "general") -> dict:
    """
    Call Groq API with the indexed transcript and return coaching results.

    Never raises — always returns a valid dict (safe defaults on failure).

    Args:
        words: list of {"word": str, "start": float, "end": float, "index": int}
        analysis_context: optional dict with keys: pace_label, words_per_minute,
                          filler_word_count, non_verbal (gesture_energy, activity_level,
                          avg_velocity, samples)
        preset: speaking context — one of: general, pitch, classroom, interview, keynote

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

    preset_blurb = PRESET_CONTEXT.get(preset, "")
    system_content = COACH_SYSTEM_PROMPT if not preset_blurb else COACH_SYSTEM_PROMPT + "\n\n" + preset_blurb

    messages = [
        {"role": "system", "content": system_content},
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
            return _enforce_unknown_non_verbal_policy(data, analysis_context)
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
            return _enforce_unknown_non_verbal_policy(data, analysis_context)
        logger.error("LLM returned invalid JSON on retry, falling back to safe defaults")
    except Exception as exc:
        logger.error("Groq retry failed: %s", exc)

    return _safe_defaults()


def generate_content_specific_plan(
    transcript: str,
    summary_feedback: list[str] | None = None,
    llm_improvements: list[dict] | None = None,
    preset: str = "general",
) -> dict:
    if not transcript.strip():
        return _safe_content_plan_defaults(transcript)

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY not set")
        return _safe_content_plan_defaults(transcript)

    transcript_excerpt = " ".join((transcript or "").split()[:1400]).strip()
    payload = {
        "transcript_excerpt": transcript_excerpt,
        "summary_feedback": (summary_feedback or [])[:5],
        "prior_improvements": [
            {
                "title": str(item.get("title", "")),
                "detail": str(item.get("detail", "")),
                "actionable_tip": str(item.get("actionable_tip", "")),
            }
            for item in (llm_improvements or [])[:5]
            if isinstance(item, dict)
        ],
        "preset": preset,
    }
    preset_blurb = PRESET_CONTEXT.get(preset, "")
    if preset_blurb:
        payload["context"] = preset_blurb

    client = Groq(api_key=api_key)
    messages = [
        {"role": "system", "content": CONTENT_IMPROVEMENTS_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload)},
    ]

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=900,
        )
        raw = response.choices[0].message.content or ""
        parsed = _strip_and_parse(raw)
        if parsed and _validate_content_plan(parsed):
            return _normalize_content_plan(parsed)
    except Exception as exc:
        logger.error("Content-specific plan failed on first attempt: %s", exc)

    try:
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "Return complete JSON only with keys: topic_summary, "
                    "audience_takeaway, improvements[].title, improvements[].content_issue, "
                    "improvements[].specific_fix, improvements[].example_revision."
                ),
            }
        ]
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=retry_messages,
            response_format={"type": "json_object"},
            max_tokens=900,
        )
        raw = response.choices[0].message.content or ""
        parsed = _strip_and_parse(raw)
        if parsed and _validate_content_plan(parsed):
            return _normalize_content_plan(parsed)
    except Exception as exc:
        logger.error("Content-specific plan retry failed: %s", exc)

    return _safe_content_plan_defaults(transcript)


def generate_follow_up_question(
    transcript: str,
    summary_feedback: list[str] | None = None,
    strengths: list[str] | None = None,
    improvements: list[str] | None = None,
    preset: str = "general",
) -> str:
    fallback = (
        "In 60-90 seconds, restate your core message and support it with one concrete example."
    )

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY not set")
        return fallback

    transcript_excerpt = " ".join((transcript or "").split()[:900]).strip()
    payload: dict = {
        "transcript_excerpt": transcript_excerpt,
        "summary_feedback": (summary_feedback or [])[:5],
        "strengths": (strengths or [])[:4],
        "improvements": (improvements or [])[:5],
    }
    preset_blurb = PRESET_CONTEXT.get(preset, "")
    if preset_blurb:
        payload["context"] = preset_blurb

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


def analyze_with_ollama(words: list[dict], analysis_context: dict | None = None, preset: str = "general") -> dict:
    """Backward-compatible alias for analyze_with_llm."""
    return analyze_with_llm(words, analysis_context, preset)


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
