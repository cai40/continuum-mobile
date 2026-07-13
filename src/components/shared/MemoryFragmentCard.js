import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../styles/theme';
import { MEMORY_PREVIEW_CHARS } from '../../utils/memoryDisplay';

export default function MemoryFragmentCard({
  text,
  meta,
  layerLabel,
  kind,
  expanded,
  onToggle,
  onDelete,
  borderColor = theme.colors.border,
  previewChars = MEMORY_PREVIEW_CHARS,
}) {
  const content = String(text || '').trim();
  if (!content) return null;

  const needsTruncate = content.length > previewChars;
  const shown = expanded || !needsTruncate
    ? content
    : `${content.slice(0, previewChars).trim()}…`;

  return (
    <View
      style={{
        backgroundColor: theme.colors.white,
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: onDelete ? 8 : 0 }}>
          {layerLabel ? (
            <Text style={{ fontSize: 9, fontWeight: '800', color: theme.colors.primary, marginBottom: 6 }}>
              {layerLabel}{kind === 'question' ? ' · QUESTION LOG' : kind === 'evidence' ? ' · EVIDENCE' : ''}
            </Text>
          ) : null}
        </View>
        {onDelete ? (
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Remove memory"
          >
            <Ionicons name="trash-outline" size={18} color={theme.colors.danger || '#dc2626'} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity
        activeOpacity={needsTruncate ? 0.7 : 1}
        onPress={needsTruncate ? onToggle : undefined}
      >
        <Text style={{ fontSize: 13, color: theme.colors.black, lineHeight: 19 }}>
          {shown}
        </Text>
        {meta ? (
          <Text style={{ fontSize: 9, color: theme.colors.gray, marginTop: 6 }}>
            {meta}
          </Text>
        ) : null}
        {needsTruncate ? (
          <Text style={{ fontSize: 10, color: theme.colors.primary, marginTop: 8, fontWeight: '600' }}>
            {expanded ? 'Tap to collapse' : 'Tap to read full fragment'}
          </Text>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}
