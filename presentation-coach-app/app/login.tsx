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

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <LinearGradient colors={['#f4e6d8', '#fff8ee', '#e8f5f3']} style={styles.gradient}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.logoRow}>
          <Ionicons name="mic" size={32} color="#d1652c" />
          <ThemedText style={styles.appName}>SpeakSmart</ThemedText>
        </View>

        <ThemedText style={styles.headline}>
          {mode === 'signin' ? 'Welcome back' : 'Create account'}
        </ThemedText>
        <ThemedText style={styles.subheadline}>
          {mode === 'signin'
            ? 'Sign in to track your progress over time.'
            : 'Join to save your coaching sessions and track growth.'}
        </ThemedText>

        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9a8272"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9a8272"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              pressed && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={busy}>
            <ThemedText style={styles.submitButtonText}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
            </ThemedText>
          </Pressable>

          <Pressable
            style={styles.toggleRow}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            <ThemedText style={styles.toggleText}>
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <ThemedText style={styles.toggleLink}>
                {mode === 'signin' ? 'Sign Up' : 'Sign In'}
              </ThemedText>
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  appName: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    color: '#2f2219',
  },
  headline: {
    fontFamily: Fonts.rounded,
    fontSize: 26,
    color: '#2f2219',
  },
  subheadline: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6b5446',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff8ee',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e7c9a4',
    padding: 20,
    gap: 12,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e7c9a4',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#2f2219',
    backgroundColor: '#fffcf5',
    fontFamily: Fonts.sans,
  },
  submitButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#d1652c',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitButtonText: {
    color: '#fff6e9',
    fontFamily: Fonts.rounded,
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  toggleRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  toggleText: {
    fontSize: 14,
    color: '#6b5446',
    fontFamily: Fonts.sans,
  },
  toggleLink: {
    color: '#d1652c',
    fontFamily: Fonts.rounded,
  },
});
