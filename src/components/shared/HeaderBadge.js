import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../../styles/theme';

export function headerBadgeStyle(color) {
  return {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: `${color}40`,
    backgroundColor: `${color}15`,
  };
}

export default function HeaderBadge({ label, color = theme.colors.gray, onPress }) {
  const badge = (
    <View style={headerBadgeStyle(color)}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={4}>
        {badge}
      </TouchableOpacity>
    );
  }

  return badge;
}

const styles = StyleSheet.create({
  text: {
    fontSize: 8,
    fontWeight: '900',
  },
});
