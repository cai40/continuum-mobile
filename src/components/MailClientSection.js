import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../styles/theme';
import { useAppContext } from '../context/AppContext';
import CleanupRangePanel from './CleanupRangePanel';
import { styles } from '../styles/theme';
import {
  fetchMailFolders,
  fetchMailList,
  fetchMailMessage,
  markMailRead,
  deleteMail,
  sendMailReply,
} from '../services/apiService';
import { resolveRenderEmailBridgeSecret } from '../utils/openclawBridge';

const DEFAULT_FOLDERS = ['INBOX', 'Min and Kids', 'Archive', 'Sent', 'Trash'];
/** Folders pinned to the home folder bar. The rest are hidden behind "More". */
const PRIMARY_FOLDERS = ['INBOX', 'Sent'];

function formatListDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

function formatFullDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(iso || '');
  }
}

function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim();
  // Only return something that looks like an email address.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function mailRowTimeMs(row) {
  const times = [row?.date, row?.headerDate]
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.max(...times) : 0;
}

/** Newest-first by date; UID tiebreak for stability. */
function mailRowSorter(a, b) {
  const byDate = mailRowTimeMs(b) - mailRowTimeMs(a);
  if (byDate !== 0) return byDate;
  return (Number(b?.uid) || 0) - (Number(a?.uid) || 0);
}

/** Merge two row lists by UID, keeping the newest date-sorted order. */
function mergeMailRows(base, extra) {
  const merged = new Map();
  for (const item of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    if (item?.uid != null) merged.set(Number(item.uid), item);
  }
  return [...merged.values()].sort(mailRowSorter);
}

const MailClientSection = () => {
  const { renderEmailEnabled, renderEmailBridgeSecret, session, setActiveTab, setPendingChatMessage } = useAppContext();
  const bridgeSecret = resolveRenderEmailBridgeSecret(renderEmailBridgeSecret);
  const authToken = session?.access_token?.trim();

  const [mode, setMode] = useState('mail'); // 'mail' | 'cleanup'
  const [folders, setFolders] = useState([]);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);

  const [selectedUid, setSelectedUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [composeVisible, setComposeVisible] = useState(false);
  const [composeMode, setComposeMode] = useState('reply'); // 'new' | 'reply'
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState(null);

  const [memoryNote, setMemoryNote] = useState(null);
  const [inboxUnread, setInboxUnread] = useState({});

  const [selectMode, setSelectMode] = useState(false);
  const [selectedUids, setSelectedUids] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const foldersCacheRef = useRef(null);
  const emailsCacheRef = useRef(null);

  const safeSet = useCallback((setter, value) => {
    if (mountedRef.current) setter(value);
  }, []);

  const CACHE_KEY = '@continuum_mail_cache_v1';

  // Restore last pull (folders + per-folder email lists) instantly, then refresh.
  const restoreCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.folders) && data.folders.length) {
        foldersCacheRef.current = data.folders;
        safeSet(setFolders, data.folders);
      }
      const perFolder = data.emails || {};
      const list = perFolder[activeFolder];
      if (Array.isArray(list) && list.length) {
        const sorted = mergeMailRows(list, []);
        emailsCacheRef.current = { ...(emailsCacheRef.current || {}), [activeFolder]: sorted };
        safeSet(setEmails, sorted);
        safeSet(setOffset, sorted.length);
        safeSet(setHasMore, sorted.length >= 50);
      }
    } catch (err) {
      console.warn('[mail] cache restore failed:', err?.message);
    }
  }, [activeFolder, safeSet]);

  const persistCache = useCallback(async () => {
    try {
      const perFolder = { ...(emailsCacheRef.current || {}) };
      const currentList = emailsCacheRef.current?.[activeFolder];
      if (Array.isArray(currentList) && currentList.length) perFolder[activeFolder] = currentList.slice(0, 100);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        folders: foldersCacheRef.current || [],
        emails: perFolder,
        savedAt: Date.now(),
      }));
    } catch (err) {
      console.warn('[mail] cache persist failed:', err?.message);
    }
  }, [activeFolder]);

  const loadFolders = useCallback(async () => {
    if (!bridgeSecret) return;
    if (foldersCacheRef.current) {
      safeSet(setFolders, foldersCacheRef.current);
      return;
    }
    try {
      const list = await fetchMailFolders(bridgeSecret);
      const names = Array.isArray(list) ? list.map((f) => f.name).filter(Boolean) : [];
      const merged = [...new Set([...DEFAULT_FOLDERS, ...names])];
      foldersCacheRef.current = merged;
      safeSet(setFolders, merged);
    } catch (err) {
      console.warn('[mail] folders failed:', err?.message);
    }
  }, [bridgeSecret, safeSet]);

  const loadEmails = useCallback(async ({ folder = activeFolder, refresh = false } = {}) => {
    if (!bridgeSecret || !renderEmailEnabled) {
      safeSet(setError, 'Email bridge is not configured. Open Setup → OpenClaw Gateway and set your bridge secret.');
      return;
    }
    if (refresh) safeSet(setRefreshing, true); else safeSet(setLoading, true);
    safeSet(setError, null);
    try {
      const start = refresh ? 0 : offset;
      const { emails: rows } = await fetchMailList(bridgeSecret, {
        folder,
        limit: 50,
        offset: start,
      });
      // Merge by UID and keep newest-first date order so a refresh doesn't
      // reorder existing items (which made the list "jump").
      safeSet(setEmails, (prev) => {
        const merged = new Map();
        const current = refresh ? (emailsCacheRef.current?.[folder] || []) : (Array.isArray(prev) ? prev : []);
        for (const item of current) if (item?.uid != null) merged.set(Number(item.uid), item);
        for (const item of rows) if (item?.uid != null) merged.set(Number(item.uid), item);
        return [...merged.values()].sort(mailRowSorter);
      });
      safeSet(setOffset, start + rows.length);
      safeSet(setHasMore, rows.length >= 50);
      if (rows.length) {
        const unread = {};
        for (const row of rows) {
          if (Array.isArray(row.flags) && !row.flags.includes('\\Seen')) unread[row.uid] = true;
        }
        safeSet(setInboxUnread, (prev) => ({ ...prev, ...unread }));
        emailsCacheRef.current = {
          ...(emailsCacheRef.current || {}),
          [folder]: mergeMailRows(emailsCacheRef.current?.[folder] || [], rows),
        };
        persistCache();
      }
    } catch (err) {
      safeSet(setError, err?.message || 'Could not load emails.');
    } finally {
      safeSet(setLoading, false);
      safeSet(setRefreshing, false);
      safeSet(setLoadingMore, false);
    }
  }, [bridgeSecret, renderEmailEnabled, activeFolder, offset, safeSet, persistCache]);

  const didInitRef = useRef(false);

  useEffect(() => {
    // Run exactly once: show the last pull immediately (from AsyncStorage),
    // then refresh in the background. Guarded so dependency churn (offset,
    // activeFolder, etc.) never re-triggers this and causes a fetch loop.
    if (didInitRef.current) return;
    didInitRef.current = true;
    restoreCache().then(() => {
      AsyncStorage.getItem(DETAIL_CACHE_KEY).then((raw) => {
        if (raw) {
          try {
            const cache = JSON.parse(raw);
            for (const [uid, email] of Object.entries(cache)) {
              if (email?.uid != null) detailCacheRef.current[email.uid] = email;
            }
          } catch {
            // ignore corrupt cache
          }
        }
      }).catch(() => {});
      loadFolders();
      loadEmails({ refresh: true });
    });
  }, [restoreCache, loadFolders, loadEmails]); // eslint-disable-line react-hooks/exhaustive-deps

  const DETAIL_CACHE_KEY = '@continuum_mail_detail_cache_v1';
  const detailCacheRef = useRef({});

  const openEmail = async (uid) => {
    if (!bridgeSecret) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    safeSet(setSelectedUid, uid);
    // Show a cached body instantly if we have one (faster perceived open),
    // then refresh from IMAP in the background.
    const cachedDetail = detailCacheRef.current[uid];
    if (cachedDetail) {
      safeSet(setDetail, cachedDetail);
      safeSet(setDetailLoading, false);
      safeSet(setDetailError, null);
    } else {
      safeSet(setDetail, null);
      safeSet(setDetailLoading, true);
      safeSet(setDetailError, null);
    }
    try {
      // The bridge ingests the opened email into memory on /mail/read, so no
      // separate ingest round-trip is needed here.
      const { email } = await fetchMailMessage(bridgeSecret, authToken, uid, activeFolder);
      detailCacheRef.current[uid] = email;
      // Cap the persistent detail cache so it doesn't grow without bound.
      try {
        const raw = await AsyncStorage.getItem(DETAIL_CACHE_KEY);
        const cache = raw ? JSON.parse(raw) : {};
        const keys = Object.keys(cache);
        if (keys.length >= 50) {
          for (const key of keys.slice(0, keys.length - 49)) delete cache[key];
        }
        cache[uid] = email;
        await AsyncStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache).slice(0, 1_000_000));
      } catch (cacheErr) {
        console.warn('[mail] detail cache write:', cacheErr?.message);
      }
      safeSet(setDetail, email);
      safeSet(setInboxUnread, (prev) => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
      safeSet(setMemoryNote, 'Saved to memory.');
      setTimeout(() => safeSet(setMemoryNote, null), 5000);
    } catch (err) {
      // If we already showed a cached copy, keep it — don't replace the view
      // with an error just because the background IMAP refresh failed (e.g.
      // the bridge restarted and the UID is momentarily unreachable).
      if (!cachedDetail) {
        safeSet(setDetailError, err?.message || 'Could not open email.');
      } else {
        console.warn('[mail] background refresh failed, showing cached copy:', err?.message);
      }
    } finally {
      safeSet(setDetailLoading, false);
    }
  };

  const markAsRead = async (uid) => {
    if (!bridgeSecret || uid == null) return;
    try {
      await markMailRead(bridgeSecret, [uid], activeFolder);
    } catch (err) {
      console.warn('[mail] mark read:', err?.message);
    }
  };

  const removeEmailsFromList = useCallback((uidsToRemove, folder = activeFolder) => {
    const uidSet = new Set((uidsToRemove || []).map(Number));
    safeSet(setEmails, (prev) => (Array.isArray(prev) ? prev.filter((item) => !uidSet.has(Number(item.uid))) : prev));
    emailsCacheRef.current = {
      ...(emailsCacheRef.current || {}),
      [folder]: (emailsCacheRef.current?.[folder] || []).filter((item) => !uidSet.has(Number(item.uid))),
    };
    safeSet(setSelectedUids, (prev) => {
      const next = new Set(prev);
      for (const uid of uidSet) next.delete(uid);
      return next;
    });
    persistCache();
  }, [activeFolder, persistCache, safeSet]);

  const deleteEmailsNow = async (uids, folder = activeFolder) => {
    if (!bridgeSecret || !uids?.length) return;
    safeSet(setDeleting, true);
    try {
      await deleteMail(bridgeSecret, uids, folder);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      removeEmailsFromList(uids, folder);
      return true;
    } catch (err) {
      Alert.alert('Delete failed', err?.message || 'Could not move the email(s) to Trash.');
      return false;
    } finally {
      safeSet(setDeleting, false);
    }
  };

  const confirmDelete = (uids, folder = activeFolder) => {
    const count = (uids || []).length;
    if (!count) return;
    Alert.alert(
      'Delete email',
      `Move ${count} email(s) to Trash? (Recoverable.)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteEmailsNow(uids, folder),
        },
      ],
    );
  };

  const enterSelectMode = (uid) => {
    safeSet(setSelectMode, true);
    safeSet(setSelectedUids, new Set([uid]));
  };

  const toggleSelect = (uid) => {
    safeSet(setSelectedUids, (prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const exitSelectMode = () => {
    safeSet(setSelectMode, false);
    safeSet(setSelectedUids, new Set());
  };

  const deleteSelected = () => {
    const uids = [...selectedUids];
    if (!uids.length) return;
    confirmDelete(uids, activeFolder);
  };

  const openReply = (email) => {
    const to = extractEmailAddress(email?.from || '');
    safeSet(setComposeMode, 'reply');
    safeSet(setComposeTo, to);
    safeSet(setComposeCc, '');
    safeSet(setComposeSubject, email?.subject && !/^re:/i.test(email.subject) ? `Re: ${email.subject}` : (email?.subject || ''));
    // Trim the quoted original so the SMTP payload stays small.
    const quote = String(email?.text || email?.snippet || '').slice(0, 800);
    safeSet(setComposeBody, `\n\n---\nOn ${formatFullDate(email?.date)}, ${email?.from} wrote:\n${quote}\n`);
    safeSet(setComposeError, null);
    safeSet(setComposeVisible, true);
  };

  const openCompose = () => {
    safeSet(setComposeMode, 'new');
    safeSet(setComposeTo, '');
    safeSet(setComposeCc, '');
    safeSet(setComposeSubject, '');
    safeSet(setComposeBody, '');
    safeSet(setComposeError, null);
    safeSet(setComposeVisible, true);
  };

  const sendReply = async () => {
    if (!isValidEmail(composeTo)) {
      Alert.alert('Invalid recipient', 'Enter a valid email address for To.');
      return;
    }
    if (!composeSubject.trim() || !composeBody.trim()) {
      Alert.alert('Missing fields', 'Subject and message are required.');
      return;
    }
    safeSet(setComposeSending, true);
    safeSet(setComposeError, null);
    try {
      await sendMailReply(bridgeSecret, {
        to: composeTo.trim(),
        cc: composeCc.trim() || undefined,
        subject: composeSubject.trim(),
        body: composeBody,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      safeSet(setComposeVisible, false);
      Alert.alert('Sent', `Email sent to ${composeTo.trim()}.`);
    } catch (err) {
      safeSet(setComposeError, err?.message || 'Could not send the email.');
    } finally {
      safeSet(setComposeSending, false);
    }
  };

  const switchFolder = (folder) => {
    if (folder === activeFolder) return;
    safeSet(setFolderModalVisible, false);
    safeSet(setSelectMode, false);
    safeSet(setSelectedUids, new Set());
    safeSet(setActiveFolder, folder);
    // Show cached emails for the folder instantly, then refresh in the background.
    const cached = emailsCacheRef.current?.[folder];
    if (Array.isArray(cached) && cached.length) {
      safeSet(setEmails, cached);
      safeSet(setOffset, cached.length);
      safeSet(setHasMore, cached.length >= 50);
    } else {
      safeSet(setEmails, []);
      safeSet(setOffset, 0);
      safeSet(setHasMore, true);
    }
    safeSet(setSelectedUid, null);
    safeSet(setDetail, null);
    setTimeout(() => loadEmails({ folder, refresh: true }), 0);
  };

  const renderEmailRow = ({ item }) => {
    const unread = inboxUnread[item.uid];
    const isSelected = selectMode && selectedUids.has(item.uid);
    const rowContent = (
      <TouchableOpacity
        onPress={() => {
          if (selectMode) {
            toggleSelect(item.uid);
            return;
          }
          openEmail(item.uid);
        }}
        onLongPress={() => enterSelectMode(item.uid)}
        activeOpacity={selectMode ? 1 : 0.6}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          padding: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: isSelected ? theme.colors.primary + '12' : theme.colors.white,
        }}
      >
        <View style={{ width: 22, paddingTop: 4 }}>
          {selectMode ? (
            <Ionicons
              name={isSelected ? 'checkbox' : 'square-outline'}
              size={20}
              color={isSelected ? theme.colors.primary : theme.colors.gray}
            />
          ) : unread ? (
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.primary, marginTop: 3 }} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: unread ? '700' : '600',
                color: theme.colors.black,
                marginRight: 8,
              }}
            >
              {item.from || 'Unknown'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.gray }}>{formatListDate(item.date)}</Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, fontWeight: unread ? '600' : '500', color: theme.colors.textPrimary, marginTop: 2 }}
          >
            {item.subject || '(no subject)'}
          </Text>
          <Text numberOfLines={2} style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>
            {item.snippet || ''}
          </Text>
        </View>
      </TouchableOpacity>
    );

    if (selectMode) return rowContent;

    return (
      <SwipeableRow
        onDelete={() => confirmDelete([item.uid], activeFolder)}
        disabled={loading || deleting}
      >
        {rowContent}
      </SwipeableRow>
    );
  };

  if (!renderEmailEnabled) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: theme.colors.background }}>
        <Ionicons name="mail-outline" size={44} color={theme.colors.gray} />
        <Text style={{ color: theme.colors.darkGray, textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
          Email bridge is not enabled. Open Setup → OpenClaw Gateway, turn on Render cloud email, and set your bridge secret.
        </Text>
      </View>
    );
  }

  if (mode === 'cleanup') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <TouchableOpacity onPress={() => setMode('mail')} style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
            backgroundColor: theme.colors.light, marginRight: 8,
          }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.darkGray }}>Mail</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('cleanup')} style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
            backgroundColor: theme.colors.primary,
          }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: 'white' }}>Cleanup</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.groupedCard}>
          <CleanupRangePanel
            mode="email"
            onEmailCleanup={(msg) => {
              setPendingChatMessage(msg);
              setActiveTab('chat');
            }}
          />
        </View>
      </ScrollView>
    );
  }

  if (detailLoading || detailError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white, padding: 24 }}>
        {detailLoading ? (
          <>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={{ color: theme.colors.gray, marginTop: 12 }}>Opening email…</Text>
          </>
        ) : (
          <>
            <Ionicons name="alert-circle-outline" size={40} color={theme.colors.danger} />
            <Text style={{ color: theme.colors.darkGray, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>{detailError}</Text>
            <TouchableOpacity
              onPress={() => { safeSet(setDetailError, null); safeSet(setSelectedUid, null); }}
              style={{ marginTop: 16, backgroundColor: theme.colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Back to list</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  if (detail) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, backgroundColor: theme.colors.white }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 8,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
          >
            <TouchableOpacity onPress={() => { safeSet(setDetail, null); safeSet(setSelectedUid, null); markAsRead(selectedUid); }} hitSlop={10} style={{ padding: 8 }}>
              <Ionicons name="chevron-back" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: theme.colors.black, textAlign: 'center' }} numberOfLines={1}>
              {detail.subject || 'Email'}
            </Text>
            <TouchableOpacity onPress={() => openReply(detail)} hitSlop={10} style={{ padding: 8 }}>
              <Ionicons name="arrow-undo" size={22} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          {memoryNote ? (
            <View style={{
              backgroundColor: theme.colors.success + '15',
              paddingVertical: 8,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
            }}
            >
              <Ionicons name="sparkles" size={14} color={theme.colors.success} />
              <Text style={{ color: theme.colors.success, fontSize: 12, marginLeft: 6, flex: 1 }} numberOfLines={2}>
                {memoryNote}
              </Text>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: theme.colors.black }}>{detail.subject || '(no subject)'}</Text>
            <Text style={{ fontSize: 13, color: theme.colors.gray, marginTop: 6 }}>
              {formatFullDate(detail.date)}
            </Text>
            <View style={{ marginTop: 8, padding: 10, backgroundColor: theme.colors.light, borderRadius: 10 }}>
              <Text style={{ fontSize: 13, color: theme.colors.textPrimary }}>
                <Text style={{ fontWeight: '700' }}>From:</Text> {detail.from}
              </Text>
              {detail.to ? (
                <Text style={{ fontSize: 13, color: theme.colors.textPrimary, marginTop: 2 }}>
                  <Text style={{ fontWeight: '700' }}>To:</Text> {detail.to}
                </Text>
              ) : null}
            </View>
            {detail.attachments?.length ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 12, color: theme.colors.gray, marginBottom: 4 }}>Attachments:</Text>
                {detail.attachments.map((a, i) => (
                  <Text key={i} style={{ fontSize: 12, color: theme.colors.primary }}>
                    {a?.filename} {a?.size ? `(${Math.round(a.size / 1024)} KB)` : ''}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={{ fontSize: 15, color: theme.colors.textPrimary, lineHeight: 22, marginTop: 14 }}>
              {detail.text || detail.snippet || '(No text body)'}
            </Text>
          </ScrollView>

          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.white }}>
            <TouchableOpacity
              onPress={() => openReply(detail)}
              style={{
                backgroundColor: theme.colors.primary,
                borderRadius: 12,
                paddingVertical: 12,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name="arrow-undo" size={18} color="white" />
              <Text style={{ color: 'white', fontWeight: '700', marginLeft: 8 }}>Reply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {selectMode ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          minHeight: 46,
          backgroundColor: theme.colors.white,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
        >
          <TouchableOpacity onPress={exitSelectMode} hitSlop={10} style={{ padding: 6 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 15 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.black }}>
            {selectedUids.size} selected
          </Text>
          <TouchableOpacity
            onPress={deleteSelected}
            disabled={deleting || selectedUids.size === 0}
            hitSlop={10}
            style={{ padding: 6, flexDirection: 'row', alignItems: 'center' }}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={theme.colors.danger} />
            ) : (
              <>
                <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
                <Text style={{ color: theme.colors.danger, fontWeight: '700', fontSize: 15, marginLeft: 4 }}>Delete</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          backgroundColor: theme.colors.white,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          flexGrow: 0,
        }}
        contentContainerStyle={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          minHeight: 44,
        }}
      >
        <TouchableOpacity
          onPress={() => setMode('mail')}
          style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
            backgroundColor: mode === 'mail' ? theme.colors.primary : theme.colors.light,
            marginRight: 6,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: mode === 'mail' ? 'white' : theme.colors.darkGray }}>Mail</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode('cleanup')}
          style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
            backgroundColor: mode === 'cleanup' ? theme.colors.primary : theme.colors.light,
            marginRight: 8,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: mode === 'cleanup' ? 'white' : theme.colors.darkGray }}>Cleanup</Text>
        </TouchableOpacity>

        <View style={{ width: 1, height: 20, backgroundColor: theme.colors.border, marginRight: 8 }} />

        {PRIMARY_FOLDERS.map((folder) => {
          const active = folder === activeFolder;
          return (
            <TouchableOpacity
              key={folder}
              onPress={() => switchFolder(folder)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
                marginRight: 6,
                backgroundColor: active ? theme.colors.primary : theme.colors.light,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: active ? 'white' : theme.colors.darkGray }}>
                {folder}
              </Text>
            </TouchableOpacity>
          );
        })}
        {!PRIMARY_FOLDERS.includes(activeFolder) ? (
          <TouchableOpacity
            onPress={() => setFolderModalVisible(true)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 16,
              marginRight: 6,
              backgroundColor: theme.colors.primary,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: 'white' }}>{activeFolder}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => setFolderModalVisible(true)}
          hitSlop={8}
          style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', marginRight: 4 }}
        >
          <Ionicons name="list" size={15} color={theme.colors.primary} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.primary, marginLeft: 3 }}>More</Text>
        </TouchableOpacity>

        <View style={{ width: 1, height: 20, backgroundColor: theme.colors.border, marginRight: 8 }} />

        <TouchableOpacity
          onPress={openCompose}
          hitSlop={8}
          style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center' }}
        >
          <Ionicons name="create-outline" size={16} color={theme.colors.secondary} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.secondary, marginLeft: 3 }}>Compose</Text>
        </TouchableOpacity>
      </ScrollView>
      )}

      {error ? (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Ionicons name="cloud-offline-outline" size={36} color={theme.colors.warning} />
          <Text style={{ color: theme.colors.darkGray, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={emails}
        keyExtractor={(item) => String(item.uid)}
        renderItem={renderEmailRow}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { exitSelectMode(); loadEmails({ refresh: true }); }} tintColor={theme.colors.primary} />
        }
        onEndReached={() => {
          if (hasMore && !loading && !loadingMore) {
            safeSet(setLoadingMore, true);
            loadEmails({});
          }
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Ionicons name="mail-open-outline" size={40} color={theme.colors.gray} />
              <Text style={{ color: theme.colors.gray, marginTop: 10 }}>No emails in {activeFolder}.</Text>
            </View>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 12 }} color={theme.colors.primary} /> : null}
      />

      <Modal visible={composeVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => safeSet(setComposeVisible, false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flex: 1, backgroundColor: theme.colors.white }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
            >
              <TouchableOpacity onPress={() => safeSet(setComposeVisible, false)} hitSlop={10} style={{ padding: 6 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: theme.colors.black }}>
                {composeMode === 'reply' ? 'Reply' : 'New Email'}
              </Text>
              <TouchableOpacity onPress={sendReply} disabled={composeSending} hitSlop={10} style={{ padding: 6 }}>
                {composeSending ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={{ color: theme.colors.primary, fontWeight: '800', fontSize: 15 }}>Send</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
              <View style={composeFieldStyle}>
                <Text style={composeLabelStyle}>To</Text>
                <TextInput
                  value={composeTo}
                  onChangeText={setComposeTo}
                  placeholder="recipient@example.com"
                  placeholderTextColor={theme.colors.gray}
                  style={composeInputStyle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>
              <View style={composeFieldStyle}>
                <Text style={composeLabelStyle}>Cc</Text>
                <TextInput
                  value={composeCc}
                  onChangeText={setComposeCc}
                  placeholder="(optional)"
                  placeholderTextColor={theme.colors.gray}
                  style={composeInputStyle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>
              <View style={composeFieldStyle}>
                <Text style={composeLabelStyle}>Subject</Text>
                <TextInput
                  value={composeSubject}
                  onChangeText={setComposeSubject}
                  placeholder="Subject"
                  placeholderTextColor={theme.colors.gray}
                  style={composeInputStyle}
                />
              </View>
            </View>
            <TextInput
              value={composeBody}
              onChangeText={setComposeBody}
              placeholder="Write your message…"
              placeholderTextColor={theme.colors.gray}
              multiline
              style={{
                flex: 1,
                margin: 14,
                padding: 12,
                fontSize: 15,
                color: theme.colors.black,
                backgroundColor: theme.colors.light,
                borderRadius: 12,
                textAlignVertical: 'top',
              }}
            />
            {composeError ? (
              <View style={{
                marginHorizontal: 14,
                marginBottom: 10,
                padding: 10,
                borderRadius: 10,
                backgroundColor: theme.colors.danger + '12',
                flexDirection: 'row',
                alignItems: 'flex-start',
              }}
              >
                <Ionicons name="alert-circle" size={15} color={theme.colors.danger} style={{ marginTop: 1 }} />
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginLeft: 6, flex: 1 }}>{composeError}</Text>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={folderModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFolderModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'flex-end',
          }}
        >
          <View style={{
            backgroundColor: theme.colors.white,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: 30,
            maxHeight: '70%',
          }}
          >
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
            >
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: theme.colors.black }}>All folders</Text>
              <TouchableOpacity onPress={() => setFolderModalVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.colors.gray} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {folders.map((folder) => {
                const active = folder === activeFolder;
                return (
                  <TouchableOpacity
                    key={folder}
                    onPress={() => switchFolder(folder)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <Ionicons
                      name={active ? 'folder-open' : 'folder-outline'}
                      size={18}
                      color={active ? theme.colors.primary : theme.colors.gray}
                      style={{ marginRight: 12 }}
                    />
                    <Text style={{
                      flex: 1,
                      fontSize: 15,
                      fontWeight: active ? '700' : '500',
                      color: active ? theme.colors.primary : theme.colors.black,
                    }}
                    >
                      {folder}
                    </Text>
                    {active ? <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const composeFieldStyle = { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border };
const composeLabelStyle = { width: 60, fontSize: 14, color: theme.colors.gray, fontWeight: '600' };
const composeInputStyle = { flex: 1, fontSize: 14, color: theme.colors.black, paddingVertical: 6 };

const SWIPE_ACTION_WIDTH = 84;

/**
 * Pure-RN swipe-left-to-reveal-delete row (no native gesture library needed).
 * Swiping left reveals a red Delete action; tapping it calls onDelete.
 */
function SwipeableRow({ children, onDelete, disabled = false }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const settle = (open) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -SWIPE_ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !disabled && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const x = Math.min(0, Math.max(-SWIPE_ACTION_WIDTH - 8, base + g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const settledOpen = base + g.dx < -SWIPE_ACTION_WIDTH / 2;
        settle(settledOpen);
      },
      onPanResponderTerminate: () => settle(openRef.current),
    }),
  ).current;

  return (
    <View style={{ backgroundColor: theme.colors.danger, overflow: 'hidden' }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          settle(false);
          onDelete?.();
        }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: SWIPE_ACTION_WIDTH,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name="trash-outline" size={20} color="white" />
        <Text style={{ color: 'white', fontSize: 11, fontWeight: '700', marginTop: 4 }}>Delete</Text>
      </TouchableOpacity>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export default MailClientSection;
