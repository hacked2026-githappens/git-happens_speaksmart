import React from 'react';
import { DimensionValue, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { AnimatedAuroraBackground } from '@/components/animated-aurora-background';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

type Feature = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const FEATURES: Feature[] = [
  {
    title: 'AI Speech Analysis',
    description: 'Get real-time feedback on pacing, filler words, and clarity.',
    icon: 'analytics-outline',
  },
  {
    title: 'Progress Tracking',
    description: 'Visualize your improvement across sessions and milestones.',
    icon: 'bar-chart-outline',
  },
  {
    title: 'Smart Coaching Tips',
    description: 'Receive personalized suggestions tailored to your speaking goals.',
    icon: 'chatbubble-ellipses-outline',
  },
  {
    title: 'Practice Scenarios',
    description: 'Rehearse interviews, pitches, and keynotes with realistic prompts.',
    icon: 'radio-outline',
  },
  {
    title: 'Confidence Score',
    description: 'Track confidence signals and celebrate consistent improvement.',
    icon: 'sparkles-outline',
  },
  {
    title: 'Live Recording',
    description: 'Record and review your delivery with timestamped AI feedback.',
    icon: 'mic-outline',
  },
];

export default function LandingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1280;
  const isTablet = width >= 900 && width < 1280;

  const heroMaxWidth = isDesktop ? 1180 : isTablet ? 960 : 800;
  const sectionMaxWidth = isDesktop ? 1420 : isTablet ? 1140 : 980;
  const navMaxWidth = isDesktop ? 1700 : 1220;
  const cardWidth: DimensionValue = isDesktop ? '32.3%' : isTablet ? '48.4%' : '100%';

  return (
    <AnimatedAuroraBackground>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, isDesktop && styles.scrollContentDesktop]}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <View style={[styles.navbar, { maxWidth: navMaxWidth }]}>
          <View style={styles.brandRow}>
            <View style={styles.logoPill}>
              <Ionicons name="mic-outline" size={15} color="#53d7dd" />
            </View>
            <ThemedText style={styles.brandText}>SpeakSmart</ThemedText>
          </View>

          <Pressable
            accessibilityLabel="Sign in to SpeakSmart"
            accessibilityRole="button"
            style={({ pressed }) => [styles.signInButton, pressed && styles.buttonPressed]}
            onPress={() => router.push('/login')}>
            <ThemedText style={styles.signInButtonText}>Sign In</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.hero, { maxWidth: heroMaxWidth }]}>
          <View style={styles.heroIconBubble}>
            <Ionicons name="mic-outline" size={20} color="#44d8dd" />
          </View>
          <ThemedText style={[styles.heroTitle, isDesktop && styles.heroTitleDesktop]}>
            Speak with{' '}
            <ThemedText style={[styles.heroTitleAccent, isDesktop && styles.heroTitleAccentDesktop]}>
              confidence
            </ThemedText>
          </ThemedText>
          <ThemedText style={[styles.heroSubtitle, isDesktop && styles.heroSubtitleDesktop]}>
            SpeakSmart is your AI-powered presentation coach. Practice, get instant feedback, and
            become a compelling speaker.
          </ThemedText>

          <View style={styles.heroActions}>
            <Pressable
              accessibilityLabel="Get started free with SpeakSmart"
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryCta, pressed && styles.buttonPressed]}
              onPress={() => router.push('/login')}>
              <LinearGradient colors={['#2fc0d5', '#39d8c9']} style={styles.primaryCtaGradient}>
                <ThemedText style={styles.primaryCtaText}>Get Started Free</ThemedText>
                <Ionicons name="arrow-forward" size={15} color="#052635" />
              </LinearGradient>
            </Pressable>

            <Pressable
              accessibilityLabel="Sign in to view demo"
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryCta, pressed && styles.buttonPressed]}
              onPress={() => router.push('/login')}>
              <ThemedText style={styles.secondaryCtaText}>Watch Demo</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={[styles.featuresSection, { maxWidth: sectionMaxWidth }]}>
          <ThemedText style={styles.sectionTitle}>Everything you need to master public speaking</ThemedText>
          <View style={styles.featuresGrid}>
            {FEATURES.map((feature) => (
              <View
                key={feature.title}
                style={[styles.featureCard, { width: cardWidth }, isDesktop && styles.featureCardDesktop]}>
                <View style={styles.featureIconBubble}>
                  <Ionicons name={feature.icon} size={16} color="#46d6de" />
                </View>
                <ThemedText style={styles.featureTitle}>{feature.title}</ThemedText>
                <ThemedText style={styles.featureDescription}>{feature.description}</ThemedText>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.ctaPanel}>
          <ThemedText style={styles.ctaTitle}>Ready to level up?</ThemedText>
          <ThemedText style={styles.ctaSubtitle}>
            Join SpeakSmart today and start your journey to becoming a fearless speaker.
          </ThemedText>
          <Pressable
            accessibilityLabel="Create your free SpeakSmart account"
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryCta, pressed && styles.buttonPressed]}
            onPress={() => router.push('/login')}>
            <LinearGradient colors={['#2fc0d5', '#39d8c9']} style={styles.primaryCtaGradient}>
              <ThemedText style={styles.primaryCtaText}>Create Free Account</ThemedText>
              <Ionicons name="arrow-forward" size={15} color="#052635" />
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </AnimatedAuroraBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 40,
    alignItems: 'center',
  },
  scrollContentDesktop: {
    paddingHorizontal: 20,
  },
  navbar: {
    width: '100%',
    maxWidth: 1220,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 70,
    paddingHorizontal: 2,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoPill: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(43, 123, 219, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(118, 190, 255, 0.35)',
  },
  brandText: {
    color: '#ebf3ff',
    fontFamily: Fonts.rounded,
    fontSize: 22,
  },
  signInButton: {
    minHeight: 34,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(135, 165, 228, 0.44)',
    backgroundColor: 'rgba(20, 26, 56, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInButtonText: {
    color: '#dce8ff',
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
  hero: {
    width: '100%',
    maxWidth: 800,
    alignItems: 'center',
    marginBottom: 72,
  },
  heroTitleDesktop: {
    fontSize: 78,
    lineHeight: 86,
  },
  heroSubtitleDesktop: {
    maxWidth: 820,
    fontSize: 20,
    lineHeight: 31,
  },
  heroIconBubble: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(35, 126, 190, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(129, 195, 255, 0.35)',
    marginBottom: 20,
  },
  heroTitle: {
    color: '#f0f3ff',
    fontFamily: Fonts.serif,
    fontSize: 64,
    textAlign: 'center',
    lineHeight: 72,
  },
  heroTitleAccent: {
    color: '#34d2cb',
    fontFamily: Fonts.serif,
    fontSize: 64,
    lineHeight: 72,
    textAlign: 'center',
  },
  heroTitleAccentDesktop: {
    fontSize: 78,
    lineHeight: 86,
  },
  heroSubtitle: {
    marginTop: 12,
    maxWidth: 680,
    color: '#9db0d2',
    fontFamily: Fonts.sans,
    fontSize: 18,
    lineHeight: 27,
    textAlign: 'center',
  },
  heroActions: {
    marginTop: 22,
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  primaryCta: {
    borderRadius: 13,
    overflow: 'hidden',
    minHeight: 48,
  },
  primaryCtaGradient: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryCtaText: {
    color: '#052635',
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  secondaryCta: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 29, 66, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(95, 122, 187, 0.5)',
  },
  secondaryCtaText: {
    color: '#dbe8ff',
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  featuresSection: {
    width: '100%',
    maxWidth: 980,
    marginBottom: 54,
  },
  sectionTitle: {
    color: '#f0f4ff',
    fontFamily: Fonts.serif,
    fontSize: 40,
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 22,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'center',
  },
  featureCard: {
    width: '100%',
    maxWidth: 460,
    minHeight: 146,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(88, 111, 167, 0.34)',
    backgroundColor: 'rgba(18, 30, 61, 0.55)',
  },
  featureCardDesktop: {
    minHeight: 174,
    padding: 20,
  },
  featureIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31, 105, 151, 0.36)',
    marginBottom: 12,
  },
  featureTitle: {
    color: '#eaf1ff',
    fontFamily: Fonts.rounded,
    fontSize: 22,
    marginBottom: 8,
  },
  featureDescription: {
    color: '#94a9cc',
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  ctaPanel: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(92, 117, 171, 0.35)',
    backgroundColor: 'rgba(18, 31, 63, 0.6)',
    alignItems: 'center',
    gap: 14,
  },
  ctaTitle: {
    color: '#f0f3ff',
    fontFamily: Fonts.serif,
    fontSize: 46,
    lineHeight: 52,
    textAlign: 'center',
  },
  ctaSubtitle: {
    color: '#9eb2d2',
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 4,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.994 }],
  },
});
