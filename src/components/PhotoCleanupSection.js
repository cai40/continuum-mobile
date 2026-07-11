import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { loadLastPhotoCleanupRun } from '../utils/photoAlbumCleanup';
import { runPhotoCleanupFromChat } from '../utils/photoCleanupChat';
import { styles, theme } from '../styles/theme';
import CleanupRangePanel from './CleanupRangePanel';
import PhotoCleanupPreviewPanel from './PhotoCleanupPreviewPanel';

export default function PhotoCleanupSection() {
  const [photoCleanup, setPhotoCleanup] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    loadLastPhotoCleanupRun().then(setPhotoCleanup).catch(() => {});
  }, []);

  const runPreview = async (msg) => {
    setRunning(true);
    setProgress('Starting photo cleanup preview…');
    try {
      const result = await runPhotoCleanupFromChat(msg, setProgress);
      if (result.report) setPhotoCleanup(result.report);
      if (!result.report?.dryRun) {
        Alert.alert('Photo cleanup preview', result.content?.slice(0, 800) || 'Preview complete.');
      }
    } catch (e) {
      Alert.alert('Photo cleanup failed', e.message || String(e));
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const runApply = (msg) => {
    Alert.alert(
      'Apply photo cleanup?',
      'This permanently deletes duplicate photos and coding screenshots in the selected period. Favorites are never deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          style: 'destructive',
          onPress: async () => {
            setRunning(true);
            setProgress('Applying photo cleanup…');
            try {
              const result = await runPhotoCleanupFromChat(msg, setProgress);
              if (result.report) setPhotoCleanup(result.report);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Photo cleanup complete', result.content?.slice(0, 800) || 'Done.');
            } catch (e) {
              Alert.alert('Photo cleanup failed', e.message || String(e));
            } finally {
              setRunning(false);
              setProgress('');
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.groupedCard}>
        <CleanupRangePanel
          mode="photo"
          onPhotoPreview={runPreview}
          onPhotoApply={runApply}
        />
      </View>

      {photoCleanup?.ran_at ? (
        <View style={[styles.groupedCard, { padding: 16, marginTop: 16 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.black }}>
            Last run {photoCleanup.dryRun ? '(preview)' : '(applied)'}
          </Text>
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
            {photoCleanup.duplicates?.found || 0} duplicates · {photoCleanup.codingScreenshots?.found || 0} coding screenshots · {photoCleanup.favorites?.selected || 0} favorites
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 4 }}>
            {new Date(photoCleanup.ran_at).toLocaleString()} · {photoCleanup.scanned} scanned
          </Text>
          <PhotoCleanupPreviewPanel report={photoCleanup} compact />
        </View>
      ) : null}

      {progress ? (
        <Text style={{ fontSize: 11, color: theme.colors.primary, marginTop: 12, paddingHorizontal: 4 }}>
          {progress}
        </Text>
      ) : null}

      {running ? (
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 8, paddingHorizontal: 4 }}>
          Running… keep the app open.
        </Text>
      ) : null}
    </ScrollView>
  );
}
