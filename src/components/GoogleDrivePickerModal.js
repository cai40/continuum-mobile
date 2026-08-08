import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../styles/theme';
import { isGoogleDriveConnected } from '../services/googleDriveAuth';
import { listGoogleDriveFiles, downloadGoogleDriveFileToCache } from '../services/googleDriveApi';
import { documentIconName } from '../utils/documentTypes';

function formatModified(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const GoogleDrivePickerModal = ({ visible, onClose, onPicked }) => {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async ({ append = false, pageToken = '', search = query } = {}) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const ok = await isGoogleDriveConnected();
      setConnected(ok);
      if (!ok) {
        setFiles([]);
        setNextPageToken('');
        return;
      }
      const result = await listGoogleDriveFiles({
        query: search,
        pageToken,
        pageSize: 30,
      });
      setFiles((prev) => (append ? [...prev, ...result.files] : result.files));
      setNextPageToken(result.nextPageToken || '');
    } catch (e) {
      Alert.alert('Google Drive', e.message || String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    load({ search: '' }).catch(() => {});
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = async (file) => {
    setDownloadingId(file.id);
    try {
      const attachment = await downloadGoogleDriveFileToCache(file);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPicked?.(attachment);
      onClose?.();
    } catch (e) {
      Alert.alert('Download failed', e.message || String(e));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.white,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.black }}>Google Drive</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={theme.colors.gray} />
            </TouchableOpacity>
          </View>
          <View style={{
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.light,
            borderRadius: 12,
            paddingHorizontal: 10,
          }}>
            <Ionicons name="search" size={18} color={theme.colors.gray} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Drive files"
              placeholderTextColor={theme.colors.gray}
              style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 10, color: theme.colors.black }}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => load({ search: query })}
            />
            <TouchableOpacity onPress={() => load({ search: query })} disabled={loading}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700', paddingHorizontal: 6 }}>Go</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!connected && !loading ? (
          <View style={{ padding: 24 }}>
            <Text style={{ color: theme.colors.darkGray, lineHeight: 20 }}>
              Google Drive is not connected. Open Setup → Google Drive, paste your OAuth Client ID, and connect your account.
            </Text>
          </View>
        ) : loading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={files}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            ListEmptyComponent={(
              <Text style={{ color: theme.colors.gray, textAlign: 'center', marginTop: 30 }}>
                No files found.
              </Text>
            )}
            renderItem={({ item }) => {
              const busy = downloadingId === item.id;
              return (
                <TouchableOpacity
                  onPress={() => pickFile(item)}
                  disabled={Boolean(downloadingId)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.white,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Ionicons
                    name={item.mimeType?.startsWith('image/') ? 'image' : documentIconName(item.mimeType, item.name)}
                    size={22}
                    color={theme.colors.primary}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ fontWeight: '700', color: theme.colors.black }} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 2 }}>
                      {item.isGoogleDoc ? 'Google Doc (export)' : (item.mimeType || 'file')}
                      {item.modifiedTime ? ` · ${formatModified(item.modifiedTime)}` : ''}
                    </Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <Ionicons name="download-outline" size={20} color={theme.colors.gray} />
                  )}
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={nextPageToken ? (
              <TouchableOpacity
                onPress={() => load({ append: true, pageToken: nextPageToken, search: query })}
                disabled={loadingMore}
                style={{ paddingVertical: 14, alignItems: 'center' }}
              >
                {loadingMore ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Load more</Text>
                )}
              </TouchableOpacity>
            ) : null}
          />
        )}
      </View>
    </Modal>
  );
};

export default GoogleDrivePickerModal;
