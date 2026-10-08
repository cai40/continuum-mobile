import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, ScrollView, Platform, KeyboardAvoidingView, Alert, ActivityIndicator, StyleSheet, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Updates from 'expo-updates';
import * as Clipboard from 'expo-clipboard';
import './src/utils/alertUtils';
import { AppProvider, useAppContext } from './src/context/AppContext';
import ChatSection from './src/components/ChatSection';
import SettingsSection from './src/components/SettingsSection';
import MailClientSection from './src/components/MailClientSection';
import PhotoCleanupSection from './src/components/PhotoCleanupSection';
import LoginSection from './src/components/LoginSection';
import SubscriptionSection from './src/components/SubscriptionSection';
import LegalGate from './src/components/LegalGate';
import StatusIndicator from './src/components/shared/StatusIndicator';
import HeaderBadge from './src/components/shared/HeaderBadge';
import { styles, theme } from './src/styles/theme';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN, BUILD_ID } from './src/constants/Config';
import { providerDisplayLabel, providerBadgeColor, isOpenRouterKey, normalizeProviderId } from './src/utils/providers';

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
    isBiometricAuthenticated,
    activeTab, setActiveTab, 
    provider, 
    autoModelRouting,
    deepseekKey,
    geminiKey,
    activeResolvedProvider,
    serverStatus,
    isInitializing,
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
            `Continuum has been updated to ${BUILD_ID}. Restart to apply changes?`,
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

  if (!user || !isBiometricAuthenticated) {
    return <LoginSection />;
  }

  const headerTitle = {
    chat: 'Continuum',
    email: 'Email',
    photos: 'Photos',
    settings: 'Setup',
  }[activeTab] || 'Continuum';

  // Header badge reflects the model actually in use: the last one a chat
  // reply resolved to, or the auto-mode default before any message.
  const defaultAutoProvider = (() => {
    if (!autoModelRouting) return provider;
    const dsKey = (deepseekKey || '').trim();
    const gmKey = (geminiKey || '').trim();
    if (dsKey && !isOpenRouterKey(dsKey)) return 'deepseek_v4_flash';
    if (gmKey) return 'gemini';
    return provider;
  })();
  const badgeProvider = activeResolvedProvider || normalizeProviderId(defaultAutoProvider);
  const providerLabel = providerDisplayLabel(badgeProvider);
  const providerColor = providerBadgeColor(badgeProvider, theme.colors);

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
          <View style={{flexDirection: 'row', alignItems: 'center', flexShrink: 1}}>
            <Text numberOfLines={1} style={{color: theme.colors.black, fontSize: 18, fontWeight: '800'}}>
              {headerTitle}
            </Text>
          </View>
          
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end'}}>
            <HeaderBadge label={providerLabel} color={providerColor} />

            <HeaderBadge label="CLOUD" color={theme.colors.success} />

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

        <View 
          style={[
            StyleSheet.absoluteFill, 
            { opacity: activeTab === 'email' ? 1 : 0, zIndex: activeTab === 'email' ? 10 : 0 }
          ]}
          pointerEvents={activeTab === 'email' ? 'auto' : 'none'}
        >
          <MailClientSection />
        </View>

        <View 
          style={[
            StyleSheet.absoluteFill, 
            { opacity: activeTab === 'photos' ? 1 : 0, zIndex: activeTab === 'photos' ? 10 : 0 }
          ]}
          pointerEvents={activeTab === 'photos' ? 'auto' : 'none'}
        >
          <PhotoCleanupSection />
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
        <TabItem icon="mail" label="Email" tab="email" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabItem icon="images" label="Photos" tab="photos" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabItem icon="options" label="Setup" tab="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
      </View>

      <LegalGate />
    </SafeAreaView>
  );
}

const TabItem = ({ icon, label, tab, activeTab, setActiveTab }) => {
  const isActive = activeTab === tab;
  return (
    <TouchableOpacity 
      style={styles.tabItem} 
      onPress={() => { Keyboard.dismiss(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(tab); }}
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
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("FATAL CONTINUUM CRASH:", error, errorInfo);
    this.setState({ errorInfo });
    // In production, we'd also log to a custom endpoint here since Sentry is off
  }

  componentDidMount() {
    if (typeof global !== 'undefined') {
      global.__criticalFaultHandler = (error, errorInfo) => {
        this.setState({ hasError: true, error, errorInfo });
      };
      if (global.ErrorUtils && !global.ErrorUtils._continuumHooked) {
        global.ErrorUtils._continuumHooked = true;
        const defaultHandler = global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
        global.ErrorUtils.setGlobalHandler((error, isFatal) => {
          if (global.__criticalFaultHandler) {
            global.__criticalFaultHandler(error, { isFatal });
          }
          if (defaultHandler) {
            defaultHandler(error, isFatal);
          }
        });
      }
    }
  }

  componentWillUnmount() {
    if (typeof global !== 'undefined' && global.__criticalFaultHandler === this) {
      global.__criticalFaultHandler = null;
    }
  }

  handleCopyError = async () => {
    try {
      const parts = [
        `=== CONTINUUM CRITICAL FAULT ===`,
        `Build: ${BUILD_ID}`,
        `Platform: ${Platform.OS} (${Platform.Version})`,
        `Timestamp: ${new Date().toISOString()}`,
        `\n[Error Message]`,
        this.state.error?.message || this.state.error?.toString() || 'Unknown runtime error',
      ];

      if (this.state.error?.stack) {
        parts.push(`\n[JavaScript Stack Trace]\n${this.state.error.stack}`);
      }

      if (this.state.errorInfo?.componentStack) {
        parts.push(`\n[React Component Stack]\n${this.state.errorInfo.componentStack}`);
      }

      const fullErrorText = parts.join('\n');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(fullErrorText);
      }
      try {
        if (Haptics?.notificationAsync) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch {}
      this.setState({ copied: true });
      setTimeout(() => {
        this.setState({ copied: false });
      }, 3000);
    } catch (err) {
      console.error("Failed to copy error to clipboard:", err);
    }
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  render() {
    if (this.state.hasError) {
      const errorString = this.state.error?.message || this.state.error?.toString() || 'Unknown runtime error';
      const jsStack = this.state.error?.stack;
      const componentStack = this.state.errorInfo?.componentStack;

      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#7f1d1d' }}>
          <ScrollView 
            contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
            showsVerticalScrollIndicator={true}
          >
            <Ionicons name="alert-circle" size={72} color="white" style={{ alignSelf: 'center', marginTop: 12, marginBottom: 16 }} />
            <Text 
              selectable={true}
              style={{ color: 'white', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}
            >
              Continuum Critical Fault
            </Text>
            <Text 
              selectable={true}
              style={{ color: '#fecaca', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 }}
            >
              An unexpected error interrupted the runtime. Tap "Copy Error Details" below so you can paste the diagnostic report directly into chat.
            </Text>

            {/* ACTION BUTTONS */}
            <View style={{ marginBottom: 20, gap: 10 }}>
              <TouchableOpacity 
                onPress={this.handleCopyError}
                activeOpacity={0.8}
                style={{ 
                  backgroundColor: this.state.copied ? '#15803d' : 'white', 
                  paddingVertical: 14, 
                  paddingHorizontal: 20, 
                  borderRadius: 12, 
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 3.84,
                  elevation: 5,
                }}
              >
                <Ionicons 
                  name={this.state.copied ? "checkmark-circle" : "copy-outline"} 
                  size={20} 
                  color={this.state.copied ? 'white' : '#7f1d1d'} 
                  style={{ marginRight: 8 }} 
                />
                <Text style={{ color: this.state.copied ? 'white' : '#7f1d1d', fontWeight: '800', fontSize: 15 }}>
                  {this.state.copied ? "✓ COPIED TO CLIPBOARD!" : "COPY ERROR DETAILS"}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity 
                  onPress={this.handleDismiss}
                  activeOpacity={0.8}
                  style={{ 
                    flex: 1,
                    backgroundColor: 'rgba(255,255,255,0.15)', 
                    paddingVertical: 12, 
                    borderRadius: 10, 
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)'
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>TRY RECOVERING</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={() => Updates.reloadAsync()}
                  activeOpacity={0.8}
                  style={{ 
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.4)', 
                    paddingVertical: 12, 
                    borderRadius: 10, 
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.2)'
                  }}
                >
                  <Text style={{ color: '#fca5a5', fontWeight: '700', fontSize: 13 }}>REBOOT APP</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ERROR DETAILS BOX */}
            <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.2)', paddingBottom: 6 }}>
                <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Diagnostics (Selectable)
                </Text>
                <TouchableOpacity onPress={this.handleCopyError} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '600' }}>
                    {this.state.copied ? "✓ Copied" : "Copy"}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text 
                selectable={true} 
                style={{ color: '#fef08a', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, fontWeight: '600', marginBottom: 8 }}
              >
                {errorString}
              </Text>

              {jsStack && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', marginBottom: 4 }}>
                    JAVASCRIPT STACK:
                  </Text>
                  <Text 
                    selectable={true} 
                    style={{ color: '#fca5a5', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, lineHeight: 14 }}
                  >
                    {jsStack}
                  </Text>
                </View>
              )}

              {componentStack && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', marginBottom: 4 }}>
                    COMPONENT STACK:
                  </Text>
                  <Text 
                    selectable={true} 
                    style={{ color: '#f87171', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, lineHeight: 14 }}
                  >
                    {componentStack}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <Text selectable={true} style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                Build: {this.context?.serverVersion || BUILD_ID} · Platform: {Platform.OS}
              </Text>
            </View>
          </ScrollView>
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
