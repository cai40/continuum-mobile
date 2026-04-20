import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Platform, KeyboardAvoidingView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Updates from 'expo-updates';
import { AppProvider, useAppContext } from './src/context/AppContext';
import ChatSection from './src/components/ChatSection';
import SettingsSection from './src/components/SettingsSection';
import LoginSection from './src/components/LoginSection';
import SubscriptionSection from './src/components/SubscriptionSection';
import StatusIndicator from './src/components/shared/StatusIndicator';
import { styles, theme } from './src/styles/theme';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from './src/constants/Config';

// Initialize Sentry for Phase 3 Production Observability
if (SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      // debug: __DEV__, // Only enable in development if needed
    });
  } catch (e) {
    console.error("Sentry Init Failed:", e);
  }
}

const AppShell = () => {
  const { 
    user,
    activeTab, setActiveTab, 
    provider, 
    serverStatus,
    isInitializing
  } = useAppContext();

  if (isInitializing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#051431', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ color: 'white', marginTop: 16, fontSize: 12, opacity: 0.6 }}>Continuum is waking up...</Text>
      </View>
    );
  }

  // Programmatic Update Enforcement
  React.useEffect(() => {
    async function onFetchUpdateAsync() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          Alert.alert(
            "New Memory Brain Available",
            "Continuum has been updated to v2.1.0 with the new Intelligence Vault. Restart to apply changes?",
            [
              { text: "Later", style: "cancel" },
              { text: "Restart Now", onPress: () => Updates.reloadAsync() }
            ]
          );
        }
      } catch (error) {
        // If fetch fails (offline), siliently continue.
        console.warn("Update Check Error:", error);
      }
    }
    
    // Force check regardless of dev environment for this structural sync pass
    onFetchUpdateAsync();
  }, []);

  if (!user) {
    return <LoginSection />;
  }


  return (
    <SafeAreaView style={styles.container}>
      {/* GLOBAL HEADER */}
      <View style={{
        paddingHorizontal: 20, 
        paddingVertical: 12,
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        backgroundColor: theme.colors.white,
        borderBottomWidth: 0.5,
        borderColor: theme.colors.border,
        marginTop: Platform.OS === 'ios' ? 0 : 30 // Extra Android safe area if needed
      }}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text style={{color: theme.colors.black, fontSize: 18, fontWeight: '800'}}>
              {activeTab === 'chat' ? 'Continuum' : 'Setup'}
            </Text>
          </View>
          
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
            {activeTab === 'chat' && (
              <View style={{backgroundColor: theme.colors.light, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4}}>
                <Text style={{color: theme.colors.gray, fontSize: 8, fontWeight: '900'}}>
                  {provider === 'openrouter' ? 'CLAUDE' : 
                   (provider === 'or_free' ? 'OR FREE' : 
                   (provider === 'deepseek' ? 'DEEPSEEK' :
                   (provider === 'qwen' ? 'QWEN' : 
                   (provider === 'gpt4o_mini' ? '4o MINI' : provider.toUpperCase()))))}
                </Text>
              </View>
            )}

            <View style={{backgroundColor: theme.colors.success + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.success + '30'}}>
              <Text style={{color: theme.colors.success, fontSize: 8, fontWeight: '900'}}>CLOUD</Text>
            </View>

            <StatusIndicator status={serverStatus} />
          </View>
        </View>
      </View>

      {/* CLOUD HEARTBEAT INDICATOR */}

      {/* MAIN CONTENT AREA */}
      <View style={{ flex: 1, position: 'relative' }}>
        {/* CHAT LAYER */}
        <View 
          style={[
            StyleSheet.absoluteFill, 
            { opacity: activeTab === 'chat' ? 1 : 0, zIndex: activeTab === 'chat' ? 10 : 0 }
          ]}
          pointerEvents={activeTab === 'chat' ? 'auto' : 'none'}
        >
          <ChatSection />
        </View>

        {/* SETUP LAYER */}
        <View 
          style={[
            StyleSheet.absoluteFill, 
            { opacity: activeTab === 'settings' ? 1 : 0, zIndex: activeTab === 'settings' ? 10 : 0 }
          ]}
          pointerEvents={activeTab === 'settings' ? 'auto' : 'none'}
        >
          <SettingsSection onUpgrade={() => setActiveTab('subscription')} />
        </View>

        {/* SUBSCRIPTION LAYER (KEEP CONDITIONAL AS IT IS MODAL-LIKE) */}
        {activeTab === 'subscription' && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
            <SubscriptionSection onBack={() => setActiveTab('settings')} />
          </View>
        )}
      </View>

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

// --- CRASH DEFENSE ENGINE: GLOBAL ERROR BOUNDARY ---
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("FATAL CONTINUUM CRASH:", error, errorInfo);
    this.setState({ errorInfo });
    // In production, we'd also log to a custom endpoint here since Sentry is off
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#7f1d1d', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="alert-circle" size={80} color="white" style={{ alignSelf: 'center', marginBottom: 24 }} />
          <Text style={{ color: 'white', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 16 }}>
            Continuum Critical Fault
          </Text>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 12, marginBottom: 24 }}>
            <Text style={{ color: '#fca5a5', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 }}>
              {this.state.error?.toString()}
            </Text>
            {this.state.errorInfo?.componentStack && (
              <Text style={{ color: '#f87171', fontSize: 10, marginTop: 8 }} numberOfLines={10}>
                {this.state.errorInfo.componentStack}
              </Text>
            )}
          </View>
          <TouchableOpacity 
            onPress={() => Updates.reloadAsync()}
            style={{ backgroundColor: 'white', padding: 16, borderRadius: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#7f1d1d', fontWeight: '800' }}>FORCE REBOOT BRAIN</Text>
          </TouchableOpacity>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'center', marginTop: 16 }}>
            v2.3.0_DEBUG_MODE
          </Text>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </GlobalErrorBoundary>
  );
}
