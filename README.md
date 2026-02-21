# SpeakSmart — AI-Powered Public Speaking Coach

SpeakSmart is a hackathon app that helps people become better public speakers. Upload a recorded video of your presentation and get instant AI-powered coaching: timestamped feedback on filler words, pacing, and weak language; an interactive annotated video player with a marker timeline; and a full dashboard with scores, strengths, and actionable improvements.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native + Expo SDK 54, Expo Router, NativeWind (Tailwind) |
| Backend | Python FastAPI + Uvicorn |
| Transcription | Local Whisper (`faster-whisper`) with word-level timestamps — free |
| Speech Analysis | Groq API (`llama-3.3-70b-versatile`) — free tier, requires API key |
| Non-verbal Analysis | MediaPipe Holistic (hand landmark tracking) + OpenCV (frame extraction) |
| Storage + DB | Supabase Storage (`videos` bucket) + Supabase Postgres (`jobs` table) |
| Audio extraction | ffmpeg-python |

---

## Repo Structure

```
git-happens/
├── presentation-coach-app/   # React Native Expo frontend
├── backend/                  # Python FastAPI backend
│   ├── main.py               # FastAPI app + /analyze endpoint
│   ├── llm.py                # Groq LLM coaching analysis
│   ├── non_verbal/           # MediaPipe gesture energy analysis
│   ├── requirements.txt
│   └── .env                  # Server secrets (never commit)
├── AGENTS.md                 # Context for AI agents and teammates
└── README.md
```

---

## Setup

### 1. Environment variables

```bash
cp .env.example backend/.env
```

Fill in `backend/.env`:
```
GROQ_API_KEY=gsk_...       # Free at console.groq.com
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=base
CORS_ALLOW_ORIGINS=*
```

Also create `presentation-coach-app/.env.local`:
```
EXPO_PUBLIC_API_URL=http://localhost:8000
```

### 2. Run the backend (Windows)

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --env-file .env --port 8000
```

### 3. Run the frontend

```bash
cd presentation-coach-app
npx expo install
npx expo start --web
```

---

## How It Works

1. User uploads a video file on the home screen
2. Backend receives the video, stores it in Supabase, and returns a `jobId` immediately
3. Backend transcribes audio with Whisper (word-level timestamps), analyzes hand movements via MediaPipe, and runs LLM coaching analysis via Groq API
4. Frontend polls `/api/results/{jobId}` every 2 seconds until the job is done
5. Results screen shows an annotated video player with a marker timeline, coaching popups, and a full dashboard

---

## Features

- Annotated video player with clickable timeline markers
- Auto-popups as video plays at moments of flagged speech
- Filler word detection, pace analysis, repetition detection (via Whisper)
- Scores, strengths, improvements, and structure analysis (via Groq API)
- Hand movement / gesture energy score with coaching tips (via MediaPipe)
- Transcript with color-coded word chips — tap any word to seek the video
- Radar chart of 5 coaching dimensions
- High-contrast accessibility mode + screen reader support
