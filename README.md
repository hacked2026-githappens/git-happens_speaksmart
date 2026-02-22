# SpeakSmart — AI-Powered Public Speaking Coach

SpeakSmart is a full-stack app that helps people become better public speakers. Upload a recorded video of your presentation and get instant AI-powered coaching: timestamped feedback on filler words, pacing, and weak language; an interactive annotated video player with a marker timeline; a full dashboard with scores, strengths, and actionable improvements; interactive practice drills; and a session history with trend analytics.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native 0.81.5 + Expo SDK 54, Expo Router, NativeWind (Tailwind) |
| Backend | Python FastAPI + Uvicorn |
| Transcription | Local Whisper (`faster-whisper`) with word-level timestamps |
| Speech Analysis | Groq API (`llama-3.3-70b-versatile`) |
| Non-verbal Analysis | MediaPipe (hand, face, pose landmark tracking) + OpenCV |
| Storage + DB | Supabase Storage (`videos` bucket) + Supabase Postgres |
| Audio processing | ffmpeg-python |

---

## Repo Structure

```
git-happens/
├── presentation-coach-app/   # React Native Expo frontend (SDK 54)
│   ├── app/                  # Expo Router screens
│   │   ├── _layout.tsx       # Root layout — AuthProvider + AuthGuard
│   │   ├── index.tsx         # Landing page (unauthenticated)
│   │   ├── login.tsx         # Sign-in / sign-up screen
│   │   ├── logout.tsx        # Cleanup + sign-out
│   │   ├── practice-history.tsx  # Drill history detail view
│   │   └── (tabs)/           # Protected dashboard (sidebar layout)
│   │       ├── _layout.tsx   # Dashboard shell with sidebar + header
│   │       ├── index.tsx     # Coach screen — video upload + AI analysis
│   │       ├── history.tsx   # Session analytics + trend charts
│   │       ├── drill.tsx     # Interactive practice drills (4 modes)
│   │       └── explore.tsx   # Coaching guide + educational content
│   ├── components/           # Shared UI components
│   ├── contexts/             # Auth context
│   ├── hooks/                # useColorScheme, useThemeColor
│   ├── lib/                  # Supabase client, database ops, practice history
│   └── constants/            # Theme colors and fonts
│
├── backend/                  # Python FastAPI backend
│   ├── main.py               # FastAPI app, all routes, speech metrics
│   ├── llm.py                # Groq LLM coaching analysis + prompt engineering
│   ├── job_runner.py         # Async background pipeline orchestrator
│   ├── non_verbal/           # MediaPipe gesture / eye / posture analysis
│   │   └── vision.py
│   ├── models/               # MediaPipe .task model files (not committed)
│   ├── requirements.txt
│   └── .env                  # Server secrets (never commit)
│
├── AGENTS.md                 # Architecture reference for AI agents and teammates
├── SETUP.md                  # Detailed setup guide
└── .env.example              # Template for required environment variables
```

---

## Setup

See [SETUP.md](SETUP.md) for the full step-by-step guide. Quick summary:

### 1. Backend environment variables

Create `backend/.env`:
```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
WHISPER_MODEL=base
CORS_ALLOW_ORIGINS=*
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
PORT=8000
```

### 2. Run the backend (Windows)

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --env-file .env --port 8000
```

### 3. Frontend environment variables

Create `presentation-coach-app/.env.local`:
```
EXPO_PUBLIC_API_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
```

### 4. Run the frontend

```bash
cd presentation-coach-app
npm install
npx expo start --web
```

---

## How It Works

1. User signs in and uploads a video on the Coach screen
2. Frontend POSTs to `/api/analyze` and gets a `jobId` immediately
3. Backend pipeline runs in the background (parallel):
   - Transcribes audio with Whisper (word-level timestamps)
   - Analyzes hand/face/pose with MediaPipe (gesture energy, eye contact, posture)
   - Extracts audio samples for pitch and volume analysis (FFmpeg)
4. Groq LLM coaching analysis runs on the indexed transcript with preset context
5. Frontend polls `/api/results/{jobId}` every 2 seconds until done
6. Results screen shows: annotated video player, marker timeline, coaching dashboard, transcript, and a personalized content improvement plan
7. Session is saved to Supabase and appears in the History screen

---

## Features

- **Coach screen** — video upload, AI analysis, multi-tab report (Report / Improvements / Transcript)
- **Annotated video player** — clickable timeline markers, auto-popups at flagged moments
- **5 coaching dimensions** — Clarity, Pace Consistency, Confidence Language, Content Structure, Filler Density
- **Non-verbal analysis** — gesture energy, eye contact proxy, posture stability (MediaPipe)
- **Personalized content plan** — topic-specific improvements with example revisions
- **Follow-up Q&A** — LLM-generated questions to test understanding of your own talk
- **History screen** — session trends with Victory charts, time-period and preset filters
- **Practice drills** — 4 interactive modes: Q&A Simulator, Filler Challenge, Paragraph Read, Topic Talk
- **5 presentation presets** — General, Pitch, Classroom, Interview, Keynote
- **Authentication** — email/password via Supabase Auth; session persists across devices
- **Responsive design** — works on web, iOS, and Android; sidebar collapses on mobile
- **Accessibility** — semantic roles, labels, and reduce-motion support throughout
