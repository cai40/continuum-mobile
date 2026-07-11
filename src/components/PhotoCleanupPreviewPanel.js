import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../styles/theme';
import {
  createPreviewPlan,
  favoriteFromTrashPlan,
  formatScore,
  planSummary,
  removeFromFavoritesPlan,
  removeFromTrashPlan,
} from '../utils/photoPreviewPlan';

function ActionChip({ label, icon, color, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: theme.colors.light,
        opacity: disabled ? 0.45 : 1,
        marginLeft: 6,
      }}
    >
      <Ionicons name={icon} size={14} color={color} style={{ marginRight: 4 }} />
      <Text style={{ fontSize: 10, fontWeight: '700', color }}>{label}</Text>
    </TouchableOpacity>
  );
}

function TrashRow({ item, editable, onRemove, onFavorite }) {
  return (
    <View
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
          {item.reason === 'coding_screenshot' ? ' · screenshot' : ''}
        </Text>
      </View>
      {editable ? (
        <View style={{ flexDirection: 'row' }}>
          <ActionChip label="Keep" icon="close-circle-outline" color={theme.colors.gray} onPress={() => onRemove(item.id)} />
          <ActionChip label="Favorite" icon="heart-outline" color={theme.colors.secondary} onPress={() => onFavorite(item)} />
        </View>
      ) : null}
    </View>
  );
}

function FavoriteRow({ item, rank, editable, onRemove }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.light,
      }}
    >
      <View style={{ width: 28, alignItems: 'center', marginRight: 6 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.primary }}>#{rank}</Text>
      </View>
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
          AI score {formatScore(item.score)}{item.manual ? ' · added from trash' : ''}
        </Text>
      </View>
      {editable ? (
        <ActionChip label="Remove" icon="heart-dislike-outline" color={theme.colors.danger} onPress={() => onRemove(item.id)} />
      ) : null}
    </View>
  );
}

function PreviewSectionShell({ title, subtitle, icon, iconColor, count, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;

  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: open ? 8 : 0 }}
      >
        <Ionicons name={icon} size={16} color={iconColor} style={{ marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.black }}>
            {title} ({count})
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: 10, color: theme.colors.gray, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.gray} />
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

/**
 * @param {Object} props
 * @param {import('../utils/photoAlbumCleanup').CleanupReport | null} props.report
 * @param {import('../utils/photoPreviewPlan').PhotoPreviewPlan | null} [props.plan]
 * @param {(plan: import('../utils/photoPreviewPlan').PhotoPreviewPlan) => void} [props.onPlanChange]
 * @param {() => void} [props.onApply]
 * @param {boolean} [props.applying]
 * @param {boolean} [props.editable]
 * @param {boolean} [props.compact]
 */
export default function PhotoCleanupPreviewPanel({
  report,
  plan: planProp,
  onPlanChange,
  onApply,
  applying = false,
  editable = false,
  compact = false,
}) {
  const plan = useMemo(() => {
    if (planProp) return planProp;
    if (report?.dryRun) return createPreviewPlan(report);
    return null;
  }, [planProp, report]);

  if (!report?.dryRun || !plan) return null;

  const { trashCount, favoriteCount, hiddenTrashCount } = planSummary(plan);
  const dupes = plan.trashItems.filter((item) => item.reason !== 'coding_screenshot');
  const screenshots = plan.trashItems.filter((item) => item.reason === 'coding_screenshot');
  const favorites = plan.favoriteItems;

  if (!trashCount && !favoriteCount && !plan.trashItems.length) {
    return (
      <View style={{ marginTop: compact ? 8 : 12 }}>
        <Text style={{ fontSize: 12, color: theme.colors.gray }}>
          Preview complete — nothing would be deleted or favorited.
        </Text>
      </View>
    );
  }

  const updatePlan = (next) => {
    if (onPlanChange) onPlanChange(next);
  };

  return (
    <View style={{ marginTop: compact ? 8 : 12 }}>
      {!compact ? (
        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.black, marginBottom: 4 }}>
          Preview — edit lists, then apply
        </Text>
      ) : null}
      {editable ? (
        <Text style={{ fontSize: 11, color: theme.colors.gray, marginBottom: 8, lineHeight: 16 }}>
          Keep removes a photo from trash. Favorite moves it from trash to favorites. Favorites are ranked by AI score (high → low).
        </Text>
      ) : null}

      <PreviewSectionShell
        title="Trash"
        subtitle="Tap Keep to skip deleting · Favorite to save instead"
        icon="trash-outline"
        iconColor={theme.colors.danger}
        count={plan.trashItems.length}
        defaultOpen
      >
        {dupes.length ? (
          <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.gray, marginBottom: 4 }}>
            Duplicates ({dupes.length})
          </Text>
        ) : null}
        {dupes.map((item) => (
          <TrashRow
            key={item.id}
            item={item}
            editable={editable}
            onRemove={(id) => updatePlan(removeFromTrashPlan(plan, id))}
            onFavorite={(row) => updatePlan(favoriteFromTrashPlan(plan, row))}
          />
        ))}
        {screenshots.length ? (
          <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.gray, marginTop: 8, marginBottom: 4 }}>
            Coding screenshots ({screenshots.length})
          </Text>
        ) : null}
        {screenshots.map((item) => (
          <TrashRow
            key={item.id}
            item={item}
            editable={editable}
            onRemove={(id) => updatePlan(removeFromTrashPlan(plan, id))}
            onFavorite={(row) => updatePlan(favoriteFromTrashPlan(plan, row))}
          />
        ))}
        {hiddenTrashCount > 0 ? (
          <Text style={{ fontSize: 10, color: theme.colors.gray, marginTop: 6, fontStyle: 'italic' }}>
            + {hiddenTrashCount} more in trash plan (not shown). Apply uses your full trash count: {trashCount}.
          </Text>
        ) : null}
      </PreviewSectionShell>

      <PreviewSectionShell
        title="Favorites"
        subtitle="Ranked by AI score — highest first"
        icon="heart-outline"
        iconColor={theme.colors.secondary}
        count={favorites.length}
        defaultOpen={!compact}
      >
        {favorites.map((item, index) => (
          <FavoriteRow
            key={item.id}
            item={item}
            rank={index + 1}
            editable={editable}
            onRemove={(id) => updatePlan(removeFromFavoritesPlan(plan, id))}
          />
        ))}
      </PreviewSectionShell>

      {editable && onApply ? (
        <TouchableOpacity
          onPress={onApply}
          disabled={applying}
          style={{
            marginTop: 16,
            backgroundColor: theme.colors.primary,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: 'center',
            opacity: applying ? 0.65 : 1,
          }}
        >
          {applying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
              Apply changes
            </Text>
          )}
          {!applying ? (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 4 }}>
              Trash {trashCount} · Favorite {favoriteCount}
            </Text>
          ) : null}
        </TouchableOpacity>
      ) : !compact ? (
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.light }}>
          <Text style={{ fontSize: 11, color: theme.colors.gray, lineHeight: 18 }}>
            Edit lists above, then tap Apply changes. Or reply apply / proceed in chat.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
