from __future__ import annotations

from contextlib import ExitStack
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
ATTENTION_MIN_SEGMENT_SECONDS = 2.0
POSTURE_EVENT_MIN_SECONDS = 2.0
ATTENTION_YAW_RATIO_THRESHOLD = 0.35
ATTENTION_PITCH_RATIO_THRESHOLD = 0.85
SWAY_EVENT_THRESHOLD = 0.02
POSTURE_STABILITY_SCALE = 80.0

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
LEGACY_NON_VERBAL_DIR = os.path.dirname(__file__)

DEFAULT_HAND_MODEL_CANDIDATES = [
    os.path.join(BACKEND_DIR, "models", "hand_landmarker.task"),
    os.path.join(LEGACY_NON_VERBAL_DIR, "models", "hand_landmarker.task"),
]
DEFAULT_FACE_MODEL_CANDIDATES = [
    os.path.join(BACKEND_DIR, "models", "face_landmarker.task"),
    os.path.join(LEGACY_NON_VERBAL_DIR, "models", "face_landmarker.task"),
]
DEFAULT_POSE_MODEL_CANDIDATES = [
    os.path.join(BACKEND_DIR, "models", "pose_landmarker.task"),
    os.path.join(LEGACY_NON_VERBAL_DIR, "models", "pose_landmarker.task"),
]


def _resolve_model_path(env_var: str, candidates: list[str]) -> str | None:
    """Resolve model path from env override or first existing default candidate."""
    env_path = os.getenv(env_var)
    if env_path and os.path.exists(env_path):
        return env_path
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _build_empty_response(samples: int = 0) -> dict:
    return {
        "non_verbal": {
            "gesture_energy": 0.0,
            "activity_level": "unknown",
            "avg_velocity": 0.0,
            "samples": int(samples),
            "eye_contact_score": 0.0,
            "eye_contact_level": "unknown",
            "posture_score": 0.0,
            "posture_level": "unknown",
            "eye_contact_pct": 0.0,
            "posture_stability": 0.0,
            "sway_score": 0.0,
            "gaze_away_events": [],
            "posture_events": [],
            "non_verbal_events": [],
        }
    }


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _mean(values: Iterable[float]) -> float:
    values = list(values)
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def _seconds_to_hms(total_seconds: float) -> str:
    total = max(0.0, float(total_seconds))
    hours = int(total // 3600)
    minutes = int((total % 3600) // 60)
    seconds = total - (hours * 3600) - (minutes * 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:05.2f}"


def _classify_activity(gesture_energy: float, transitions: int) -> str:
    if transitions <= 0:
        return "unknown"
    if gesture_energy < 2.5:
        return "low"
    if gesture_energy < 6.5:
        return "moderate"
    return "high"


def _classify_eye_contact(score: float, face_samples: int) -> str:
    if face_samples <= 0:
        return "unknown"
    if score < 4.0:
        return "low"
    if score < 7.0:
        return "moderate"
    return "high"


def _classify_posture(score: float, posture_samples: int) -> str:
    if posture_samples <= 1:
        return "unknown"
    if score < 4.0:
        return "unstable"
    if score < 7.0:
        return "moderate"
    return "stable"


def _posture_stability_from_sway(sway_score: float) -> float:
    """Convert raw sway score to a stable 0-10 metric (higher means steadier posture)."""
    return _clamp(10.0 - (sway_score * POSTURE_STABILITY_SCALE), 0.0, 10.0)


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


def _landmark_xy(landmarks: list[object], index: int) -> tuple[float, float] | None:
    if index < 0 or index >= len(landmarks):
        return None
    lm = landmarks[index]
    return float(lm.x), float(lm.y)


def _estimate_attention(face_result: object) -> bool:
    """
    Estimate whether the speaker is attentive to camera.

    This uses face presence and a lightweight head-orientation proxy:
    - yaw proxy from nose offset vs eye midpoint
    - pitch proxy from nose vertical offset vs eye-to-mouth height
    """
    faces = getattr(face_result, "face_landmarks", None) or []
    if not faces:
        return False

    landmarks = faces[0]
    left_eye = _landmark_xy(landmarks, 33)
    right_eye = _landmark_xy(landmarks, 263)
    nose = _landmark_xy(landmarks, 1)
    mouth = _landmark_xy(landmarks, 13)
    if not left_eye or not right_eye or not nose or not mouth:
        return True

    eye_mid_x = (left_eye[0] + right_eye[0]) / 2.0
    eye_mid_y = (left_eye[1] + right_eye[1]) / 2.0
    inter_eye = max(abs(right_eye[0] - left_eye[0]), 1e-6)
    eye_to_mouth = max(abs(mouth[1] - eye_mid_y), 1e-6)

    yaw_ratio = abs(nose[0] - eye_mid_x) / inter_eye
    pitch_ratio = abs(nose[1] - eye_mid_y) / eye_to_mouth

    return (
        yaw_ratio <= ATTENTION_YAW_RATIO_THRESHOLD
        and pitch_ratio <= ATTENTION_PITCH_RATIO_THRESHOLD
    )


def _extract_pose_mid_shoulder(pose_result: object) -> tuple[float, float] | None:
    poses = getattr(pose_result, "pose_landmarks", None) or []
    if not poses:
        return None
    landmarks = poses[0]
    left_shoulder = _landmark_xy(landmarks, 11)
    right_shoulder = _landmark_xy(landmarks, 12)
    if not left_shoulder or not right_shoulder:
        return None
    return (
        (left_shoulder[0] + right_shoulder[0]) / 2.0,
        (left_shoulder[1] + right_shoulder[1]) / 2.0,
    )


def _segments_from_flags(
    timestamps: list[float], flags: list[bool], min_duration_seconds: float
) -> list[dict[str, float]]:
    """Convert boolean timeline into contiguous {start,end} events with min duration."""
    if not timestamps or not flags or len(timestamps) != len(flags):
        return []

    events: list[dict[str, float]] = []
    start_ts: float | None = None
    last_true_ts: float | None = None

    for ts, active in zip(timestamps, flags):
        if active:
            if start_ts is None:
                start_ts = ts
            last_true_ts = ts
            continue

        if start_ts is not None and last_true_ts is not None:
            duration = last_true_ts - start_ts
            if duration >= min_duration_seconds:
                start = round(start_ts, 3)
                end = round(last_true_ts, 3)
                events.append(
                    {
                        "start": start,
                        "end": end,
                        "start_hms": _seconds_to_hms(start),
                        "end_hms": _seconds_to_hms(end),
                    }
                )
        start_ts = None
        last_true_ts = None

    if start_ts is not None and last_true_ts is not None:
        duration = last_true_ts - start_ts
        if duration >= min_duration_seconds:
            start = round(start_ts, 3)
            end = round(last_true_ts, 3)
            events.append(
                {
                    "start": start,
                    "end": end,
                    "start_hms": _seconds_to_hms(start),
                    "end_hms": _seconds_to_hms(end),
                }
            )

    return events


def _build_non_verbal_events(
    gaze_away_events: list[dict[str, float]],
    posture_events: list[dict[str, float]],
    activity_level: str,
) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []

    for event in gaze_away_events:
        duration = max(0.0, float(event["end"]) - float(event["start"]))
        severity = "high" if duration >= 4.0 else "medium"
        events.append(
            {
                "timestamp": float(event["start"]),
                "timestamp_hms": _seconds_to_hms(float(event["start"])),
                "type": "gaze_away",
                "severity": severity,
                "title": "Eye contact dropped",
                "message": f"Looked away for ~{duration:.1f}s.",
            }
        )

    for event in posture_events:
        duration = max(0.0, float(event["end"]) - float(event["start"]))
        severity = "high" if duration >= 4.0 else "medium"
        events.append(
            {
                "timestamp": float(event["start"]),
                "timestamp_hms": _seconds_to_hms(float(event["start"])),
                "type": "high_sway",
                "severity": severity,
                "title": "Posture became unstable",
                "message": f"Noticeable upper-body sway for ~{duration:.1f}s.",
            }
        )

    if activity_level == "low":
        events.append(
            {
                "timestamp": 0.0,
                "timestamp_hms": _seconds_to_hms(0.0),
                "type": "low_gesture",
                "severity": "low",
                "title": "Low gesture activity",
                "message": "Consider using a few deliberate hand gestures for emphasis.",
            }
        )
    elif activity_level == "high":
        events.append(
            {
                "timestamp": 0.0,
                "timestamp_hms": _seconds_to_hms(0.0),
                "type": "high_gesture",
                "severity": "medium",
                "title": "High gesture activity",
                "message": "Energetic movement detected; keep gestures intentional.",
            }
        )

    return sorted(events, key=lambda event: float(event["timestamp"]))


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

        hand_model_path = _resolve_model_path(
            "NON_VERBAL_HAND_MODEL_PATH", DEFAULT_HAND_MODEL_CANDIDATES
        )
        if hand_model_path is None:
            # model missing; fail gracefully
            return _build_empty_response(samples=0)

        face_model_path = _resolve_model_path(
            "NON_VERBAL_FACE_MODEL_PATH", DEFAULT_FACE_MODEL_CANDIDATES
        )
        pose_model_path = _resolve_model_path(
            "NON_VERBAL_POSE_MODEL_PATH", DEFAULT_POSE_MODEL_CANDIDATES
        )

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return _build_empty_response(samples=0)

        source_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        effective_source_fps = source_fps if source_fps > 0 else DEFAULT_FPS_FALLBACK

        safe_target_fps = max(1, int(target_fps))
        frame_stride = max(1, int(round(effective_source_fps / safe_target_fps)))

        hand_base_options = mp_python.BaseOptions(model_asset_path=hand_model_path)
        hand_options = mp_vision.HandLandmarkerOptions(
            base_options=hand_base_options,
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        face_options = None
        if face_model_path is not None:
            face_options = mp_vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=face_model_path),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_faces=1,
            )
        pose_options = None
        if pose_model_path is not None:
            pose_options = mp_vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=pose_model_path),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_poses=1,
            )

        velocities: list[float] = []
        prev_vec: list[float] | None = None
        prev_mid_shoulder: tuple[float, float] | None = None
        frame_index = 0
        attention_timestamps: list[float] = []
        attention_flags: list[bool] = []
        sway_timestamps: list[float] = []
        sway_values: list[float] = []
        sway_flags: list[bool] = []

        with ExitStack() as stack:
            hand_landmarker = stack.enter_context(
                mp_vision.HandLandmarker.create_from_options(hand_options)
            )
            face_landmarker = (
                stack.enter_context(mp_vision.FaceLandmarker.create_from_options(face_options))
                if face_options is not None
                else None
            )
            pose_landmarker = (
                stack.enter_context(mp_vision.PoseLandmarker.create_from_options(pose_options))
                if pose_options is not None
                else None
            )

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

                hand_result = hand_landmarker.detect_for_video(mp_image, timestamp_ms)
                curr_vec = _extract_hand_vector_task(hand_result)
                if curr_vec is not None and prev_vec is not None:
                    diff = [abs(c - p) for c, p in zip(curr_vec, prev_vec)]
                    velocities.append(_mean(diff))

                # update prev_vec only if we have a current hand vector
                if curr_vec is not None:
                    prev_vec = curr_vec

                if face_landmarker is not None:
                    face_result = face_landmarker.detect_for_video(mp_image, timestamp_ms)
                    attention_timestamps.append(timestamp_ms / 1000.0)
                    attention_flags.append(_estimate_attention(face_result))

                if pose_landmarker is not None:
                    pose_result = pose_landmarker.detect_for_video(mp_image, timestamp_ms)
                    curr_mid_shoulder = _extract_pose_mid_shoulder(pose_result)
                    if curr_mid_shoulder is not None and prev_mid_shoulder is not None:
                        sway = (
                            ((curr_mid_shoulder[0] - prev_mid_shoulder[0]) ** 2)
                            + ((curr_mid_shoulder[1] - prev_mid_shoulder[1]) ** 2)
                        ) ** 0.5
                        sway_timestamps.append(timestamp_ms / 1000.0)
                        sway_values.append(float(sway))
                        sway_flags.append(sway >= SWAY_EVENT_THRESHOLD)
                    if curr_mid_shoulder is not None:
                        prev_mid_shoulder = curr_mid_shoulder

                frame_index += 1

        avg_velocity = _mean(velocities)
        gesture_energy = _clamp(avg_velocity * GESTURE_ENERGY_SCALE, 0.0, 10.0)
        activity_level = _classify_activity(gesture_energy, transitions=len(velocities))

        attentive_count = sum(1 for attentive in attention_flags if attentive)
        eye_contact_pct = (
            (attentive_count / len(attention_flags)) * 100.0 if attention_flags else 0.0
        )
        eye_contact_score = _clamp(eye_contact_pct / 10.0, 0.0, 10.0)
        eye_contact_level = _classify_eye_contact(eye_contact_score, len(attention_flags))
        gaze_away_events = _segments_from_flags(
            attention_timestamps,
            [not attentive for attentive in attention_flags],
            ATTENTION_MIN_SEGMENT_SECONDS,
        )

        sway_score = _mean(sway_values)
        posture_stability = _posture_stability_from_sway(sway_score)
        posture_score = posture_stability
        posture_level = _classify_posture(posture_stability, len(sway_values))
        posture_events = _segments_from_flags(
            sway_timestamps, sway_flags, POSTURE_EVENT_MIN_SECONDS
        )
        non_verbal_events = _build_non_verbal_events(
            gaze_away_events=gaze_away_events,
            posture_events=posture_events,
            activity_level=activity_level,
        )

        return {
            "non_verbal": {
                "gesture_energy": float(round(gesture_energy, 3)),
                "activity_level": activity_level,
                "avg_velocity": float(round(avg_velocity, 6)),
                "samples": int(samples),
                "eye_contact_score": float(round(eye_contact_score, 3)),
                "eye_contact_level": eye_contact_level,
                "posture_score": float(round(posture_score, 3)),
                "posture_level": posture_level,
                "eye_contact_pct": float(round(eye_contact_pct, 3)),
                "posture_stability": float(round(posture_stability, 3)),
                "sway_score": float(round(sway_score, 6)),
                "gaze_away_events": gaze_away_events,
                "posture_events": posture_events,
                "non_verbal_events": non_verbal_events,
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
