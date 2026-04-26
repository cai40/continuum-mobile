import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Updates from 'expo-updates';
import { supabase } from '../services/supabase';
import { theme } from '../styles/theme';
import { BUILD_ID } from '../constants/Config';


import { useAppContext } from '../context/AppContext';


const LoginHeader = React.memo(() => {
  const { serverVersion } = useAppContext();
  return (
    <View style={loginStyles.header}>
      <View style={loginStyles.logoCircle}>
         <Ionicons name="pulse" size={40} color={theme.colors.primary} />
      </View>
      <Text style={loginStyles.title}>Continuum</Text>
      <Text style={{ color: theme.colors.gray, fontSize: 10, marginTop: 10 }}>
        {serverVersion || 'Connecting...'}
      </Text>
      <Text style={loginStyles.subtitle}>Your Autonomous Memory AI</Text>
    </View>
  );
});

const LoginSection = () => {
  const { serverVersion, user, setIsBiometricAuthenticated } = useAppContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Load saved credentials on mount with Biometric Verification
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        // 1. Initial Hardware Check
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        
        if (hasHardware && isEnrolled) {
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: user ? 'Unlock Continuum' : 'Login to Continuum',
            fallbackLabel: 'Use Passcode',
          });
          
          if (result.success) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            
            if (user) {
              // CASE A: User has a session but is locked (Re-entry)
              setIsBiometricAuthenticated(true);
            } else {
              // CASE B: User is cold-starting without a session
              const savedEmail = await AsyncStorage.getItem('saved_email');
              const savedPass = await AsyncStorage.getItem('saved_password');
              
              if (savedEmail && savedPass) {
                setEmail(savedEmail);
                setPassword(savedPass);
                // Trigger auto-login with restored credentials
                await performAuth(savedEmail, savedPass);
              }
            }
          }
        } else {
          // No biometrics available, try to at least fill email for convenience
          const savedEmail = await AsyncStorage.getItem('saved_email');
          if (savedEmail) setEmail(savedEmail);
        }
      } catch (e) { console.warn("Biometric check failed:", e); }
    };
    loadCredentials();
  }, [user]);

  // ─── Shared Auth Logic ────────────────────────────────────────────────────────
  const performAuth = async (targetEmail, targetPass) => {
    setLoading(true);
    try {
      const { error, data } = await supabase.auth.signInWithPassword({ 
        email: targetEmail.trim(), 
        password: targetPass 
      });
      if (error) throw error;
      
      await AsyncStorage.setItem('saved_email', targetEmail.trim());
      await AsyncStorage.setItem('saved_password', targetPass);
      
      // On successful login, also set biometric as authenticated for this session
      setIsBiometricAuthenticated(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Auth Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Force OTA Update ────────────────────────────────────────────────────────
  const forceUpdateCheck = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    
    try {
      // Safety Check: Is the updates module active in this build?
      if (!Updates.isEnabled) {
        Alert.alert("Cloud Status", "Offline Mode: This build does not have OTA syncing enabled.");
        setIsSyncing(false);
        return;
      }

      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } else {
        Alert.alert(
          'Continuum Sync',
          'Your app is already running the latest cloud brain. Force a reload anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reload Now', onPress: () => Updates.reloadAsync().catch(() => {}) }
          ]
        );
      }
    } catch (err) {
      console.log("Sync Error:", err);
      Alert.alert("Cloud Sync", "System is up to date. Manual reload recommended if issues persist.");
    } finally {
      setIsSyncing(false);
    }
  };

  // ─── Password Reset ───────────────────────────────────────────────────────────
  const handlePasswordReset = async () => {
    if (!email.trim()) {
      Alert.alert('Email Required', 'Please enter your email address above, then tap "Forgot Password".');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'continuum://reset-password',
      });
      if (error) throw error;
      Alert.alert(
        'Reset Email Sent',
        `A password reset link has been sent to ${email.trim()}. Check your inbox.`
      );
    } catch (error) {
      Alert.alert('Reset Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Sign In / Sign Up ────────────────────────────────────────────────────────
  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Required', 'Please enter both email and password.');
      return;
    }

    if (isSignUp) {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data?.user && !data?.session) {
          Alert.alert(
            'Verify Your Email',
            `A confirmation link has been sent to ${email.trim()}. Please check your inbox.`,
            [{ text: 'OK' }]
          );
        }
      } catch (error) {
        Alert.alert('Auth Error', error.message);
      } finally {
        setLoading(false);
      }
    } else {
      await performAuth(email, password);
    }
  };

  // ─── LOCKED STATE UI ────────────────────────────────────────────────────────
  if (user) {
    return (
      <View style={loginStyles.container}>
        <View style={loginStyles.content}>
          <LoginHeader />
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <View style={{ 
              width: 100, height: 100, borderRadius: 50, 
              backgroundColor: theme.colors.light, 
              justifyContent: 'center', alignItems: 'center',
              marginBottom: 24
            }}>
              <Ionicons name="lock-closed" size={48} color={theme.colors.primary} />
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: theme.colors.black }}>Vault Locked</Text>
            <Text style={{ fontSize: 14, color: theme.colors.gray, marginTop: 8, textAlign: 'center' }}>
              Authentication required to access your memory brain.
            </Text>
            
            <TouchableOpacity
              style={[loginStyles.primaryButton, { width: '100%', marginTop: 40 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                // Trigger the same biometric logic manually
                const retryBiometric = async () => {
                  const result = await LocalAuthentication.authenticateAsync({
                    promptMessage: 'Unlock Continuum',
                    fallbackLabel: 'Use Passcode',
                  });
                  if (result.success) setIsBiometricAuthenticated(true);
                };
                retryBiometric();
              }}
            >
              <Text style={loginStyles.buttonText}>Unlock with Biometrics</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 24 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                supabase.auth.signOut();
                setIsBiometricAuthenticated(false);
              }}
            >
              <Text style={{ color: theme.colors.danger, fontWeight: '600' }}>Switch Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={loginStyles.container}>
      {/* Cloud Sync Button */}
      <View style={{ position: 'absolute', top: 60, right: 20, zIndex: 10 }}>
        <TouchableOpacity onPress={forceUpdateCheck} disabled={isSyncing}>
          <Ionicons
            name={isSyncing ? 'cloud-download' : 'cloud-done-outline'}
            size={24}
            color={isSyncing ? theme.colors.primary : theme.colors.gray}
            style={{ opacity: 0.6 }}
          />
        </TouchableOpacity>
      </View>

      <View style={loginStyles.content}>
        <LoginHeader />

        <View style={loginStyles.form}>
          {/* Email */}
          <View style={loginStyles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color={theme.colors.gray} style={loginStyles.inputIcon} />
            <TextInput
              style={loginStyles.input}
              placeholder="Email Address"
              placeholderTextColor={theme.colors.gray}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              autoCorrect={false}
              spellCheck={false}
            />
          </View>

          {/* Password + Show/Hide Toggle */}
          <View style={loginStyles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.colors.gray} style={loginStyles.inputIcon} />
            <TextInput
              style={loginStyles.input}
              placeholder="Password"
              placeholderTextColor={theme.colors.gray}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType="password"
              autoComplete="current-password"
              autoCorrect={false}
              spellCheck={false}
            />
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowPassword(prev => !prev);
              }}
              style={{ paddingHorizontal: 8 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={theme.colors.gray}
              />
            </TouchableOpacity>
          </View>

          {/* Forgot Password (only shown in Sign In mode) */}
          {!isSignUp && (
            <TouchableOpacity
              onPress={handlePasswordReset}
              style={loginStyles.forgotButton}
            >
              <Text style={loginStyles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          {/* Primary CTA */}
          <TouchableOpacity
            style={loginStyles.primaryButton}
            onPress={handleAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={loginStyles.buttonText}>
                {isSignUp ? 'Create Account' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Toggle Sign In / Sign Up */}
          <TouchableOpacity
            style={loginStyles.secondaryButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsSignUp(!isSignUp);
            }}
          >
            <Text style={loginStyles.secondaryButtonText}>
              {isSignUp ? 'Already have an account? Sign In' : 'New to Continuum? Create Account'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Version Watermark */}
        <View style={{ marginTop: 32, alignItems: 'center' }}>
          <Text style={{ color: theme.colors.gray, fontSize: 10, opacity: 0.4 }}>
            {serverVersion || BUILD_ID}
          </Text>
        </View>
      </View>
    </View>
  );
};

const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.white,
  },
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: theme.colors.black,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.gray,
    marginTop: 4,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.light,
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: theme.colors.black,
    fontSize: 16,
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 16,
    marginTop: -8,
  },
  forgotText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LoginSection;
