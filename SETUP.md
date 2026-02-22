# SpeakSmart — Setup Guide

## Prerequisites

- [Python 3.11+](https://python.org)
- [Node.js 18+](https://nodejs.org)
- [FFmpeg](https://ffmpeg.org) — required for Whisper transcription
  - Windows: `winget install Gyan.FFmpeg`
- [Groq API key](https://console.groq.com) — free, no credit card required

---

## Backend

### 1. Create a virtual environment

From the repo root:

```powershell
python -m venv .venv
```

### 2. Install dependencies

```powershell
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### 3. Configure environment variables

Create `backend/.env` with:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=base
CORS_ALLOW_ORIGINS=*
```

### 4. Start the server

```powershell
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --env-file .env --port 8000
```

Verify it's running: `GET http://localhost:8000/health` → `{ "status": "ok" }`

---

### 5. Set up non-verbal MediaPipe models (.task files)

The gesture/non-verbal pipeline in `backend/non_verbal/vision.py` needs task model files.

Create the models directory:

```powershell
New-Item -ItemType Directory -Force backend\models | Out-Null
```

Download required models:

```powershell
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

Optional env overrides in `backend/.env` (only if using custom paths):

```
NON_VERBAL_HAND_MODEL_PATH=C:\path\to\hand_landmarker.task
NON_VERBAL_FACE_MODEL_PATH=C:\path\to\face_landmarker.task
NON_VERBAL_POSE_MODEL_PATH=C:\path\to\pose_landmarker.task
```

Smoke test non-verbal analysis:

```powershell
.\venv\Scripts\python.exe backend\non_verbal\vision.py sample_files\sample.mp4 5
```

If models are missing, API stays crash-safe but returns fallback/unknown values for those signals.

---

## Frontend

### 1. Install dependencies

```bash
cd presentation-coach-app
npm install
```

### 2. Configure environment variables

Create `presentation-coach-app/.env.local`:

```
EXPO_PUBLIC_API_URL=http://localhost:8000
```

### 3. Start the app

```bash
npx expo start --web        # web browser
npx expo start --ios        # iOS simulator
npx expo start --android    # Android emulator
```

---

## Testing the LLM module

Run this without starting the full server to verify Groq is working:

```powershell
cd backend
..\venv\Scripts\python.exe test_llm.py
```

Expected output: JSON coaching analysis + `All checks passed.`
