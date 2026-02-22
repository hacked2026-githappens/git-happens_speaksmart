import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/contexts/auth';
import { fetchSessions } from '@/lib/database';

const palette = {
  accent: '#d1652c',
  accentDeep: '#b54f1b',
  mint: '#17998a',
  lightCanvas: '#f6ede2',
  darkCanvas: '#1b1510',
  lightCard: '#fff8ee',
  darkCard: '#2a211b',
  borderLight: '#e7c9a4',
  borderDark: 'rgba(255, 214, 168, 0.28)',
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Bar chart row: label + filled bar + value */
function ScoreBar({
  label,
  value,
  color,
  isDark,
}: {
  label: string;
  value: number;
  color: string;
  isDark: boolean;
}) {
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

/** Mini line-like chart using vertical bars per session */
function TrendChart({
  sessions,
  isDark,
}: {
  sessions: Session[];
  isDark: boolean;
}) {
  const recent = sessions.slice(0, 10).reverse();
  if (recent.length < 2) return null;

  const entries = recent.map((s) => ({
    date: formatDate(s.created_at),
    clarity: s.scores?.clarity ?? 0,
    confidence: s.scores?.confidence_language ?? 0,
    structure: s.scores?.content_structure ?? 0,
  }));

  return (
    <View style={chartStyles.trendContainer}>
      <ThemedText style={chartStyles.trendTitle}>Score trends (last {entries.length} sessions)</ThemedText>
      <View style={chartStyles.trendLegend}>
        {(
          [
            { key: 'clarity', label: 'Clarity', color: SCORE_COLORS.clarity },
            { key: 'confidence', label: 'Confidence', color: SCORE_COLORS.confidence },
            { key: 'structure', label: 'Structure', color: SCORE_COLORS.structure },
          ] as const
        ).map(({ key, label, color }) => (
          <View key={key} style={chartStyles.legendItem}>
            <View style={[chartStyles.legendDot, { backgroundColor: color }]} />
            <ThemedText style={chartStyles.legendLabel}>{label}</ThemedText>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={chartStyles.trendChart}>
          {entries.map((entry, index) => (
            <View key={index} style={chartStyles.trendColumn}>
              <View style={chartStyles.trendBars}>
                {(
                  [
                    { val: entry.clarity, color: SCORE_COLORS.clarity },
                    { val: entry.confidence, color: SCORE_COLORS.confidence },
                    { val: entry.structure, color: SCORE_COLORS.structure },
                  ] as const
                ).map(({ val, color }, barIndex) => (
                  <View key={barIndex} style={chartStyles.trendBarTrack}>
                    <View
                      style={[
                        chartStyles.trendBarFill,
                        {
                          height: `${(val / 10) * 100}%` as any,
                          backgroundColor: color,
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <ThemedText
                style={[chartStyles.trendDateLabel, isDark && chartStyles.trendDateLabelDark]}
                numberOfLines={1}>
                {entry.date.split(',')[0]}
              </ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function SessionCard({ session, isDark }: { session: Session; isDark: boolean }) {
  const presetColor = PRESET_COLORS[session.preset] ?? '#8a7560';
  const scores = session.scores;

  return (
    <View style={[cardStyles.card, isDark && cardStyles.cardDark]}>
      <View style={cardStyles.headerRow}>
        <View>
          <ThemedText style={cardStyles.dateText}>{formatDate(session.created_at)}</ThemedText>
          <ThemedText style={cardStyles.timeText}>{formatTime(session.created_at)}</ThemedText>
        </View>
        <View style={[cardStyles.presetBadge, { backgroundColor: presetColor + '22', borderColor: presetColor + '55' }]}>
          <ThemedText style={[cardStyles.presetBadgeText, { color: presetColor }]}>
            {session.preset.charAt(0).toUpperCase() + session.preset.slice(1)}
          </ThemedText>
        </View>
      </View>

      {session.wpm != null && (
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

      {scores && (
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

      {!!session.strengths?.length && (
        <View style={cardStyles.listRow}>
          <Ionicons name="checkmark-circle-outline" size={14} color={palette.mint} />
          <ThemedText style={cardStyles.listText} numberOfLines={2}>
            {session.strengths[0]}
          </ThemedText>
        </View>
      )}

      {!!session.improvements?.length && (
        <View style={cardStyles.listRow}>
          <Ionicons name="alert-circle-outline" size={14} color={palette.accent} />
          <ThemedText style={cardStyles.listText} numberOfLines={2}>
            {session.improvements[0].title}: {session.improvements[0].detail}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

  // Reload when tab gains focus
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const canvas = isDark ? palette.darkCanvas : palette.lightCanvas;
  const card = isDark ? palette.darkCard : palette.lightCard;

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
            {sessions.length > 0
              ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} recorded`
              : 'No sessions yet'}
          </ThemedText>
        </View>

        {error && (
          <View style={[styles.errorBox, isDark && styles.errorBoxDark]}>
            <Ionicons name="warning-outline" size={16} color="#9a2f1f" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        )}

        {sessions.length >= 2 && (
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            <TrendChart sessions={sessions} isDark={isDark} />
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

        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} isDark={isDark} />
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 18,
    paddingTop: 60,
    paddingBottom: 100,
    gap: 14,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  pageHeader: {
    gap: 4,
    marginBottom: 6,
  },
  pageTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
  },
  pageSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8ddd8',
    borderWidth: 1,
    borderColor: '#f0b8ae',
  },
  errorBoxDark: {
    backgroundColor: 'rgba(154, 47, 31, 0.2)',
    borderColor: 'rgba(240, 184, 174, 0.3)',
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#9a2f1f',
  },
  chartCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#fff8ee',
    padding: 16,
  },
  chartCardDark: {
    backgroundColor: '#2a211b',
    borderColor: palette.borderDark,
  },
  emptyBox: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#fff8ee',
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyBoxDark: {
    backgroundColor: '#2a211b',
    borderColor: palette.borderDark,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    opacity: 0.75,
    maxWidth: 280,
  },
});

const chartStyles = StyleSheet.create({
  trendContainer: {
    gap: 12,
  },
  trendTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  trendLegend: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 12,
    opacity: 0.85,
  },
  trendChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    height: 110,
    paddingBottom: 24,
  },
  trendColumn: {
    alignItems: 'center',
    width: 42,
    gap: 4,
  },
  trendBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 80,
  },
  trendBarTrack: {
    width: 10,
    height: 80,
    backgroundColor: 'rgba(47, 34, 25, 0.1)',
    borderRadius: 4,
    justifyContent: 'flex-end',
  },
  trendBarFill: {
    width: '100%',
    borderRadius: 4,
  },
  trendDateLabel: {
    fontSize: 9,
    opacity: 0.65,
    textAlign: 'center',
  },
  trendDateLabelDark: {
    opacity: 0.5,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    width: 72,
    fontSize: 13,
    fontFamily: Fonts.rounded,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 99,
    backgroundColor: 'rgba(47, 34, 25, 0.12)',
    overflow: 'hidden',
  },
  barTrackDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
  },
  barValue: {
    width: 40,
    fontSize: 12,
    fontFamily: Fonts.rounded,
    textAlign: 'right',
  },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#fff8ee',
    padding: 16,
    gap: 10,
  },
  cardDark: {
    backgroundColor: '#2a211b',
    borderColor: palette.borderDark,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  dateText: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  timeText: {
    fontSize: 12,
    opacity: 0.65,
    marginTop: 2,
  },
  presetBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  presetBadgeText: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statText: {
    fontSize: 13,
  },
  statSep: {
    opacity: 0.4,
  },
  scoresRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  scoreChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  scoreChipValue: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    lineHeight: 20,
  },
  scoreChipLabel: {
    fontSize: 11,
    opacity: 0.75,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  listText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.9,
  },
});
