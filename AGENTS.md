# AGENTS.md — SpeakSmart Project Context

This file is for AI agents and teammates jumping into any part of the codebase. Read this first.

---

## What This Project Is

**SpeakSmart** — a 48-hour hackathon app that coaches public speakers.

Flow:
1. User picks a video file on the home screen
2. Frontend POSTs it to the Python FastAPI backend → gets back a `jobId`
3. Backend pipeline (async, FastAPI BackgroundTasks):
   - Uploads video to Supabase Storage
   - Downloads video, extracts audio with ffmpeg (mono 16kHz MP3)
   - **In parallel:** transcribes audio with `faster-whisper` (word-level timestamps) AND analyzes video frames with MediaPipe Holistic (hand landmark tracking → gesture energy score)
   - Detects filler words, pace issues, and repetition from Whisper word array
   - Sends indexed transcript to Groq API (`llama-3.3-70b-versatile`) for coaching analysis
   - Merges all feedback events + non-verbal results, stores in Supabase
4. Frontend polls until done, then shows: annotated video player + coaching dashboard

---

## Repo Layout

```
git-happens/
├── presentation-coach-app/     # React Native Expo frontend (SDK 54)
│   ├── app/                    # Expo Router screens
│   │   ├── _layout.tsx         # Root layout — wraps AccessibilityProvider, imports global.css
│   │   ├── index.tsx           # Upload screen (/)
│   │   ├── analyzing/
│   │   │   └── [jobId].tsx     # Polling/progress screen
│   │   └── results/
│   │       └── [jobId].tsx     # Annotated player + dashboard
│   ├── components/
│   │   ├── VideoUploader.native.tsx   # expo-document-picker
│   │   ├── VideoUploader.web.tsx      # <input type="file">
│   │   └── AnnotatedPlayer/
│   │       ├── index.tsx        # Video player (expo-av native, <video> web)
│   │       ├── TimelineBar.tsx  # Clickable marker dots + progress line
│   │       └── FeedbackPopup.tsx # Slide-up coaching popup
│   ├── contexts/
│   │   └── AccessibilityContext.tsx  # High-contrast toggle
│   ├── lib/
│   │   └── api.ts              # submitVideo() + getResults() fetch wrappers
│   ├── constants/
│   │   ├── colors.ts           # Normal + high-contrast palettes
│   │   └── theme.ts            # Existing theme (light/dark)
│   ├── __mocks__/
│   │   └── results.json        # Sample results object for local development
│   ├── global.css              # NativeWind Tailwind entry
│   ├── tailwind.config.js
│   └── babel.config.js
│
├── backend/                     # Python FastAPI backend
│   ├── main.py                  # FastAPI app + POST /analyze endpoint
│   ├── llm.py                   # Groq API coaching analysis (analyze_with_llm, map_llm_events)
│   ├── non_verbal/              # MediaPipe gesture energy analysis module
│   │   ├── vision.py            # Hand landmark tracking → gesture_energy score
│   │   └── __init__.py
│   ├── test_llm.py              # Standalone LLM test (run with: python test_llm.py)
│   ├── requirements.txt         # Python dependencies
│   └── .env                    # Server-side secrets (never commit)
│
├── .env.example                 # Documents all required env vars
├── README.md
└── AGENTS.md                   # This file
```

---

## Supabase Schema

### Storage
- Bucket name: `videos` (private, no public access)
- File path convention: `uploads/{jobId}.mp4`

### Table: `jobs`

```sql
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'pending',  -- 'pending' | 'processing' | 'done' | 'error'
  video_path      text,
  results         jsonb,
  error_message   text,
  created_at      timestamptz not null default now()
);
```

---

## API Contract

Backend runs on port **8000** (`uvicorn main:app --port 8000`).

### `POST /api/analyze`
- Body: `multipart/form-data` with field `video` (video file)
- Response: `{ "jobId": string }`
- Side effect: uploads video to Supabase Storage, inserts job row, fires async background pipeline

### `GET /api/results/{job_id}`
- Response (pending/processing): `{ "status": "pending" | "processing" }`
- Response (done): `{ "status": "done", "results": ResultsObject, "videoUrl": string }`
- Response (error): `{ "status": "error", "error_message": string }`
- `videoUrl` is a Supabase signed URL expiring in 1 hour

### Results Object Shape

```ts
{
  transcript: Array<{ word: string; start: number; end: number; index: number }>;
  duration: number;
  feedbackEvents: Array<{
    id: string;          // uuid
    timestamp: number;   // seconds into video
    type: "filler_word" | "pace" | "repetition" | "weak_language" | "confidence" | "grammar" | "content";
    severity: "low" | "medium" | "high";
    title: string;
    message: string;
    wordIndex: number;
  }>;
  scores: {
    clarity: number;            // 1-10
    pace_consistency: number;
    confidence_language: number;
    content_structure: number;
    filler_word_density: number;
  };
  strengths: string[];
  improvements: Array<{ title: string; detail: string; actionable_tip: string }>;
  structure: { has_clear_intro: boolean; has_clear_conclusion: boolean; body_feedback: string };
  non_verbal: {
    gesture_energy: number;        // 0-10 scale
    activity_level: "low" | "moderate" | "high" | "unknown";
    avg_velocity: number;          // raw landmark velocity for debugging
    samples: number;               // number of frames analyzed
  };
  stats: { total_filler_words: number; avg_wpm: number; total_words: number; flagged_sentences: number };
}
```

---

## Existing Code to Reuse (`backend/main.py`)

These functions are already implemented and should be kept/reused as-is:
- `FILLER_WORDS` set — extend with `'right'`, `'kind of'`, `'sort of'`
- `tokenize(text)` — word tokenization
- `count_stutter_events(words)` — consecutive repeated words
- `classify_pace(wpm)` — slow/good/fast classification
- `ensure_supported_media(upload)` — validates audio/video content type
- `save_upload_to_temp(upload)` — saves UploadFile to `/tmp`, returns `Path`
- `get_whisper_model()` with `@lru_cache` — rewrite for `faster-whisper` (`WhisperModel(size, device="cpu", compute_type="int8")`)
- FastAPI app instance, CORS middleware setup

The old `POST /analyze` endpoint (synchronous, no Supabase) can be kept for backward compatibility or removed.

---

## Frontend Route Map

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/index.tsx` | File picker + upload trigger |
| `/analyzing/[jobId]` | `app/analyzing/[jobId].tsx` | Polling + animated progress |
| `/results/[jobId]` | `app/results/[jobId].tsx` | Player + full dashboard |

---

## Key Conventions

### Platform-specific components
Use `.native.tsx` / `.web.tsx` file suffixes. Expo Router resolves them automatically — import without the suffix:
```ts
import VideoUploader from '@/components/VideoUploader'; // resolves .native or .web
```

### Styling
NativeWind (Tailwind classes via `className` prop). Avoid `StyleSheet.create` except for dynamic values that can't be expressed as static classes.

### Accessibility — required for judging
- Every `Pressable` and `TouchableOpacity` must have `accessibilityLabel` and `accessibilityRole`
- Never convey info through color alone — colored word chips also need `accessibilityLabel` like `"filler word: um"`
- Font sizes: always multiply by `PixelRatio.getFontScale()`, never hardcode pixel values
- Web video: `tabIndex={0}`, space = play/pause, arrow keys = seek ±5s

### Environment variables
- `EXPO_PUBLIC_*` prefix = safe for frontend bundle (Expo reads from `.env.local`)
- All other secrets (Supabase service key) = `backend/.env` only, never in frontend

### FormData on native vs web
```ts
// native
formData.append('video', { uri: file.uri, name: file.name, type: file.mimeType ?? 'video/mp4' } as any);
// web
formData.append('video', file); // raw File object
```
Use `Platform.OS === 'web'` to branch.

---

## Environment Variables

### `backend/.env`
```
GROQ_API_KEY=gsk_...               # Free API key from console.groq.com
GROQ_MODEL=llama-3.3-70b-versatile # or llama-3.1-8b-instant for faster responses
WHISPER_MODEL=base                 # tiny | base | small | medium
CORS_ALLOW_ORIGINS=*
```

### `presentation-coach-app/.env.local`
```
EXPO_PUBLIC_API_URL=http://localhost:8000
```

---

## Python Dependencies (`backend/requirements.txt`)

```
fastapi
uvicorn[standard]
python-multipart
python-dotenv
faster-whisper      # Local Whisper — 4-8x faster than openai-whisper, same accuracy, free
groq                # Groq API client — free tier, fast inference
supabase            # Supabase Python client
ffmpeg-python       # ffmpeg wrapper for audio extraction
opencv-python       # Frame extraction for non-verbal analysis
mediapipe           # Hand + pose landmark detection
```

**faster-whisper API is different from openai-whisper:**
- Returns a generator (not a list) — must consume in the same thread
- Word objects are NamedTuples: `w.word`, `w.start`, `w.end` (not dict keys)

**LLM — Groq API:**
- Get a free key at console.groq.com
- `analyze_with_llm(words)` in `llm.py` — backward alias `analyze_with_ollama` also available
- Returns full coaching JSON: scores, strengths, improvements, structure, feedbackEvents, stats

---

## Build Order

Work in this sequence — do not skip ahead:

1. **Phase 0** — This file + README (done)
2. **Phase 1** — Scaffold: update `backend/requirements.txt`, add Expo packages, NativeWind setup, delete `app/(tabs)/`
3. **Phase 2** — Backend: new `POST /api/analyze` + `GET /api/results/{job_id}` routes in `main.py`, full `job_runner.py` pipeline
4. **Phase 3** — Upload screen (`app/index.tsx`) + VideoUploader components + `lib/api.ts`
5. **Phase 4** — Analyzing screen with polling + animated spinner
6. **Phase 5** — AnnotatedPlayer (player + TimelineBar + FeedbackPopup)
7. **Phase 6** — Results screen + full dashboard (stats, radar chart, transcript chips)
8. **Phase 7** — Accessibility: AccessibilityContext, high-contrast palette, font scaling, keyboard nav

---

## Running Locally

```powershell
# One-time setup (from repo root)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Terminal 1 — backend
cd backend
..\venv\Scripts\python.exe -m uvicorn main:app --reload --env-file .env --port 8000

# Terminal 2 — frontend
cd presentation-coach-app
npx expo start --web
```

Verify: `GET http://localhost:8000/health` → `{ "status": "ok" }`

Test the LLM module standalone (no server needed):
```powershell
cd backend
..\venv\Scripts\python.exe test_llm.py
```
