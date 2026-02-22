from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from llm import analyze_with_llm, generate_content_specific_plan, map_llm_events
from non_verbal.vision import analyze_nonverbal

logger = logging.getLogger(__name__)


async def run_analysis_job(
    job_id: str,
    temp_path: Path,
    duration_seconds: float | None,
    preset: str,
    supabase: Any,
) -> None:
    """Background pipeline: transcribe + vision in parallel, then LLM, then store results."""
    # Import here to avoid circular import (job_runner imports from main, main imports job_runner)
    from main import (
        analyze_audio_delivery_from_samples,
        build_speech_metrics,
        build_summary_feedback,
        build_timeline_markers,
        detect_media_duration_seconds,
        extract_audio_samples_for_analysis,
        transcribe_with_whisper,
    )

    try:
        supabase.table("jobs").update({"status": "processing"}).eq("id", job_id).execute()

        # Auto-detect duration if not provided
        if duration_seconds is None or duration_seconds <= 0:
            detected, _ = await asyncio.to_thread(detect_media_duration_seconds, temp_path)
            duration_seconds = detected if detected is not None else 30.0

        # Run transcription, non-verbal analysis, and audio extraction in parallel
        (
            (transcript, words, whisper_notes),
            nv_result,
            (audio_samples, audio_sample_rate, audio_extract_notes),
        ) = await asyncio.gather(
            asyncio.to_thread(transcribe_with_whisper, temp_path),
            asyncio.to_thread(analyze_nonverbal, str(temp_path)),
            asyncio.to_thread(extract_audio_samples_for_analysis, temp_path),
        )

        metrics = build_speech_metrics(transcript, duration_seconds)
        audio_delivery, audio_dsp_notes = await asyncio.to_thread(
            analyze_audio_delivery_from_samples,
            audio_samples,
            audio_sample_rate,
            words,
            duration_seconds,
        )
        audio_notes = [*audio_extract_notes, *audio_dsp_notes]
        metrics["audio_delivery"] = audio_delivery
        metrics["non_verbal"] = nv_result["non_verbal"]
        summary_feedback = build_summary_feedback(metrics)

        analysis_context = {
            "pace_label": metrics.get("pace_label"),
            "words_per_minute": metrics.get("words_per_minute"),
            "filler_word_count": metrics.get("filler_word_count", 0),
            "non_verbal": metrics.get("non_verbal", {}),
        }

        # Run LLM coaching and content plan generation in parallel.
        # Content plan uses transcript + summary_feedback (available now); it doesn't
        # need the coaching improvements list, so we pass [] to enable parallelism.
        llm_result, content_plan = await asyncio.gather(
            asyncio.to_thread(analyze_with_llm, words, analysis_context, preset),
            asyncio.to_thread(
                generate_content_specific_plan,
                transcript,
                summary_feedback,
                [],
                preset,
            ),
        )
        llm_events = map_llm_events(llm_result.get("feedbackEvents", []), words)
        llm_result["feedbackEvents"] = llm_events

        notes = [*whisper_notes, *audio_notes]
        if not transcript:
            notes.append("Transcript is empty. Speaking metrics may be limited.")

        results: dict[str, Any] = {
            # AGENTS.md spec keys
            "words": words,
            "duration": duration_seconds,
            "feedbackEvents": llm_events,
            "scores": llm_result.get("scores", {}),
            "strengths": llm_result.get("strengths", []),
            "improvements": llm_result.get("improvements", []),
            "structure": llm_result.get("structure", {}),
            "non_verbal": metrics["non_verbal"],
            "stats": llm_result.get("stats", {
                "total_filler_words": metrics.get("filler_word_count", 0),
                "avg_wpm": metrics.get("words_per_minute") or 0,
                "total_words": metrics.get("word_count", 0),
                "flagged_sentences": 0,
            }),
            # Backward-compat keys so mapAnalyzePayload() + saveSession() in index.tsx work unchanged
            "transcript": transcript,
            "summary_feedback": summary_feedback,
            "markers": [m.model_dump() for m in build_timeline_markers(metrics)],
            "llm_analysis": llm_result,
            "metrics": metrics,
            "personalized_content_plan": content_plan,
            "notes": notes,
        }

        supabase.table("jobs").update({"status": "done", "results": results}).eq("id", job_id).execute()

    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        supabase.table("jobs").update(
            {"status": "error", "error_message": str(exc)}
        ).eq("id", job_id).execute()

    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to delete temp file %s", temp_path)
