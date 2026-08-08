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

const FOLDER_MIME = 'application/vnd.google-apps.folder';

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
  // Stack of { id, name } — last entry is current folder. Root = { id: 'root', name: 'My Drive' }
  const [folderStack, setFolderStack] = useState([{ id: 'root', name: 'My Drive' }]);

  const currentFolder = folderStack[folderStack.length - 1] || { id: 'root', name: 'My Drive' };
  const isSearching = Boolean(String(query || '').trim());

  const load = useCallback(async ({
    append = false,
    pageToken = '',
    search = query,
    folderId = currentFolder.id,
  } = {}) => {
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
        folderId,
        pageToken,
        pageSize: 40,
      });
      setFiles((prev) => (append ? [...prev, ...result.files] : result.files));
      setNextPageToken(result.nextPageToken || '');
    } catch (e) {
      Alert.alert('Google Drive', e.message || String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, currentFolder.id]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setFolderStack([{ id: 'root', name: 'My Drive' }]);
    load({ search: '', folderId: 'root' }).catch(() => {});
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFolder = (folder) => {
    const next = { id: folder.id, name: folder.name || 'Folder' };
    setQuery('');
    setFolderStack((prev) => [...prev, next]);
    load({ search: '', folderId: next.id }).catch(() => {});
  };

  const goBack = () => {
    if (folderStack.length <= 1) return;
    const nextStack = folderStack.slice(0, -1);
    setFolderStack(nextStack);
    setQuery('');
    const parent = nextStack[nextStack.length - 1];
    load({ search: '', folderId: parent.id }).catch(() => {});
  };

  const pickFile = async (file) => {
    const isFolder = file.isFolder
      || file.mimeType === FOLDER_MIME
      || file.shortcutTargetMime === FOLDER_MIME;

    if (isFolder) {
      const target = file.shortcutTargetId
        ? { id: file.shortcutTargetId, name: file.name }
        : file;
      openFolder(target);
      return;
    }

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

  const runSearch = () => {
    load({ search: query, folderId: currentFolder.id }).catch(() => {});
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

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            {folderStack.length > 1 && !isSearching ? (
              <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
                <Ionicons name="chevron-back" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 2 }}>Back</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={{ flex: 1, color: theme.colors.gray, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {isSearching ? `Search results` : currentFolder.name}
            </Text>
          </View>

          <View style={{
            marginTop: 10,
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
              placeholder="Search all Drive files"
              placeholderTextColor={theme.colors.gray}
              style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 10, color: theme.colors.black }}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={runSearch}
            />
            <TouchableOpacity onPress={runSearch} disabled={loading}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700', paddingHorizontal: 6 }}>Go</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!connected && !loading ? (
          <View style={{ padding: 24 }}>
            <Text style={{ color: theme.colors.darkGray, lineHeight: 20 }}>
              Google Drive is not connected. Open Setup → Google Drive and connect your account.
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
                {isSearching ? 'No files found.' : 'This folder is empty.'}
              </Text>
            )}
            renderItem={({ item }) => {
              const busy = downloadingId === item.id;
              const isFolder = item.isFolder
                || item.mimeType === FOLDER_MIME
                || item.shortcutTargetMime === FOLDER_MIME;
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
                    name={
                      isFolder
                        ? 'folder'
                        : (item.mimeType?.startsWith('image/') ? 'image' : documentIconName(item.mimeType, item.name))
                    }
                    size={22}
                    color={theme.colors.primary}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ fontWeight: '700', color: theme.colors.black }} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 2 }}>
                      {isFolder
                        ? 'Folder'
                        : (item.isGoogleDoc ? 'Google Doc (export)' : (item.mimeType || 'file'))}
                      {item.modifiedTime ? ` · ${formatModified(item.modifiedTime)}` : ''}
                    </Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <Ionicons
                      name={isFolder ? 'chevron-forward' : 'download-outline'}
                      size={20}
                      color={theme.colors.gray}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={nextPageToken ? (
              <TouchableOpacity
                onPress={() => load({
                  append: true,
                  pageToken: nextPageToken,
                  search: query,
                  folderId: currentFolder.id,
                })}
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
