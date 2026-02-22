import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
  FadeInDown,
  FadeInRight,
  FadeOutRight,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { deleteSession, fetchSessions } from '@/lib/database';

const palette = {
  accent: '#39c8cf',
  accentDeep: '#1c8fa3',
  mint: '#2ac0a8',
  lightCanvas: '#141d3f',
  darkCanvas: '#141d3f',
  lightCard: '#1b2550',
  darkCard: '#1b2550',
  borderLight: 'rgba(108, 143, 208, 0.36)',
  borderDark: 'rgba(108, 143, 208, 0.36)',
};

const PRESET_COLORS: Record<string, string> = {
  general: '#8a7560',
  pitch: '#d1652c',
  classroom: '#17998a',
  interview: '#3577ba',
  keynote: '#9b5f1f',
};

const SCORE_COLORS = {
  clarity: '#17998a',
  confidence: '#d1652c',
  structure: '#3577ba',
};

// ── Analytics constants ───────────────────────────────────────────────────────

type MetricType = 'scores' | 'pace' | 'filler' | 'nonverbal';
type PresetFilter = 'all' | 'general' | 'pitch' | 'classroom' | 'interview' | 'keynote';

const PRESET_OPTIONS: PresetFilter[] = ['all', 'general', 'pitch', 'classroom', 'interview', 'keynote'];

const PERIOD_OPTIONS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
];

const METRIC_TABS: { key: MetricType; label: string }[] = [
  { key: 'scores', label: 'Scores' },
  { key: 'pace', label: 'Pace' },
  { key: 'filler', label: 'Filler' },
  { key: 'nonverbal', label: 'Non-verbal' },
];

const NON_VERBAL_COLORS = {
  gesture_energy: '#9b5f1f',
  eye_contact_score: '#3577ba',
  posture_stability: '#17998a',
};

// ── Series config ─────────────────────────────────────────────────────────────

type AnnotatedMarker = {
  time_sec: number;
  label: string;
  detail?: string | null;
};

type AnnotatedVideoMeta = {
  source_uri: string;
  source_name?: string | null;
  markers: AnnotatedMarker[];
};

type AnalysisSnapshot = {
  summary?: string | null;
  summary_feedback?: string[] | null;
  bullets?: string[] | null;
  markers?: AnnotatedMarker[] | null;
  notes?: string[] | null;
  transcript?: string | null;
  personalized_content_plan?: {
    topic_summary?: string | null;
    audience_takeaway?: string | null;
    improvements?: Array<{
      title?: string | null;
      content_issue?: string | null;
      specific_fix?: string | null;
      example_revision?: string | null;
    }> | null;
  } | null;
  source_video?: {
    uri?: string | null;
    name?: string | null;
  } | null;
};

function formatSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mm = Math.floor(safe / 60);
  const ss = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}

type Session = {
  id: string;
  created_at: string;
  preset: string;
  wpm: number | null;
  pace_label: string | null;
  filler_count: number | null;
  duration_s: number | null;
  scores: Record<string, number> | null;
  strengths: string[] | null;
  improvements: { title: string; detail: string }[] | null;
  transcript: string | null;
  non_verbal: Record<string, any> | null;
};

function getAnnotatedVideoMeta(session: Session): AnnotatedVideoMeta | null {
  const raw = session.non_verbal?.annotated_video;
  const snapshot = getAnalysisSnapshot(session);
  const sourceUri =
    typeof raw?.source_uri === 'string' && raw.source_uri.trim()
      ? raw.source_uri
      : typeof snapshot?.source_video?.uri === 'string' && snapshot.source_video.uri.trim()
      ? snapshot.source_video.uri
      : null;
  const rawMarkers = Array.isArray(raw?.markers)
    ? raw.markers
    : Array.isArray(snapshot?.markers)
    ? snapshot?.markers
    : null;
  if (!sourceUri) return null;
  if (!Array.isArray(rawMarkers) || rawMarkers.length === 0) return null;

  const parsedMarkers: Array<AnnotatedMarker | null> = rawMarkers.map((marker: any) => {
      const time = Number(marker?.time_sec);
      if (!Number.isFinite(time)) return null;
      return {
        time_sec: time,
        label: typeof marker?.label === 'string' ? marker.label : 'moment',
        detail: typeof marker?.detail === 'string' ? marker.detail : null,
      };
    });

  const markers: AnnotatedMarker[] = parsedMarkers.filter(
    (marker): marker is AnnotatedMarker => marker !== null,
  );
  markers.sort((a, b) => a.time_sec - b.time_sec);

  if (!markers.length) return null;

  return {
    source_uri: sourceUri,
    source_name:
      typeof raw?.source_name === 'string'
        ? raw.source_name
        : typeof snapshot?.source_video?.name === 'string'
        ? snapshot.source_video.name
        : null,
    markers,
  };
}

function getAnalysisSnapshot(session: Session): AnalysisSnapshot | null {
  const raw = session.non_verbal?.analysis_snapshot;
  if (!raw || typeof raw !== 'object') return null;
  return raw as AnalysisSnapshot;
}

type SeriesConfig = {
  key: string;
  label: string;
  color: string;
  getValue: (s: Session) => number;
  minVal: number;
  maxVal: number;
  unit: string;
  lowerIsBetter?: boolean;
};

type ReferenceLine = { value: number; color: string; label?: string };

const SERIES_BY_METRIC: Record<MetricType, SeriesConfig[]> = {
  scores: [
    { key: 'clarity',    label: 'Clarity',    color: SCORE_COLORS.clarity,    getValue: (s) => s.scores?.clarity ?? 0,               minVal: 0, maxVal: 10, unit: '/10' },
    { key: 'confidence', label: 'Confidence', color: SCORE_COLORS.confidence, getValue: (s) => s.scores?.confidence_language ?? 0,   minVal: 0, maxVal: 10, unit: '/10' },
    { key: 'structure',  label: 'Structure',  color: SCORE_COLORS.structure,  getValue: (s) => s.scores?.content_structure ?? 0,     minVal: 0, maxVal: 10, unit: '/10' },
  ],
  pace: [
    { key: 'wpm', label: 'WPM', color: '#17998a', getValue: (s) => s.wpm ?? 0, minVal: 0, maxVal: 240, unit: ' WPM' },
  ],
  filler: [
    {
      key: 'density', label: 'Fillers/min', color: '#d1652c',
      getValue: (s) => {
        const mins = s.duration_s != null && s.duration_s > 0 ? s.duration_s / 60 : null;
        return mins != null ? (s.filler_count ?? 0) / mins : (s.filler_count ?? 0);
      },
      minVal: 0, maxVal: 15, unit: '/min', lowerIsBetter: true,
    },
  ],
  nonverbal: [
    { key: 'gesture_energy',    label: 'Gesture',     color: NON_VERBAL_COLORS.gesture_energy,    getValue: (s) => s.non_verbal?.gesture_energy ?? 0,    minVal: 0, maxVal: 10, unit: '/10' },
    { key: 'eye_contact_score', label: 'Eye contact', color: NON_VERBAL_COLORS.eye_contact_score, getValue: (s) => s.non_verbal?.eye_contact_score ?? 0, minVal: 0, maxVal: 10, unit: '/10' },
    { key: 'posture_stability', label: 'Posture',     color: NON_VERBAL_COLORS.posture_stability, getValue: (s) => s.non_verbal?.posture_stability ?? 0, minVal: 0, maxVal: 10, unit: '/10' },
  ],
};

const REFERENCE_LINES: Record<MetricType, ReferenceLine[]> = {
  scores:    [{ value: 7,   color: 'rgba(23,153,138,0.3)' }],
  pace:      [{ value: 120, color: 'rgba(23,153,138,0.35)', label: '120' }, { value: 180, color: 'rgba(23,153,138,0.35)', label: '180' }],
  filler:    [{ value: 2,   color: 'rgba(23,153,138,0.35)', label: '2' },   { value: 5,   color: 'rgba(245,166,35,0.35)', label: '5' }],
  nonverbal: [{ value: 7,   color: 'rgba(23,153,138,0.3)' }],
};

const DEFAULT_ACTIVE_LINES: Record<MetricType, string[]> = {
  scores:    ['clarity', 'confidence', 'structure'],
  pace:      ['wpm'],
  filler:    ['density'],
  nonverbal: ['gesture_energy', 'eye_contact_score', 'posture_stability'],
};

// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  presetFilter, onPresetChange,
  periodFilter, onPeriodChange,
  isDark,
}: {
  presetFilter: PresetFilter;
  onPresetChange: (p: PresetFilter) => void;
  periodFilter: number;
  onPeriodChange: (days: number) => void;
  isDark: boolean;
}) {
  return (
    <View style={filterStyles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterStyles.pillRow}>
        {PRESET_OPTIONS.map((p) => {
          const isActive = presetFilter === p;
          const color = p === 'all' ? palette.accent : (PRESET_COLORS[p] ?? palette.accent);
          return (
            <Pressable key={p} onPress={() => onPresetChange(p)}
              style={[filterStyles.pill, isDark && filterStyles.pillDark, isActive && { backgroundColor: color, borderColor: color }]}>
              <ThemedText style={[filterStyles.pillText, isActive && filterStyles.pillTextActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={filterStyles.pillRow}>
        {PERIOD_OPTIONS.map(({ label, days }) => {
          const isActive = periodFilter === days;
          return (
            <Pressable key={label} onPress={() => onPeriodChange(days)}
              style={[filterStyles.pill, isDark && filterStyles.pillDark, isActive && { backgroundColor: palette.accent, borderColor: palette.accent }]}>
              <ThemedText style={[filterStyles.pillText, isActive && filterStyles.pillTextActive]}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Metric tabs ───────────────────────────────────────────────────────────────

function MetricTabs({ active, onChange, isDark }: { active: MetricType; onChange: (m: MetricType) => void; isDark: boolean }) {
  return (
    <View style={[filterStyles.tabRow, isDark && filterStyles.tabRowDark]}>
      {METRIC_TABS.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <Pressable key={key} onPress={() => onChange(key)} style={[filterStyles.tab, isActive && filterStyles.tabActive]}>
            <ThemedText style={[filterStyles.tabText, isActive && filterStyles.tabTextActive]}>{label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Line chart ────────────────────────────────────────────────────────────────

const CHART_H = 160;
const PAD = { top: 8, bottom: 30, left: 28, right: 4 };

function LineChart({
  sessions,
  allSeries,
  activeKeys,
  referenceLines,
  isDark,
}: {
  sessions: Session[];
  allSeries: SeriesConfig[];
  activeKeys: string[];
  referenceLines: ReferenceLine[];
  isDark: boolean;
}) {
  const [containerW, setContainerW] = useState(0);

  if (sessions.length < 1 || containerW === 0) {
    return (
      <View
        style={{ height: CHART_H }}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      />
    );
  }

  const cW = containerW - PAD.left - PAD.right;
  const cH = CHART_H - PAD.top - PAD.bottom;
  const n = sessions.length;

  // Use the scale from the first series (all series in a tab share the same scale)
  const { minVal, maxVal } = allSeries[0];

  const getX = (i: number) => (n <= 1 ? cW / 2 : (i / (n - 1)) * cW);
  const getY = (val: number) => cH - Math.max(0, Math.min((val - minVal) / (maxVal - minVal), 1)) * cH;

  // Y-axis grid ticks: 4 evenly spaced
  const ticks = [0, 0.33, 0.67, 1].map((pct) => minVal + pct * (maxVal - minVal));

  const activeSeries = allSeries.filter((s) => activeKeys.includes(s.key));
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const cardBg = isDark ? palette.darkCard : palette.lightCard;

  return (
    <View
      style={{ height: CHART_H, position: 'relative' }}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>

      {/* Y-axis tick labels */}
      {ticks.map((val, i) => (
        <ThemedText
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            top: PAD.top + getY(val) - 7,
            width: PAD.left - 5,
            fontSize: 9,
            textAlign: 'right',
            opacity: 0.45,
            fontFamily: Fonts.rounded,
          }}>
          {Math.round(val)}
        </ThemedText>
      ))}

      {/* Chart area */}
      <View
        style={{
          position: 'absolute',
          left: PAD.left,
          top: PAD.top,
          width: cW,
          height: cH,
        }}>

        {/* Horizontal grid lines */}
        {ticks.map((val, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: getY(val),
              height: 1,
              backgroundColor: gridColor,
            }}
          />
        ))}

        {/* Reference lines (e.g. good WPM zone) */}
        {referenceLines.map((ref, i) => {
          if (ref.value < minVal || ref.value > maxVal) return null;
          return (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: getY(ref.value), height: 1.5, backgroundColor: ref.color }}>
              {ref.label != null && (
                <ThemedText style={{ position: 'absolute', right: 2, top: -10, fontSize: 8, opacity: 0.7 }}>
                  {ref.label}
                </ThemedText>
              )}
            </View>
          );
        })}

        {/* Series lines and dots */}
        {activeSeries.map(({ key, color, getValue }) => {
          const points = sessions.map((s, i) => ({ x: getX(i), y: getY(getValue(s)) }));
          return (
            <View key={key} style={StyleSheet.absoluteFill} pointerEvents="none">
              {/* Line segments */}
              {points.slice(0, -1).map((p, i) => {
                const next = points[i + 1];
                const dx = next.x - p.x;
                const dy = next.y - p.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                return (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: p.x + dx / 2 - len / 2,
                      top: p.y + dy / 2 - 1.5,
                      width: len,
                      height: 3,
                      backgroundColor: color,
                      borderRadius: 2,
                      transform: [{ rotate: `${angle}deg` }],
                    }}
                  />
                );
              })}
              {/* Dots */}
              {points.map((p, i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    left: p.x - 5,
                    top: p.y - 5,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: color,
                    borderWidth: 2,
                    borderColor: cardBg,
                  }}
                />
              ))}
            </View>
          );
        })}

        {/* X-axis date labels */}
        {sessions.map((s, i) => (
          <ThemedText
            key={i}
            numberOfLines={1}
            style={{
              position: 'absolute',
              left: getX(i) - 21,
              top: cH + 6,
              width: 42,
              fontSize: 9,
              textAlign: 'center',
              opacity: 0.5,
            }}>
            {formatDate(s.created_at).split(',')[0]}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

// ── Metric checkboxes ─────────────────────────────────────────────────────────

function MetricCheckboxes({
  allSeries,
  activeKeys,
  onToggle,
  isDark,
}: {
  allSeries: SeriesConfig[];
  activeKeys: string[];
  onToggle: (key: string) => void;
  isDark: boolean;
}) {
  return (
    <View style={checkboxStyles.container}>
      {allSeries.map(({ key, label, color }) => {
        const isActive = activeKeys.includes(key);
        return (
          <Pressable key={key} onPress={() => onToggle(key)} style={checkboxStyles.row}>
            <View style={[checkboxStyles.box, { borderColor: color }, isActive && { backgroundColor: color }]}>
              {isActive && <Ionicons name="checkmark" size={10} color="#fff" />}
            </View>
            <ThemedText
              numberOfLines={1}
              style={[checkboxStyles.label, { color }, !isActive && checkboxStyles.labelInactive]}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Improvement summary ───────────────────────────────────────────────────────

function ImprovementSummary({
  sessions,
  activeSeries,
  isDark,
}: {
  sessions: Session[];
  activeSeries: SeriesConfig[];
  isDark: boolean;
}) {
  if (sessions.length < 2) {
    return (
      <View style={[summaryStyles.container, isDark && summaryStyles.containerDark]}>
        <ThemedText style={summaryStyles.notEnoughText}>Add more sessions to see improvement trends.</ThemedText>
      </View>
    );
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return (
    <View style={[summaryStyles.container, isDark && summaryStyles.containerDark]}>
      <ThemedText style={summaryStyles.title}>Progress: first session vs. latest</ThemedText>
      {activeSeries.map(({ key, label, color, getValue, unit, lowerIsBetter }) => {
        const f = getValue(first);
        const l = getValue(last);
        const diff = l - f;
        const improved = lowerIsBetter ? diff < 0 : diff > 0;
        const declined = lowerIsBetter ? diff > 0 : diff < 0;
        const deltaColor = improved ? '#17998a' : declined ? '#e74c3c' : (isDark ? '#c7b5a2' : '#8a7560');
        const icon: any = improved ? 'arrow-up-circle' : declined ? 'arrow-down-circle' : 'remove-circle-outline';
        const pct = f !== 0 ? Math.round(Math.abs(diff / f) * 100) : null;

        return (
          <View key={key} style={summaryStyles.row}>
            <View style={[summaryStyles.rowDot, { backgroundColor: color }]} />
            <ThemedText style={summaryStyles.rowLabel}>{label}</ThemedText>
            <ThemedText style={summaryStyles.rowValues}>
              {f.toFixed(1)}{unit} → {l.toFixed(1)}{unit}
            </ThemedText>
            <View style={summaryStyles.badgeRow}>
              <Ionicons name={icon} size={15} color={deltaColor} />
              <ThemedText style={[summaryStyles.badgeText, { color: deltaColor }]}>
                {diff === 0 ? 'No change' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}${pct != null ? ` (${pct}%)` : ''}`}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Score bar (used in SessionCard) ──────────────────────────────────────────

function ScoreBar({ label, value, color, isDark }: { label: string; value: number; color: string; isDark: boolean }) {
  const pct = Math.max(0, Math.min(value / 10, 1));
  return (
    <View style={chartStyles.barRow}>
      <ThemedText style={chartStyles.barLabel}>{label}</ThemedText>
      <View style={[chartStyles.barTrack, isDark && chartStyles.barTrackDark]}>
        <View style={[chartStyles.barFill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      </View>
      <ThemedText style={[chartStyles.barValue, { color }]}>{value}/10</ThemedText>
    </View>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  isDark,
  deleting,
  onDelete,
}: {
  session: Session;
  isDark: boolean;
  deleting: boolean;
  onDelete: (session: Session) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAnnotated, setShowAnnotated] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const presetColor = PRESET_COLORS[session.preset] ?? '#8a7560';
  const scores = session.scores;
  const analysisSnapshot = getAnalysisSnapshot(session);
  const annotatedVideo = getAnnotatedVideoMeta(session);
  const annotatedPlayer = useVideoPlayer(annotatedVideo?.source_uri ?? '', (player) => {
    player.loop = false;
  });

  const jumpToTimestamp = useCallback(
    (seconds: number) => {
      try {
        annotatedPlayer.currentTime = Math.max(0, seconds);
        annotatedPlayer.play();
      } catch {
        // no-op: local/expired URLs can fail; keep UI responsive
      }
    },
    [annotatedPlayer],
  );

  return (
    <View style={[cardStyles.card, isDark && cardStyles.cardDark]}>
      <View style={cardStyles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} session details`}
          onPress={() => setExpanded((v) => !v)}
          style={cardStyles.headerMain}>
          <View>
            <ThemedText style={cardStyles.dateText}>{formatDate(session.created_at)}</ThemedText>
            <ThemedText style={cardStyles.timeText}>{formatTime(session.created_at)}</ThemedText>
          </View>
          <View style={[cardStyles.presetBadge, { backgroundColor: presetColor + '22', borderColor: presetColor + '55' }]}>
            <ThemedText style={[cardStyles.presetBadgeText, { color: presetColor }]}>
              {session.preset.charAt(0).toUpperCase() + session.preset.slice(1)}
            </ThemedText>
          </View>
        </Pressable>
        <View style={cardStyles.headerRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete this session"
            disabled={deleting}
            onPress={() => onDelete(session)}
            style={({ pressed }) => [
              cardStyles.iconButton,
              deleting && cardStyles.iconButtonDisabled,
              pressed && !deleting && { opacity: 0.82 },
            ]}>
            <Ionicons
              name={deleting ? 'hourglass-outline' : 'trash-outline'}
              size={15}
              color={deleting ? '#9db0d2' : '#e59db0'}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} session details`}
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [cardStyles.iconButton, pressed && { opacity: 0.82 }]}>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={isDark ? '#c7b5a2' : '#8a7560'}
            />
          </Pressable>
        </View>
      </View>

      {expanded && (
        <View style={cardStyles.expandedBody}>
      {expanded && session.wpm != null && (
        <View style={cardStyles.statRow}>
          <Ionicons name="speedometer-outline" size={14} color={palette.accentDeep} />
          <ThemedText style={cardStyles.statText}>
            {Math.round(session.wpm)} WPM · {session.pace_label ?? '—'}
          </ThemedText>
          {session.filler_count != null && session.filler_count > 0 && (
            <>
              <ThemedText style={cardStyles.statSep}>·</ThemedText>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={palette.accentDeep} />
              <ThemedText style={cardStyles.statText}>{session.filler_count} fillers</ThemedText>
            </>
          )}
        </View>
      )}

      {expanded && scores && (
        <View style={cardStyles.scoresRow}>
          {[
            { label: 'Clarity', value: scores.clarity, color: SCORE_COLORS.clarity },
            { label: 'Confidence', value: scores.confidence_language, color: SCORE_COLORS.confidence },
            { label: 'Structure', value: scores.content_structure, color: SCORE_COLORS.structure },
          ].map(({ label, value, color }) =>
            value != null ? (
              <View key={label} style={[cardStyles.scoreChip, { borderColor: color + '55' }]}>
                <ThemedText style={[cardStyles.scoreChipValue, { color }]}>{value}</ThemedText>
                <ThemedText style={cardStyles.scoreChipLabel}>{label}</ThemedText>
              </View>
            ) : null,
          )}
        </View>
      )}

      {expanded && !!session.strengths?.length && (
        <View style={cardStyles.listRow}>
          <Ionicons name="checkmark-circle-outline" size={14} color={palette.mint} />
          <ThemedText style={cardStyles.listText} numberOfLines={2}>{session.strengths[0]}</ThemedText>
        </View>
      )}

      {expanded && !!session.improvements?.length && (
        <View style={cardStyles.listRow}>
          <Ionicons name="alert-circle-outline" size={14} color={palette.accent} />
          <ThemedText style={cardStyles.listText} numberOfLines={2}>
            {session.improvements[0].title}: {session.improvements[0].detail}
          </ThemedText>
        </View>
      )}

      {expanded && analysisSnapshot && (
        <View style={[cardStyles.snapshotPanel, isDark && cardStyles.snapshotPanelDark]}>
          {!!analysisSnapshot.summary && (
            <View style={cardStyles.snapshotSection}>
              <ThemedText style={cardStyles.snapshotTitle}>Coach Summary</ThemedText>
              <ThemedText style={cardStyles.snapshotText}>{analysisSnapshot.summary}</ThemedText>
            </View>
          )}

          {!!analysisSnapshot.bullets?.length && (
            <View style={cardStyles.snapshotSection}>
              <ThemedText style={cardStyles.snapshotTitle}>Key Feedback</ThemedText>
              {analysisSnapshot.bullets.slice(0, 4).map((bullet, index) => (
                <View key={`${index}-${bullet}`} style={cardStyles.snapshotBulletRow}>
                  <View style={cardStyles.snapshotBulletDot} />
                  <ThemedText style={cardStyles.snapshotBulletText}>{bullet}</ThemedText>
                </View>
              ))}
            </View>
          )}

          {!!analysisSnapshot.notes?.length && (
            <View style={cardStyles.snapshotSection}>
              <ThemedText style={cardStyles.snapshotTitle}>Analysis Notes</ThemedText>
              {analysisSnapshot.notes.slice(0, 3).map((note, index) => (
                <ThemedText key={`${index}-${note}`} style={cardStyles.snapshotNoteText}>
                  {note}
                </ThemedText>
              ))}
            </View>
          )}

          {!!analysisSnapshot.personalized_content_plan && (
            <View style={cardStyles.snapshotSection}>
              <ThemedText style={cardStyles.snapshotTitle}>Content Plan</ThemedText>
              {!!analysisSnapshot.personalized_content_plan.topic_summary && (
                <ThemedText style={cardStyles.snapshotText}>
                  Topic: {analysisSnapshot.personalized_content_plan.topic_summary}
                </ThemedText>
              )}
              {!!analysisSnapshot.personalized_content_plan.audience_takeaway && (
                <ThemedText style={cardStyles.snapshotText}>
                  Takeaway: {analysisSnapshot.personalized_content_plan.audience_takeaway}
                </ThemedText>
              )}
              {!!analysisSnapshot.personalized_content_plan.improvements?.length && (
                <View style={cardStyles.snapshotPlanList}>
                  {analysisSnapshot.personalized_content_plan.improvements
                    .slice(0, 2)
                    .map((item, index) => (
                      <View key={`${index}-${item.title ?? 'plan'}`} style={cardStyles.snapshotPlanCard}>
                        {!!item.title && (
                          <ThemedText style={cardStyles.snapshotPlanTitle}>{item.title}</ThemedText>
                        )}
                        {!!item.content_issue && (
                          <ThemedText style={cardStyles.snapshotPlanText}>
                            {item.content_issue}
                          </ThemedText>
                        )}
                        {!!item.specific_fix && (
                          <ThemedText style={cardStyles.snapshotPlanText}>
                            Fix: {item.specific_fix}
                          </ThemedText>
                        )}
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          {!!analysisSnapshot.transcript && (
            <View style={cardStyles.snapshotSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showTranscript ? 'Hide transcript preview' : 'Show transcript preview'}
                onPress={() => setShowTranscript((v) => !v)}
                style={cardStyles.snapshotTranscriptToggle}>
                <ThemedText style={cardStyles.snapshotTitle}>Transcript</ThemedText>
                <Ionicons
                  name={showTranscript ? 'chevron-up-outline' : 'chevron-down-outline'}
                  size={16}
                  color={palette.accentDeep}
                />
              </Pressable>
              {showTranscript && (
                <ThemedText style={cardStyles.snapshotTranscriptText}>
                  {analysisSnapshot.transcript}
                </ThemedText>
              )}
            </View>
          )}
        </View>
      )}

      {expanded && annotatedVideo && (
        <View style={[cardStyles.annotatedPanel, isDark && cardStyles.annotatedPanelDark]}>
          <View style={cardStyles.annotatedHeaderRow}>
            <View style={cardStyles.annotatedTitleWrap}>
              <ThemedText style={cardStyles.annotatedTitle}>Annotated moments</ThemedText>
              <ThemedText style={cardStyles.annotatedSubtitle}>
                {annotatedVideo.markers.length} timestamp
                {annotatedVideo.markers.length === 1 ? '' : 's'}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showAnnotated ? 'Hide video' : 'Show video'}
              onPress={() => setShowAnnotated((v) => !v)}
              style={({ pressed }) => [
                cardStyles.annotatedToggleBtn,
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons
                name={showAnnotated ? 'videocam' : 'videocam-outline'}
                size={14}
                color="#fff"
              />
              <ThemedText style={cardStyles.annotatedToggleText}>Show Video</ThemedText>
            </Pressable>
          </View>

          {showAnnotated && (
            <>
              <View style={cardStyles.annotatedVideoWrap}>
                <VideoView
                  style={cardStyles.annotatedVideo}
                  player={annotatedPlayer}
                  nativeControls
                  allowsFullscreen
                  allowsPictureInPicture
                />
              </View>
              {!!annotatedVideo.source_name && (
                <ThemedText numberOfLines={1} style={cardStyles.annotatedFileName}>
                  {annotatedVideo.source_name}
                </ThemedText>
              )}
            </>
          )}

          <View style={cardStyles.annotatedList}>
            {annotatedVideo.markers.slice(0, 10).map((marker, index) => (
              <Pressable
                key={`${marker.time_sec}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`Jump to ${formatSeconds(marker.time_sec)} for ${marker.label}`}
                onPress={() => {
                  if (!showAnnotated) setShowAnnotated(true);
                  jumpToTimestamp(marker.time_sec);
                }}
                style={({ pressed }) => [
                  cardStyles.annotatedRow,
                  isDark && cardStyles.annotatedRowDark,
                  pressed && { opacity: 0.86 },
                ]}>
                <ThemedText style={cardStyles.annotatedTime}>{formatSeconds(marker.time_sec)}</ThemedText>
                <View style={cardStyles.annotatedBody}>
                  <ThemedText style={cardStyles.annotatedLabel}>{marker.label}</ThemedText>
                  {!!marker.detail && (
                    <ThemedText numberOfLines={2} style={cardStyles.annotatedDetail}>
                      {marker.detail}
                    </ThemedText>
                  )}
                </View>
                <Ionicons
                  name="play-forward-outline"
                  size={14}
                  color={isDark ? '#f2e4d1' : '#8a7560'}
                />
              </Pressable>
            ))}
          </View>
        </View>
      )}
        </View>
      )}
    </View>
  );
}

// ── History screen ────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { user } = useAuth();
  const isDark = true;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [presetFilter, setPresetFilter] = useState<PresetFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<number>(0);
  const [activeMetric, setActiveMetric] = useState<MetricType>('scores');
  const [activeLines, setActiveLines] = useState<Record<MetricType, string[]>>(DEFAULT_ACTIVE_LINES);

  const toggleLine = useCallback(
    (key: string) => {
      setActiveLines((prev) => {
        const current = prev[activeMetric];
        // Prevent deselecting the last active line
        if (current.includes(key) && current.length === 1) return prev;
        const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
        return { ...prev, [activeMetric]: next };
      });
    },
    [activeMetric],
  );

  const filteredSessions = useMemo(() => {
    let result = [...sessions];
    if (presetFilter !== 'all') result = result.filter((s) => s.preset === presetFilter);
    if (periodFilter > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - periodFilter);
      result = result.filter((s) => new Date(s.created_at) >= cutoff);
    }
    result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return result;
  }, [sessions, presetFilter, periodFilter]);

  const chartSessions = useMemo(() => filteredSessions.slice(-10), [filteredSessions]);

  const currentSeries = SERIES_BY_METRIC[activeMetric];
  const currentActiveKeys = activeLines[activeMetric];
  const activeSeries = currentSeries.filter((s) => currentActiveKeys.includes(s.key));

  const isNonverbalEmpty =
    activeMetric === 'nonverbal' &&
    !chartSessions.some(
      (s) =>
        s.non_verbal?.gesture_energy != null ||
        s.non_verbal?.eye_contact_score != null ||
        s.non_verbal?.posture_stability != null,
    );

  const load = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setLoading(true);
      setError(null);
      const { data, error: fetchError } = await fetchSessions(user.id);
      if (fetchError) {
        setError(fetchError.message);
      } else {
        setSessions((data as Session[]) ?? []);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [user],
  );

  useEffect(() => { load(); }, [load]);

  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(true); };

  const handleDeleteSession = useCallback(
    async (session: Session) => {
      if (!user || deletingId) return;
      setDeletingId(session.id);
      const previous = sessions;
      setSessions((prev) => prev.filter((item) => item.id !== session.id));

      const { error: deleteError } = await deleteSession(user.id, session.id);
      if (deleteError) {
        setSessions(previous);
        setError(deleteError.message || 'Could not delete this session.');
      }
      setDeletingId(null);
    },
    [deletingId, sessions, user],
  );

  const confirmDeleteSession = useCallback(
    (session: Session) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const approved = window.confirm(
          `Delete session from ${formatDate(session.created_at)} at ${formatTime(session.created_at)}?`,
        );
        if (approved) {
          void handleDeleteSession(session);
        }
        return;
      }

      Alert.alert(
        'Delete session?',
        `This will permanently remove the session from ${formatDate(session.created_at)}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void handleDeleteSession(session);
            },
          },
        ],
      );
    },
    [handleDeleteSession],
  );

  const canvas = isDark ? palette.darkCanvas : palette.lightCanvas;

  if (loading) {
    return (
      <ThemedView style={[styles.centered, { backgroundColor: canvas }]}>
        <ActivityIndicator size="large" color={palette.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.root, { backgroundColor: canvas }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} />}>

        <View style={styles.pageHeader}>
          <ThemedText style={styles.pageTitle}>Session History</ThemedText>
          <ThemedText style={styles.pageSubtitle}>
            {sessions.length === 0
              ? 'No sessions yet'
              : filteredSessions.length === sessions.length
              ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} recorded`
              : `${filteredSessions.length} of ${sessions.length} sessions`}
          </ThemedText>
        </View>

        {error && (
          <View style={[styles.errorBox, isDark && styles.errorBoxDark]}>
            <Ionicons name="warning-outline" size={16} color="#ffd3c9" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        )}

        {sessions.length > 0 && (
          <FilterBar
            presetFilter={presetFilter} onPresetChange={setPresetFilter}
            periodFilter={periodFilter} onPeriodChange={setPeriodFilter}
            isDark={isDark}
          />
        )}

        {filteredSessions.length >= 1 && (
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            <MetricTabs active={activeMetric} onChange={setActiveMetric} isDark={isDark} />

            <Animated.View
              key={`metric-${activeMetric}`}
              entering={FadeInRight.duration(220)}
              exiting={FadeOutRight.duration(180)}>
              {isNonverbalEmpty ? (
                <View style={chartStyles.noDataBox}>
                  <Ionicons name="eye-off-outline" size={28} color={palette.accent} />
                  <ThemedText style={chartStyles.noDataText}>
                    No non-verbal data in these sessions. Use the camera-based coach to capture gesture, eye contact, and posture metrics.
                  </ThemedText>
                </View>
              ) : (
                <View style={chartStyles.chartRow}>
                  <View style={{ flex: 1 }}>
                    <LineChart
                      sessions={chartSessions}
                      allSeries={currentSeries}
                      activeKeys={currentActiveKeys}
                      referenceLines={REFERENCE_LINES[activeMetric]}
                      isDark={isDark}
                    />
                  </View>
                  <MetricCheckboxes
                    allSeries={currentSeries}
                    activeKeys={currentActiveKeys}
                    onToggle={toggleLine}
                    isDark={isDark}
                  />
                </View>
              )}

              <ImprovementSummary
                sessions={filteredSessions}
                activeSeries={isNonverbalEmpty ? [] : activeSeries}
                isDark={isDark}
              />
            </Animated.View>
          </View>
        )}

        {sessions.length === 0 && !error && (
          <View style={[styles.emptyBox, isDark && styles.emptyBoxDark]}>
            <Ionicons name="analytics-outline" size={40} color={palette.accent} style={styles.emptyIcon} />
            <ThemedText style={styles.emptyTitle}>No sessions yet</ThemedText>
            <ThemedText style={styles.emptyText}>
              Run AI Coach on a practice clip to start tracking your progress here.
            </ThemedText>
          </View>
        )}

        {sessions.length > 0 && filteredSessions.length === 0 && (
          <View style={[styles.emptyBox, isDark && styles.emptyBoxDark]}>
            <Ionicons name="filter-outline" size={36} color={palette.accent} style={styles.emptyIcon} />
            <ThemedText style={styles.emptyTitle}>No matching sessions</ThemedText>
            <ThemedText style={styles.emptyText}>Try a different preset or time period.</ThemedText>
          </View>
        )}

        {[...filteredSessions].reverse().map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isDark={isDark}
            deleting={deletingId === session.id}
            onDelete={confirmDeleteSession}
          />
        ))}

      </ScrollView>
    </ThemedView>
  );
}

// ── StyleSheets ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: {
    padding: 18,
    paddingTop: 20,
    paddingBottom: 100,
    gap: 14,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  pageHeader: { gap: 4, marginBottom: 6 },
  pageTitle: { fontFamily: Fonts.rounded, fontSize: 28 },
  pageSubtitle: { fontSize: 14, opacity: 0.7 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
    borderRadius: 12, backgroundColor: 'rgba(154,47,31,0.16)', borderWidth: 1, borderColor: 'rgba(240,184,174,0.32)',
  },
  errorBoxDark: { backgroundColor: 'rgba(154,47,31,0.16)', borderColor: 'rgba(240,184,174,0.32)' },
  errorText: { flex: 1, fontSize: 14, color: '#ffd3c9' },
  chartCard: {
    borderRadius: 20, borderWidth: 1, borderColor: palette.borderLight,
    backgroundColor: palette.lightCard, padding: 16,
  },
  chartCardDark: { backgroundColor: palette.darkCard, borderColor: palette.borderDark },
  emptyBox: {
    borderRadius: 20, borderWidth: 1, borderColor: palette.borderLight,
    backgroundColor: palette.lightCard, padding: 32, alignItems: 'center', gap: 10,
  },
  emptyBoxDark: { backgroundColor: palette.darkCard, borderColor: palette.borderDark },
  emptyIcon: { marginBottom: 4 },
  emptyTitle: { fontFamily: Fonts.rounded, fontSize: 20 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center', opacity: 0.75, maxWidth: 280 },
});

const chartStyles = StyleSheet.create({
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noDataBox: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  noDataText: { fontSize: 13, opacity: 0.75, textAlign: 'center', maxWidth: 260, lineHeight: 19 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 72, fontSize: 13, fontFamily: Fonts.rounded },
  barTrack: { flex: 1, height: 10, borderRadius: 99, backgroundColor: 'rgba(108, 143, 208, 0.24)', overflow: 'hidden' },
  barTrackDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  barFill: { height: '100%', borderRadius: 99 },
  barValue: { width: 40, fontSize: 12, fontFamily: Fonts.rounded, textAlign: 'right' },
});

const filterStyles = StyleSheet.create({
  container: { gap: 8 },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: palette.borderLight },
  pillDark: { borderColor: palette.borderDark },
  pillText: { fontFamily: Fonts.rounded, fontSize: 13, opacity: 0.75 },
  pillTextActive: { color: '#fff', opacity: 1 },
  tabRow: {
    flexDirection: 'row', borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)', padding: 3, gap: 2, marginBottom: 14,
  },
  tabRowDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  tab: { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: palette.accent },
  tabText: { fontFamily: Fonts.rounded, fontSize: 13, opacity: 0.7 },
  tabTextActive: { color: '#fff', opacity: 1 },
});

const checkboxStyles = StyleSheet.create({
  container: {
    gap: 10,
    paddingLeft: 10,
    justifyContent: 'center',
    minWidth: 88,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box: {
    width: 16, height: 16, borderRadius: 4, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  label: { fontFamily: Fonts.rounded, fontSize: 12, flexShrink: 1 },
  labelInactive: { opacity: 0.35 },
});

const summaryStyles = StyleSheet.create({
  container: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: palette.borderLight, gap: 8,
  },
  containerDark: { borderTopColor: palette.borderDark },
  title: { fontFamily: Fonts.rounded, fontSize: 13, opacity: 0.65, marginBottom: 2 },
  notEnoughText: { fontSize: 13, opacity: 0.6, textAlign: 'center', paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  rowLabel: { fontFamily: Fonts.rounded, fontSize: 13, width: 78, flexShrink: 0 },
  rowValues: { fontSize: 12, opacity: 0.65, flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  badgeText: { fontFamily: Fonts.rounded, fontSize: 12 },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20, borderWidth: 1, borderColor: palette.borderLight,
    backgroundColor: palette.lightCard, padding: 16, gap: 10,
  },
  cardDark: { backgroundColor: palette.darkCard, borderColor: palette.borderDark },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  headerMain: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.32)',
    backgroundColor: 'rgba(16, 32, 68, 0.48)',
  },
  iconButtonDisabled: {
    opacity: 0.65,
  },
  expandedBody: {
    gap: 10,
  },
  dateText: { fontFamily: Fonts.rounded, fontSize: 15 },
  timeText: { fontSize: 12, opacity: 0.65, marginTop: 2 },
  presetBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  presetBadgeText: { fontFamily: Fonts.rounded, fontSize: 12 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 13 },
  statSep: { opacity: 0.4 },
  scoresRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  scoreChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: 'center', gap: 2 },
  scoreChipValue: { fontFamily: Fonts.rounded, fontSize: 16, lineHeight: 20 },
  scoreChipLabel: { fontSize: 11, opacity: 0.75 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  listText: { flex: 1, fontSize: 13, lineHeight: 19, opacity: 0.9 },
  snapshotPanel: {
    borderWidth: 1,
    borderColor: 'rgba(23,153,138,0.2)',
    backgroundColor: 'rgba(23,153,138,0.05)',
    borderRadius: 14,
    padding: 10,
    gap: 10,
  },
  snapshotPanelDark: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  snapshotSection: {
    gap: 6,
  },
  snapshotTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    color: palette.accentDeep,
  },
  snapshotText: {
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.9,
  },
  snapshotBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  snapshotBulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.mint,
    marginTop: 6,
  },
  snapshotBulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.9,
  },
  snapshotNoteText: {
    fontSize: 11,
    opacity: 0.72,
    lineHeight: 17,
  },
  snapshotPlanList: {
    gap: 6,
    marginTop: 2,
  },
  snapshotPlanCard: {
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.3)',
    borderRadius: 10,
    padding: 8,
    gap: 3,
    backgroundColor: 'rgba(15, 27, 58, 0.55)',
  },
  snapshotPlanTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  snapshotPlanText: {
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.85,
  },
  snapshotTranscriptToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  snapshotTranscriptText: {
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.85,
  },
  annotatedPanel: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.32)',
    backgroundColor: 'rgba(15, 27, 58, 0.52)',
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  annotatedPanelDark: {
    borderColor: 'rgba(108, 143, 208, 0.32)',
    backgroundColor: 'rgba(15, 27, 58, 0.52)',
  },
  annotatedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  annotatedTitleWrap: { flex: 1 },
  annotatedTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
  annotatedSubtitle: {
    fontSize: 11,
    opacity: 0.65,
    marginTop: 1,
  },
  annotatedToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  annotatedToggleText: {
    color: '#fff',
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  annotatedVideoWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#000',
  },
  annotatedVideo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  annotatedFileName: {
    fontSize: 11,
    opacity: 0.65,
  },
  annotatedList: {
    gap: 6,
  },
  annotatedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.28)',
    backgroundColor: 'rgba(15, 27, 58, 0.62)',
    padding: 8,
  },
  annotatedRowDark: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  annotatedTime: {
    minWidth: 42,
    fontFamily: Fonts.rounded,
    fontSize: 12,
    color: palette.accentDeep,
  },
  annotatedBody: {
    flex: 1,
    gap: 2,
  },
  annotatedLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  annotatedDetail: {
    fontSize: 12,
    opacity: 0.75,
    lineHeight: 17,
  },
});
