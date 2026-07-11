import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { loadLastPhotoCleanupRun } from '../utils/photoAlbumCleanup';
import { runPhotoCleanupFromChat } from '../utils/photoCleanupChat';
import { formatPhotoPreviewAlertSummary } from '../utils/photoCleanupPreview';
import { styles, theme } from '../styles/theme';
import CleanupRangePanel from './CleanupRangePanel';
import PhotoCleanupPreviewPanel from './PhotoCleanupPreviewPanel';

export default function PhotoCleanupSection() {
  const [photoCleanup, setPhotoCleanup] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    loadLastPhotoCleanupRun().then(setPhotoCleanup).catch(() => {});
  }, []);

  const showPreviewResult = (report, { alertTitle = 'Preview complete' } = {}) => {
    if (!report) return;
    setPhotoCleanup(report);
    setExpandedPreview(!!report.dryRun);
    if (report.dryRun) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(alertTitle, formatPhotoPreviewAlertSummary(report));
    }
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    });
  };

  const runPreview = async (msg) => {
    setRunning(true);
    setProgress('Starting photo cleanup preview…');
    try {
      const result = await runPhotoCleanupFromChat(msg, setProgress);
      if (result.type === 'status') {
        Alert.alert('Photo cleanup', result.content?.slice(0, 800) || '');
        return;
      }
      showPreviewResult(result.report);
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
            setExpandedPreview(false);
            setProgress('Applying photo cleanup…');
            try {
              const result = await runPhotoCleanupFromChat(msg, setProgress);
              if (result.report) {
                setPhotoCleanup(result.report);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Photo cleanup complete', result.content?.slice(0, 800) || 'Done.');
              }
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
      ref={scrollRef}
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

      {progress ? (
        <View style={[styles.groupedCard, { padding: 14, marginTop: 16 }]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.primary }}>
            {progress}
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 6 }}>
            Scanning your library on-device — keep the app open. Large libraries may take a few minutes.
          </Text>
        </View>
      ) : null}

      {photoCleanup?.ran_at ? (
        <View style={[styles.groupedCard, { padding: 16, marginTop: 16 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.black }}>
            {photoCleanup.dryRun ? 'Preview results' : 'Last applied cleanup'}
          </Text>
          <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
            {photoCleanup.duplicates?.found || 0} duplicates · {photoCleanup.codingScreenshots?.found || 0} coding screenshots · {photoCleanup.favorites?.selected || 0} favorites
          </Text>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 4 }}>
            {new Date(photoCleanup.ran_at).toLocaleString()} · {photoCleanup.scanned} scanned
            {photoCleanup.rangeLabel ? ` · ${photoCleanup.rangeLabel}` : ''}
          </Text>
          {photoCleanup.dryRun ? (
            <Text style={{ fontSize: 11, color: theme.colors.primary, marginTop: 8, fontWeight: '600' }}>
              Reply apply, proceed, yes, or ok in chat — or tap Apply cleanup above.
            </Text>
          ) : null}
          <PhotoCleanupPreviewPanel report={photoCleanup} compact={!expandedPreview} />
        </View>
      ) : !running ? (
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 16, paddingHorizontal: 4 }}>
          Choose a period above and tap Preview (dry run) to see what would be trashed or favorited.
        </Text>
      ) : null}
    </ScrollView>
  );
}
