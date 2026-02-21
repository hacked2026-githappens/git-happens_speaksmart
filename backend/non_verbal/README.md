# Non-Verbal Gesture Analysis (Starter Module)

This folder contains the standalone non-verbal analysis module for gesture activity:

- `backend/non_verbal/vision.py`
- `backend/non_verbal/models/` (local model storage)

It is intentionally isolated so teammates can validate it before full pipeline integration.

## What It Returns

`analyze_nonverbal(video_path, target_fps=5)` returns:

```json
{
  "non_verbal": {
    "gesture_energy": 0.0,
    "activity_level": "low|moderate|high|unknown",
    "avg_velocity": 0.0,
    "samples": 0
  }
}
```

## Dependencies

Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Required for this module:
- `opencv-python`
- `mediapipe`

## Model Setup

MediaPipe Task models are pre-trained `.task` bundles. We do not train/create them in this repo; we download and version-pin them.

This repo does **not** commit the `.task` model file by default.

Expected default path:
- `backend/non_verbal/models/hand_landmarker.task`

### Download required model (Hand Landmarker)

Create the model directory (if missing) and download:

PowerShell:

```powershell
New-Item -ItemType Directory -Force backend/non_verbal/models | Out-Null
Invoke-WebRequest `
  -Uri "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" `
  -OutFile "backend/non_verbal/models/hand_landmarker.task"
```

macOS/Linux:

```bash
mkdir -p backend/non_verbal/models
curl -L "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" \
  -o backend/non_verbal/models/hand_landmarker.task
```

Optional override:
- set env var `NON_VERBAL_MODEL_PATH` to a custom file path.

PowerShell example:

```powershell
$env:NON_VERBAL_MODEL_PATH="C:\path\to\hand_landmarker.task"
```

### Optional models to consider next

If we expand beyond hand motion, keep additional models in `backend/non_verbal/models/` and wire via new env vars in future modules:

- `face_landmarker.task` (facial expressions / confidence cues)
- `pose_landmarker_full.task` (posture, stance, body openness)
- `gesture_recognizer.task` (discrete gesture classes, not just motion energy)

Example download commands:

```bash
curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o backend/non_verbal/models/face_landmarker.task

curl -L "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task" \
  -o backend/non_verbal/models/pose_landmarker_full.task

curl -L "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task" \
  -o backend/non_verbal/models/gesture_recognizer.task
```

## Local Smoke Test

Run directly:

```bash
python backend/non_verbal/vision.py path/to/video.mp4 5
```

Or import:

```python
from backend.non_verbal import analyze_nonverbal
print(analyze_nonverbal("path/to/video.mp4", target_fps=5))
```

If dependencies/model are missing, it fails safely and returns:

```json
{"non_verbal":{"gesture_energy":0.0,"activity_level":"unknown","avg_velocity":0.0,"samples":0}}
```

## Calibration Notes

- `GESTURE_ENERGY_SCALE` in `backend/non_verbal/vision.py` controls sensitivity.
- Current default is tuned to avoid constant clamping at `10`.
- Validate with at least:
  - one low-gesture video
  - one moderate/high-gesture video
