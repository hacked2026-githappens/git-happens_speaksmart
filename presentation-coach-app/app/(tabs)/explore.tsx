import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
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
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#0d1430', dark: '#0d1430' }}
      headerImage={
        <LinearGradient colors={['#0f1735', '#1c2251', '#134a54']} style={styles.hero}>
          <ThemedText style={styles.heroTitle}>Practice Guide</ThemedText>
          <ThemedText style={styles.heroSubtitle}>
            Three focused drills to level up each presentation round.
          </ThemedText>
        </LinearGradient>
      }>
      <ThemedView style={styles.page} lightColor="#0f1735" darkColor="#0f1735">
        <ThemedView style={styles.card} lightColor="#1b2550" darkColor="#1b2550">
          <View style={styles.sectionHeader}>
            <Ionicons name="book-outline" size={18} color="#d1652c" />
            <ThemedText style={styles.sectionTitle}>Coaching drills</ThemedText>
          </View>

          {drills.map((drill) => (
            <View key={drill.title} style={styles.row}>
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
            <Ionicons name="clipboard-outline" size={18} color="#17998a" />
            <ThemedText style={styles.sectionTitle}>Before you hit record</ThemedText>
          </View>
          {checklist.map((item, index) => (
            <View key={item} style={styles.checkRow}>
              <ThemedText style={styles.checkIndex}>{index + 1}</ThemedText>
              <ThemedText style={styles.checkText}>{item}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <ThemedView style={styles.quoteCard} lightColor="#16234a" darkColor="#16234a">
          <Ionicons name="mic-outline" size={18} color="#ffcc95" />
          <ThemedText style={styles.quoteText}>
            Better speaking is built in loops: record, review, refine, repeat.
          </ThemedText>
        </ThemedView>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
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
    maxWidth: 520,
    fontSize: 15,
    lineHeight: 22,
  },
  page: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingBottom: 28,
    gap: 14,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    padding: 16,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#2f2219',
        shadowOpacity: 0.15,
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
  },
  rowDetail: {
    lineHeight: 21,
    fontSize: 14,
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
