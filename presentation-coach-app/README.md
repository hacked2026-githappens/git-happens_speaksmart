# SpeakSmart — Frontend (React Native / Expo)

This is the Expo frontend for SpeakSmart, an AI-powered public speaking coach. It runs on web, iOS, and Android from a single codebase.

---

## Tech Stack

- **React Native 0.81.5** + **Expo SDK 54**
- **Expo Router** — file-based routing
- **TypeScript 5.9.2** — strict mode enabled
- **NativeWind** — Tailwind CSS for React Native
- **Supabase JS** — authentication and session database
- **Victory Native** — charts and data visualization
- **React Native Reanimated** — animations
- **expo-video / expo-av** — video playback and audio recording

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create `.env.local` in this directory:

```
EXPO_PUBLIC_API_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
```

### 3. Start the app

```bash
npx expo start --web        # Recommended for development
npx expo start --ios        # iOS simulator
npx expo start --android    # Android emulator
```

The backend must be running on port 8000. See [../SETUP.md](../SETUP.md) for full setup instructions.

---

## Project Structure

```
presentation-coach-app/
├── app/
│   ├── _layout.tsx             # Root layout — AuthProvider + AuthGuard + theme
│   ├── index.tsx               # Landing page (unauthenticated)
│   ├── login.tsx               # Sign-in / sign-up
│   ├── logout.tsx              # Cleanup + sign-out
│   ├── practice-history.tsx    # Drill history detail view
│   └── (tabs)/
│       ├── _layout.tsx         # Dashboard: collapsible sidebar + header
│       ├── index.tsx           # Coach screen — video upload + AI analysis
│       ├── history.tsx         # Session history + trend charts
│       ├── drill.tsx           # Practice drills (4 modes)
│       └── explore.tsx         # Coaching guide
├── components/                 # Shared UI components
├── contexts/
│   └── auth.tsx                # AuthProvider + useAuth() hook
├── hooks/                      # useColorScheme, useThemeColor
├── lib/
│   ├── supabase.ts             # Supabase client
│   ├── database.ts             # Session CRUD operations
│   ├── practice-history.ts     # Local drill history (AsyncStorage)
│   └── web-*.ts                # Browser draft persistence
└── constants/
    └── theme.ts                # Colors, fonts, preset palette
```

---

## Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Landing | `/` | Entry point for unauthenticated users |
| Login | `/login` | Email/password sign-in and sign-up |
| Coach | `/(tabs)` | Upload a video and get AI coaching feedback |
| History | `/(tabs)/history` | View past sessions and score trends |
| Drill | `/(tabs)/drill` | Interactive speaking practice (Q&A, Filler, Paragraph, Topic) |
| Explore | `/(tabs)/explore` | Coaching tips and educational content |
| Practice History | `/practice-history` | Detailed drill session history |

---

## Key Conventions

**Styling:** Use NativeWind `className` for all styling. Only use `StyleSheet.create` for dynamic values.

**Platform-specific files:** Use `.native.tsx` / `.web.tsx` suffixes — Expo Router resolves them automatically.

**Environment variables:** Only `EXPO_PUBLIC_*` variables are safe to use in the frontend bundle.

**Accessibility:** All interactive elements must have `accessibilityLabel` and `accessibilityRole`. Never convey information through color alone.

---

## Available Scripts

```bash
npm run start    # Start Expo dev server
npm run web      # Start for web
npm run ios      # Start for iOS simulator
npm run android  # Start for Android emulator
npm run lint     # Run ESLint
```
