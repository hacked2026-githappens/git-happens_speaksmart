import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

export default function PracticeScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="radio-outline" size={24} color="#45d8df" />
        </View>
        <ThemedText style={styles.title}>Practice Hub</ThemedText>
        <ThemedText style={styles.subtitle}>
          This page is a placeholder route so the dashboard can integrate future practice workflows
          smoothly without navigation changes.
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to coach page"
          onPress={() => router.push('/(tabs)')}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <ThemedText style={styles.buttonText}>Open Coach</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    backgroundColor: 'rgba(24, 38, 77, 0.65)',
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(42, 116, 164, 0.44)',
  },
  title: {
    color: '#e8f4ff',
    fontFamily: Fonts.rounded,
    fontSize: 28,
  },
  subtitle: {
    color: '#a9bfdc',
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 560,
  },
  button: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#39c8cf',
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonText: {
    color: '#032236',
    fontFamily: Fonts.rounded,
    fontSize: 14,
  },
});
