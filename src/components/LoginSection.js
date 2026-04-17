import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import { theme } from '../styles/theme';

const LoginSection = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Required", "Please enter both email and password.");
      return;
    }
    
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert("Success", "Check your email for the confirmation link!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      Alert.alert("Auth Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={loginStyles.container}
    >
      <View style={loginStyles.content}>
        <View style={loginStyles.header}>
          <View style={loginStyles.logoCircle}>
             <Ionicons name="pulse" size={40} color={theme.colors.primary} />
          </View>
          <Text style={loginStyles.title}>Continuum</Text>
          <Text style={loginStyles.subtitle}>Your Autonomous Memory AI</Text>
        </View>

        <View style={loginStyles.form}>
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
            />
          </View>

          <View style={loginStyles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.colors.gray} style={loginStyles.inputIcon} />
            <TextInput 
              style={loginStyles.input}
              placeholder="Password"
              placeholderTextColor={theme.colors.gray}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity 
            style={loginStyles.primaryButton} 
            onPress={handleAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={loginStyles.buttonText}>{isSignUp ? "Create Account" : "Sign In"}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={loginStyles.secondaryButton} 
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsSignUp(!isSignUp);
            }}
          >
            <Text style={loginStyles.secondaryButtonText}>
              {isSignUp ? "Already have an account? Sign In" : "New to Continuum? Create Account"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.white,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
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
