import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { theme } from '../../styles/theme';
import { MEMORY_PREVIEW_CHARS } from '../../utils/memoryDisplay';

export default function MemoryFragmentCard({
  text,
  meta,
  layerLabel,
  expanded,
  onToggle,
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
    <TouchableOpacity
      activeOpacity={needsTruncate ? 0.7 : 1}
      onPress={needsTruncate ? onToggle : undefined}
      style={{
        backgroundColor: theme.colors.white,
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
      }}
    >
      {layerLabel ? (
        <Text style={{ fontSize: 9, fontWeight: '800', color: theme.colors.primary, marginBottom: 6 }}>
          {layerLabel}
        </Text>
      ) : null}
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
  );
}
