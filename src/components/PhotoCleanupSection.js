import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { applyPhotoCleanupPlan, loadLastPhotoCleanupRun } from '../utils/photoAlbumCleanup';
import { runPhotoCleanupFromChat } from '../utils/photoCleanupChat';
import { formatPhotoPreviewAlertSummary } from '../utils/photoCleanupPreview';
import { createPreviewPlan, planSummary } from '../utils/photoPreviewPlan';
import { styles, theme } from '../styles/theme';
import CleanupRangePanel from './CleanupRangePanel';
import PhotoCleanupPreviewPanel from './PhotoCleanupPreviewPanel';

export default function PhotoCleanupSection() {
  const [photoCleanup, setPhotoCleanup] = useState(null);
  const [previewPlan, setPreviewPlan] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    loadLastPhotoCleanupRun().then((report) => {
      setPhotoCleanup(report);
      if (report?.dryRun) setPreviewPlan(createPreviewPlan(report));
    }).catch(() => {});
  }, []);

  const showPreviewResult = (report, { alertTitle = 'Preview complete' } = {}) => {
    if (!report) return;
    setPhotoCleanup(report);
    setPreviewPlan(createPreviewPlan(report));
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

  const applyPlan = async () => {
    if (!previewPlan) return;
    const { trashCount, favoriteCount } = planSummary(previewPlan);
    Alert.alert(
      'Apply changes?',
      `Trash ${trashCount} photo(s) and favorite ${favoriteCount} photo(s)? Deleted items go to Recently Deleted on iOS.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply changes',
          style: 'destructive',
          onPress: async () => {
            setRunning(true);
            setExpandedPreview(false);
            setProgress('Applying your changes…');
            try {
              const report = await applyPhotoCleanupPlan({
                trashIds: previewPlan.trashIds,
                favoriteIds: previewPlan.favoriteIds,
                onProgress: setProgress,
              });
              setPhotoCleanup(report);
              setPreviewPlan(null);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Changes applied',
                `Deleted ${report.duplicates.deleted} photo(s). Favorited ${report.favorites.selected} photo(s).`,
              );
            } catch (e) {
              Alert.alert('Apply failed', e.message || String(e));
            } finally {
              setRunning(false);
              setProgress('');
            }
          },
        },
      ],
    );
  };

  const runApply = (msg) => {
    if (previewPlan && photoCleanup?.dryRun) {
      applyPlan();
      return;
    }
    Alert.alert(
      'Apply photo cleanup?',
      'Run preview first to review and edit trash/favorite lists, then tap Apply changes.',
      [
        { text: 'Run preview', onPress: () => runPreview(msg.replace(/^apply\s+/i, 'preview ')) },
        { text: 'Cancel', style: 'cancel' },
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
          {photoCleanup.dryRun && previewPlan ? (
            <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
              Trash {planSummary(previewPlan).trashCount} · Favorites {planSummary(previewPlan).favoriteCount}
            </Text>
          ) : (
            <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 4 }}>
              {photoCleanup.duplicates?.found || 0} duplicates · {photoCleanup.codingScreenshots?.found || 0} coding screenshots · {photoCleanup.favorites?.selected || 0} favorites
            </Text>
          )}
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 4 }}>
            {new Date(photoCleanup.ran_at).toLocaleString()} · {photoCleanup.scanned} scanned
            {photoCleanup.rangeLabel ? ` · ${photoCleanup.rangeLabel}` : ''}
          </Text>
          <PhotoCleanupPreviewPanel
            report={photoCleanup}
            plan={previewPlan}
            onPlanChange={setPreviewPlan}
            onApply={applyPlan}
            applying={running}
            editable={!!photoCleanup.dryRun && !!previewPlan}
            compact={!expandedPreview}
          />
        </View>
      ) : !running ? (
        <Text style={{ fontSize: 12, color: theme.colors.gray, marginTop: 16, paddingHorizontal: 4 }}>
          Choose a period above and tap Preview (dry run) to review trash and favorites, edit the lists, then tap Apply changes.
        </Text>
      ) : null}
    </ScrollView>
  );
}
