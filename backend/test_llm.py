"""
Standalone test for backend/llm.py — run from the backend/ directory:
    python test_llm.py

Does NOT require Supabase, ffmpeg, or Whisper — just Ollama running locally.
"""
import json
from llm import analyze_with_ollama, map_llm_events

# Sample transcript words (mimics what faster-whisper produces)
SAMPLE_WORDS = [
    {"word": "Hello", "start": 0.0, "end": 0.4, "index": 0},
    {"word": "everyone", "start": 0.4, "end": 0.9, "index": 1},
    {"word": "um", "start": 1.0, "end": 1.2, "index": 2},
    {"word": "today", "start": 1.3, "end": 1.6, "index": 3},
    {"word": "I", "start": 1.7, "end": 1.8, "index": 4},
    {"word": "think", "start": 1.8, "end": 2.1, "index": 5},
    {"word": "I", "start": 2.2, "end": 2.3, "index": 6},
    {"word": "want", "start": 2.3, "end": 2.5, "index": 7},
    {"word": "to", "start": 2.5, "end": 2.6, "index": 8},
    {"word": "talk", "start": 2.7, "end": 2.9, "index": 9},
    {"word": "about", "start": 3.0, "end": 3.3, "index": 10},
    {"word": "like", "start": 3.4, "end": 3.6, "index": 11},
    {"word": "climate", "start": 3.7, "end": 4.0, "index": 12},
    {"word": "change", "start": 4.0, "end": 4.4, "index": 13},
    {"word": "basically", "start": 4.5, "end": 4.9, "index": 14},
    {"word": "it", "start": 5.0, "end": 5.1, "index": 15},
    {"word": "is", "start": 5.1, "end": 5.2, "index": 16},
    {"word": "maybe", "start": 5.3, "end": 5.6, "index": 17},
    {"word": "the", "start": 5.6, "end": 5.7, "index": 18},
    {"word": "most", "start": 5.7, "end": 5.9, "index": 19},
    {"word": "important", "start": 6.0, "end": 6.5, "index": 20},
    {"word": "issue", "start": 6.5, "end": 6.9, "index": 21},
    {"word": "of", "start": 7.0, "end": 7.1, "index": 22},
    {"word": "our", "start": 7.1, "end": 7.3, "index": 23},
    {"word": "time", "start": 7.3, "end": 7.7, "index": 24},
]

print("Calling analyze_with_ollama()...")
result = analyze_with_ollama(SAMPLE_WORDS)

print("\n--- RESULT ---")
print(json.dumps(result, indent=2))

print("\n--- CHECKS ---")
assert "scores" in result, "FAIL: missing scores"
assert "strengths" in result, "FAIL: missing strengths"
assert "improvements" in result, "FAIL: missing improvements"
assert "structure" in result, "FAIL: missing structure"
assert "feedbackEvents" in result, "FAIL: missing feedbackEvents"
assert "stats" in result, "FAIL: missing stats"

score_keys = {"clarity", "pace_consistency", "confidence_language", "content_structure", "filler_word_density"}
assert score_keys == set(result["scores"].keys()), f"FAIL: scores keys mismatch: {result['scores'].keys()}"

print("✓ All required keys present")
print(f"✓ Scores: {result['scores']}")
print(f"✓ Strengths count: {len(result['strengths'])}")
print(f"✓ Improvements count: {len(result['improvements'])}")
print(f"✓ feedbackEvents count: {len(result['feedbackEvents'])}")

# Test map_llm_events
if result["feedbackEvents"]:
    mapped = map_llm_events(result["feedbackEvents"], SAMPLE_WORDS)
    print(f"✓ map_llm_events: {len(mapped)} events with timestamps")
    for ev in mapped[:3]:
        print(f"   [{ev['type']}] t={ev['timestamp']:.1f}s — {ev['title']}")

print("\nAll checks passed.")
