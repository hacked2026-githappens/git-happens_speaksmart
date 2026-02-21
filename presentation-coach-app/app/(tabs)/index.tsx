import React, { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// TypeScript definitions for web-specific globals
declare global {
  interface Navigator {
    mediaDevices: any;
  }
}

type Marker = {
  time_sec: number;
  label: string;
  detail?: string;
};

type LLMAnalysis = {
  scores: {
    clarity: number;
    pace_consistency: number;
    confidence_language: number;
    content_structure: number;
    filler_word_density: number;
  };
  strengths: string[];
  improvements: { title: string; detail: string; actionable_tip?: string }[];
  structure: {
    has_clear_intro: boolean;
    has_clear_conclusion: boolean;
    body_feedback: string;
  };
  feedbackEvents: {
    id?: string;
    timestamp?: number;
    type: string;
    severity: string;
    title: string;
    message: string;
    wordIndex?: number;
  }[];
  stats: { flagged_sentences: number };
};

type CoachResponse = {
  summary: string;
  bullets?: string[];
  markers?: Marker[];
  notes?: string[];
  transcript?: string;
  llm?: LLMAnalysis;
  metrics?: {
    words_per_minute?: number;
    pace_label?: string;
    [key: string]: any;
  };
};

type FollowUpQuestionResponse = {
  question: string;
};

type FollowUpAnswerEvalResponse = {
  is_correct: boolean;
  verdict: 'correct' | 'partially_correct' | 'incorrect' | 'insufficient_information';
  correctness_score: number;
  reason: string;
  missing_points: string[];
  suggested_improvement: string;
};

type ButtonTone = 'primary' | 'secondary' | 'neutral';

type ActionButtonProps = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  tone?: ButtonTone;
};

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

function formatSeconds(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = Math.max(0, Math.floor(seconds % 60))
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}

function getCorrectnessBadge(verdict: FollowUpAnswerEvalResponse['verdict']): {
  label: string;
  textColor: string;
  backgroundColor: string;
} {
  if (verdict === 'correct') {
    return { label: 'Correct', textColor: '#0f6b60', backgroundColor: '#dff5f2' };
  }
  if (verdict === 'partially_correct') {
    return { label: 'Partially Correct', textColor: '#9b5f1f', backgroundColor: '#fce8cf' };
  }
  if (verdict === 'incorrect') {
    return { label: 'Incorrect', textColor: '#9a2f1f', backgroundColor: '#f8ddd8' };
  }
  return {
    label: 'Needs More Context',
    textColor: '#5f4d3f',
    backgroundColor: 'rgba(47, 34, 25, 0.14)',
  };
}

function mapAnalyzePayload(api: any): CoachResponse {
  return {
    summary: api.summary_feedback?.[0] ?? 'Feedback ready.',
    bullets: api.summary_feedback ?? [],
    markers: (api.markers ?? []).map((marker: any) => ({
      time_sec: marker.second,
      label: marker.category,
      detail: marker.message,
    })),
    notes: [],
    transcript: api.transcript ?? '',
    llm: api.llm_analysis ?? undefined,
    metrics: api.metrics ?? {},
  };
}

function ActionButton({ label, icon, onPress, disabled, tone = 'neutral' }: ActionButtonProps) {
  const buttonStyleByTone: Record<ButtonTone, object> = {
    primary: styles.primaryButton,
    secondary: styles.secondaryButton,
    neutral: styles.neutralButton,
  };

  const textStyleByTone: Record<ButtonTone, object> = {
    primary: styles.primaryButtonText,
    secondary: styles.secondaryButtonText,
    neutral: styles.neutralButtonText,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        buttonStyleByTone[tone],
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}>
      <Ionicons name={icon} size={18} style={[styles.buttonIcon, textStyleByTone[tone]]} />
      <ThemedText style={[styles.actionButtonText, textStyleByTone[tone]]}>{label}</ThemedText>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const player = useVideoPlayer(videoUri ?? '', (p) => {
    p.loop = false;
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<CoachResponse | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [recordElapsedSeconds, setRecordElapsedSeconds] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null);

  const [answerVideoUri, setAnswerVideoUri] = useState<string | null>(null);
  const answerPlayer = useVideoPlayer(answerVideoUri ?? '', (p) => {
    p.loop = false;
  });
  const [answerVideoName, setAnswerVideoName] = useState<string>('');
  const [answerVideoDuration, setAnswerVideoDuration] = useState<number | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerFeedback, setAnswerFeedback] = useState<CoachResponse | null>(null);
  const [answerCorrectness, setAnswerCorrectness] =
    useState<FollowUpAnswerEvalResponse | null>(null);
  const [answerShowTranscript, setAnswerShowTranscript] = useState(false);
  const [answerRecording, setAnswerRecording] = useState(false);
  const [answerRecordStart, setAnswerRecordStart] = useState<number | null>(null);
  const [answerRecordElapsedSeconds, setAnswerRecordElapsedSeconds] = useState(0);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const previewRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const answerMediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const answerPreviewRef = React.useRef<HTMLVideoElement | null>(null);
  const answerStreamRef = React.useRef<MediaStream | null>(null);

  const resetAnswerPractice = () => {
    setAnswerVideoUri(null);
    setAnswerVideoName('');
    setAnswerVideoDuration(null);
    setAnswerBusy(false);
    setAnswerFeedback(null);
    setAnswerCorrectness(null);
    setAnswerShowTranscript(false);
    setAnswerRecordStart(null);
    setAnswerRecordElapsedSeconds(0);
    setAnswerRecording(false);

    answerMediaRecorderRef.current = null;
    if (answerPreviewRef.current) {
      answerPreviewRef.current.srcObject = null;
    }
    if (answerStreamRef.current) {
      answerStreamRef.current.getTracks().forEach((track) => track.stop());
      answerStreamRef.current = null;
    }
  };

  const resetFollowUpFlow = () => {
    setQuestionBusy(false);
    setFollowUpQuestion(null);
    resetAnswerPractice();
  };

  React.useEffect(() => {
    const update = async () => {
      if (videoUri && player) {
        try {
          const status = await player.getStatusAsync();
          if (status.isLoaded && status.durationMillis != null) {
            setVideoDuration(status.durationMillis / 1000);
          }
        } catch (error) {
          console.warn('could not read duration from player', error);
        }
      }
    };
    update();
  }, [videoUri, player]);

  React.useEffect(() => {
    const update = async () => {
      if (answerVideoUri && answerPlayer) {
        try {
          const status = await answerPlayer.getStatusAsync();
          if (status.isLoaded && status.durationMillis != null) {
            setAnswerVideoDuration(status.durationMillis / 1000);
          }
        } catch (error) {
          console.warn('could not read duration from answer player', error);
        }
      }
    };
    update();
  }, [answerVideoUri, answerPlayer]);

  React.useEffect(() => {
    if (!recording || !recordStart) {
      setRecordElapsedSeconds(0);
      return;
    }

    const tick = setInterval(() => {
      setRecordElapsedSeconds(Math.max(0, Math.round((Date.now() - recordStart) / 1000)));
    }, 1000);

    return () => clearInterval(tick);
  }, [recording, recordStart]);

  React.useEffect(() => {
    if (!answerRecording || !answerRecordStart) {
      setAnswerRecordElapsedSeconds(0);
      return;
    }

    const tick = setInterval(() => {
      setAnswerRecordElapsedSeconds(
        Math.max(0, Math.round((Date.now() - answerRecordStart) / 1000)),
      );
    }, 1000);

    return () => clearInterval(tick);
  }, [answerRecording, answerRecordStart]);

  React.useEffect(() => {
    if (Platform.OS === 'web' && recording && streamRef.current && previewRef.current) {
      previewRef.current.srcObject = streamRef.current;
      previewRef.current.muted = true;
      previewRef.current.play().catch(() => {});
    }
  }, [recording]);

  React.useEffect(() => {
    if (
      Platform.OS === 'web' &&
      answerRecording &&
      answerStreamRef.current &&
      answerPreviewRef.current
    ) {
      answerPreviewRef.current.srcObject = answerStreamRef.current;
      answerPreviewRef.current.muted = true;
      answerPreviewRef.current.play().catch(() => {});
    }
  }, [answerRecording]);

  const paceState = useMemo(() => {
    const wordsPerMinute = feedback?.metrics?.words_per_minute;
    if (typeof wordsPerMinute !== 'number') {
      return null;
    }

    const min = 110;
    const max = 170;
    const clamped = Math.min(Math.max((wordsPerMinute - min) / (max - min), 0), 1);

    if (feedback?.metrics?.pace_label === 'fast') {
      return { color: '#d1652c', label: 'Fast pace', percent: clamped };
    }
    if (feedback?.metrics?.pace_label === 'slow') {
      return { color: '#3577ba', label: 'Slow pace', percent: clamped };
    }
    return { color: '#17998a', label: 'Balanced pace', percent: clamped };
  }, [feedback]);

  const llmScoreCards = useMemo(() => {
    if (!feedback?.llm?.scores) {
      return [];
    }

    return [
      { label: 'Clarity', value: feedback.llm.scores.clarity },
      { label: 'Pace', value: feedback.llm.scores.pace_consistency },
      { label: 'Confidence', value: feedback.llm.scores.confidence_language },
      { label: 'Structure', value: feedback.llm.scores.content_structure },
    ];
  }, [feedback]);

  const answerPaceState = useMemo(() => {
    const wordsPerMinute = answerFeedback?.metrics?.words_per_minute;
    if (typeof wordsPerMinute !== 'number') {
      return null;
    }

    const min = 110;
    const max = 170;
    const clamped = Math.min(Math.max((wordsPerMinute - min) / (max - min), 0), 1);

    if (answerFeedback?.metrics?.pace_label === 'fast') {
      return { color: '#d1652c', label: 'Fast pace', percent: clamped };
    }
    if (answerFeedback?.metrics?.pace_label === 'slow') {
      return { color: '#3577ba', label: 'Slow pace', percent: clamped };
    }
    return { color: '#17998a', label: 'Balanced pace', percent: clamped };
  }, [answerFeedback]);

  const answerLlmScoreCards = useMemo(() => {
    if (!answerFeedback?.llm?.scores) {
      return [];
    }

    return [
      { label: 'Clarity', value: answerFeedback.llm.scores.clarity },
      { label: 'Pace', value: answerFeedback.llm.scores.pace_consistency },
      { label: 'Confidence', value: answerFeedback.llm.scores.confidence_language },
      { label: 'Structure', value: answerFeedback.llm.scores.content_structure },
    ];
  }, [answerFeedback]);

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setVideoUri(asset.uri);
      setVideoName(asset.fileName ?? asset.uri.split('/').pop() ?? 'selected-video');
      setVideoDuration(asset.duration ? asset.duration / 1000 : null);
      setFeedback(null);
      setShowTranscript(false);
      resetFollowUpFlow();
    }
  };

  const recordVideo = async () => {
    if (Platform.OS === 'web') {
      if (recording) {
        mediaRecorderRef.current?.stop();
        setRecording(false);
        setRecordStart(null);
        return;
      }

      try {
        setVideoUri(null);
        setVideoDuration(null);
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;

        setRecording(true);
        setRecordStart(Date.now());

        const chunks: Blob[] = [];
        const options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp8,opus' };
        const recorder = new MediaRecorder(stream, options);

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          setVideoUri(url);
          setVideoName('recorded.webm');

          const probe = document.createElement('video');
          probe.preload = 'metadata';
          probe.src = url;
          probe.onloadedmetadata = () => {
          setVideoDuration(probe.duration);
          URL.revokeObjectURL(probe.src);
        };

        setFeedback(null);
        setShowTranscript(false);
        resetFollowUpFlow();
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
          if (previewRef.current) {
            previewRef.current.srcObject = null;
          }
          streamRef.current = null;
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
      } catch (error: any) {
        console.error('camera capture failed', error);
        Alert.alert('Camera error', error?.message || 'Could not access camera for recording.');
      }
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setVideoUri(asset.uri);
      setVideoName(asset.fileName ?? asset.uri.split('/').pop() ?? 'recorded-video');
      setVideoDuration(asset.duration ? asset.duration / 1000 : null);
      setFeedback(null);
      setShowTranscript(false);
      resetFollowUpFlow();
    }
  };

  const analyze = async () => {
    if (!videoUri) {
      Alert.alert('Pick a video first.');
      return;
    }

    resetFollowUpFlow();
    setBusy(true);

    try {
      const form = new FormData();

      if (Platform.OS === 'web') {
        const response = await fetch(videoUri);
        const blob = await response.blob();
        form.append('file', blob, 'practice.mp4');
      } else {
        form.append(
          'file',
          {
            uri: videoUri,
            name: 'practice.mp4',
            type: 'video/mp4',
          } as any,
        );
      }

      if (videoDuration != null && videoDuration > 0.5) {
        form.append('duration_seconds', videoDuration.toString());
      }

      const result = await fetch(`${BACKEND_URL}/analyze`, {
        method: 'POST',
        body: form,
      });

      if (!result.ok) {
        const text = await result.text();
        Alert.alert('Backend error', `Status ${result.status}\n\n${text}`);
        return;
      }

      const api = await result.json();
      setFeedback(mapAnalyzePayload(api));
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const generateFollowUpQuestion = async () => {
    if (!feedback) {
      Alert.alert('Run AI Coach first.');
      return;
    }

    setQuestionBusy(true);
    try {
      const response = await fetch(`${BACKEND_URL}/followup-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: feedback.transcript ?? '',
          summary_feedback: feedback.bullets ?? [feedback.summary],
          strengths: feedback.llm?.strengths ?? [],
          improvements:
            feedback.llm?.improvements?.map(
              (item) => `${item.title}: ${item.detail}`,
            ) ?? [],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        Alert.alert('Question generation failed', `Status ${response.status}\n\n${text}`);
        return;
      }

      const api = (await response.json()) as FollowUpQuestionResponse;
      const question = api.question?.trim();
      if (!question) {
        Alert.alert('Question generation failed', 'The AI did not return a valid question.');
        return;
      }

      setFollowUpQuestion(question);
      resetAnswerPractice();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not generate follow-up question');
    } finally {
      setQuestionBusy(false);
    }
  };

  const pickAnswerVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setAnswerVideoUri(asset.uri);
      setAnswerVideoName(asset.fileName ?? asset.uri.split('/').pop() ?? 'answer-video');
      setAnswerVideoDuration(asset.duration ? asset.duration / 1000 : null);
      setAnswerFeedback(null);
      setAnswerCorrectness(null);
      setAnswerShowTranscript(false);
    }
  };

  const recordAnswerVideo = async () => {
    if (Platform.OS === 'web') {
      if (answerRecording) {
        answerMediaRecorderRef.current?.stop();
        setAnswerRecording(false);
        setAnswerRecordStart(null);
        return;
      }

      try {
        setAnswerVideoUri(null);
        setAnswerVideoDuration(null);
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        answerStreamRef.current = stream;

        setAnswerRecording(true);
        setAnswerRecordStart(Date.now());

        const chunks: Blob[] = [];
        const options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp8,opus' };
        const recorder = new MediaRecorder(stream, options);

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          setAnswerVideoUri(url);
          setAnswerVideoName('followup-answer.webm');

          const probe = document.createElement('video');
          probe.preload = 'metadata';
          probe.src = url;
          probe.onloadedmetadata = () => {
            setAnswerVideoDuration(probe.duration);
            URL.revokeObjectURL(probe.src);
          };

          setAnswerFeedback(null);
          setAnswerCorrectness(null);
          setAnswerShowTranscript(false);
          stream.getTracks().forEach((track) => track.stop());
          answerMediaRecorderRef.current = null;
          if (answerPreviewRef.current) {
            answerPreviewRef.current.srcObject = null;
          }
          answerStreamRef.current = null;
        };

        answerMediaRecorderRef.current = recorder;
        recorder.start();
      } catch (error: any) {
        console.error('answer camera capture failed', error);
        Alert.alert('Camera error', error?.message || 'Could not access camera for answer recording.');
      }
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setAnswerVideoUri(asset.uri);
      setAnswerVideoName(asset.fileName ?? asset.uri.split('/').pop() ?? 'answer-recording');
      setAnswerVideoDuration(asset.duration ? asset.duration / 1000 : null);
      setAnswerFeedback(null);
      setAnswerCorrectness(null);
      setAnswerShowTranscript(false);
    }
  };

  const analyzeAnswer = async () => {
    if (!answerVideoUri) {
      Alert.alert('Upload or record an answer first.');
      return;
    }

    setAnswerBusy(true);
    try {
      const form = new FormData();

      if (Platform.OS === 'web') {
        const response = await fetch(answerVideoUri);
        const blob = await response.blob();
        form.append('file', blob, 'followup-answer.mp4');
      } else {
        form.append(
          'file',
          {
            uri: answerVideoUri,
            name: 'followup-answer.mp4',
            type: 'video/mp4',
          } as any,
        );
      }

      if (answerVideoDuration != null && answerVideoDuration > 0.5) {
        form.append('duration_seconds', answerVideoDuration.toString());
      }

      const result = await fetch(`${BACKEND_URL}/analyze`, {
        method: 'POST',
        body: form,
      });

      if (!result.ok) {
        const text = await result.text();
        Alert.alert('Backend error', `Status ${result.status}\n\n${text}`);
        return;
      }

      const api = await result.json();
      const mappedAnswer = mapAnalyzePayload(api);
      setAnswerFeedback(mappedAnswer);
      setAnswerCorrectness(null);

      if (followUpQuestion && mappedAnswer.transcript?.trim()) {
        const correctnessResponse = await fetch(`${BACKEND_URL}/evaluate-followup-answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: followUpQuestion,
            answer_transcript: mappedAnswer.transcript,
            presentation_transcript: feedback?.transcript ?? '',
            presentation_summary_feedback: feedback?.bullets ?? [feedback?.summary ?? ''],
            presentation_strengths: feedback?.llm?.strengths ?? [],
            presentation_improvements:
              feedback?.llm?.improvements?.map(
                (item) => `${item.title}: ${item.detail}`,
              ) ?? [],
          }),
        });

        if (!correctnessResponse.ok) {
          const text = await correctnessResponse.text();
          Alert.alert('Correctness check failed', `Status ${correctnessResponse.status}\n\n${text}`);
        } else {
          const correctnessApi =
            (await correctnessResponse.json()) as FollowUpAnswerEvalResponse;
          setAnswerCorrectness(correctnessApi);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not analyze follow-up answer');
    } finally {
      setAnswerBusy(false);
    }
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#f4e6d8', dark: '#251a12' }}
      headerImage={
        <LinearGradient colors={['#ffba62', '#f0814f', '#2ab4a3']} style={styles.hero}>
          <View style={styles.heroOrbOne} />
          <View style={styles.heroOrbTwo} />
          <View style={styles.heroPill}>
            <Ionicons name="sparkles-outline" size={14} color="#fff6e8" />
            <ThemedText style={styles.heroPillText}>SpeakSmart Coach</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>Practice with sharper feedback</ThemedText>
          <ThemedText style={styles.heroSubtitle}>
            Upload or record your presentation and get timestamped coaching in under a minute.
          </ThemedText>
          <View style={styles.heroStepsRow}>
            <View style={styles.heroStepItem}>
              <Ionicons name="videocam-outline" size={14} color="#fff9f0" />
              <ThemedText style={styles.heroStepText}>Capture</ThemedText>
            </View>
            <View style={styles.heroStepItem}>
              <Ionicons name="analytics-outline" size={14} color="#fff9f0" />
              <ThemedText style={styles.heroStepText}>Analyze</ThemedText>
            </View>
            <View style={styles.heroStepItem}>
              <Ionicons name="trending-up-outline" size={14} color="#fff9f0" />
              <ThemedText style={styles.heroStepText}>Improve</ThemedText>
            </View>
          </View>
        </LinearGradient>
      }>
      <ThemedView style={styles.page} lightColor={palette.lightCanvas} darkColor={palette.darkCanvas}>
        <Animated.View entering={FadeInDown.duration(420).springify().damping(18)}>
          <ThemedView style={styles.card} lightColor={palette.lightCard} darkColor={palette.darkCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLabel}>
                <Ionicons name="film-outline" size={18} color={palette.accentDeep} />
                <ThemedText style={styles.cardHeaderText}>Your Practice Clip</ThemedText>
              </View>
              {videoUri ? (
                <View style={styles.statusBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#fef5ea" />
                  <ThemedText style={styles.statusBadgeText}>Ready</ThemedText>
                </View>
              ) : (
                <View style={[styles.statusBadge, styles.statusBadgeMuted]}>
                  <ThemedText style={styles.statusBadgeTextMuted}>Waiting for video</ThemedText>
                </View>
              )}
            </View>

            {!!videoUri && (
              <View style={styles.clipBlock}>
                <View style={styles.videoWrap}>
                  <VideoView
                    style={styles.video}
                    player={player}
                    allowsFullscreen
                    allowsPictureInPicture
                    nativeControls
                  />
                </View>
                <View style={[styles.fileMetaRow, isDark && styles.fileMetaRowDark]}>
                  <Ionicons name="document-text-outline" size={16} color={palette.accentDeep} />
                  <ThemedText numberOfLines={1} style={styles.fileNameText}>
                    {videoName}
                  </ThemedText>
                  {!!videoDuration && (
                    <ThemedText style={styles.fileDurationText}>{formatSeconds(videoDuration)}</ThemedText>
                  )}
                </View>
              </View>
            )}

            {Platform.OS === 'web' && recording && (
              <View style={styles.recordingBlock}>
                <video
                  ref={previewRef as any}
                  style={styles.webPreview as any}
                  autoPlay
                  playsInline
                  muted
                />
                <View style={styles.recordingPill}>
                  <View style={styles.liveDot} />
                  <ThemedText style={styles.recordingPillText}>
                    Recording {formatSeconds(recordElapsedSeconds)}
                  </ThemedText>
                </View>
              </View>
            )}

            <View style={styles.buttonGrid}>
              <ActionButton
                label={videoUri ? 'Replace Clip' : 'Upload Clip'}
                icon="cloud-upload-outline"
                onPress={pickVideo}
                disabled={Platform.OS === 'web' && (recording || answerRecording)}
                tone="neutral"
              />
              <ActionButton
                label={
                  Platform.OS === 'web' && recording
                    ? 'Stop Capture'
                    : videoUri
                    ? 'Record Again'
                    : 'Record Clip'
                }
                icon={Platform.OS === 'web' && recording ? 'stop-circle-outline' : 'videocam-outline'}
                onPress={recordVideo}
                disabled={Platform.OS === 'web' && answerRecording}
                tone={Platform.OS === 'web' && recording ? 'secondary' : 'primary'}
              />
            </View>

            <ActionButton
              label={busy ? 'Analyzing...' : 'Run AI Coach'}
              icon={busy ? 'hourglass-outline' : 'sparkles-outline'}
              onPress={analyze}
              disabled={!videoUri || busy || questionBusy || answerBusy}
              tone="secondary"
            />
          </ThemedView>
        </Animated.View>

        {!!feedback && (
          <Animated.View entering={FadeInDown.duration(520).delay(80).springify().damping(17)}>
            <ThemedView style={styles.card} lightColor={palette.lightCard} darkColor={palette.darkCard}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLabel}>
                  <Ionicons name="chatbubbles-outline" size={18} color={palette.mint} />
                  <ThemedText style={styles.cardHeaderText}>Coach Report</ThemedText>
                </View>
                {!!feedback.llm?.feedbackEvents?.length && (
                  <View style={styles.eventPill}>
                    <ThemedText style={styles.eventPillText}>
                      {feedback.llm.feedbackEvents.length} insight
                      {feedback.llm.feedbackEvents.length === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                )}
              </View>

              <View style={[styles.summaryPanel, isDark && styles.summaryPanelDark]}>
                <ThemedText style={styles.summaryText}>{feedback.summary}</ThemedText>
              </View>

              {!!paceState && typeof feedback.metrics?.words_per_minute === 'number' && (
                <View style={styles.pacePanel}>
                  <View style={styles.paceHeaderRow}>
                    <ThemedText style={styles.paceLabel}>Delivery pace</ThemedText>
                    <ThemedText style={[styles.paceValue, { color: paceState.color }]}>
                      {Math.round(feedback.metrics.words_per_minute)} wpm ({paceState.label})
                    </ThemedText>
                  </View>
                  <View style={styles.paceBarContainer}>
                    <View style={[styles.paceBarFill, { width: `${paceState.percent * 100}%`, backgroundColor: paceState.color }]} />
                  </View>
                </View>
              )}

              {!!llmScoreCards.length && (
                <View style={styles.scoreGrid}>
                  {llmScoreCards.map((score) => (
                    <View key={score.label} style={[styles.scoreCard, isDark && styles.scoreCardDark]}>
                      <ThemedText style={styles.scoreValue}>{score.value}/10</ThemedText>
                      <ThemedText style={styles.scoreLabel}>{score.label}</ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {!!feedback.bullets?.length && (
                <View style={styles.listSection}>
                  <ThemedText style={styles.sectionTitle}>Summary bullets</ThemedText>
                  {feedback.bullets.map((bullet, index) => (
                    <View key={`${bullet}-${index}`} style={styles.listItem}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={palette.mint} />
                      <ThemedText style={styles.listItemText}>{bullet}</ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {!!feedback.llm?.improvements?.length && (
                <View style={styles.listSection}>
                  <ThemedText style={styles.sectionTitle}>Focus next</ThemedText>
                  {feedback.llm.improvements.map((improvement, index) => (
                    <View key={`${improvement.title}-${index}`} style={styles.listItem}>
                      <Ionicons name="alert-circle-outline" size={16} color={palette.accent} />
                      <ThemedText style={styles.listItemText}>
                        {improvement.title}: {improvement.detail}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {!!feedback.markers?.length && (
                <View style={[styles.annotatedPanel, isDark && styles.annotatedPanelDark]}>
                  <View style={styles.annotatedHeaderRow}>
                    <ThemedText style={styles.sectionTitle}>Annotated moments</ThemedText>
                    <ThemedText style={styles.annotatedCount}>
                      {feedback.markers.length} marker{feedback.markers.length === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  {feedback.markers.slice(0, 8).map((marker, index) => (
                    <View key={`${marker.time_sec}-${index}`} style={styles.annotatedRow}>
                      <ThemedText style={styles.annotatedTime}>
                        {formatSeconds(marker.time_sec)}
                      </ThemedText>
                      <View style={styles.annotatedBody}>
                        <ThemedText style={styles.annotatedLabel}>{marker.label}</ThemedText>
                        {!!marker.detail && (
                          <ThemedText style={styles.annotatedDetail}>{marker.detail}</ThemedText>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {!!feedback.transcript && (
                <View style={[styles.transcriptPanel, isDark && styles.transcriptPanelDark]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Toggle transcript"
                    onPress={() => setShowTranscript((previous) => !previous)}
                    style={({ pressed }) => [styles.transcriptToggle, pressed && styles.buttonPressed]}>
                    <ThemedText style={styles.sectionTitle}>Transcript</ThemedText>
                    <Ionicons
                      name={showTranscript ? 'chevron-up-outline' : 'chevron-down-outline'}
                      size={18}
                      color={palette.accentDeep}
                    />
                  </Pressable>
                  {showTranscript && <ThemedText style={styles.transcriptText}>{feedback.transcript}</ThemedText>}
                </View>
              )}

              <ActionButton
                label={
                  questionBusy
                    ? 'Generating question...'
                    : followUpQuestion
                    ? 'Regenerate Follow-up Question'
                    : 'Get Follow-up Question'
                }
                icon={questionBusy ? 'hourglass-outline' : 'help-circle-outline'}
                onPress={generateFollowUpQuestion}
                disabled={questionBusy || busy}
                tone="primary"
              />

              {!!followUpQuestion && (
                <View style={[styles.followUpPanel, isDark && styles.followUpPanelDark]}>
                  <View style={styles.followUpHeader}>
                    <Ionicons name="help-buoy-outline" size={16} color={palette.accentDeep} />
                    <ThemedText style={styles.sectionTitle}>AI follow-up prompt</ThemedText>
                  </View>
                  <View style={[styles.questionBubble, isDark && styles.questionBubbleDark]}>
                    <ThemedText style={styles.questionText}>{followUpQuestion}</ThemedText>
                  </View>

                  {!!answerVideoUri && (
                    <View style={styles.clipBlock}>
                      <View style={styles.videoWrap}>
                        <VideoView
                          style={styles.video}
                          player={answerPlayer}
                          allowsFullscreen
                          allowsPictureInPicture
                          nativeControls
                        />
                      </View>
                      <View style={[styles.fileMetaRow, isDark && styles.fileMetaRowDark]}>
                        <Ionicons name="chatbox-ellipses-outline" size={16} color={palette.accentDeep} />
                        <ThemedText numberOfLines={1} style={styles.fileNameText}>
                          {answerVideoName}
                        </ThemedText>
                        {!!answerVideoDuration && (
                          <ThemedText style={styles.fileDurationText}>
                            {formatSeconds(answerVideoDuration)}
                          </ThemedText>
                        )}
                      </View>
                    </View>
                  )}

                  {Platform.OS === 'web' && answerRecording && (
                    <View style={styles.recordingBlock}>
                      <video
                        ref={answerPreviewRef as any}
                        style={styles.webPreview as any}
                        autoPlay
                        playsInline
                        muted
                      />
                      <View style={styles.recordingPill}>
                        <View style={styles.liveDot} />
                        <ThemedText style={styles.recordingPillText}>
                          Recording answer {formatSeconds(answerRecordElapsedSeconds)}
                        </ThemedText>
                      </View>
                    </View>
                  )}

                  <View style={styles.buttonGrid}>
                    <ActionButton
                      label={answerVideoUri ? 'Replace Answer Video' : 'Upload Answer Video'}
                      icon="cloud-upload-outline"
                      onPress={pickAnswerVideo}
                      disabled={Platform.OS === 'web' && (recording || answerRecording)}
                      tone="neutral"
                    />
                    <ActionButton
                      label={
                        Platform.OS === 'web' && answerRecording
                          ? 'Stop Answer Recording'
                          : answerVideoUri
                          ? 'Record Answer Again'
                          : 'Record Answer'
                      }
                      icon={
                        Platform.OS === 'web' && answerRecording
                          ? 'stop-circle-outline'
                          : 'videocam-outline'
                      }
                      onPress={recordAnswerVideo}
                      disabled={Platform.OS === 'web' && recording}
                      tone={Platform.OS === 'web' && answerRecording ? 'secondary' : 'primary'}
                    />
                  </View>

                  <ActionButton
                    label={answerBusy ? 'Analyzing Answer...' : 'Analyze Answer'}
                    icon={answerBusy ? 'hourglass-outline' : 'sparkles-outline'}
                    onPress={analyzeAnswer}
                    disabled={!answerVideoUri || answerBusy || recording || busy}
                    tone="secondary"
                  />

                  {!!answerFeedback && (
                    <View style={styles.answerFeedbackPanel}>
                      <ThemedText style={styles.sectionTitle}>Answer feedback</ThemedText>
                      <View style={[styles.summaryPanel, isDark && styles.summaryPanelDark]}>
                        <ThemedText style={styles.summaryText}>{answerFeedback.summary}</ThemedText>
                      </View>

                      {!!answerCorrectness &&
                        (() => {
                          const badge = getCorrectnessBadge(answerCorrectness.verdict);
                          return (
                            <View style={[styles.correctnessPanel, isDark && styles.correctnessPanelDark]}>
                              <View style={styles.correctnessHeaderRow}>
                                <ThemedText style={styles.sectionTitle}>
                                  Correctness check
                                </ThemedText>
                                <View
                                  style={[
                                    styles.correctnessBadge,
                                    { backgroundColor: badge.backgroundColor },
                                  ]}>
                                  <ThemedText
                                    style={[
                                      styles.correctnessBadgeText,
                                      { color: badge.textColor },
                                    ]}>
                                    {badge.label}
                                  </ThemedText>
                                </View>
                              </View>
                              <ThemedText style={styles.correctnessScore}>
                                Score: {answerCorrectness.correctness_score}/100
                              </ThemedText>
                              <ThemedText style={styles.correctnessReason}>
                                {answerCorrectness.reason}
                              </ThemedText>

                              {!!answerCorrectness.missing_points?.length && (
                                <View style={styles.listSection}>
                                  <ThemedText style={styles.correctnessSubTitle}>
                                    Missing points
                                  </ThemedText>
                                  {answerCorrectness.missing_points
                                    .slice(0, 3)
                                    .map((point, index) => (
                                      <View
                                        key={`missing-point-${index}`}
                                        style={styles.listItem}>
                                        <Ionicons
                                          name="ellipse-outline"
                                          size={14}
                                          color={palette.accentDeep}
                                        />
                                        <ThemedText style={styles.listItemText}>
                                          {point}
                                        </ThemedText>
                                      </View>
                                    ))}
                                </View>
                              )}

                              {!!answerCorrectness.suggested_improvement && (
                                <View style={[styles.correctnessTipBox, isDark && styles.correctnessTipBoxDark]}>
                                  <ThemedText style={styles.correctnessSubTitle}>
                                    Improve this answer
                                  </ThemedText>
                                  <ThemedText style={styles.correctnessTipText}>
                                    {answerCorrectness.suggested_improvement}
                                  </ThemedText>
                                </View>
                              )}
                            </View>
                          );
                        })()}

                      {!!answerPaceState &&
                        typeof answerFeedback.metrics?.words_per_minute === 'number' && (
                          <View style={styles.pacePanel}>
                            <View style={styles.paceHeaderRow}>
                              <ThemedText style={styles.paceLabel}>Answer pace</ThemedText>
                              <ThemedText
                                style={[styles.paceValue, { color: answerPaceState.color }]}>
                                {Math.round(answerFeedback.metrics.words_per_minute)} wpm (
                                {answerPaceState.label})
                              </ThemedText>
                            </View>
                            <View style={styles.paceBarContainer}>
                              <View
                                style={[
                                  styles.paceBarFill,
                                  {
                                    width: `${answerPaceState.percent * 100}%`,
                                    backgroundColor: answerPaceState.color,
                                  },
                                ]}
                              />
                            </View>
                          </View>
                        )}

                      {!!answerLlmScoreCards.length && (
                        <View style={styles.scoreGrid}>
                          {answerLlmScoreCards.map((score) => (
                            <View
                              key={`answer-${score.label}`}
                              style={[styles.scoreCard, isDark && styles.scoreCardDark]}>
                              <ThemedText style={styles.scoreValue}>{score.value}/10</ThemedText>
                              <ThemedText style={styles.scoreLabel}>{score.label}</ThemedText>
                            </View>
                          ))}
                        </View>
                      )}

                      {!!answerFeedback.bullets?.length && (
                        <View style={styles.listSection}>
                          {answerFeedback.bullets.map((bullet, index) => (
                            <View key={`answer-bullet-${index}`} style={styles.listItem}>
                              <Ionicons
                                name="checkmark-circle-outline"
                                size={16}
                                color={palette.mint}
                              />
                              <ThemedText style={styles.listItemText}>{bullet}</ThemedText>
                            </View>
                          ))}
                        </View>
                      )}

                      {!!answerFeedback.transcript && (
                        <View style={[styles.transcriptPanel, isDark && styles.transcriptPanelDark]}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Toggle answer transcript"
                            onPress={() => setAnswerShowTranscript((previous) => !previous)}
                            style={({ pressed }) => [
                              styles.transcriptToggle,
                              pressed && styles.buttonPressed,
                            ]}>
                            <ThemedText style={styles.sectionTitle}>Answer transcript</ThemedText>
                            <Ionicons
                              name={
                                answerShowTranscript
                                  ? 'chevron-up-outline'
                                  : 'chevron-down-outline'
                              }
                              size={18}
                              color={palette.accentDeep}
                            />
                          </Pressable>
                          {answerShowTranscript && (
                            <ThemedText style={styles.transcriptText}>
                              {answerFeedback.transcript}
                            </ThemedText>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </ThemedView>
          </Animated.View>
        )}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  heroOrbOne: {
    position: 'absolute',
    top: -32,
    right: -24,
    width: 120,
    height: 120,
    borderRadius: 80,
    backgroundColor: 'rgba(255, 248, 233, 0.22)',
  },
  heroOrbTwo: {
    position: 'absolute',
    bottom: 16,
    left: -30,
    width: 120,
    height: 120,
    borderRadius: 70,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  heroPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.16)',
  },
  heroPillText: {
    color: '#fff6e8',
    fontSize: 12,
    letterSpacing: 0.5,
    fontFamily: Fonts.rounded,
  },
  heroTitle: {
    color: '#fffaf2',
    fontFamily: Fonts.rounded,
    fontSize: 30,
    lineHeight: 34,
    maxWidth: 420,
  },
  heroSubtitle: {
    color: 'rgba(255, 251, 243, 0.92)',
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 560,
  },
  heroStepsRow: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroStepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.16)',
  },
  heroStepText: {
    color: '#fff7ee',
    fontFamily: Fonts.rounded,
    fontSize: 12,
    lineHeight: 14,
  },
  page: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingBottom: 30,
    gap: 16,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.borderLight,
    padding: 18,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#2f2219',
        shadowOpacity: 0.15,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardHeaderLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderText: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: palette.mint,
  },
  statusBadgeMuted: {
    backgroundColor: 'rgba(47, 34, 25, 0.1)',
  },
  statusBadgeText: {
    color: '#fff7eb',
    fontFamily: Fonts.rounded,
    fontSize: 12,
    lineHeight: 14,
  },
  statusBadgeTextMuted: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    lineHeight: 14,
  },
  clipBlock: {
    gap: 10,
  },
  videoWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#1f1813',
  },
  video: {
    width: '100%',
    height: 250,
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(47, 34, 25, 0.08)',
  },
  fileMetaRowDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  fileNameText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  fileDurationText: {
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
  recordingBlock: {
    gap: 8,
  },
  webPreview: {
    width: '100%',
    height: 230,
    borderRadius: 14,
    objectFit: 'cover',
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#1f1813',
  },
  recordingPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fff1e0',
  },
  recordingPillText: {
    color: palette.accentDeep,
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: '#ef4e35',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 46,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
    flexGrow: 1,
  },
  secondaryButton: {
    backgroundColor: palette.mint,
    borderColor: palette.mint,
  },
  neutralButton: {
    backgroundColor: 'transparent',
    borderColor: palette.borderLight,
    flexGrow: 1,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    lineHeight: 16,
  },
  buttonIcon: {
    marginTop: 1,
  },
  primaryButtonText: {
    color: '#fff6e9',
  },
  secondaryButtonText: {
    color: '#edfff9',
  },
  neutralButtonText: {
    color: palette.accentDeep,
  },
  eventPill: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#dff5f2',
  },
  eventPillText: {
    color: '#1d6c63',
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  summaryPanel: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  summaryPanelDark: {
    backgroundColor: 'rgba(14, 11, 8, 0.62)',
    borderColor: 'rgba(255, 214, 168, 0.3)',
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
  },
  pacePanel: {
    gap: 8,
  },
  paceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  paceLabel: {
    fontFamily: Fonts.rounded,
  },
  paceValue: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
  },
  paceBarContainer: {
    width: '100%',
    height: 12,
    borderRadius: 99,
    overflow: 'hidden',
    backgroundColor: 'rgba(47, 34, 25, 0.12)',
  },
  paceBarFill: {
    height: '100%',
    borderRadius: 99,
  },
  scoreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scoreCard: {
    minWidth: 110,
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  scoreCardDark: {
    backgroundColor: 'rgba(14, 11, 8, 0.66)',
    borderColor: 'rgba(255, 214, 168, 0.3)',
  },
  scoreValue: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    color: palette.accentDeep,
    lineHeight: 24,
  },
  scoreLabel: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.78,
  },
  listSection: {
    gap: 7,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    lineHeight: 20,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listItemText: {
    flex: 1,
    lineHeight: 20,
  },
  annotatedPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 9,
  },
  annotatedPanelDark: {
    backgroundColor: 'rgba(14, 11, 8, 0.58)',
    borderColor: 'rgba(255, 214, 168, 0.3)',
  },
  annotatedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  annotatedCount: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    opacity: 0.7,
  },
  annotatedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  annotatedTime: {
    minWidth: 40,
    fontFamily: Fonts.rounded,
    fontSize: 12,
    lineHeight: 17,
    color: palette.accent,
    marginTop: 1,
  },
  annotatedBody: {
    flex: 1,
    gap: 2,
  },
  annotatedLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 13,
    lineHeight: 17,
    textTransform: 'capitalize',
  },
  annotatedDetail: {
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.92,
  },
  followUpPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  followUpPanelDark: {
    backgroundColor: 'rgba(14, 11, 8, 0.54)',
    borderColor: 'rgba(255, 214, 168, 0.3)',
  },
  followUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  questionBubble: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  questionBubbleDark: {
    backgroundColor: 'rgba(16, 12, 9, 0.72)',
    borderColor: 'rgba(255, 214, 168, 0.34)',
  },
  questionText: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    lineHeight: 20,
  },
  answerFeedbackPanel: {
    gap: 10,
  },
  correctnessPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  correctnessPanelDark: {
    backgroundColor: 'rgba(16, 12, 9, 0.72)',
    borderColor: 'rgba(255, 214, 168, 0.34)',
  },
  correctnessHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  correctnessBadge: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  correctnessBadgeText: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    lineHeight: 14,
  },
  correctnessScore: {
    fontFamily: Fonts.rounded,
    fontSize: 13,
    opacity: 0.88,
  },
  correctnessReason: {
    fontSize: 14,
    lineHeight: 21,
  },
  correctnessSubTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    lineHeight: 18,
  },
  correctnessTipBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.66)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4,
  },
  correctnessTipBoxDark: {
    backgroundColor: 'rgba(21, 16, 12, 0.74)',
    borderColor: 'rgba(255, 214, 168, 0.34)',
  },
  correctnessTipText: {
    fontSize: 14,
    lineHeight: 20,
  },
  transcriptPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
    overflow: 'hidden',
  },
  transcriptPanelDark: {
    backgroundColor: 'rgba(16, 12, 9, 0.7)',
    borderColor: 'rgba(255, 214, 168, 0.32)',
  },
  transcriptToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  transcriptText: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    fontSize: 14,
    lineHeight: 21,
  },
});
