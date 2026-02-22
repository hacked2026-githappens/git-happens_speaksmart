import React, { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addPracticeHistoryEntry,
  type PracticeHistoryEntry,
} from '@/lib/practice-history';

declare global {
  interface Navigator {
    mediaDevices: any;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DrillMode = 'qa' | 'filler' | 'paragraph' | 'topic';

type ModeCard = { key: DrillMode; icon: string; title: string; desc: string };

type EvalResult = {
  is_correct: boolean;
  verdict: 'correct' | 'partially_correct' | 'incorrect' | 'insufficient_information';
  correctness_score: number;
  reason: string;
  missing_points: string[];
  suggested_improvement: string;
};

type FillerResult = {
  fillerCount: number;
  fillerWords: Record<string, number>;
  totalWords: number;
  success: boolean;
};

type ParagraphResult = {
  monotone: { label: string; is_monotone: boolean; pitch_std_semitones: number | null };
  volume: { consistency_label: string; too_quiet: boolean; trailing_off_events: number };
  pauses: { pause_quality: string; effective_pauses: number; awkward_silences: number };
  score: number;
};

type TopicResult = {
  score: number;
  wpm: number;
  paceLabel: string;
  fillerCount: number;
  strengths: string[];
  improvements: string[];
  monotoneLabel: string;
  volumeLabel: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND_URL =
  Platform.select({
    android: 'http://10.0.2.2:8000',
    ios: 'http://localhost:8000',
    default: 'http://localhost:8000',
  }) ?? 'http://localhost:8000';

const palette = {
  accent: '#d1652c',
  accentDeep: '#b54f1b',
  mint: '#17998a',
  lightCanvas: '#f6ede2',
  darkCanvas: '#1b1510',
  lightCard: '#fff8ee',
  darkCard: '#2a211b',
  lightInk: '#2f2219',
  darkInk: '#f2e4d1',
  borderLight: '#e7c9a4',
  borderDark: 'rgba(255, 214, 168, 0.28)',
};

const PRESETS = [
  { key: 'general', label: 'General', icon: 'mic-outline' as const },
  { key: 'interview', label: 'Interview', icon: 'briefcase-outline' as const },
  { key: 'pitch', label: 'Pitch', icon: 'trending-up-outline' as const },
  { key: 'classroom', label: 'Classroom', icon: 'school-outline' as const },
  { key: 'keynote', label: 'Keynote', icon: 'people-outline' as const },
];

const FILLER_CHALLENGE_SECONDS = 60;

const DRILL_MODES: ModeCard[] = [
  { key: 'qa',        icon: 'chatbubble-ellipses-outline', title: 'Q&A Simulator',    desc: 'Answer interview questions' },
  { key: 'filler',    icon: 'close-circle-outline',        title: 'Filler Challenge', desc: 'Speak filler-free for 60 s' },
  { key: 'paragraph', icon: 'book-outline',                title: 'Paragraph Read',   desc: 'Score your delivery' },
  { key: 'topic',     icon: 'bulb-outline',                title: 'Topic Talk',       desc: 'Improvise on a random topic' },
];
const PARAGRAPH_MAX_SECONDS = 90;
const TOPIC_MAX_SECONDS = 90;

const MONOTONE_SCORE: Record<string, number> = { dynamic: 100, some_variation: 70, monotone: 30, unknown: 50 };
const VOLUME_SCORE: Record<string, number> = { consistent: 100, inconsistent: 60, too_quiet: 30, unknown: 50 };
const PAUSE_SCORE: Record<string, number> = { effective: 100, mixed: 65, needs_work: 30, unknown: 50 };

const MONOTONE_LABEL: Record<string, string> = { dynamic: 'Expressive', some_variation: 'Varied Pitch', monotone: 'Monotone', unknown: 'Pitch Unknown' };
const MONOTONE_COLOR: Record<string, string> = { dynamic: '#17998a', some_variation: '#e09b2d', monotone: '#c0392b', unknown: '#8a8a8a' };
const VOLUME_LABEL: Record<string, string> = { consistent: 'Good Volume', inconsistent: 'Inconsistent Volume', too_quiet: 'Too Quiet', unknown: 'Volume Unknown' };
const VOLUME_COLOR: Record<string, string> = { consistent: '#17998a', inconsistent: '#e09b2d', too_quiet: '#c0392b', unknown: '#8a8a8a' };
const PAUSE_LABEL: Record<string, string> = { effective: 'Effective', mixed: 'Mixed', needs_work: 'Needs Work', unknown: 'Unknown' };
const PAUSE_COLOR: Record<string, string> = { effective: '#17998a', mixed: '#e09b2d', needs_work: '#c0392b', unknown: '#8a8a8a' };

function computeDeliveryScore(ad: any): number {
  const m = MONOTONE_SCORE[ad?.monotone?.label ?? 'unknown'] ?? 50;
  const v = VOLUME_SCORE[ad?.volume?.consistency_label ?? 'unknown'] ?? 50;
  const p = PAUSE_SCORE[ad?.silence?.pause_quality ?? 'unknown'] ?? 50;
  return Math.round((m + v + p) / 3);
}

function computeTopicScore(scores: Record<string, number>): number {
  const vals = Object.values(scores ?? {});
  if (!vals.length) return 0;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10);
}

function computeFillerChallengeScore(fillerCount: number, totalWords: number): number {
  if (fillerCount <= 0) return 100;
  if (totalWords <= 0) return 40;
  const density = fillerCount / Math.max(totalWords, 1);
  return Math.max(0, Math.min(100, Math.round(100 - density * 500)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function pollResults(jobId: string): Promise<any> {
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${BACKEND_URL}/api/results/${jobId}`);
    if (!poll.ok) throw new Error(`Poll failed (${poll.status})`);
    const data = await poll.json();
    if (data.status === 'done') return data.results;
    if (data.status === 'error')
      throw new Error(data.error_message ?? 'Analysis failed on server');
  }
  throw new Error('Analysis timed out after 4 minutes. Please try again.');
}

async function submitVideoForTranscript(
  videoUri: string,
  preset: string,
  durationHint?: number,
): Promise<any> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const resp = await fetch(videoUri);
    const blob = await resp.blob();
    form.append('video', blob, 'drill.webm');
  } else {
    const ext = videoUri.split('.').pop() ?? 'm4a';
    form.append('video', { uri: videoUri, name: `drill.${ext}`, type: `audio/${ext}` } as any);
  }
  form.append('preset', preset);
  if (durationHint != null && durationHint > 0) {
    form.append('duration_seconds', durationHint.toString());
  }
  const result = await fetch(`${BACKEND_URL}/api/analyze`, { method: 'POST', body: form });
  if (!result.ok) {
    const text = await result.text();
    throw new Error(`Backend error ${result.status}: ${text}`);
  }
  const { jobId } = await result.json();
  return pollResults(jobId);
}

// ─── Score Circle ─────────────────────────────────────────────────────────────

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 70 ? palette.mint : score >= 40 ? '#e09b2d' : '#c0392b';
  return (
    <View style={[scoreCircleStyles.ring, { borderColor: color }]}>
      <ThemedText style={[scoreCircleStyles.number, { color }]}>{score}</ThemedText>
      <ThemedText style={scoreCircleStyles.label}>/100</ThemedText>
    </View>
  );
}

const scoreCircleStyles = StyleSheet.create({
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  number: { fontFamily: Fonts.rounded, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  label: { fontFamily: Fonts.rounded, fontSize: 12, opacity: 0.6 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DrillScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const ink = isDark ? palette.darkInk : palette.lightInk;
  const card = isDark ? palette.darkCard : palette.lightCard;
  const border = isDark ? palette.borderDark : palette.borderLight;
  const canvas = isDark ? palette.darkCanvas : palette.lightCanvas;

  const savePracticeHistory = async (
    entry: Omit<PracticeHistoryEntry, 'id' | 'created_at'>,
  ) => {
    try {
      await addPracticeHistoryEntry(entry);
    } catch {
      // Keep drill flow non-blocking if local persistence fails.
    }
  };

  const [mode, setMode] = useState<DrillMode>('qa');

  // ── Q&A Simulator state ────────────────────────────────────────────────────
  const [qaPreset, setQaPreset] = useState('general');
  const [qaQuestion, setQaQuestion] = useState<string | null>(null);
  const [qaQuestionBusy, setQaQuestionBusy] = useState(false);
  const [qaRecording, setQaRecording] = useState(false);
  const [qaElapsed, setQaElapsed] = useState(0);
  const [qaRecordStart, setQaRecordStart] = useState<number | null>(null);
  const [qaVideoUri, setQaVideoUri] = useState<string | null>(null);
  const [qaAnalyzing, setQaAnalyzing] = useState(false);
  const [qaResult, setQaResult] = useState<EvalResult | null>(null);

  const qaMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const qaStreamRef = useRef<MediaStream | null>(null);
  const qaAudioRecordingRef = useRef<Audio.Recording | null>(null);
  const qaAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Q&A Simulator error state ──────────────────────────────────────────────
  const [qaError, setQaError] = useState<string | null>(null);

  // ── Filler Challenge state ─────────────────────────────────────────────────
  const [fcRecording, setFcRecording] = useState(false);
  const [fcSecondsLeft, setFcSecondsLeft] = useState(FILLER_CHALLENGE_SECONDS);
  const [fcVideoUri, setFcVideoUri] = useState<string | null>(null);
  const [fcBlobRef] = useState<{ current: Blob | null }>({ current: null });
  const [fcAnalyzing, setFcAnalyzing] = useState(false);
  const [fcResult, setFcResult] = useState<FillerResult | null>(null);
  const [fcError, setFcError] = useState<string | null>(null);

  const fcMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fcStreamRef = useRef<MediaStream | null>(null);
  const fcAudioRecordingRef = useRef<Audio.Recording | null>(null);
  const fcCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fcAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Paragraph Reading state ────────────────────────────────────────────────
  const [prParagraph, setPrParagraph] = useState<{ title: string; text: string } | null>(null);
  const [prParagraphBusy, setPrParagraphBusy] = useState(false);
  const [prRecording, setPrRecording] = useState(false);
  const [prElapsed, setPrElapsed] = useState(0);
  const [prRecordStart, setPrRecordStart] = useState<number | null>(null);
  const [prVideoUri, setPrVideoUri] = useState<string | null>(null);
  const [prBlobRef] = useState<{ current: Blob | null }>({ current: null });
  const [prAnalyzing, setPrAnalyzing] = useState(false);
  const [prResult, setPrResult] = useState<ParagraphResult | null>(null);
  const [prError, setPrError] = useState<string | null>(null);

  const prMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const prStreamRef = useRef<MediaStream | null>(null);
  const prAudioRecordingRef = useRef<Audio.Recording | null>(null);
  const prAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Topic Talk state ───────────────────────────────────────────────────────
  const [ttTopic, setTtTopic] = useState<{ topic: string; prompt: string } | null>(null);
  const [ttTopicBusy, setTtTopicBusy] = useState(false);
  const [ttRecording, setTtRecording] = useState(false);
  const [ttElapsed, setTtElapsed] = useState(0);
  const [ttRecordStart, setTtRecordStart] = useState<number | null>(null);
  const [ttVideoUri, setTtVideoUri] = useState<string | null>(null);
  const [ttBlobRef] = useState<{ current: Blob | null }>({ current: null });
  const [ttAnalyzing, setTtAnalyzing] = useState(false);
  const [ttResult, setTtResult] = useState<TopicResult | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);

  const ttMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const ttStreamRef = useRef<MediaStream | null>(null);
  const ttAudioRecordingRef = useRef<Audio.Recording | null>(null);
  const ttAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── QA elapsed timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!qaRecording || !qaRecordStart) {
      setQaElapsed(0);
      return;
    }
    const tick = setInterval(() => {
      setQaElapsed(Math.round((Date.now() - qaRecordStart) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [qaRecording, qaRecordStart]);


  // ── PR elapsed timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!prRecording || !prRecordStart) { setPrElapsed(0); return; }
    const tick = setInterval(() => {
      setPrElapsed(Math.round((Date.now() - prRecordStart) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [prRecording, prRecordStart]);


  // ── TT elapsed timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!ttRecording || !ttRecordStart) { setTtElapsed(0); return; }
    const tick = setInterval(() => {
      setTtElapsed(Math.round((Date.now() - ttRecordStart) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [ttRecording, ttRecordStart]);


  // ── Reset helpers ──────────────────────────────────────────────────────────
  const resetQa = () => {
    setQaQuestion(null);
    setQaVideoUri(null);
    setQaResult(null);
    setQaRecording(false);
    setQaElapsed(0);
    setQaRecordStart(null);
    if (qaAutoStopRef.current) clearTimeout(qaAutoStopRef.current);
    if (qaStreamRef.current) {
      qaStreamRef.current.getTracks().forEach((t) => t.stop());
      qaStreamRef.current = null;
    }
    qaMediaRecorderRef.current = null;
  };

  const resetAnswer = () => {
    setQaVideoUri(null);
    setQaResult(null);
    setQaRecording(false);
    setQaElapsed(0);
    setQaRecordStart(null);
    if (qaAutoStopRef.current) clearTimeout(qaAutoStopRef.current);
    if (qaStreamRef.current) {
      qaStreamRef.current.getTracks().forEach((t) => t.stop());
      qaStreamRef.current = null;
    }
    qaMediaRecorderRef.current = null;
  };

  const resetFc = () => {
    setFcVideoUri(null);
    setFcResult(null);
    setFcError(null);
    setFcRecording(false);
    setFcSecondsLeft(FILLER_CHALLENGE_SECONDS);
    fcBlobRef.current = null;
    if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
    if (fcAutoStopRef.current) clearTimeout(fcAutoStopRef.current);
    if (fcStreamRef.current) {
      fcStreamRef.current.getTracks().forEach((t) => t.stop());
      fcStreamRef.current = null;
    }
    fcMediaRecorderRef.current = null;
  };

  const resetPr = () => {
    setPrParagraph(null);
    setPrVideoUri(null);
    setPrResult(null);
    setPrError(null);
    setPrRecording(false);
    setPrElapsed(0);
    setPrRecordStart(null);
    prBlobRef.current = null;
    if (prAutoStopRef.current) clearTimeout(prAutoStopRef.current);
    if (prStreamRef.current) {
      prStreamRef.current.getTracks().forEach((t) => t.stop());
      prStreamRef.current = null;
    }
    prMediaRecorderRef.current = null;
  };

  const resetTt = () => {
    setTtTopic(null);
    setTtVideoUri(null);
    setTtResult(null);
    setTtError(null);
    setTtRecording(false);
    setTtElapsed(0);
    setTtRecordStart(null);
    ttBlobRef.current = null;
    if (ttAutoStopRef.current) clearTimeout(ttAutoStopRef.current);
    if (ttStreamRef.current) {
      ttStreamRef.current.getTracks().forEach((t) => t.stop());
      ttStreamRef.current = null;
    }
    ttMediaRecorderRef.current = null;
  };

  // ── Get Question ───────────────────────────────────────────────────────────
  const getQuestion = async () => {
    resetAnswer();
    setQaQuestionBusy(true);
    try {
      const response = await fetch(`${BACKEND_URL}/followup-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary_feedback: ['Drill practice session'],
          preset: qaPreset,
        }),
      });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      const data = await response.json();
      setQaQuestion(data.question?.trim() ?? null);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not generate question');
    } finally {
      setQaQuestionBusy(false);
    }
  };

  // ── QA Recording ──────────────────────────────────────────────────────────
  const qaStartRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      qaStreamRef.current = stream;
      setQaRecording(true);
      setQaRecordStart(Date.now());
      setQaVideoUri(null);

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setQaVideoUri(URL.createObjectURL(blob));
        setQaRecording(false);
        setQaRecordStart(null);
        stream.getTracks().forEach((t) => t.stop());
        qaStreamRef.current = null;
        qaMediaRecorderRef.current = null;
      };
      qaMediaRecorderRef.current = recorder;
      recorder.start();
      qaAutoStopRef.current = setTimeout(() => { qaMediaRecorderRef.current?.stop(); }, 90_000);
    } catch (err: any) {
      Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
    }
  };

  const qaStopRecordingWeb = () => {
    if (qaAutoStopRef.current) clearTimeout(qaAutoStopRef.current);
    qaMediaRecorderRef.current?.stop();
  };

  const handleQaRecord = async () => {
    if (Platform.OS === 'web') {
      if (qaRecording) { qaStopRecordingWeb(); } else { await qaStartRecordingWeb(); }
    } else {
      if (qaRecording) {
        if (qaAutoStopRef.current) clearTimeout(qaAutoStopRef.current);
        try {
          await qaAudioRecordingRef.current?.stopAndUnloadAsync();
          const uri = qaAudioRecordingRef.current?.getURI() ?? null;
          qaAudioRecordingRef.current = null;
          setQaVideoUri(uri);
        } catch {}
        setQaRecording(false);
        setQaRecordStart(null);
      } else {
        try {
          await Audio.requestPermissionsAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          qaAudioRecordingRef.current = recording;
          setQaRecording(true);
          setQaRecordStart(Date.now());
          setQaVideoUri(null);
          qaAutoStopRef.current = setTimeout(async () => {
            try {
              await qaAudioRecordingRef.current?.stopAndUnloadAsync();
              const uri = qaAudioRecordingRef.current?.getURI() ?? null;
              qaAudioRecordingRef.current = null;
              setQaVideoUri(uri);
            } catch {}
            setQaRecording(false);
            setQaRecordStart(null);
          }, 90_000);
        } catch (err: any) {
          Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
        }
      }
    }
  };

  // ── QA Submit ─────────────────────────────────────────────────────────────
  const submitAnswer = async () => {
    if (!qaVideoUri || !qaQuestion) return;
    setQaError(null);
    setQaAnalyzing(true);
    try {
      const results = await submitVideoForTranscript(qaVideoUri, qaPreset);
      const transcript: string = results?.transcript ?? '';

      const evalResp = await fetch(`${BACKEND_URL}/evaluate-followup-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: qaQuestion, answer_transcript: transcript }),
      });
      if (!evalResp.ok) throw new Error(`Eval error ${evalResp.status}`);
      const evalData = await evalResp.json();
      setQaResult(evalData);
      const verdict = String(evalData?.verdict ?? 'insufficient_information');
      const verdictSummary =
        verdict === 'correct'
          ? 'Correct answer'
          : verdict === 'partially_correct'
            ? 'Partially correct answer'
            : verdict === 'incorrect'
              ? 'Incorrect answer'
              : 'Needs more context';
      void savePracticeHistory({
        mode: 'qa',
        modeLabel: 'Q&A Simulator',
        score: Number(evalData?.correctness_score ?? 0),
        summary: verdictSummary,
        detail:
          typeof evalData?.reason === 'string'
            ? evalData.reason
            : qaQuestion ?? undefined,
        metrics: {
          preset: qaPreset,
          verdict,
        },
      });
    } catch (err: any) {
      setQaError(err?.message ?? 'Analysis failed. Make sure the backend is running.');
    } finally {
      setQaAnalyzing(false);
    }
  };

  // ── Filler Challenge Recording ─────────────────────────────────────────────
  const fcStartRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      fcStreamRef.current = stream;
      setFcRecording(true);
      setFcSecondsLeft(FILLER_CHALLENGE_SECONDS);
      setFcVideoUri(null);

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        fcBlobRef.current = blob;
        setFcVideoUri(blob.size > 0 ? URL.createObjectURL(blob) : null);
        setFcRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        fcStreamRef.current = null;
        fcMediaRecorderRef.current = null;
        if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
      };
      fcMediaRecorderRef.current = recorder;
      recorder.start();

      fcCountdownRef.current = setInterval(() => {
        setFcSecondsLeft((prev) => {
          if (prev <= 1) { clearInterval(fcCountdownRef.current!); return 0; }
          return prev - 1;
        });
      }, 1000);
      fcAutoStopRef.current = setTimeout(() => {
        fcMediaRecorderRef.current?.stop();
        if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
      }, FILLER_CHALLENGE_SECONDS * 1000);
    } catch (err: any) {
      Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
    }
  };

  const fcStopRecordingWeb = () => {
    if (fcAutoStopRef.current) clearTimeout(fcAutoStopRef.current);
    if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
    fcMediaRecorderRef.current?.stop();
  };

  const handleFcRecord = async () => {
    if (Platform.OS === 'web') {
      if (fcRecording) { fcStopRecordingWeb(); } else { await fcStartRecordingWeb(); }
    } else {
      if (fcRecording) {
        if (fcAutoStopRef.current) clearTimeout(fcAutoStopRef.current);
        if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
        try {
          await fcAudioRecordingRef.current?.stopAndUnloadAsync();
          const blob = null; // native audio has no blob size check
          fcBlobRef.current = blob;
          const uri = fcAudioRecordingRef.current?.getURI() ?? null;
          fcAudioRecordingRef.current = null;
          setFcVideoUri(uri);
        } catch {}
        setFcRecording(false);
      } else {
        try {
          await Audio.requestPermissionsAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          fcAudioRecordingRef.current = recording;
          setFcRecording(true);
          setFcSecondsLeft(FILLER_CHALLENGE_SECONDS);
          setFcVideoUri(null);
          fcCountdownRef.current = setInterval(() => {
            setFcSecondsLeft((prev) => {
              if (prev <= 1) { clearInterval(fcCountdownRef.current!); return 0; }
              return prev - 1;
            });
          }, 1000);
          fcAutoStopRef.current = setTimeout(async () => {
            if (fcCountdownRef.current) clearInterval(fcCountdownRef.current);
            try {
              await fcAudioRecordingRef.current?.stopAndUnloadAsync();
              const uri = fcAudioRecordingRef.current?.getURI() ?? null;
              fcAudioRecordingRef.current = null;
              setFcVideoUri(uri);
            } catch {}
            setFcRecording(false);
          }, FILLER_CHALLENGE_SECONDS * 1000);
        } catch (err: any) {
          Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
        }
      }
    }
  };

  // ── Filler Challenge Submit ────────────────────────────────────────────────
  const submitFcRecording = async () => {
    if (!fcVideoUri) return;
    if (fcBlobRef.current !== null && fcBlobRef.current.size === 0) {
      setFcError('Recording was too short — no audio was captured. Try again and speak for at least 2 seconds.');
      return;
    }
    setFcError(null);
    setFcAnalyzing(true);
    try {
      const results = await submitVideoForTranscript(
        fcVideoUri,
        'general',
        FILLER_CHALLENGE_SECONDS,
      );
      const fillerCount: number = results?.metrics?.filler_word_count ?? 0;
      const fillerWords: Record<string, number> = results?.metrics?.filler_words ?? {};
      const totalWords: number = results?.metrics?.word_count ?? 0;
      setFcResult({ fillerCount, fillerWords, totalWords, success: fillerCount === 0 });
      const score = computeFillerChallengeScore(fillerCount, totalWords);
      void savePracticeHistory({
        mode: 'filler',
        modeLabel: 'Filler Challenge',
        score,
        summary:
          fillerCount === 0
            ? 'Perfect run: zero filler words'
            : `${fillerCount} filler word${fillerCount !== 1 ? 's' : ''} detected`,
        detail:
          totalWords > 0
            ? `${totalWords} words spoken in the challenge`
            : 'Challenge analyzed',
        metrics: {
          filler_count: fillerCount,
          total_words: totalWords,
        },
      });
    } catch (err: any) {
      setFcError(err?.message ?? 'Analysis failed. Make sure the backend is running.');
    } finally {
      setFcAnalyzing(false);
    }
  };

  // ── Paragraph Reading — fetch ──────────────────────────────────────────────
  const getParagraph = async () => {
    setPrParagraphBusy(true);
    setPrResult(null);
    setPrError(null);
    setPrVideoUri(null);
    prBlobRef.current = null;
    try {
      const resp = await fetch(`${BACKEND_URL}/random-paragraph`);
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data = await resp.json();
      setPrParagraph(data);
    } catch (err: any) {
      setPrError(err?.message ?? 'Could not load paragraph');
    } finally {
      setPrParagraphBusy(false);
    }
  };

  // ── Paragraph Reading — recording ──────────────────────────────────────────
  const prStartRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      prStreamRef.current = stream;
      setPrRecording(true);
      setPrRecordStart(Date.now());
      setPrVideoUri(null);
      prBlobRef.current = null;

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        prBlobRef.current = blob;
        setPrVideoUri(blob.size > 0 ? URL.createObjectURL(blob) : null);
        setPrRecording(false);
        setPrRecordStart(null);
        stream.getTracks().forEach((t) => t.stop());
        prStreamRef.current = null;
        prMediaRecorderRef.current = null;
      };
      prMediaRecorderRef.current = recorder;
      recorder.start();
      prAutoStopRef.current = setTimeout(() => { prMediaRecorderRef.current?.stop(); }, PARAGRAPH_MAX_SECONDS * 1000);
    } catch (err: any) {
      Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
    }
  };

  const prStopRecordingWeb = () => {
    if (prAutoStopRef.current) clearTimeout(prAutoStopRef.current);
    prMediaRecorderRef.current?.stop();
  };

  const handlePrRecord = async () => {
    if (Platform.OS === 'web') {
      if (prRecording) { prStopRecordingWeb(); } else { await prStartRecordingWeb(); }
    } else {
      if (prRecording) {
        if (prAutoStopRef.current) clearTimeout(prAutoStopRef.current);
        try {
          await prAudioRecordingRef.current?.stopAndUnloadAsync();
          const uri = prAudioRecordingRef.current?.getURI() ?? null;
          prAudioRecordingRef.current = null;
          setPrVideoUri(uri);
        } catch {}
        setPrRecording(false);
        setPrRecordStart(null);
      } else {
        try {
          await Audio.requestPermissionsAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          prAudioRecordingRef.current = recording;
          setPrRecording(true);
          setPrRecordStart(Date.now());
          setPrVideoUri(null);
          prBlobRef.current = null;
          prAutoStopRef.current = setTimeout(async () => {
            try {
              await prAudioRecordingRef.current?.stopAndUnloadAsync();
              const uri = prAudioRecordingRef.current?.getURI() ?? null;
              prAudioRecordingRef.current = null;
              setPrVideoUri(uri);
            } catch {}
            setPrRecording(false);
            setPrRecordStart(null);
          }, PARAGRAPH_MAX_SECONDS * 1000);
        } catch (err: any) {
          Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
        }
      }
    }
  };

  // ── Paragraph Reading — submit ─────────────────────────────────────────────
  const submitPrRecording = async () => {
    if (!prVideoUri) return;
    if (prBlobRef.current !== null && prBlobRef.current.size === 0) {
      setPrError('Recording was too short — no audio captured. Try again and speak for at least 2 seconds.');
      return;
    }
    setPrError(null);
    setPrAnalyzing(true);
    try {
      const results = await submitVideoForTranscript(prVideoUri, 'general');
      const ad = results?.metrics?.audio_delivery ?? {};
      const monotone = ad.monotone ?? { label: 'unknown', is_monotone: false, pitch_std_semitones: null };
      const volume = ad.volume ?? { consistency_label: 'unknown', too_quiet: false, trailing_off_events: 0 };
      const pauses = ad.silence ?? { pause_quality: 'unknown', effective_pauses: 0, awkward_silences: 0 };
      const score = computeDeliveryScore(ad);
      setPrResult({ monotone, volume, pauses, score });
      void savePracticeHistory({
        mode: 'paragraph',
        modeLabel: 'Paragraph Read',
        score,
        summary: `Delivery score: ${score}/100`,
        detail: `Pitch ${MONOTONE_LABEL[monotone.label] ?? monotone.label}, volume ${VOLUME_LABEL[volume.consistency_label] ?? volume.consistency_label}, pauses ${PAUSE_LABEL[pauses.pause_quality] ?? pauses.pause_quality}`,
      });
    } catch (err: any) {
      setPrError(err?.message ?? 'Analysis failed. Make sure the backend is running.');
    } finally {
      setPrAnalyzing(false);
    }
  };

  // ── Topic Talk — fetch ─────────────────────────────────────────────────────
  const getTopic = async () => {
    setTtTopicBusy(true);
    setTtResult(null);
    setTtError(null);
    setTtVideoUri(null);
    ttBlobRef.current = null;
    try {
      const resp = await fetch(`${BACKEND_URL}/random-topic`);
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data = await resp.json();
      setTtTopic(data);
    } catch (err: any) {
      setTtError(err?.message ?? 'Could not load topic');
    } finally {
      setTtTopicBusy(false);
    }
  };

  // ── Topic Talk — recording ─────────────────────────────────────────────────
  const ttStartRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      ttStreamRef.current = stream;
      setTtRecording(true);
      setTtRecordStart(Date.now());
      setTtVideoUri(null);
      ttBlobRef.current = null;

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        ttBlobRef.current = blob;
        setTtVideoUri(blob.size > 0 ? URL.createObjectURL(blob) : null);
        setTtRecording(false);
        setTtRecordStart(null);
        stream.getTracks().forEach((t) => t.stop());
        ttStreamRef.current = null;
        ttMediaRecorderRef.current = null;
      };
      ttMediaRecorderRef.current = recorder;
      recorder.start();
      ttAutoStopRef.current = setTimeout(() => { ttMediaRecorderRef.current?.stop(); }, TOPIC_MAX_SECONDS * 1000);
    } catch (err: any) {
      Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
    }
  };

  const ttStopRecordingWeb = () => {
    if (ttAutoStopRef.current) clearTimeout(ttAutoStopRef.current);
    ttMediaRecorderRef.current?.stop();
  };

  const handleTtRecord = async () => {
    if (Platform.OS === 'web') {
      if (ttRecording) { ttStopRecordingWeb(); } else { await ttStartRecordingWeb(); }
    } else {
      if (ttRecording) {
        if (ttAutoStopRef.current) clearTimeout(ttAutoStopRef.current);
        try {
          await ttAudioRecordingRef.current?.stopAndUnloadAsync();
          const uri = ttAudioRecordingRef.current?.getURI() ?? null;
          ttAudioRecordingRef.current = null;
          setTtVideoUri(uri);
        } catch {}
        setTtRecording(false);
        setTtRecordStart(null);
      } else {
        try {
          await Audio.requestPermissionsAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          ttAudioRecordingRef.current = recording;
          setTtRecording(true);
          setTtRecordStart(Date.now());
          setTtVideoUri(null);
          ttBlobRef.current = null;
          ttAutoStopRef.current = setTimeout(async () => {
            try {
              await ttAudioRecordingRef.current?.stopAndUnloadAsync();
              const uri = ttAudioRecordingRef.current?.getURI() ?? null;
              ttAudioRecordingRef.current = null;
              setTtVideoUri(uri);
            } catch {}
            setTtRecording(false);
            setTtRecordStart(null);
          }, TOPIC_MAX_SECONDS * 1000);
        } catch (err: any) {
          Alert.alert('Microphone error', err?.message ?? 'Could not access microphone');
        }
      }
    }
  };

  // ── Topic Talk — submit ────────────────────────────────────────────────────
  const submitTtRecording = async () => {
    if (!ttVideoUri) return;
    if (ttBlobRef.current !== null && ttBlobRef.current.size === 0) {
      setTtError('Recording was too short — no audio captured. Try again and speak for at least 2 seconds.');
      return;
    }
    setTtError(null);
    setTtAnalyzing(true);
    try {
      const results = await submitVideoForTranscript(ttVideoUri, 'general');
      const score = computeTopicScore(results?.scores ?? {});
      const ad = results?.metrics?.audio_delivery ?? {};
      const wpm = Math.round(results?.metrics?.words_per_minute ?? 0);
      const paceLabel = results?.metrics?.pace_label ?? 'unknown';
      const fillerCount = results?.metrics?.filler_word_count ?? 0;
      setTtResult({
        score,
        wpm,
        paceLabel,
        fillerCount,
        strengths: (results?.strengths ?? []).slice(0, 2),
        improvements: (results?.improvements ?? []).slice(0, 1),
        monotoneLabel: ad?.monotone?.label ?? 'unknown',
        volumeLabel: ad?.volume?.consistency_label ?? 'unknown',
      });
      void savePracticeHistory({
        mode: 'topic',
        modeLabel: 'Topic Talk',
        score,
        summary: `${wpm} WPM, ${fillerCount} filler word${fillerCount !== 1 ? 's' : ''}`,
        detail: `Pace ${paceLabel}, pitch ${MONOTONE_LABEL[ad?.monotone?.label ?? 'unknown'] ?? (ad?.monotone?.label ?? 'unknown')}, volume ${VOLUME_LABEL[ad?.volume?.consistency_label ?? 'unknown'] ?? (ad?.volume?.consistency_label ?? 'unknown')}`,
        metrics: {
          wpm,
          filler_count: fillerCount,
        },
      });
    } catch (err: any) {
      setTtError(err?.message ?? 'Analysis failed. Make sure the backend is running.');
    } finally {
      setTtAnalyzing(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const verdictLabel: Record<string, string> = {
    correct: 'Correct',
    partially_correct: 'Partial',
    incorrect: 'Incorrect',
    insufficient_information: 'Unclear',
  };
  const verdictColor: Record<string, string> = {
    correct: palette.mint,
    partially_correct: '#e09b2d',
    incorrect: '#c0392b',
    insufficient_information: '#8a8a8a',
  };

  return (
    <ScrollView
      style={[s.scroll, { backgroundColor: canvas }]}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled">

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <View style={s.headerCopy}>
            <ThemedText style={[s.headerTitle, { color: ink }]}>Practice</ThemedText>
            <ThemedText style={[s.headerSub, { color: ink }]}>
              Focused practice games to sharpen your speaking
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open practice history"
            onPress={() => router.push('/practice-history')}
            style={[s.historyBtn, { borderColor: border, backgroundColor: card }]}>
            <Ionicons name="stats-chart-outline" size={18} color={palette.accent} />
            <ThemedText style={[s.historyBtnText, { color: ink }]}>History</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Mode Selector — 2×2 grid */}
      <View style={s.modeGrid}>
        {DRILL_MODES.map((m) => {
          const active = mode === m.key;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={m.title}
              onPress={() => { setMode(m.key); resetQa(); resetFc(); resetPr(); resetTt(); }}
              style={[
                s.modeCard,
                { backgroundColor: card, borderColor: active ? palette.accent : border },
                active && { borderWidth: 2 },
              ]}>
              <Ionicons name={m.icon as any} size={22} color={active ? palette.accent : ink} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.modeCardTitle, { color: active ? palette.accent : ink }]}>{m.title}</ThemedText>
              <ThemedText style={[s.modeCardDesc, { color: ink }]}>{m.desc}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/* ── Q&A Simulator ─────────────────────────────────────────────────── */}
      {mode === 'qa' && (
        <View style={s.panel}>

          {/* Preset picker */}
          <ThemedText style={[s.sectionLabel, { color: ink }]}>Topic</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.presetScroll}>
            {PRESETS.map((p) => {
              const active = qaPreset === p.key;
              return (
                <Pressable
                  key={p.key}
                  accessibilityRole="button"
                  accessibilityLabel={p.label}
                  onPress={() => setQaPreset(p.key)}
                  style={[
                    s.presetPill,
                    { borderColor: border },
                    active && { backgroundColor: palette.accentDeep, borderColor: palette.accentDeep },
                  ]}>
                  <Ionicons
                    name={p.icon}
                    size={14}
                    color={active ? '#fff' : palette.accent}
                    style={{ marginRight: 4 }}
                  />
                  <ThemedText style={[s.presetPillText, { color: active ? '#fff' : ink }]}>
                    {p.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Get Question */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Get a question"
            onPress={getQuestion}
            disabled={qaQuestionBusy || qaAnalyzing}
            style={[s.primaryBtn, (qaQuestionBusy || qaAnalyzing) && s.btnDisabled]}>
            <Ionicons name="sparkles-outline" size={16} color="#fff" style={s.btnIcon} />
            <ThemedText style={s.primaryBtnText}>
              {qaQuestionBusy ? 'Generating…' : qaQuestion ? 'New Question' : 'Get Question'}
            </ThemedText>
          </Pressable>

          {/* Question card */}
          {qaQuestion && (
            <View style={[s.questionCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="help-circle" size={20} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.questionText, { color: ink }]}>{qaQuestion}</ThemedText>
            </View>
          )}

          {/* Recording section (only after question is loaded) */}
          {qaQuestion && !qaResult && (
            <View style={s.recordSection}>
              <ThemedText style={[s.sectionLabel, { color: ink }]}>
                Record your answer (max 90 s)
              </ThemedText>

              {/* Elapsed timer */}
              {qaRecording && (
                <ThemedText style={[s.timerText, { color: palette.accent }]}>
                  {qaElapsed}s / 90s
                </ThemedText>
              )}

              {/* Record button */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={qaRecording ? 'Stop recording' : 'Start recording'}
                onPress={handleQaRecord}
                disabled={qaAnalyzing}
                style={[
                  s.recordBtn,
                  qaRecording ? s.recordBtnActive : { borderColor: border, backgroundColor: card },
                  qaAnalyzing && s.btnDisabled,
                ]}>
                <Ionicons
                  name={qaRecording ? 'stop-circle' : 'videocam-outline'}
                  size={20}
                  color={qaRecording ? '#fff' : palette.accent}
                  style={{ marginRight: 6 }}
                />
                <ThemedText style={{ color: qaRecording ? '#fff' : ink, fontFamily: Fonts.rounded }}>
                  {qaRecording ? 'Stop Recording' : 'Start Recording'}
                </ThemedText>
              </Pressable>

              {/* Submit */}
              {qaVideoUri && !qaRecording && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Submit answer for grading"
                  onPress={submitAnswer}
                  disabled={qaAnalyzing}
                  style={[s.primaryBtn, { marginTop: 10 }, qaAnalyzing && s.btnDisabled]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#fff" style={s.btnIcon} />
                  <ThemedText style={s.primaryBtnText}>
                    {qaAnalyzing ? 'Analyzing…' : 'Submit Answer'}
                  </ThemedText>
                </Pressable>
              )}

              {/* Inline error */}
              {qaError && (
                <View style={[s.errorBox, { borderColor: '#c0392b' }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#c0392b" style={{ marginRight: 6 }} />
                  <ThemedText style={s.errorText}>{qaError}</ThemedText>
                </View>
              )}
            </View>
          )}

          {/* Eval result card */}
          {qaResult && (
            <View style={[s.resultCard, { backgroundColor: card, borderColor: border }]}>
              <ScoreCircle score={qaResult.correctness_score} />

              {/* Verdict badge */}
              <View style={[
                s.verdictBadge,
                { backgroundColor: verdictColor[qaResult.verdict] + '22', borderColor: verdictColor[qaResult.verdict] },
              ]}>
                <ThemedText style={[s.verdictText, { color: verdictColor[qaResult.verdict] }]}>
                  {verdictLabel[qaResult.verdict] ?? qaResult.verdict}
                </ThemedText>
              </View>

              {/* Reason */}
              <ThemedText style={[s.resultSection, { color: ink }]}>{qaResult.reason}</ThemedText>

              {/* Missing points */}
              {qaResult.missing_points.length > 0 && (
                <View style={s.missingSection}>
                  <ThemedText style={[s.missingSectionTitle, { color: ink }]}>Missing points</ThemedText>
                  {qaResult.missing_points.map((pt, i) => (
                    <View key={i} style={s.missingRow}>
                      <Ionicons name="ellipse" size={6} color={palette.accent} style={{ marginTop: 5, marginRight: 8 }} />
                      <ThemedText style={[s.missingPoint, { color: ink }]}>{pt}</ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {/* Suggested improvement */}
              <View style={[s.tipBox, { backgroundColor: palette.mint + '18', borderColor: palette.mint }]}>
                <Ionicons name="bulb-outline" size={14} color={palette.mint} style={{ marginRight: 6, marginTop: 2 }} />
                <ThemedText style={[s.tipText, { color: ink }]}>{qaResult.suggested_improvement}</ThemedText>
              </View>

              {/* Buttons */}
              <View style={s.resultButtons}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Get next question"
                  onPress={getQuestion}
                  disabled={qaQuestionBusy}
                  style={[s.primaryBtn, { flex: 1, marginRight: 6 }, qaQuestionBusy && s.btnDisabled]}>
                  <Ionicons name="arrow-forward-circle-outline" size={16} color="#fff" style={s.btnIcon} />
                  <ThemedText style={s.primaryBtnText}>Next Question</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change topic"
                  onPress={resetQa}
                  style={[s.secondaryBtn, { flex: 1 }]}>
                  <ThemedText style={[s.secondaryBtnText, { color: ink }]}>Change Topic</ThemedText>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Filler Challenge ───────────────────────────────────────────────── */}
      {mode === 'filler' && (
        <View style={s.panel}>

          {/* Instructions */}
          <View style={[s.questionCard, { backgroundColor: card, borderColor: border }]}>
            <Ionicons name="trophy-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
            <ThemedText style={[s.questionText, { color: ink }]}>
              Speak for 60 seconds without using any filler words — no "um", "uh", "like", "you know",
              "actually", "basically", "literally", or "so".
            </ThemedText>
          </View>

          {/* Countdown ring */}
          <View style={s.countdownWrap}>
            <View style={[
              s.countdownRing,
              { borderColor: fcRecording ? palette.accent : border },
            ]}>
              <ThemedText style={[s.countdownNumber, { color: fcRecording ? palette.accent : ink }]}>
                {fcRecording ? fcSecondsLeft : FILLER_CHALLENGE_SECONDS}
              </ThemedText>
              <ThemedText style={[s.countdownLabel, { color: ink }]}>seconds</ThemedText>
            </View>
          </View>

          {/* Record button */}
          {!fcVideoUri && !fcResult && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fcRecording ? 'Stop recording' : 'Start 60-second challenge'}
              onPress={handleFcRecord}
              disabled={fcAnalyzing}
              style={[
                s.recordBtn,
                fcRecording ? s.recordBtnActive : { borderColor: border, backgroundColor: card },
                fcAnalyzing && s.btnDisabled,
              ]}>
              <Ionicons
                name={fcRecording ? 'stop-circle' : 'play-circle-outline'}
                size={22}
                color={fcRecording ? '#fff' : palette.accent}
                style={{ marginRight: 6 }}
              />
              <ThemedText style={{ color: fcRecording ? '#fff' : ink, fontFamily: Fonts.rounded, fontSize: 16 }}>
                {fcRecording ? 'Stop Early' : 'Start Challenge'}
              </ThemedText>
            </Pressable>
          )}

          {/* Submit recorded video */}
          {fcVideoUri && !fcResult && !fcAnalyzing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Analyze my recording"
              onPress={submitFcRecording}
              style={s.primaryBtn}>
              <Ionicons name="analytics-outline" size={16} color="#fff" style={s.btnIcon} />
              <ThemedText style={s.primaryBtnText}>Check Results</ThemedText>
            </Pressable>
          )}

          {/* Analyzing loading card */}
          {fcAnalyzing && (
            <View style={[s.loadingCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="hourglass-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.loadingText, { color: ink }]}>Analyzing your recording…</ThemedText>
              <ThemedText style={[s.loadingSub, { color: ink }]}>This usually takes 20–60 seconds</ThemedText>
            </View>
          )}

          {/* Inline error */}
          {fcError && (
            <View style={[s.errorBox, { borderColor: '#c0392b' }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#c0392b" style={{ marginRight: 6 }} />
              <ThemedText style={s.errorText}>{fcError}</ThemedText>
            </View>
          )}

          {/* Result */}
          {fcResult && (
            <View style={[s.resultCard, { backgroundColor: card, borderColor: border }]}>
              {/* Success / Fail banner */}
              <View style={[
                s.fcBanner,
                { backgroundColor: fcResult.success ? palette.mint + '22' : '#c0392b22' },
              ]}>
                <Ionicons
                  name={fcResult.success ? 'trophy' : 'close-circle'}
                  size={32}
                  color={fcResult.success ? palette.mint : '#c0392b'}
                />
                <ThemedText style={[
                  s.fcBannerText,
                  { color: fcResult.success ? palette.mint : '#c0392b' },
                ]}>
                  {fcResult.success
                    ? 'Perfect! Zero filler words!'
                    : `${fcResult.fillerCount} filler word${fcResult.fillerCount !== 1 ? 's' : ''} detected`}
                </ThemedText>
              </View>

              {/* Filler breakdown chips */}
              {!fcResult.success && Object.keys(fcResult.fillerWords).length > 0 && (
                <View style={s.chipWrap}>
                  {Object.entries(fcResult.fillerWords).map(([word, count]) => (
                    <View key={word} style={[s.fillerChip, { borderColor: palette.accent + '66' }]}>
                      <ThemedText style={[s.fillerChipWord, { color: ink }]}>"{word}"</ThemedText>
                      <View style={[s.fillerChipBadge, { backgroundColor: palette.accent }]}>
                        <ThemedText style={s.fillerChipCount}>×{count}</ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Stats */}
              <ThemedText style={[s.fcStats, { color: ink }]}>
                {fcResult.totalWords} words spoken
              </ThemedText>

              {/* Try again */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try the challenge again"
                onPress={resetFc}
                style={s.primaryBtn}>
                <Ionicons name="refresh-outline" size={16} color="#fff" style={s.btnIcon} />
                <ThemedText style={s.primaryBtnText}>Try Again</ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* ── Paragraph Reading ──────────────────────────────────────────────── */}
      {mode === 'paragraph' && (
        <View style={s.panel}>

          {/* Get paragraph button */}
          {!prParagraph && !prParagraphBusy && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get a paragraph to read"
              onPress={getParagraph}
              style={s.primaryBtn}>
              <Ionicons name="book-outline" size={16} color="#fff" style={s.btnIcon} />
              <ThemedText style={s.primaryBtnText}>Get Paragraph</ThemedText>
            </Pressable>
          )}

          {prParagraphBusy && (
            <View style={[s.loadingCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="hourglass-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.loadingText, { color: ink }]}>Loading paragraph…</ThemedText>
            </View>
          )}

          {/* Paragraph card */}
          {prParagraph && (
            <View style={[s.paragraphCard, { backgroundColor: card, borderColor: border }]}>
              <ThemedText style={[s.paragraphTitle, { color: palette.accent }]}>{prParagraph.title}</ThemedText>
              <ThemedText style={[s.paragraphBody, { color: ink }]}>{prParagraph.text}</ThemedText>
            </View>
          )}

          {/* Recording controls */}
          {prParagraph && !prVideoUri && !prResult && (
            <View style={s.recordSection}>
              {prRecording && (
                <ThemedText style={[s.timerText, { color: ink }]}>
                  {prElapsed}s / {PARAGRAPH_MAX_SECONDS}s
                </ThemedText>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={prRecording ? 'Stop recording' : 'Record your reading'}
                onPress={handlePrRecord}
                style={[
                  s.recordBtn,
                  { borderColor: prRecording ? '#c0392b' : palette.accent },
                  prRecording && s.recordBtnActive,
                ]}>
                <Ionicons
                  name={prRecording ? 'stop-circle' : 'mic'}
                  size={18}
                  color={prRecording ? '#fff' : palette.accent}
                  style={s.btnIcon}
                />
                <ThemedText style={{ color: prRecording ? '#fff' : ink, fontFamily: Fonts.rounded, fontSize: 16 }}>
                  {prRecording ? 'Stop Recording' : 'Record Reading'}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Submit */}
          {prVideoUri && !prResult && !prAnalyzing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Analyze my reading"
              onPress={submitPrRecording}
              style={s.primaryBtn}>
              <Ionicons name="analytics-outline" size={16} color="#fff" style={s.btnIcon} />
              <ThemedText style={s.primaryBtnText}>Analyze Reading</ThemedText>
            </Pressable>
          )}

          {/* Analyzing */}
          {prAnalyzing && (
            <View style={[s.loadingCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="hourglass-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.loadingText, { color: ink }]}>Analyzing your delivery…</ThemedText>
              <ThemedText style={[s.loadingSub, { color: ink }]}>This usually takes 20–60 seconds</ThemedText>
            </View>
          )}

          {/* Error */}
          {prError && (
            <View style={[s.errorBox, { borderColor: '#c0392b' }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#c0392b" style={{ marginRight: 6 }} />
              <ThemedText style={s.errorText}>{prError}</ThemedText>
            </View>
          )}

          {/* Result card */}
          {prResult && (
            <View style={[s.resultCard, { backgroundColor: card, borderColor: border }]}>
              <ScoreCircle score={prResult.score} />

              {/* Pitch/Tone row */}
              <View style={s.deliveryRow}>
                <Ionicons name="musical-notes-outline" size={18} color={MONOTONE_COLOR[prResult.monotone.label] ?? '#8a8a8a'} style={{ marginRight: 8 }} />
                <ThemedText style={[s.deliveryRowLabel, { color: ink }]}>Pitch Variation</ThemedText>
                <View style={[s.deliveryChip, { backgroundColor: (MONOTONE_COLOR[prResult.monotone.label] ?? '#8a8a8a') + '22', borderColor: (MONOTONE_COLOR[prResult.monotone.label] ?? '#8a8a8a') + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: MONOTONE_COLOR[prResult.monotone.label] ?? '#8a8a8a' }]}>
                    {MONOTONE_LABEL[prResult.monotone.label] ?? prResult.monotone.label}
                  </ThemedText>
                </View>
              </View>

              {/* Volume row */}
              <View style={s.deliveryRow}>
                <Ionicons name="volume-medium-outline" size={18} color={VOLUME_COLOR[prResult.volume.consistency_label] ?? '#8a8a8a'} style={{ marginRight: 8 }} />
                <ThemedText style={[s.deliveryRowLabel, { color: ink }]}>Volume</ThemedText>
                <View style={[s.deliveryChip, { backgroundColor: (VOLUME_COLOR[prResult.volume.consistency_label] ?? '#8a8a8a') + '22', borderColor: (VOLUME_COLOR[prResult.volume.consistency_label] ?? '#8a8a8a') + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: VOLUME_COLOR[prResult.volume.consistency_label] ?? '#8a8a8a' }]}>
                    {VOLUME_LABEL[prResult.volume.consistency_label] ?? prResult.volume.consistency_label}
                  </ThemedText>
                </View>
                {prResult.volume.trailing_off_events > 0 && (
                  <ThemedText style={[s.deliveryNote, { color: ink }]}>  {prResult.volume.trailing_off_events} trailing off</ThemedText>
                )}
              </View>

              {/* Pauses row */}
              <View style={s.deliveryRow}>
                <Ionicons name="pause-circle-outline" size={18} color={PAUSE_COLOR[prResult.pauses.pause_quality] ?? '#8a8a8a'} style={{ marginRight: 8 }} />
                <ThemedText style={[s.deliveryRowLabel, { color: ink }]}>Pauses</ThemedText>
                <View style={[s.deliveryChip, { backgroundColor: (PAUSE_COLOR[prResult.pauses.pause_quality] ?? '#8a8a8a') + '22', borderColor: (PAUSE_COLOR[prResult.pauses.pause_quality] ?? '#8a8a8a') + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: PAUSE_COLOR[prResult.pauses.pause_quality] ?? '#8a8a8a' }]}>
                    {PAUSE_LABEL[prResult.pauses.pause_quality] ?? prResult.pauses.pause_quality}
                  </ThemedText>
                </View>
                <ThemedText style={[s.deliveryNote, { color: ink }]}>
                  {'  '}{prResult.pauses.effective_pauses}✓ {prResult.pauses.awkward_silences}✗
                </ThemedText>
              </View>

              {/* Try new paragraph */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try a new paragraph"
                onPress={getParagraph}
                style={s.primaryBtn}>
                <Ionicons name="refresh-outline" size={16} color="#fff" style={s.btnIcon} />
                <ThemedText style={s.primaryBtnText}>Try New Paragraph</ThemedText>
              </Pressable>
            </View>
          )}

        </View>
      )}

      {/* ── Topic Talk ─────────────────────────────────────────────────────── */}
      {mode === 'topic' && (
        <View style={s.panel}>

          {/* Get topic button */}
          {!ttTopic && !ttTopicBusy && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get a random topic"
              onPress={getTopic}
              style={s.primaryBtn}>
              <Ionicons name="bulb-outline" size={16} color="#fff" style={s.btnIcon} />
              <ThemedText style={s.primaryBtnText}>Get Topic</ThemedText>
            </Pressable>
          )}

          {ttTopicBusy && (
            <View style={[s.loadingCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="hourglass-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.loadingText, { color: ink }]}>Loading topic…</ThemedText>
            </View>
          )}

          {/* Topic card */}
          {ttTopic && (
            <View style={[s.paragraphCard, { backgroundColor: card, borderColor: border }]}>
              <ThemedText style={[s.paragraphTitle, { color: palette.accent }]}>{ttTopic.topic}</ThemedText>
              <ThemedText style={[s.paragraphBody, { color: ink, fontStyle: 'italic', opacity: 0.8 }]}>{ttTopic.prompt}</ThemedText>
            </View>
          )}

          {/* Recording controls */}
          {ttTopic && !ttVideoUri && !ttResult && (
            <View style={s.recordSection}>
              {ttRecording && (
                <ThemedText style={[s.timerText, { color: ink }]}>
                  {ttElapsed}s / {TOPIC_MAX_SECONDS}s
                </ThemedText>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ttRecording ? 'Stop recording' : 'Start speaking'}
                onPress={handleTtRecord}
                style={[
                  s.recordBtn,
                  { borderColor: ttRecording ? '#c0392b' : palette.accent },
                  ttRecording && s.recordBtnActive,
                ]}>
                <Ionicons
                  name={ttRecording ? 'stop-circle' : 'mic'}
                  size={18}
                  color={ttRecording ? '#fff' : palette.accent}
                  style={s.btnIcon}
                />
                <ThemedText style={{ color: ttRecording ? '#fff' : ink, fontFamily: Fonts.rounded, fontSize: 16 }}>
                  {ttRecording ? 'Stop Speaking' : 'Start Speaking'}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Submit */}
          {ttVideoUri && !ttResult && !ttAnalyzing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Analyze my talk"
              onPress={submitTtRecording}
              style={s.primaryBtn}>
              <Ionicons name="analytics-outline" size={16} color="#fff" style={s.btnIcon} />
              <ThemedText style={s.primaryBtnText}>Analyze Talk</ThemedText>
            </Pressable>
          )}

          {/* Analyzing */}
          {ttAnalyzing && (
            <View style={[s.loadingCard, { backgroundColor: card, borderColor: border }]}>
              <Ionicons name="hourglass-outline" size={22} color={palette.accent} style={{ marginBottom: 6 }} />
              <ThemedText style={[s.loadingText, { color: ink }]}>Analyzing your talk…</ThemedText>
              <ThemedText style={[s.loadingSub, { color: ink }]}>This usually takes 20–60 seconds</ThemedText>
            </View>
          )}

          {/* Error */}
          {ttError && (
            <View style={[s.errorBox, { borderColor: '#c0392b' }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#c0392b" style={{ marginRight: 6 }} />
              <ThemedText style={s.errorText}>{ttError}</ThemedText>
            </View>
          )}

          {/* Result card */}
          {ttResult && (
            <View style={[s.resultCard, { backgroundColor: card, borderColor: border }]}>
              <ScoreCircle score={ttResult.score} />

              {/* Pace row */}
              <View style={s.deliveryRow}>
                <Ionicons name="speedometer-outline" size={18} color={ink} style={{ marginRight: 8 }} />
                <ThemedText style={[s.deliveryRowLabel, { color: ink }]}>
                  {ttResult.wpm} wpm
                </ThemedText>
                <View style={[s.deliveryChip, { backgroundColor: palette.accent + '22', borderColor: palette.accent + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: palette.accent }]}>{ttResult.paceLabel}</ThemedText>
                </View>
              </View>

              {/* Filler row */}
              <View style={s.deliveryRow}>
                <Ionicons
                  name={ttResult.fillerCount === 0 ? 'checkmark-circle-outline' : 'close-circle-outline'}
                  size={18}
                  color={ttResult.fillerCount === 0 ? palette.mint : '#c0392b'}
                  style={{ marginRight: 8 }}
                />
                <ThemedText style={[s.deliveryRowLabel, { color: ink }]}>
                  {ttResult.fillerCount === 0 ? 'No filler words' : `${ttResult.fillerCount} filler word${ttResult.fillerCount !== 1 ? 's' : ''}`}
                </ThemedText>
              </View>

              {/* Strengths */}
              {ttResult.strengths.length > 0 && (
                <View style={s.missingSection}>
                  <ThemedText style={[s.missingSectionTitle, { color: ink }]}>Strengths</ThemedText>
                  {ttResult.strengths.map((s2, i) => (
                    <View key={i} style={s.missingRow}>
                      <Ionicons name="checkmark-circle" size={14} color={palette.mint} style={{ marginRight: 6, marginTop: 3 }} />
                      <ThemedText style={[s.missingPoint, { color: ink }]}>{s2}</ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {/* Improvement */}
              {ttResult.improvements.length > 0 && (
                <View style={s.missingSection}>
                  <ThemedText style={[s.missingSectionTitle, { color: ink }]}>Top Tip</ThemedText>
                  {ttResult.improvements.slice(0, 1).map((imp: any, i: number) => (
                    <View key={i} style={s.missingRow}>
                      <Ionicons name="arrow-forward-circle" size={14} color={palette.accent} style={{ marginRight: 6, marginTop: 3 }} />
                      <ThemedText style={[s.missingPoint, { color: ink }]}>
                        {typeof imp === 'string' ? imp : imp?.description ?? imp?.title ?? JSON.stringify(imp)}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {/* Delivery chips */}
              <View style={[s.deliveryRow, { flexWrap: 'wrap', gap: 6 }]}>
                <View style={[s.deliveryChip, { backgroundColor: (MONOTONE_COLOR[ttResult.monotoneLabel] ?? '#8a8a8a') + '22', borderColor: (MONOTONE_COLOR[ttResult.monotoneLabel] ?? '#8a8a8a') + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: MONOTONE_COLOR[ttResult.monotoneLabel] ?? '#8a8a8a' }]}>
                    {MONOTONE_LABEL[ttResult.monotoneLabel] ?? ttResult.monotoneLabel}
                  </ThemedText>
                </View>
                <View style={[s.deliveryChip, { backgroundColor: (VOLUME_COLOR[ttResult.volumeLabel] ?? '#8a8a8a') + '22', borderColor: (VOLUME_COLOR[ttResult.volumeLabel] ?? '#8a8a8a') + '66' }]}>
                  <ThemedText style={[s.deliveryChipText, { color: VOLUME_COLOR[ttResult.volumeLabel] ?? '#8a8a8a' }]}>
                    {VOLUME_LABEL[ttResult.volumeLabel] ?? ttResult.volumeLabel}
                  </ThemedText>
                </View>
              </View>

              {/* New topic */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get a new topic"
                onPress={getTopic}
                style={s.primaryBtn}>
                <Ionicons name="refresh-outline" size={16} color="#fff" style={s.btnIcon} />
                <ThemedText style={s.primaryBtnText}>New Topic</ThemedText>
              </Pressable>
            </View>
          )}

        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 120 },

  header: { marginBottom: 20, marginTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerCopy: { flex: 1 },
  headerTitle: { fontFamily: Fonts.rounded, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  headerSub: { fontFamily: Fonts.rounded, fontSize: 14, opacity: 0.65 },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    marginTop: 2,
  },
  historyBtnText: { fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '600' },

  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  modeCard: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 2,
  },
  modeCardTitle: { fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  modeCardDesc: { fontFamily: Fonts.rounded, fontSize: 11, opacity: 0.6, textAlign: 'center' },

  panel: { gap: 14 },

  sectionLabel: { fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '600', opacity: 0.7, marginBottom: -6 },

  presetScroll: { marginHorizontal: -4 },
  presetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  presetPillText: { fontFamily: Fonts.rounded, fontSize: 13 },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  primaryBtnText: { fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '600', color: '#fff' },
  btnIcon: { marginRight: 6 },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
  },
  secondaryBtnText: { fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '600' },

  btnDisabled: { opacity: 0.45 },

  questionCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  questionText: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24 },

  recordSection: { gap: 10 },

  timerText: { fontFamily: Fonts.rounded, fontSize: 14, fontWeight: '700', textAlign: 'center' },

  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1.5,
  },
  recordBtnActive: {
    backgroundColor: '#c0392b',
    borderColor: '#c0392b',
  },

  resultCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  verdictBadge: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  verdictText: { fontFamily: Fonts.rounded, fontSize: 14, fontWeight: '700' },
  resultSection: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22 },

  missingSection: { gap: 6 },
  missingSectionTitle: { fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '600', opacity: 0.7 },
  missingRow: { flexDirection: 'row', alignItems: 'flex-start' },
  missingPoint: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, flex: 1 },

  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  tipText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, flex: 1 },

  resultButtons: { flexDirection: 'row', gap: 8 },

  // Filler challenge
  countdownWrap: { alignItems: 'center', paddingVertical: 10 },
  countdownRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: { fontFamily: Fonts.rounded, fontSize: 38, fontWeight: '700', lineHeight: 42 },
  countdownLabel: { fontFamily: Fonts.rounded, fontSize: 12, opacity: 0.65 },

  fcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
  },
  fcBannerText: { fontFamily: Fonts.rounded, fontSize: 17, fontWeight: '700', flex: 1 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fillerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 6,
  },
  fillerChipWord: { fontFamily: Fonts.rounded, fontSize: 13 },
  fillerChipBadge: {
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fillerChipCount: { fontFamily: Fonts.rounded, fontSize: 12, color: '#fff', fontWeight: '700' },
  fcStats: { fontFamily: Fonts.rounded, fontSize: 13, textAlign: 'center', opacity: 0.7 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#c0392b12',
  },
  errorText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, flex: 1, color: '#c0392b' },

  loadingCard: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  loadingText: { fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '600' },
  loadingSub: { fontFamily: Fonts.rounded, fontSize: 12, opacity: 0.6 },

  // Paragraph / Topic
  paragraphCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  paragraphTitle: { fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '700' },
  paragraphBody: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 26 },

  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  deliveryRowLabel: { fontFamily: Fonts.rounded, fontSize: 13, flex: 1 },
  deliveryChip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  deliveryChipText: { fontFamily: Fonts.rounded, fontSize: 12, fontWeight: '600' },
  deliveryNote: { fontFamily: Fonts.rounded, fontSize: 12, opacity: 0.7 },
});
