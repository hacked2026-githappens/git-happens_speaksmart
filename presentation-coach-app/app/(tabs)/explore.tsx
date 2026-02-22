import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';

const drills = [
  {
    title: 'One-minute opener',
    detail:
      'Record a 60 second intro that states your topic, your audience value, and your key message in one breath.',
    icon: 'flash-outline' as const,
  },
  {
    title: 'Pauses over filler words',
    detail:
      'Pick a section where your pace accelerates and intentionally add one beat of silence at each sentence break.',
    icon: 'pause-circle-outline' as const,
  },
  {
    title: 'Strong close loop',
    detail:
      'End by repeating your main point with one concrete action the listener should take in the next 24 hours.',
    icon: 'checkmark-done-outline' as const,
  },
];

const checklist = [
  'Open with context in the first 15 seconds.',
  'Keep your average pace between 120 and 165 words per minute.',
  'Use short sentences when introducing numbers or technical terms.',
  'Finish with a clear outcome and call to action.',
];

export default function ExploreScreen() {
  return (
    <ThemedView style={styles.root} lightColor="#141d3f" darkColor="#141d3f">
      <View style={styles.backGlowTop} />
      <View style={styles.backGlowBottom} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#17214b', '#1b2550', '#134a54']} style={styles.hero}>
          <ThemedText style={styles.heroTitle}>Practice Guide</ThemedText>
          <ThemedText style={styles.heroSubtitle}>
            Three focused drills to level up each presentation round.
          </ThemedText>
        </LinearGradient>

        <ThemedView style={styles.card} lightColor="#1b2550" darkColor="#1b2550">
          <View style={styles.sectionHeader}>
            <Ionicons name="book-outline" size={18} color="#39c8cf" />
            <ThemedText style={styles.sectionTitle}>Coaching drills</ThemedText>
          </View>

          {drills.map((drill) => (
            <View
              key={drill.title}
              style={styles.row}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${drill.title}: ${drill.detail}`}>
              <View style={styles.iconChip}>
                <Ionicons name={drill.icon} size={16} color="#fff7ed" />
              </View>
              <View style={styles.rowBody}>
                <ThemedText style={styles.rowTitle}>{drill.title}</ThemedText>
                <ThemedText style={styles.rowDetail}>{drill.detail}</ThemedText>
              </View>
            </View>
          ))}
        </ThemedView>

        <ThemedView style={styles.card} lightColor="#1b2550" darkColor="#1b2550">
          <View style={styles.sectionHeader}>
            <Ionicons name="clipboard-outline" size={18} color="#2ac0a8" />
            <ThemedText style={styles.sectionTitle}>Before you hit record</ThemedText>
          </View>
          {checklist.map((item, index) => (
            <View
              key={item}
              style={styles.checkRow}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Tip ${index + 1}: ${item}`}>
              <ThemedText style={styles.checkIndex}>{index + 1}</ThemedText>
              <ThemedText style={styles.checkText}>{item}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <ThemedView style={styles.quoteCard} lightColor="#1b2550" darkColor="#1b2550">
          <Ionicons name="mic-outline" size={18} color="#9ee7ef" />
          <ThemedText style={styles.quoteText}>
            Better speaking is built in loops: record, review, refine, repeat.
          </ThemedText>
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#141d3f',
  },
  backGlowTop: {
    position: 'absolute',
    top: -140,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 999,
    backgroundColor: 'rgba(39, 103, 211, 0.12)',
  },
  backGlowBottom: {
    position: 'absolute',
    right: -150,
    bottom: -220,
    width: 460,
    height: 460,
    borderRadius: 999,
    backgroundColor: 'rgba(42, 192, 168, 0.14)',
  },
  page: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 14,
  },
  hero: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    paddingHorizontal: 22,
    paddingVertical: 20,
    gap: 8,
  },
  heroTitle: {
    color: '#eef5ff',
    fontFamily: Fonts.rounded,
    fontSize: 32,
    lineHeight: 34,
  },
  heroSubtitle: {
    color: 'rgba(209, 224, 247, 0.92)',
    maxWidth: 620,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    padding: 18,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#101a38',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    color: '#e8f4ff',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#2aaeb9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 15,
    lineHeight: 18,
    color: '#e8f4ff',
  },
  rowDetail: {
    lineHeight: 21,
    fontSize: 14,
    color: '#b8cce7',
  },
  checkRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  checkIndex: {
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#2aaeb9',
    color: '#e5f8ff',
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: Fonts.rounded,
    fontSize: 13,
    marginTop: 1,
  },
  checkText: {
    flex: 1,
    lineHeight: 21,
    fontSize: 14,
    color: '#b8cce7',
  },
  quoteCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    padding: 16,
    gap: 8,
  },
  quoteText: {
    color: '#d9e9ff',
    fontFamily: Fonts.rounded,
    fontSize: 16,
    lineHeight: 22,
  },
});

