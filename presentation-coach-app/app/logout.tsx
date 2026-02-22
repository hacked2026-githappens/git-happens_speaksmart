import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AnimatedAuroraBackground } from '@/components/animated-aurora-background';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { clearWebCoachDraft } from '@/lib/web-coach-draft';
import { clearWebVideoDraft } from '@/lib/web-video-draft';

export default function LogoutScreen() {
  const { signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      try {
        if (typeof window !== 'undefined') {
          clearWebCoachDraft();
          await clearWebVideoDraft().catch(() => {});
        }
        await signOut();
      } finally {
        router.replace('/');
      }
    };
    run();
  }, [router, signOut]);

  return (
    <AnimatedAuroraBackground>
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#49d8d5" />
        <ThemedText style={styles.text}>Signing you out...</ThemedText>
      </View>
    </AnimatedAuroraBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  text: {
    color: '#d9ebff',
    fontFamily: Fonts.rounded,
    fontSize: 16,
  },
});
