import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../styles/theme';
import {
  getCleanupRange,
  getCleanupRangeFromMonths,
  buildEmailCleanupPreviewMessage,
  buildEmailCleanupApplyMessage,
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
  const months = listSelectableMonths(24);

  const runEmailWithRange = (range, apply) => {
    if (!range || !onEmailCleanup) return;
    const message = apply ? buildEmailCleanupApplyMessage(range) : buildEmailCleanupPreviewMessage(range);
    onEmailCleanup(message);
  };

  const runEmail = (period, opts, apply) => {
    runEmailWithRange(getCleanupRange(period, opts), apply);
  };

  const showEmailActionSheet = (period, opts = {}) => {
    Alert.alert(
      'Email cleaning',
      'Preview lists newsletters/promos that would move to Trash. Apply requires Allow move to Trash in Setup.',
      [
        { text: 'Preview (dry run)', onPress: () => runEmail(period, opts, false) },
        { text: 'Apply cleanup', style: 'destructive', onPress: () => runEmail(period, opts, true) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const showEmailActionSheetForRange = (range) => {
    Alert.alert(
      'Email cleaning',
      'Preview lists newsletters/promos that would move to Trash. Apply requires Allow move to Trash in Setup.',
      [
        { text: 'Preview (dry run)', onPress: () => runEmailWithRange(range, false) },
        { text: 'Apply cleanup', style: 'destructive', onPress: () => runEmailWithRange(range, true) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const runPhotoWithRange = (range, apply) => {
    if (!range) return;
    const message = buildPhotoCleanupMessage(range, { apply });
    if (apply) onPhotoApply?.(message);
    else onPhotoPreview?.(message);
  };

  const runPhoto = (period, opts, apply) => {
    runPhotoWithRange(getCleanupRange(period, opts), apply);
  };

  const showPhotoActionSheet = (period, opts = {}) => {
    Alert.alert('Photo cleaning', 'Preview scans without deleting. Apply removes duplicates and coding screenshots. Favorites are never touched.', [
      { text: 'Preview (dry run)', onPress: () => runPhoto(period, opts, false) },
      { text: 'Apply cleanup', style: 'destructive', onPress: () => runPhoto(period, opts, true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const showPhotoActionSheetForRange = (range) => {
    Alert.alert('Photo cleaning', 'Preview scans without deleting. Apply removes duplicates and coding screenshots. Favorites are never touched.', [
      { text: 'Preview (dry run)', onPress: () => runPhotoWithRange(range, false) },
      { text: 'Apply cleanup', style: 'destructive', onPress: () => runPhotoWithRange(range, true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openMonthPicker = () => {
    setMonthPickerVisible(true);
  };

  const onMonthsConfirmed = (selectedMonths) => {
    setMonthPickerVisible(false);
    if (!selectedMonths.length) return;

    const range = selectedMonths.length === 1
      ? getCleanupRange('custom_month', selectedMonths[0])
      : getCleanupRangeFromMonths(selectedMonths);
    if (!range) return;

    if (mode === 'email') {
      showEmailActionSheetForRange(range);
      return;
    }
    showPhotoActionSheetForRange(range);
  };

  const handleRangePress = (period) => {
    if (mode === 'email') {
      if (emailDisabled) {
        Alert.alert('Email cleaning unavailable', emailDisabledHint || 'Enable Render cloud email in Setup.');
        return;
      }
      if (period === 'custom_month') openMonthPicker();
      else showEmailActionSheet(period);
      return;
    }
    if (period === 'custom_month') openMonthPicker();
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
                { text: 'Choose months…', onPress: () => handleRangePress('custom_month') },
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
          title={mode === 'email' ? 'Email — choose months' : 'Photos — choose months'}
          onConfirm={onMonthsConfirmed}
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
          ? 'Fetch and clean newsletters, promos, and junk for the selected period. Preview lists what would move to Trash; apply requires Render cloud email and Allow move to Trash.'
          : 'Remove duplicate photos and coding screenshots for photos taken in the selected period. Favorites are never deleted. Preview first, then apply.'}
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
        label="Choose months…"
        subtitle="Pick one or more of the last 24 months"
        icon="list-outline"
        onPress={() => handleRangePress('custom_month')}
        disabled={mode === 'email' && emailDisabled}
      />

      <MonthPickerModal
        visible={monthPickerVisible}
        months={months}
        title={mode === 'email' ? 'Email — choose months' : 'Photos — choose months'}
        onConfirm={onMonthsConfirmed}
        onClose={() => setMonthPickerVisible(false)}
      />
    </View>
  );
}

function MonthPickerModal({ visible, months, title, onConfirm, onClose }) {
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  const toggleMonth = (item) => {
    const key = `${item.year}-${item.month}`;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!selectedKeys.size) {
      Alert.alert('Choose at least one month', 'Tap months to select them, then tap Done.');
      return;
    }
    const selected = months.filter((item) => selectedKeys.has(`${item.year}-${item.month}`));
    onConfirm(selected);
    setSelectedKeys(new Set());
  };

  const handleClose = () => {
    setSelectedKeys(new Set());
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
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
          <TouchableOpacity onPress={handleClose}>
            <Text style={{ color: theme.colors.gray, fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '800', color: theme.colors.black }}>{title}</Text>
          <TouchableOpacity onPress={handleConfirm}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
              Done{selectedKeys.size ? ` (${selectedKeys.size})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.gray, paddingHorizontal: 20, paddingVertical: 10 }}>
          Tap to select multiple months. Non-adjacent months are supported for photos.
        </Text>
        <FlatList
          data={months}
          keyExtractor={(item) => `${item.year}-${item.month}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          renderItem={({ item }) => {
            const key = `${item.year}-${item.month}`;
            const selected = selectedKeys.has(key);
            return (
              <TouchableOpacity
                onPress={() => toggleMonth(item)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.light,
                }}
              >
                <Ionicons
                  name={selected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={selected ? theme.colors.primary : theme.colors.gray}
                  style={{ marginRight: 12 }}
                />
                <Text style={{
                  fontSize: 16,
                  fontWeight: selected ? '700' : '600',
                  color: theme.colors.black,
                }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
}
