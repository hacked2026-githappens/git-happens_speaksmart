from __future__ import annotations

import os
import sys
from typing import Iterable

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None  # type: ignore[assignment]

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
except Exception:  # pragma: no cover
    mp = None  # type: ignore[assignment]
    mp_python = None  # type: ignore[assignment]
    mp_vision = None  # type: ignore[assignment]


# Tune this constant to calibrate gesture energy sensitivity.
# Higher values increase the 0-10 energy score for the same motion.
GESTURE_ENERGY_SCALE = 30.0
DEFAULT_FPS_FALLBACK = 30.0

DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")


def _resolve_model_path() -> str:
    """Resolve model path from env override or default local location."""
    return os.getenv("NON_VERBAL_MODEL_PATH", DEFAULT_MODEL_PATH)


def _build_empty_response(samples: int = 0) -> dict:
    return {
        "non_verbal": {
            "gesture_energy": 0.0,
            "activity_level": "unknown",
            "avg_velocity": 0.0,
            "samples": int(samples),
        }
    }


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _mean(values: Iterable[float]) -> float:
    values = list(values)
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def _classify_activity(gesture_energy: float, transitions: int) -> str:
    if transitions <= 0:
        return "unknown"
    if gesture_energy < 2.5:
        return "low"
    if gesture_energy < 6.5:
        return "moderate"
    return "high"


def _extract_hand_vector_task(result: object) -> list[float] | None:
    """
    Build a normalized landmark vector from MediaPipe Tasks HandLandmarkerResult.

    Layout: left_hand(21*2) + right_hand(21*2). Missing hands remain zeros.
    Returns None if no hands detected for this frame.
    """
    hand_landmarks = getattr(result, "hand_landmarks", None)
    if not hand_landmarks:
        return None

    handedness = getattr(result, "handedness", None) or []
    vec_size = 21 * 2

    left = [0.0] * vec_size
    right = [0.0] * vec_size

    for i, landmarks in enumerate(hand_landmarks):
        label = None
        if i < len(handedness) and handedness[i]:
            try:
                label = handedness[i][0].category_name.lower()  # "left" / "right"
            except Exception:
                label = None

        values: list[float] = []
        for lm in landmarks:
            values.extend([float(lm.x), float(lm.y)])

        if label == "left":
            left = values
        elif label == "right":
            right = values
        else:
            # fallback if handedness isn't reliable
            if left == [0.0] * vec_size:
                left = values
            else:
                right = values

    return left + right


def analyze_nonverbal(video_path: str, target_fps: int = 5) -> dict:
    """
    Analyze hand motion in a video and return non-verbal activity metrics.

    - Samples frames at target_fps.
    - Runs MediaPipe Tasks HandLandmarker in VIDEO mode (requires timestamp_ms).
    - For consecutive valid hand vectors:
        frame_velocity = mean(abs(curr_vec - prev_vec))
      avg_velocity = mean(frame_velocity over valid transitions)
      gesture_energy = clamp(avg_velocity * GESTURE_ENERGY_SCALE, 0, 10)
    """
    samples = 0
    cap = None

    try:
        if cv2 is None or mp is None or mp_python is None or mp_vision is None:
            return _build_empty_response(samples=0)

        if not os.path.exists(video_path):
            return _build_empty_response(samples=0)

        model_path = _resolve_model_path()
        if not os.path.exists(model_path):
            # model missing; fail gracefully
            return _build_empty_response(samples=0)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return _build_empty_response(samples=0)

        source_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        effective_source_fps = source_fps if source_fps > 0 else DEFAULT_FPS_FALLBACK

        safe_target_fps = max(1, int(target_fps))
        frame_stride = max(1, int(round(effective_source_fps / safe_target_fps)))

        base_options = mp_python.BaseOptions(model_asset_path=model_path)
        options = mp_vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        velocities: list[float] = []
        prev_vec: list[float] | None = None
        frame_index = 0

        with mp_vision.HandLandmarker.create_from_options(options) as landmarker:
            while True:
                success, frame = cap.read()
                if not success:
                    break

                # timestamp based on ORIGINAL frame index (not sampled count)
                timestamp_ms = int((frame_index / effective_source_fps) * 1000)

                # skip frames to hit target fps
                if frame_index % frame_stride != 0:
                    frame_index += 1
                    continue

                samples += 1

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                curr_vec = _extract_hand_vector_task(result)
                if curr_vec is not None and prev_vec is not None:
                    diff = [abs(c - p) for c, p in zip(curr_vec, prev_vec)]
                    velocities.append(_mean(diff))

                # update prev_vec only if we have a current hand vector
                if curr_vec is not None:
                    prev_vec = curr_vec

                frame_index += 1

        avg_velocity = _mean(velocities)
        gesture_energy = _clamp(avg_velocity * GESTURE_ENERGY_SCALE, 0.0, 10.0)
        activity_level = _classify_activity(gesture_energy, transitions=len(velocities))

        return {
            "non_verbal": {
                "gesture_energy": float(round(gesture_energy, 3)),
                "activity_level": activity_level,
                "avg_velocity": float(round(avg_velocity, 6)),
                "samples": int(samples),
            }
        }

    except Exception:
        # Never crash upstream pipeline due to non-verbal analysis failures.
        return _build_empty_response(samples=samples)

    finally:
        if cap is not None:
            cap.release()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python backend/non_verbal/vision.py <path/to/video.mp4> [target_fps]")
        raise SystemExit(1)

    input_video = sys.argv[1]
    fps = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    print(analyze_nonverbal(input_video, target_fps=fps))
