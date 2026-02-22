# Non-Verbal Analysis Module

This module analyzes non-verbal communication signals from video presentations using MediaPipe landmark models.

**File:** `backend/non_verbal/vision.py`

---

## What It Returns

`analyze_nonverbal(video_path, target_fps=5)` returns:

```json
{
  "non_verbal": {
    "gesture_energy": 0.0,
    "activity_level": "low|moderate|high|unknown",
    "avg_velocity": 0.0,
    "samples": 0,
    "eye_contact_score": 0.0,
    "eye_contact_level": "low|moderate|high|unknown",
    "posture_score": 0.0,
    "posture_level": "unstable|moderate|stable|unknown"
  }
}
```

Field notes:
- `gesture_*` — derived from hand landmark motion (MediaPipe Hand Landmarker)
- `eye_contact_*` — camera-facing proxy from face-center stability (not true gaze tracking)
- `posture_*` — posture stability proxy from vertical face movement over time (not full skeletal scoring)
- All scores are on a 0–10 scale

If any model is missing, the corresponding fields return `0.0` / `"unknown"` — the rest of the pipeline continues unaffected.

---

## Model Files

MediaPipe `.task` models live in `backend/models/`. They are not committed to the repo.

All three models are currently in use:

| Model | File | Signal |
|-------|------|--------|
| Hand Landmarker | `hand_landmarker.task` | Gesture energy, activity level |
| Face Landmarker | `face_landmarker.task` | Eye contact proxy |
| Pose Landmarker | `pose_landmarker.task` | Posture stability proxy |

### Download (PowerShell)

```powershell
New-Item -ItemType Directory -Force backend\models | Out-Null

Invoke-WebRequest `
  -Uri "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" `
  -OutFile "backend/models/hand_landmarker.task"

Invoke-WebRequest `
  -Uri "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" `
  -OutFile "backend/models/face_landmarker.task"

Invoke-WebRequest `
  -Uri "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" `
  -OutFile "backend/models/pose_landmarker.task"
```

### Download (macOS/Linux)

```bash
mkdir -p backend/models

curl -L "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" \
  -o backend/models/hand_landmarker.task

curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o backend/models/face_landmarker.task

curl -L "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
  -o backend/models/pose_landmarker.task
```

### Custom paths

Override default model paths via `backend/.env`:

```
NON_VERBAL_HAND_MODEL_PATH=C:\path\to\hand_landmarker.task
NON_VERBAL_FACE_MODEL_PATH=C:\path\to\face_landmarker.task
NON_VERBAL_POSE_MODEL_PATH=C:\path\to\pose_landmarker.task
```

---

## Dependencies

```
opencv-python
mediapipe
```

Both are included in `backend/requirements.txt`.

---

## Smoke Test

Run directly from the repo root:

```bash
python backend/non_verbal/vision.py path/to/video.mp4 5
```

Or import in Python:

```python
from backend.non_verbal import analyze_nonverbal
print(analyze_nonverbal("path/to/video.mp4", target_fps=5))
```

Validate with at least:
- One low-gesture video (seated, hands mostly still)
- One high-gesture video (active hand movements)

---

## Calibration Notes

- `GESTURE_ENERGY_SCALE` in `vision.py` controls sensitivity — tune to avoid constant clamping at `10`
- `eye_contact_*` and `posture_*` are intentionally lightweight proxies for robustness and speed
- Surface feedback as "camera-facing consistency" and "posture stability" — not as absolute gaze or posture claims
- Frame extraction rate (`target_fps`) defaults to 5; lower values are faster, higher values are more accurate for fast movements
