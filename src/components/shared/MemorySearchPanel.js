import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../styles/theme';
import MemoryFragmentCard from './MemoryFragmentCard';
import { MEMORY_QUICK_FILTERS } from '../../utils/memoryDisplay';

export function MemorySearchPanel({
  query,
  onChangeQuery,
  matchCount,
  matches,
  expandedIds,
  onToggleExpanded,
  questionLogCount = 0,
}) {
  const hasQuery = String(query || '').trim().length > 0;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 10, fontWeight: '800', color: theme.colors.gray, marginBottom: 8 }}>
        FIND IN MEMORY
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.colors.white,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          marginBottom: 10,
        }}
      >
        <Ionicons name="search" size={18} color={theme.colors.gray} style={{ marginRight: 8 }} />
        <TextInput
          style={{ flex: 1, paddingVertical: 10, fontSize: 14, color: theme.colors.black }}
          placeholder="Search Min, boundary, April 2026, UID…"
          placeholderTextColor={theme.colors.gray}
          value={query}
          onChangeText={onChangeQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {hasQuery ? (
          <TouchableOpacity onPress={() => onChangeQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color={theme.colors.gray} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: hasQuery ? 12 : 0 }}>
        {MEMORY_QUICK_FILTERS.map((chip) => (
          <TouchableOpacity
            key={chip.label}
            onPress={() => onChangeQuery(chip.query)}
            style={{
              backgroundColor: query === chip.query ? theme.colors.primary : theme.colors.light,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 16,
              marginRight: 8,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: query === chip.query ? '#fff' : theme.colors.black,
              }}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {hasQuery ? (
        <View style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: theme.colors.gray, marginBottom: 10 }}>
            {matchCount === 0
              ? (questionLogCount > 0
                ? `Found ${questionLogCount} question log(s) in L2 but no UID/Date email evidence. Run an April Min-folder fetch in chat, then Pin to L1.`
                : 'No fragments matched. Try “min”, “boundary”, or “april 2026”.')
              : `${matchCount} matching fragment${matchCount === 1 ? '' : 's'} (evidence ranked first)`}
          </Text>
          {matches.map((row) => {
            const key = `${row.layer}_${row.id}`;
            return (
              <MemoryFragmentCard
                key={key}
                layerLabel={row.layerLabel}
                kind={row.kind}
                text={row.text}
                meta={row.meta}
                expanded={!!expandedIds[key]}
                onToggle={() => onToggleExpanded(key)}
                borderColor={row.kind === 'evidence' ? theme.colors.success : theme.colors.primary}
              />
            );
          })}
        </View>
      ) : (
        <Text style={{ fontSize: 11, color: theme.colors.gray, lineHeight: 16 }}>
          Long lists are truncated — tap any fragment to expand. Use search or quick filters to jump to Min / boundary / email details.
        </Text>
      )}
    </View>
  );
}
