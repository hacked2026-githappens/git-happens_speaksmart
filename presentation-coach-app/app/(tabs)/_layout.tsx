import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Href, Slot, usePathname, useRouter } from 'expo-router';

import { AnimatedAuroraBackground } from '@/components/animated-aurora-background';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

type NavItem = {
  label: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Coach', href: '/(tabs)', icon: 'mic-outline' },
  { label: 'History', href: '/(tabs)/history', icon: 'bar-chart-outline' },
  { label: 'Practice', href: '/(tabs)/drill', icon: 'radio-outline' },
  { label: 'Guide', href: '/(tabs)/explore', icon: 'book-outline' },
];

function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: (href: Href) => void;
}) {
  const pathname = usePathname();
  const currentPath = pathname === '/' ? '/(tabs)' : pathname;

  return (
    <View style={[styles.sidebar, collapsed && styles.sidebarCollapsed]}>
      <View style={styles.sidebarTop}>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Ionicons name="mic-outline" size={15} color="#53d7dd" />
          </View>
          {!collapsed && (
            <View>
              <ThemedText style={styles.brandTitle}>SpeakSmart</ThemedText>
              <ThemedText style={styles.brandSub}>Presentation Coach</ThemedText>
            </View>
          )}
        </View>

        <View style={styles.navGroup}>
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.href;
            return (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.label}`}
                onPress={() => onNavigate(item.href)}
                style={({ pressed }) => [
                  styles.navButton,
                  collapsed && styles.navButtonCollapsed,
                  active && styles.navButtonActive,
                  pressed && styles.navButtonPressed,
                ]}>
                <Ionicons name={item.icon} size={16} color={active ? '#dffdff' : '#93abd1'} />
                {!collapsed && (
                  <ThemedText style={[styles.navLabel, active && styles.navLabelActive]}>
                    {item.label}
                  </ThemedText>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.sidebarBottom}>
        {!collapsed && (
          <View style={styles.tipCard}>
            <ThemedText style={styles.tipTitle}>Pro Tip</ThemedText>
            <ThemedText style={styles.tipText}>Practice 10 min daily to compound confidence gains.</ThemedText>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          onPress={() => onNavigate('/logout')}
          style={({ pressed }) => [
            styles.logoutButton,
            collapsed && styles.navButtonCollapsed,
            pressed && styles.navButtonPressed,
          ]}>
          <Ionicons name="log-out-outline" size={16} color="#ffd2dc" />
          {!collapsed && <ThemedText style={styles.logoutLabel}>Log out</ThemedText>}
        </Pressable>
      </View>
    </View>
  );
}

export default function TabsDashboardLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isMobile = width < 980;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const pageTitle = useMemo(() => {
    const match = NAV_ITEMS.find(
      (item) => pathname === item.href || (pathname === '/' && item.href === '/(tabs)'),
    );
    return match?.label ?? 'Dashboard';
  }, [pathname]);

  const go = (href: Href) => {
    router.push(href);
  };

  return (
    <AnimatedAuroraBackground>
      <View style={styles.root}>
        {!isMobile && <Sidebar collapsed={collapsed} onNavigate={go} />}

        <View style={styles.main}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isMobile ? 'Open dashboard sidebar' : 'Toggle sidebar'}
              onPress={() => (isMobile ? setMobileOpen(true) : setCollapsed((v) => !v))}
              style={({ pressed }) => [styles.toggleBtn, pressed && styles.navButtonPressed]}>
              <Ionicons name="menu-outline" size={18} color="#d6e8ff" />
            </Pressable>
            <ThemedText style={styles.topBarTitle}>{pageTitle}</ThemedText>
            <View style={styles.userChip}>
              <ThemedText style={styles.userChipText}>U</ThemedText>
            </View>
          </View>

          <View style={styles.content}>
            <Slot />
          </View>
        </View>

        {isMobile && mobileOpen && (
          <View style={styles.mobileOverlay}>
            <Pressable style={styles.mobileBackdrop} onPress={() => setMobileOpen(false)} />
            <Sidebar collapsed={false} onNavigate={go} />
          </View>
        )}
      </View>
    </AnimatedAuroraBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 240,
    borderRightWidth: 1,
    borderRightColor: 'rgba(105, 132, 188, 0.28)',
    backgroundColor: 'rgba(10, 20, 44, 0.86)',
    padding: 12,
    justifyContent: 'space-between',
  },
  sidebarCollapsed: {
    width: 84,
  },
  sidebarTop: {
    gap: 16,
  },
  brandRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(52, 108, 191, 0.48)',
    borderWidth: 1,
    borderColor: 'rgba(104, 182, 244, 0.35)',
  },
  brandTitle: {
    color: '#ebf4ff',
    fontFamily: Fonts.rounded,
    fontSize: 20,
  },
  brandSub: {
    color: '#8ba2c9',
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  navGroup: {
    gap: 8,
  },
  navButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(88, 116, 168, 0.36)',
    backgroundColor: 'rgba(12, 26, 58, 0.5)',
  },
  navButtonCollapsed: {
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  navButtonActive: {
    borderColor: 'rgba(90, 195, 228, 0.42)',
    backgroundColor: 'rgba(44, 132, 175, 0.42)',
  },
  navButtonPressed: {
    opacity: 0.88,
  },
  navLabel: {
    color: '#93abd1',
    fontFamily: Fonts.rounded,
    fontSize: 14,
  },
  navLabelActive: {
    color: '#dcf9ff',
  },
  sidebarBottom: {
    gap: 10,
  },
  tipCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 143, 208, 0.36)',
    backgroundColor: 'rgba(22, 38, 78, 0.52)',
    padding: 10,
    gap: 4,
  },
  tipTitle: {
    color: '#9ed7ee',
    fontFamily: Fonts.rounded,
    fontSize: 12,
  },
  tipText: {
    color: '#96accd',
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  logoutButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(198, 114, 140, 0.44)',
    backgroundColor: 'rgba(82, 24, 41, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutLabel: {
    color: '#ffd8df',
    fontFamily: Fonts.rounded,
    fontSize: 14,
  },
  main: {
    flex: 1,
  },
  topBar: {
    height: 62,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(104, 132, 187, 0.28)',
    backgroundColor: 'rgba(9, 18, 38, 0.82)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(104, 132, 187, 0.36)',
    backgroundColor: 'rgba(18, 31, 65, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    color: '#e7f0ff',
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  userChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(112, 92, 210, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(188, 169, 255, 0.4)',
  },
  userChipText: {
    color: '#f3eaff',
    fontFamily: Fonts.rounded,
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  mobileOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  mobileBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
});
