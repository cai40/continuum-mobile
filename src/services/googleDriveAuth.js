import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const STORAGE = {
  accessToken: '@gdrive_access_token',
  refreshToken: '@gdrive_refresh_token',
  expiresAt: '@gdrive_expires_at',
  email: '@gdrive_account_email',
  webClientId: '@gdrive_web_client_id',
  iosClientId: '@gdrive_ios_client_id',
  androidClientId: '@gdrive_android_client_id',
};

export const DRIVE_READONLY_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.readonly',
];

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

let secureStore = null;
try {
  // Optional native module — falls back to AsyncStorage until a build includes it.
  // eslint-disable-next-line global-require
  secureStore = require('expo-secure-store');
} catch {
  secureStore = null;
}

async function storageSet(key, value) {
  const str = value == null ? '' : String(value);
  if (secureStore?.setItemAsync) {
    try {
      await secureStore.setItemAsync(key, str);
      return;
    } catch {
      // fall through
    }
  }
  if (str) await AsyncStorage.setItem(key, str);
  else await AsyncStorage.removeItem(key);
}

async function storageGet(key) {
  if (secureStore?.getItemAsync) {
    try {
      const v = await secureStore.getItemAsync(key);
      if (v != null) return v;
    } catch {
      // fall through
    }
  }
  return AsyncStorage.getItem(key);
}

async function storageDelete(key) {
  if (secureStore?.deleteItemAsync) {
    try {
      await secureStore.deleteItemAsync(key);
    } catch {
      // fall through
    }
  }
  await AsyncStorage.removeItem(key);
}

export function getGoogleDriveRedirectUri() {
  return AuthSession.makeRedirectUri({
    scheme: 'continuum',
    path: 'oauth',
  });
}

export async function loadGoogleClientIds() {
  const [web, ios, android] = await Promise.all([
    storageGet(STORAGE.webClientId),
    storageGet(STORAGE.iosClientId),
    storageGet(STORAGE.androidClientId),
  ]);
  return {
    webClientId: (web || '').trim(),
    iosClientId: (ios || '').trim(),
    androidClientId: (android || '').trim(),
  };
}

export async function saveGoogleClientIds({ webClientId, iosClientId, androidClientId }) {
  await Promise.all([
    storageSet(STORAGE.webClientId, (webClientId || '').trim()),
    storageSet(STORAGE.iosClientId, (iosClientId || '').trim()),
    storageSet(STORAGE.androidClientId, (androidClientId || '').trim()),
  ]);
}

function pickClientId(ids) {
  if (Platform.OS === 'ios' && ids.iosClientId) return ids.iosClientId;
  if (Platform.OS === 'android' && ids.androidClientId) return ids.androidClientId;
  return ids.webClientId || ids.iosClientId || ids.androidClientId || '';
}

export async function getGoogleDriveConnection() {
  const [accessToken, refreshToken, expiresAt, email] = await Promise.all([
    storageGet(STORAGE.accessToken),
    storageGet(STORAGE.refreshToken),
    storageGet(STORAGE.expiresAt),
    storageGet(STORAGE.email),
  ]);
  return {
    connected: Boolean(accessToken || refreshToken),
    accessToken: accessToken || '',
    refreshToken: refreshToken || '',
    expiresAt: Number(expiresAt) || 0,
    email: email || '',
  };
}

async function persistTokens({ accessToken, refreshToken, expiresIn, email }) {
  const expiresAt = Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000 - 60_000;
  await storageSet(STORAGE.accessToken, accessToken || '');
  if (refreshToken) await storageSet(STORAGE.refreshToken, refreshToken);
  await storageSet(STORAGE.expiresAt, String(expiresAt));
  if (email) await storageSet(STORAGE.email, email);
}

async function fetchGoogleEmail(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json?.email || '';
  } catch {
    return '';
  }
}

async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error_description || json?.error || `Token refresh failed (${res.status})`);
  }
  await persistTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresIn: json.expires_in,
  });
  return json.access_token;
}

/** Returns a valid access token, refreshing when needed. */
export async function getValidGoogleDriveAccessToken() {
  const ids = await loadGoogleClientIds();
  const clientId = pickClientId(ids);
  const conn = await getGoogleDriveConnection();
  if (!conn.accessToken && !conn.refreshToken) {
    throw new Error('Google Drive is not connected. Open Setup → Google Drive to connect.');
  }
  if (conn.accessToken && conn.expiresAt > Date.now() + 30_000) {
    return conn.accessToken;
  }
  if (!conn.refreshToken) {
    throw new Error('Google Drive session expired. Reconnect under Setup → Google Drive.');
  }
  if (!clientId) {
    throw new Error('Missing Google OAuth Client ID. Add it under Setup → Google Drive.');
  }
  return refreshAccessToken(conn.refreshToken, clientId);
}

export async function connectGoogleDrive() {
  const ids = await loadGoogleClientIds();
  const clientId = pickClientId(ids);
  if (!clientId) {
    throw new Error(
      'Add a Google OAuth Client ID first (Setup → Google Drive). Create a Web client in Google Cloud Console and paste the Client ID.',
    );
  }

  const redirectUri = getGoogleDriveRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: DRIVE_READONLY_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  });

  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery, { showInRecents: true });
  if (result.type !== 'success' || !result.params?.code) {
    if (result.type === 'dismiss' || result.type === 'cancel') {
      throw new Error('Google sign-in was cancelled.');
    }
    throw new Error('Google sign-in failed. Check the Client ID and redirect URI.');
  }

  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: request.codeVerifier || '',
      },
    },
    discovery,
  );

  if (!tokenResult?.accessToken) {
    throw new Error('Google did not return an access token.');
  }

  const email = await fetchGoogleEmail(tokenResult.accessToken);
  await persistTokens({
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    expiresIn: tokenResult.expiresIn,
    email,
  });

  return getGoogleDriveConnection();
}

export async function disconnectGoogleDrive() {
  const conn = await getGoogleDriveConnection();
  const token = conn.accessToken || conn.refreshToken;
  if (token) {
    try {
      await fetch(`${discovery.revocationEndpoint}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // ignore revoke network errors
    }
  }
  await Promise.all([
    storageDelete(STORAGE.accessToken),
    storageDelete(STORAGE.refreshToken),
    storageDelete(STORAGE.expiresAt),
    storageDelete(STORAGE.email),
  ]);
}

export async function isGoogleDriveConnected() {
  const conn = await getGoogleDriveConnection();
  return conn.connected;
}
