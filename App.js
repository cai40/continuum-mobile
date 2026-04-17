import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AppProvider, useAppContext } from './src/context/AppContext';
import ChatSection from './src/components/ChatSection';
import SettingsSection from './src/components/SettingsSection';
import LoginSection from './src/components/LoginSection';
import StatusIndicator from './src/components/shared/StatusIndicator';
import { styles, theme } from './src/styles/theme';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from './src/constants/Config';

// Initialize Sentry for Phase 3 Production Observability
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // debug: __DEV__, // Only enable in development if needed
  });
}

const AppShell = () => {
  const { 
    user,
    activeTab, setActiveTab, 
    provider, 
    serverStatus 
  } = useAppContext();

  if (!user) {
    return <LoginSection />;
  }

  const renderSection = () => {
    switch (activeTab) {
      case 'chat': return <ChatSection />;
      case 'settings': return <SettingsSection />;
      default: return <ChatSection />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* GLOBAL HEADER */}
      <View style={{
        paddingHorizontal: 20, 
        height: 60, 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        backgroundColor: theme.colors.white,
        borderBottomWidth: 0.5,
        borderColor: theme.colors.border
      }}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text style={{color: theme.colors.black, fontSize: 18, fontWeight: '800'}}>
            {activeTab === 'chat' ? 'Continuum' : 'Setup'}
          </Text>
          {activeTab === 'chat' && (
            <View style={{marginLeft: 8, backgroundColor: theme.colors.light, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4}}>
              <Text style={{color: theme.colors.gray, fontSize: 10, fontWeight: 'bold'}}>{provider.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <StatusIndicator status={serverStatus} />
          <TouchableOpacity 
            style={{marginLeft: 12}}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab('settings'); }}
          >
            <Ionicons name="settings-outline" size={22} color={theme.colors.black} />
          </TouchableOpacity>
        </View>
      </View>

      {/* CLOUD HEARTBEAT INDICATOR */}

      {/* MAIN CONTENT AREA */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.mainArea}>
        {renderSection()}
      </KeyboardAvoidingView>

      {/* NAVIGATION BAR */}
      <View style={styles.tabBar}>
        <TabItem icon="chatbubble-ellipses" label="Continuum" tab="chat" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabItem icon="options" label="Setup" tab="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

const TabItem = ({ icon, label, tab, activeTab, setActiveTab }) => {
  const isActive = activeTab === tab;
  return (
    <TouchableOpacity 
      style={styles.tabItem} 
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(tab); }}
    >
      <Ionicons name={isActive ? icon : `${icon}-outline`} size={24} color={isActive ? theme.colors.primary : theme.colors.gray} />
      <Text style={[styles.tabLabel, {color: isActive ? theme.colors.primary : theme.colors.gray}]}>{label}</Text>
    </TouchableOpacity>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
