import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedAuroraBackground } from '@/components/animated-aurora-background';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    setBusy(true);
    try {
      const { error } =
        mode === 'signin'
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password);

      if (error) {
        Alert.alert(mode === 'signin' ? 'Sign in failed' : 'Sign up failed', error);
        return;
      }

      if (mode === 'signup') {
        Alert.alert(
          'Account created',
          'Check your email to confirm your account, then sign in.',
          [{ text: 'OK', onPress: () => setMode('signin') }],
        );
        return;
      }

      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedAuroraBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <View style={styles.brandBlock}>
            <View style={styles.brandIconWrap}>
              <Ionicons name="mic-outline" size={20} color="#30d7d4" />
            </View>
            <ThemedText style={styles.brandTitle}>SpeakSmart</ThemedText>
            <ThemedText style={styles.brandSubtitle}>Your AI presentation coach</ThemedText>
          </View>

          <View style={styles.form}>
            {mode === 'signup' && (
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Full name</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Jane Doe"
                  placeholderTextColor="#566384"
                  value={fullName}
                  onChangeText={setFullName}
                  editable={!busy}
                  accessibilityLabel="Full name"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#566384"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!busy}
                accessibilityLabel="Email address"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Password</ThemedText>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="********"
                  placeholderTextColor="#566384"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  onSubmitEditing={handleSubmit}
                  returnKeyType="go"
                  accessibilityLabel="Password"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeButton}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#8291b3" />
                </Pressable>
              </View>
            </View>

            {mode === 'signup' && (
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Confirm password</ThemedText>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="********"
                    placeholderTextColor="#566384"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    editable={!busy}
                    accessibilityLabel="Confirm password"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    onPress={() => setShowConfirmPassword((v) => !v)}
                    style={styles.eyeButton}>
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#8291b3"
                    />
                  </Pressable>
                </View>
              </View>
            )}

            {mode === 'signin' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Forgot password, unavailable"
                accessibilityState={{ disabled: true }}
                disabled
                style={styles.forgotButton}>
                <ThemedText style={styles.forgotText}>Forgot password?</ThemedText>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'signin' ? 'Sign in' : 'Create account'}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                busy && styles.primaryButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={busy}>
              <LinearGradient colors={['#33c2cd', '#43d1c2']} style={styles.primaryGradient}>
                <ThemedText style={styles.primaryButtonText}>
                  {busy ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create account'}
                </ThemedText>
              </LinearGradient>
            </Pressable>

            {mode === 'signin' && (
              <>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <ThemedText style={styles.dividerText}>or</ThemedText>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  style={({ pressed }) => [styles.googleButton, pressed && styles.googleButtonPressed]}>
                  <ThemedText style={styles.googleG}>G</ThemedText>
                  <ThemedText style={styles.googleButtonText}>Continue with Google</ThemedText>
                </Pressable>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'signin' ? 'Switch to sign up' : 'Switch to sign in'}
              onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              style={styles.toggleRow}>
              <ThemedText style={styles.toggleText}>
                {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
                <ThemedText style={styles.toggleLink}>
                  {mode === 'signin' ? 'Create an account' : 'Sign in'}
                </ThemedText>
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </AnimatedAuroraBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    maxWidth: 540,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(77, 104, 160, 0.34)',
    backgroundColor: 'rgba(18, 28, 61, 0.74)',
    padding: 24,
    shadowColor: '#060d1f',
    shadowOpacity: 0.42,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 22,
  },
  brandIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(36, 122, 176, 0.4)',
    marginBottom: 14,
  },
  brandTitle: {
    color: '#e9efff',
    fontFamily: Fonts.serif,
    fontSize: 54,
    lineHeight: 60,
    textAlign: 'center',
  },
  brandSubtitle: {
    marginTop: 4,
    color: '#8897b8',
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 21,
  },
  form: {
    gap: 14,
  },
  inputGroup: {
    gap: 9,
  },
  label: {
    color: '#c8d2e8',
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  input: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(76, 98, 146, 0.44)',
    backgroundColor: 'rgba(44, 53, 84, 0.46)',
    paddingHorizontal: 14,
    color: '#e5eeff',
    fontSize: 15,
    fontFamily: Fonts.sans,
  },
  passwordWrap: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(76, 98, 146, 0.44)',
    backgroundColor: 'rgba(44, 53, 84, 0.46)',
    paddingLeft: 14,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    color: '#e5eeff',
    fontSize: 15,
    fontFamily: Fonts.sans,
  },
  eyeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    minHeight: 24,
    justifyContent: 'center',
    marginTop: -2,
  },
  forgotText: {
    color: '#7f8dad',
    fontFamily: Fonts.sans,
    fontSize: 14,
  },
  primaryButton: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 2,
  },
  primaryGradient: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  primaryButtonText: {
    color: '#00141f',
    fontFamily: Fonts.rounded,
    fontSize: 23,
  },
  primaryButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
  primaryButtonDisabled: {
    opacity: 0.62,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(70, 89, 132, 0.4)',
  },
  dividerText: {
    color: '#7686a7',
    fontFamily: Fonts.sans,
    fontSize: 14,
    paddingHorizontal: 12,
  },
  googleButton: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(75, 95, 142, 0.42)',
    backgroundColor: 'rgba(26, 37, 70, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  googleButtonPressed: {
    opacity: 0.9,
  },
  googleG: {
    color: '#fbbf24',
    fontFamily: Fonts.rounded,
    fontSize: 21,
    lineHeight: 24,
  },
  googleButtonText: {
    color: '#e4ecfe',
    fontFamily: Fonts.rounded,
    fontSize: 15,
  },
  toggleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 2,
  },
  toggleText: {
    color: '#8192b5',
    fontFamily: Fonts.sans,
    fontSize: 14,
  },
  toggleLink: {
    color: '#30d7d4',
    fontFamily: Fonts.rounded,
  },
});
