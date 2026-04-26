import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, SafeAreaView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../styles/theme';
import { useAppContext } from '../context/AppContext';

const LegalGate = () => {
  const { hasAcceptedLegal, recordLegalAcceptance } = useAppContext();
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const handleScroll = (event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 20;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom) {
      setHasScrolledToBottom(true);
    }
  };

  if (hasAcceptedLegal) return null;

  return (
    <Modal visible={!hasAcceptedLegal} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={32} color={theme.colors.primary} />
          <Text style={styles.title}>Legal Agreement</Text>
          <Text style={styles.subtitle}>Please review our terms and privacy policy to continue.</Text>
        </View>

        <ScrollView 
          style={styles.scroll} 
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.sectionTitle}>1. PRIVACY POLICY</Text>
          <Text style={styles.bodyText}>
            Continuum is designed as a "Memory OS". To provide its core services, we process and store:
            {"\n\n"}• Voice recordings (transcribed locally and processed by neural engines)
            {"\n"}• Chat history and semantic memories
            {"\n"}• Geographic location (for contextual weather and services)
            {"\n"}• Personal information provided during account creation
            {"\n\n"}We use industry-standard encryption to protect your data. Your memories are your own; we do not sell your personal data to third parties.
          </Text>

          <Text style={styles.sectionTitle}>2. TERMS OF USE</Text>
          <Text style={styles.bodyText}>
            By using Continuum, you agree to:
            {"\n\n"}• Provide accurate account information.
            {"\n"}• Use the service responsibly and not for illegal purposes.
            {"\n"}• Acknowledge that AI-generated content can occasionally be inaccurate.
            {"\n"}• Understand that cloud services (Groq, Gemini, OpenRouter) are utilized for advanced intelligence.
            {"\n\n"}Continuum is provided "as is" without warranties of any kind.
          </Text>

          <Text style={styles.sectionTitle}>3. AUDIT LOGGING</Text>
          <Text style={styles.bodyText}>
            To comply with legal requirements, a record of this acceptance (including your email, timestamp, and IP address) will be stored in our permanent audit log. This record persists even if you choose to delete your account.
          </Text>
          
          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={styles.footer}>
          {!hasScrolledToBottom && (
            <Text style={styles.scrollPrompt}>Please scroll to the bottom to accept</Text>
          )}
          <TouchableOpacity 
            style={[styles.button, !hasScrolledToBottom && styles.buttonDisabled]} 
            onPress={recordLegalAcceptance}
            disabled={!hasScrolledToBottom}
          >
            <Text style={styles.buttonText}>I Accept & Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.white },
  header: { padding: 24, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { fontSize: 24, fontWeight: '800', color: theme.colors.black, marginTop: 12 },
  subtitle: { fontSize: 13, color: theme.colors.gray, textAlign: 'center', marginTop: 8 },
  scroll: { flex: 1, padding: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.black, marginTop: 20, marginBottom: 10 },
  bodyText: { fontSize: 14, color: theme.colors.gray, lineHeight: 22 },
  footer: { padding: 24, borderTopWidth: 1, borderTopColor: theme.colors.border },
  scrollPrompt: { textAlign: 'center', color: theme.colors.primary, fontSize: 11, fontWeight: '700', marginBottom: 12 },
  button: { 
    backgroundColor: theme.colors.primary, 
    height: 56, 
    borderRadius: 16, 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4
  },
  buttonDisabled: { backgroundColor: theme.colors.gray, shadowOpacity: 0 },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '800' }
});

export default LegalGate;
