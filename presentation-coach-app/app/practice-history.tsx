import React, { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getPracticeHistoryEntries,
  type PracticeHistoryEntry,
  type PracticeMode,
} from '@/lib/practice-history';

type ModeFilter = 'all' | PracticeMode;
type PeriodFilter = 0 | 7 | 30 | 90;

const MODE_OPTIONS: Array<{ key: ModeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'qa', label: 'Q&A' },
  { key: 'filler', label: 'Filler' },
  { key: 'paragraph', label: 'Paragraph' },
  { key: 'topic', label: 'Topic' },
];

const PERIOD_OPTIONS: Array<{ key: PeriodFilter; label: string }> = [
  { key: 0, label: 'All' },
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
];

const MODE_LABELS: Record<PracticeMode, string> = {
  qa: 'Q&A Simulator',
  filler: 'Filler Challenge',
  paragraph: 'Paragraph Read',
  topic: 'Topic Talk',
};

const MODE_COLORS: Record<PracticeMode, string> = {
  qa: '#3577ba',
  filler: '#d1652c',
  paragraph: '#9b5f1f',
  topic: '#17998a',
};

const palette = {
  accent: '#d1652c',
  lightCanvas: '#f6ede2',
  darkCanvas: '#1b1510',
  lightCard: '#fff8ee',
  darkCard: '#2a211b',
  lightInk: '#2f2219',
  darkInk: '#f2e4d1',
  borderLight: '#e7c9a4',
  borderDark: 'rgba(255, 214, 168, 0.28)',
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatChartLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function PracticeHistoryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const ink = isDark ? palette.darkInk : palette.lightInk;
  const card = isDark ? palette.darkCard : palette.lightCard;
  const border = isDark ? palette.borderDark : palette.borderLight;
  const canvas = isDark ? palette.darkCanvas : palette.lightCanvas;

  const [entries, setEntries] = useState<PracticeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(0);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const next = await getPracticeHistoryEntries();
    setEntries(next);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadEntries();
    }, [loadEntries]),
  );

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    return entries.filter((entry) => {
      if (modeFilter !== 'all' && entry.mode !== modeFilter) return false;
      if (periodFilter === 0) return true;
      const cutoff = now - periodFilter * 24 * 60 * 60 * 1000;
      return new Date(entry.created_at).getTime() >= cutoff;
    });
  }, [entries, modeFilter, periodFilter]);

  const chartEntries = useMemo(
    () => filteredEntries.slice(0, 12).reverse(),
    [filteredEntries],
  );

  const avgScore = useMemo(() => {
    if (!filteredEntries.length) return 0;
    const total = filteredEntries.reduce((sum, item) => sum + item.score, 0);
    return Math.round(total / filteredEntries.length);
  }, [filteredEntries]);

  const bestScore = useMemo(() => {
    if (!filteredEntries.length) return 0;
    return filteredEntries.reduce((best, item) => Math.max(best, item.score), 0);
  }, [filteredEntries]);

  return (
    <ScrollView
      style={[s.scroll, { backgroundColor: canvas }]}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled">
      <View style={s.headerRow}>
        <View style={s.headerCopy}>
          <ThemedText style={[s.title, { color: ink }]}>Practice History</ThemedText>
          <ThemedText style={[s.subtitle, { color: ink }]}>
            Track past drill scores and compare progress by mode.
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh practice history"
          onPress={() => {
            void loadEntries();
          }}
          style={[s.refreshBtn, { borderColor: border, backgroundColor: card }]}>
          <Ionicons name="refresh-outline" size={18} color={palette.accent} />
        </Pressable>
      </View>

      <View style={[s.filterCard, { backgroundColor: card, borderColor: border }]}>
        <ThemedText style={[s.filterLabel, { color: ink }]}>Mode</ThemedText>
        <View style={s.pillWrap}>
          {MODE_OPTIONS.map((option) => {
            const active = modeFilter === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={`Filter mode: ${option.label}`}
                onPress={() => setModeFilter(option.key)}
                style={[
                  s.pill,
                  { borderColor: border },
                  active && { backgroundColor: palette.accent, borderColor: palette.accent },
                ]}>
                <ThemedText style={[s.pillText, active && s.pillTextActive]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText style={[s.filterLabel, { color: ink }]}>Period</ThemedText>
        <View style={s.pillWrap}>
          {PERIOD_OPTIONS.map((option) => {
            const active = periodFilter === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={`Filter period: ${option.label}`}
                onPress={() => setPeriodFilter(option.key)}
                style={[
                  s.pill,
                  { borderColor: border },
                  active && { backgroundColor: palette.accent, borderColor: palette.accent },
                ]}>
                <ThemedText style={[s.pillText, active && s.pillTextActive]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={s.statsRow}>
        <View style={[s.statCard, { backgroundColor: card, borderColor: border }]}>
          <ThemedText style={[s.statValue, { color: ink }]}>
            {filteredEntries.length}
          </ThemedText>
          <ThemedText style={[s.statLabel, { color: ink }]}>Attempts</ThemedText>
        </View>
        <View style={[s.statCard, { backgroundColor: card, borderColor: border }]}>
          <ThemedText style={[s.statValue, { color: ink }]}>{avgScore}</ThemedText>
          <ThemedText style={[s.statLabel, { color: ink }]}>Avg Score</ThemedText>
        </View>
        <View style={[s.statCard, { backgroundColor: card, borderColor: border }]}>
          <ThemedText style={[s.statValue, { color: ink }]}>{bestScore}</ThemedText>
          <ThemedText style={[s.statLabel, { color: ink }]}>Best Score</ThemedText>
        </View>
      </View>

      <View style={[s.chartCard, { backgroundColor: card, borderColor: border }]}>
        <ThemedText style={[s.sectionTitle, { color: ink }]}>Score Trend</ThemedText>
        {chartEntries.length === 0 ? (
          <ThemedText style={[s.emptyText, { color: ink }]}>
            No practice attempts for the current filters.
          </ThemedText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.chartRow}>
              {chartEntries.map((entry) => {
                const modeColor = MODE_COLORS[entry.mode] ?? palette.accent;
                return (
                  <View key={entry.id} style={s.chartBarCol}>
                    <View style={[s.chartTrack, { borderColor: border }]}>
                      <View
                        style={[
                          s.chartFill,
                          {
                            height: `${Math.max(6, Math.min(100, entry.score))}%`,
                            backgroundColor: modeColor,
                          },
                        ]}
                      />
                    </View>
                    <ThemedText style={[s.chartScore, { color: ink }]}>
                      {entry.score}
                    </ThemedText>
                    <ThemedText style={[s.chartDate, { color: ink }]}>
                      {formatChartLabel(entry.created_at)}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      <View style={s.entriesWrap}>
        <ThemedText style={[s.sectionTitle, { color: ink }]}>Attempts</ThemedText>
        {loading ? (
          <View style={[s.entryCard, { backgroundColor: card, borderColor: border }]}>
            <ThemedText style={[s.entrySummary, { color: ink }]}>
              Loading practice history...
            </ThemedText>
          </View>
        ) : filteredEntries.length === 0 ? (
          <View style={[s.entryCard, { backgroundColor: card, borderColor: border }]}>
            <ThemedText style={[s.entrySummary, { color: ink }]}>
              Complete a drill in Practice to build history.
            </ThemedText>
          </View>
        ) : (
          filteredEntries.map((entry) => {
            const modeColor = MODE_COLORS[entry.mode] ?? palette.accent;
            return (
              <View
                key={entry.id}
                style={[s.entryCard, { backgroundColor: card, borderColor: border }]}>
                <View style={s.entryTopRow}>
                  <View
                    style={[
                      s.modeBadge,
                      { backgroundColor: `${modeColor}22`, borderColor: `${modeColor}66` },
                    ]}>
                    <ThemedText style={[s.modeBadgeText, { color: modeColor }]}>
                      {MODE_LABELS[entry.mode] ?? entry.modeLabel}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      s.scoreBadge,
                      { borderColor: modeColor, backgroundColor: `${modeColor}20` },
                    ]}>
                    <ThemedText style={[s.scoreBadgeText, { color: modeColor }]}>
                      {entry.score}
                    </ThemedText>
                  </View>
                </View>

                <ThemedText style={[s.entrySummary, { color: ink }]}>
                  {entry.summary}
                </ThemedText>
                {entry.detail ? (
                  <ThemedText style={[s.entryDetail, { color: ink }]}>
                    {entry.detail}
                  </ThemedText>
                ) : null}
                <ThemedText style={[s.entryMeta, { color: ink }]}>
                  {formatDateTime(entry.created_at)}
                </ThemedText>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    padding: 20,
    paddingBottom: 120,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
  },
  headerCopy: { flex: 1 },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    opacity: 0.7,
    lineHeight: 20,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  filterLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    opacity: 0.7,
    marginTop: 2,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  pillTextActive: {
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 12,
    opacity: 0.7,
  },
  chartCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    opacity: 0.75,
    lineHeight: 20,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingRight: 8,
  },
  chartBarCol: {
    width: 36,
    alignItems: 'center',
    gap: 4,
  },
  chartTrack: {
    width: 22,
    height: 120,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  chartFill: {
    width: '100%',
    borderRadius: 12,
  },
  chartScore: {
    fontFamily: Fonts.rounded,
    fontSize: 11,
    opacity: 0.85,
  },
  chartDate: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    opacity: 0.6,
  },
  entriesWrap: { gap: 10 },
  entryCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  entryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  modeBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modeBadgeText: {
    fontFamily: Fonts.rounded,
    fontSize: 11,
    fontWeight: '700',
  },
  scoreBadge: {
    minWidth: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  scoreBadgeText: {
    fontFamily: Fonts.rounded,
    fontSize: 13,
    fontWeight: '700',
  },
  entrySummary: {
    fontFamily: Fonts.rounded,
    fontSize: 14,
    lineHeight: 20,
  },
  entryDetail: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.8,
  },
  entryMeta: {
    fontFamily: Fonts.rounded,
    fontSize: 11,
    opacity: 0.6,
  },
});
