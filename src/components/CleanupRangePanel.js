import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../styles/theme';
import {
  getCleanupRange,
  buildEmailCleanupMessage,
  buildPhotoCleanupMessage,
  listSelectableMonths,
} from '../utils/cleanupMenu';

function RangeButton({ label, subtitle, icon, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: theme.colors.light,
        opacity: disabled ? 0.5 : 1,
        marginBottom: 8,
      }}
    >
      <Ionicons name={icon} size={20} color={theme.colors.primary} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.black }}>{label}</Text>
        {subtitle ? (
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.gray} />
    </TouchableOpacity>
  );
}

/**
 * @param {Object} props
 * @param {'email'|'photo'} props.mode
 * @param {(message: string) => void} [props.onEmailCleanup]
 * @param {(message: string) => void} [props.onPhotoPreview]
 * @param {(message: string) => void} [props.onPhotoApply]
 * @param {boolean} [props.emailDisabled]
 * @param {string} [props.emailDisabledHint]
 * @param {boolean} [props.compact]
 */
export default function CleanupRangePanel({
  mode,
  onEmailCleanup,
  onPhotoPreview,
  onPhotoApply,
  emailDisabled = false,
  emailDisabledHint,
  compact = false,
}) {
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pendingPhotoApply, setPendingPhotoApply] = useState(false);
  const months = listSelectableMonths(24);

  const runEmail = (period, opts) => {
    const range = getCleanupRange(period, opts);
    if (!range || !onEmailCleanup) return;
    onEmailCleanup(buildEmailCleanupMessage(range));
  };

  const runPhoto = (period, opts, apply) => {
    const range = getCleanupRange(period, opts);
    if (!range) return;
    const message = buildPhotoCleanupMessage(range, { apply });
    if (apply) onPhotoApply?.(message);
    else onPhotoPreview?.(message);
  };

  const openMonthPicker = (forApply = false) => {
    setPendingPhotoApply(forApply);
    setMonthPickerVisible(true);
  };

  const onMonthSelected = ({ month, year, label }) => {
    setMonthPickerVisible(false);
    const opts = { month, year };
    if (mode === 'email') runEmail('custom_month', opts);
    else runPhoto('custom_month', opts, pendingPhotoApply);
  };

  const showPhotoActionSheet = (period, opts = {}) => {
    Alert.alert('Photo cleaning', 'Preview scans without deleting. Apply removes duplicates and coding screenshots.', [
      { text: 'Preview (dry run)', onPress: () => runPhoto(period, opts, false) },
      { text: 'Apply cleanup', style: 'destructive', onPress: () => runPhoto(period, opts, true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleRangePress = (period) => {
    if (mode === 'email') {
      if (emailDisabled) {
        Alert.alert('Email cleaning unavailable', emailDisabledHint || 'Enable Render cloud email in Setup.');
        return;
      }
      if (period === 'custom_month') openMonthPicker(false);
      else runEmail(period);
      return;
    }
    if (period === 'custom_month') openMonthPicker(false);
    else showPhotoActionSheet(period);
  };

  if (compact) {
    return (
      <>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 4, paddingBottom: 6 }}>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(mode === 'email' ? 'Email cleaning' : 'Photo cleaning', 'Choose a time range', [
                { text: 'Today', onPress: () => handleRangePress('today') },
                { text: 'This week', onPress: () => handleRangePress('week') },
                { text: 'This month', onPress: () => handleRangePress('month') },
                { text: 'Choose month…', onPress: () => handleRangePress('custom_month') },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: mode === 'email' ? theme.colors.primary + '18' : theme.colors.secondary + '18',
              borderWidth: 1,
              borderColor: mode === 'email' ? theme.colors.primary + '40' : theme.colors.secondary + '40',
            }}
          >
            <Ionicons
              name={mode === 'email' ? 'mail-outline' : 'images-outline'}
              size={14}
              color={mode === 'email' ? theme.colors.primary : theme.colors.secondary}
            />
            <Text style={{
              fontSize: 9,
              fontWeight: '800',
              marginLeft: 4,
              color: mode === 'email' ? theme.colors.primary : theme.colors.secondary,
            }}
            >
              {mode === 'email' ? 'EMAIL' : 'PHOTOS'}
            </Text>
          </TouchableOpacity>
        </View>
        <MonthPickerModal
          visible={monthPickerVisible}
          months={months}
          title={mode === 'email' ? 'Email — choose month' : 'Photos — choose month'}
          onSelect={onMonthSelected}
          onClose={() => setMonthPickerVisible(false)}
        />
      </>
    );
  }

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.black, marginBottom: 4 }}>
        {mode === 'email' ? 'Email cleaning' : 'Photo cleaning'}
      </Text>
      <Text style={{ fontSize: 11, color: theme.colors.gray, marginBottom: 16, lineHeight: 16 }}>
        {mode === 'email'
          ? 'Fetch and clean newsletters, promos, and junk for the selected period. Requires Render cloud email and Allow move to Trash.'
          : 'Remove duplicate photos and coding screenshots for photos taken in the selected period. Preview first, then apply.'}
      </Text>

      {emailDisabled && mode === 'email' ? (
        <Text style={{ fontSize: 11, color: theme.colors.danger, marginBottom: 12 }}>
          {emailDisabledHint}
        </Text>
      ) : null}

      <RangeButton
        label="Today"
        subtitle="Since midnight local time"
        icon="today-outline"
        onPress={() => handleRangePress('today')}
        disabled={mode === 'email' && emailDisabled}
      />
      <RangeButton
        label="This week"
        subtitle="Sunday through Saturday (calendar week)"
        icon="calendar-outline"
        onPress={() => handleRangePress('week')}
        disabled={mode === 'email' && emailDisabled}
      />
      <RangeButton
        label="This month"
        subtitle="Current calendar month"
        icon="calendar-number-outline"
        onPress={() => handleRangePress('month')}
        disabled={mode === 'email' && emailDisabled}
      />
      <RangeButton
        label="Choose month…"
        subtitle="Pick any of the last 24 months"
        icon="list-outline"
        onPress={() => handleRangePress('custom_month')}
        disabled={mode === 'email' && emailDisabled}
      />

      <MonthPickerModal
        visible={monthPickerVisible}
        months={months}
        title={mode === 'email' ? 'Email — choose month' : 'Photos — choose month'}
        onSelect={onMonthSelected}
        onClose={() => setMonthPickerVisible(false)}
      />
    </View>
  );
}

function MonthPickerModal({ visible, months, title, onSelect, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.white }}>
        <View style={{
          padding: 20,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.light,
        }}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.black }}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={months}
          keyExtractor={(item) => `${item.year}-${item.month}`}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => onSelect(item)}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.light,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.black }}>{item.label}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}
