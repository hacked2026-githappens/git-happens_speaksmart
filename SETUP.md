# SpeakSmart — Setup Guide

## Prerequisites

- [Python 3.11+](https://python.org)
- [Node.js 18+](https://nodejs.org)
- [FFmpeg](https://ffmpeg.org) — required for audio extraction and transcription
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
- [Groq API key](https://console.groq.com) — free, no credit card required
- [Supabase project](https://supabase.com) — free tier is sufficient

---

## 1. Supabase Setup

### Create a project
Sign in at [supabase.com](https://supabase.com) and create a new project. Note your **Project URL** and keys from **Project Settings → API**.

### Create the `jobs` table

In the Supabase SQL editor:

```sql
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'pending',
  results         jsonb,
  error_message   text,
  created_at      timestamptz not null default now()
);
```

### Create the `sessions` table

```sql
create table sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  preset          text,
  duration_s      float,
  wpm             float,
  pace_label      text,
  filler_count    int,
  scores          jsonb,
  strengths       jsonb,
  improvements    jsonb,
  transcript      text,
  non_verbal      jsonb,
  created_at      timestamptz not null default now()
);

-- Enable Row Level Security
alter table sessions enable row level security;

create policy "Users can manage their own sessions"
  on sessions for all
  using (auth.uid() = user_id);
```

### Create the `videos` storage bucket

In **Storage → New bucket**: name it `videos`, keep it **private**.

---

## 2. Backend

### Create a virtual environment

From the repo root:

```powershell
python -m venv .venv
```

### Install dependencies

```powershell
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### Configure environment variables

Create `backend/.env`:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=base
CORS_ALLOW_ORIGINS=*
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
PORT=8000
```

- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com)
- `SUPABASE_URL` — Project Settings → API → Project URL
- `SUPABASE_SERVICE_KEY` — Project Settings → API → `service_role` secret key (never expose to clients)
- `WHISPER_MODEL` — `tiny` (fastest) | `base` (default) | `small` | `medium` (most accurate)

### Start the server

```powershell
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --env-file .env --port 8000
```

Verify: `GET http://localhost:8000/health` → `{ "status": "ok" }`

---

## 3. MediaPipe Model Files

The non-verbal analysis pipeline needs MediaPipe `.task` model files. These are not committed to the repo.

Create the models directory:

```powershell
New-Item -ItemType Directory -Force backend\models | Out-Null
```

Download all three required models:

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

macOS/Linux:

```bash
mkdir -p backend/models
curl -L "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" \
  -o backend/models/hand_landmarker.task

curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  -o backend/models/face_landmarker.task

curl -L "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
  -o backend/models/pose_landmarker.task
```

Optional: override default model paths in `backend/.env`:

```
NON_VERBAL_HAND_MODEL_PATH=C:\path\to\hand_landmarker.task
NON_VERBAL_FACE_MODEL_PATH=C:\path\to\face_landmarker.task
NON_VERBAL_POSE_MODEL_PATH=C:\path\to\pose_landmarker.task
```

If models are missing the API remains crash-safe but returns `"unknown"` for non-verbal fields.

Smoke test:

```powershell
.\venv\Scripts\python.exe backend\non_verbal\vision.py sample_files\sample.mp4 5
```

---

## 4. Frontend

### Install dependencies

```bash
cd presentation-coach-app
npm install
```

### Configure environment variables

Create `presentation-coach-app/.env.local`:

```
EXPO_PUBLIC_API_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
```

- `EXPO_PUBLIC_SUPABASE_URL` — same Project URL as backend
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API → `anon` public key (safe to expose)

### Start the app

```bash
npx expo start --web        # web browser (recommended for dev)
npx expo start --ios        # iOS simulator
npx expo start --android    # Android emulator
```

---

## 5. Verify End-to-End

1. Open `http://localhost:8081` in your browser
2. Sign up for an account on the login screen
3. Navigate to the Coach tab and upload a video file
4. The analysis should complete within 30–90 seconds depending on video length and hardware
5. Results, history, and practice drills should all be functional

---

## Testing the LLM Module

Run standalone without starting the full server:

```powershell
cd backend
..\venv\Scripts\python.exe test_llm.py
```

Expected output: JSON coaching analysis + `All checks passed.`
