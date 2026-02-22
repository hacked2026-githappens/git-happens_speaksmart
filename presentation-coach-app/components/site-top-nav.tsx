import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

const NAV_ITEMS = [
  { label: 'Coach', href: '/(tabs)', icon: 'mic-outline' as const },
  { label: 'History', href: '/(tabs)/history', icon: 'bar-chart-outline' as const },
  { label: 'Guide', href: '/(tabs)/explore', icon: 'book-outline' as const },
];

export function SiteTopNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={styles.wrapper}>
      <View style={styles.brandRow}>
        <View style={styles.logoBubble}>
          <Ionicons name="mic-outline" size={14} color="#45d8df" />
        </View>
        <ThemedText style={styles.brandText}>SpeakSmart</ThemedText>
      </View>

      <View style={styles.linksRow}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href === '/(tabs)' && pathname === '/');
          return (
            <Pressable
              key={item.href}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label} page`}
              onPress={() => router.push(item.href)}
              style={({ pressed }) => [
                styles.linkButton,
                active && styles.linkButtonActive,
                pressed && styles.linkButtonPressed,
              ]}>
              <Ionicons name={item.icon} size={14} color={active ? '#dcf9ff' : '#95abd0'} />
              <ThemedText style={[styles.linkText, active && styles.linkTextActive]}>{item.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log out"
        onPress={() => router.push('/logout')}
        style={({ pressed }) => [styles.logoutButton, pressed && styles.linkButtonPressed]}>
        <Ionicons name="log-out-outline" size={14} color="#ffccd6" />
        <ThemedText style={styles.logoutText}>Log out</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 74,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(104, 132, 187, 0.28)',
    backgroundColor: 'rgba(11, 19, 40, 0.88)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBubble: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(37, 98, 165, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(91, 167, 235, 0.36)',
  },
  brandText: {
    color: '#e8f1ff',
    fontFamily: Fonts.rounded,
    fontSize: 21,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  linkButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(91, 118, 170, 0.44)',
    backgroundColor: 'rgba(14, 24, 53, 0.55)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkButtonActive: {
    backgroundColor: 'rgba(39, 108, 183, 0.72)',
    borderColor: 'rgba(106, 191, 255, 0.54)',
  },
  linkButtonPressed: {
    opacity: 0.9,
  },
  linkText: {
    color: '#95abd0',
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
  linkTextActive: {
    color: '#dcf9ff',
  },
  logoutButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(204, 120, 140, 0.45)',
    backgroundColor: 'rgba(81, 25, 39, 0.32)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoutText: {
    color: '#ffd8df',
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
});
