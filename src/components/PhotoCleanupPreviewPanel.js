import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../styles/theme';

function PreviewSection({ title, subtitle, icon, iconColor, items, total, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!total) return null;

  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: open ? 8 : 0 }}
      >
        <Ionicons name={icon} size={16} color={iconColor} style={{ marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.black }}>
            {title} ({total})
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: 10, color: theme.colors.gray, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.gray} />
      </TouchableOpacity>
      {open ? items.map((item) => (
        <View
          key={item.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.light,
          }}
        >
          <Image
            source={{ uri: item.uri }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              backgroundColor: theme.colors.light,
              marginRight: 10,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: theme.colors.black }}>
              {item.filename}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 10, color: theme.colors.gray, marginTop: 2 }}>
              {item.dateLabel}{item.sizeLabel ? ` · ${item.sizeLabel}` : ''}
            </Text>
          </View>
        </View>
      )) : null}
      {open && items.length < total ? (
        <Text style={{ fontSize: 10, color: theme.colors.gray, marginTop: 6, fontStyle: 'italic' }}>
          Showing {items.length} of {total}.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * @param {{ report: import('../utils/photoAlbumCleanup').CleanupReport | null, compact?: boolean }} props
 */
export default function PhotoCleanupPreviewPanel({ report, compact = false }) {
  if (!report?.dryRun) return null;

  const dupes = report.trash?.duplicates?.items || [];
  const screenshots = report.trash?.codingScreenshots?.items || [];
  const favorites = report.favorites?.items || [];
  const trashTotal = report.trash?.total || 0;
  const favoriteTotal = report.favorites?.total || report.favorites?.selected || 0;

  if (!trashTotal && !favoriteTotal) {
    return (
      <View style={{ marginTop: compact ? 8 : 12 }}>
        <Text style={{ fontSize: 12, color: theme.colors.gray }}>
          Preview complete — nothing would be deleted or favorited.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: compact ? 8 : 12 }}>
      {!compact ? (
        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.black, marginBottom: 4 }}>
          Preview — planned changes
        </Text>
      ) : null}
      <PreviewSection
        title="Duplicates → trash"
        subtitle="Lower-quality or older copies"
        icon="copy-outline"
        iconColor={theme.colors.danger}
        items={dupes}
        total={report.trash?.duplicates?.total || 0}
        defaultOpen
      />
      <PreviewSection
        title="Coding screenshots → trash"
        subtitle="IDE, terminal, and monitor screenshots"
        icon="code-slash-outline"
        iconColor={theme.colors.danger}
        items={screenshots}
        total={report.trash?.codingScreenshots?.total || 0}
        defaultOpen={!compact}
      />
      <PreviewSection
        title="Add to favorites"
        subtitle="Continuum Favorites album"
        icon="heart-outline"
        iconColor={theme.colors.secondary}
        items={favorites}
        total={favoriteTotal}
        defaultOpen={!compact}
      />
    </View>
  );
}
