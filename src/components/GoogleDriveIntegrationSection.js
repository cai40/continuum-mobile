import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { theme } from '../styles/theme';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getGoogleDriveConnection,
  getGoogleDriveRedirectUri,
  loadGoogleClientIds,
  saveGoogleClientIds,
} from '../services/googleDriveAuth';

const GoogleDriveIntegrationSection = ({ onBack }) => {
  const [webClientId, setWebClientId] = useState('');
  const [iosClientId, setIosClientId] = useState('');
  const [androidClientId, setAndroidClientId] = useState('');
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');

  const refresh = useCallback(async () => {
    const [ids, conn] = await Promise.all([
      loadGoogleClientIds(),
      getGoogleDriveConnection(),
    ]);
    setWebClientId(ids.webClientId);
    setIosClientId(ids.iosClientId);
    setAndroidClientId(ids.androidClientId);
    setConnected(conn.connected);
    setEmail(conn.email || '');
    setRedirectUri(getGoogleDriveRedirectUri());
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const saveIds = async () => {
    setBusy(true);
    try {
      await saveGoogleClientIds({ webClientId, iosClientId, androidClientId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Google OAuth Client IDs saved on this device.');
    } catch (e) {
      Alert.alert('Save failed', e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onConnect = async () => {
    setBusy(true);
    try {
      await saveGoogleClientIds({ webClientId, iosClientId, androidClientId });
      const conn = await connectGoogleDrive();
      setConnected(conn.connected);
      setEmail(conn.email || '');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Google Drive connected',
        conn.email
          ? `Signed in as ${conn.email}. You can attach Drive files from chat.`
          : 'Signed in. You can attach Drive files from chat.',
      );
    } catch (e) {
      Alert.alert('Connect failed', e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = () => {
    Alert.alert(
      'Disconnect Google Drive?',
      'Continuum will forget the Drive access token on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await disconnectGoogleDrive();
              setConnected(false);
              setEmail('');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              Alert.alert('Disconnect failed', e.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const copyRedirect = async () => {
    await Clipboard.setStringAsync(redirectUri);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Copied', 'Redirect URI copied. Paste it into Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs.');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
        <Ionicons name="arrow-back" size={22} color={theme.colors.primary} />
        <Text style={{ marginLeft: 8, color: theme.colors.primary, fontWeight: '700' }}>Setup</Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.black, marginBottom: 6 }}>
        Google Drive
      </Text>
      <Text style={{ fontSize: 13, color: theme.colors.gray, lineHeight: 19, marginBottom: 18 }}>
        Connect your Google account with read-only Drive access. Continuum can list and download files you choose — it never gets write/delete permission.
      </Text>

      <View style={{
        backgroundColor: theme.colors.white,
        borderRadius: 14,
        padding: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontWeight: '700', color: theme.colors.black }}>Connected</Text>
            <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
              {connected ? (email || 'Signed in') : 'Not connected'}
            </Text>
          </View>
          <Switch
            value={connected}
            onValueChange={(on) => {
              if (on) onConnect();
              else onDisconnect();
            }}
            disabled={busy}
          />
        </View>
      </View>

      <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.gray, letterSpacing: 1, marginBottom: 8 }}>
        GOOGLE CLOUD OAUTH
      </Text>
      <Text style={{ fontSize: 12, color: theme.colors.gray, lineHeight: 18, marginBottom: 12 }}>
        1) Create a project at console.cloud.google.com{'\n'}
        2) Enable Google Drive API{'\n'}
        3) Create OAuth client (Web application recommended){'\n'}
        4) Add this redirect URI, then paste the Client ID below
      </Text>

      <TouchableOpacity
        onPress={copyRedirect}
        style={{
          backgroundColor: theme.colors.light,
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Ionicons name="copy-outline" size={18} color={theme.colors.primary} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.gray }}>REDIRECT URI</Text>
          <Text style={{ fontSize: 12, color: theme.colors.black, marginTop: 2 }} selectable>
            {redirectUri || 'continuum://oauth'}
          </Text>
        </View>
      </TouchableOpacity>

      <Text style={labelStyle}>Web Client ID (required)</Text>
      <TextInput
        value={webClientId}
        onChangeText={setWebClientId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="xxxxx.apps.googleusercontent.com"
        placeholderTextColor={theme.colors.gray}
        style={inputStyle}
      />

      <Text style={labelStyle}>iOS Client ID (optional)</Text>
      <TextInput
        value={iosClientId}
        onChangeText={setIosClientId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="iOS OAuth client ID"
        placeholderTextColor={theme.colors.gray}
        style={inputStyle}
      />

      <Text style={labelStyle}>Android Client ID (optional)</Text>
      <TextInput
        value={androidClientId}
        onChangeText={setAndroidClientId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Android OAuth client ID"
        placeholderTextColor={theme.colors.gray}
        style={inputStyle}
      />

      <TouchableOpacity
        onPress={saveIds}
        disabled={busy}
        style={[buttonStyle, { backgroundColor: theme.colors.light, marginBottom: 10 }]}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: '800' }}>Save Client IDs</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={connected ? onDisconnect : onConnect}
        disabled={busy}
        style={[buttonStyle, { backgroundColor: connected ? theme.colors.danger : theme.colors.primary }]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '800' }}>
            {connected ? 'Disconnect Google Drive' : 'Connect Google Drive'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 16, lineHeight: 16 }}>
        Note: First-time use of expo-auth-session / SecureStore may require a new TestFlight / EAS native build. After that, chat can attach Drive files via the paperclip menu.
      </Text>
    </ScrollView>
  );
};

const labelStyle = {
  fontSize: 11,
  fontWeight: '700',
  color: theme.colors.gray,
  marginBottom: 6,
  marginTop: 4,
};

const inputStyle = {
  backgroundColor: theme.colors.white,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 13,
  color: theme.colors.black,
  marginBottom: 12,
};

const buttonStyle = {
  borderRadius: 12,
  paddingVertical: 14,
  alignItems: 'center',
  justifyContent: 'center',
};

export default GoogleDriveIntegrationSection;
