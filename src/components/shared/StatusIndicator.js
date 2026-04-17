import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme } from '../../styles/theme';

const StatusIndicator = ({ status }) => {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (status === 'degraded' || status === 'offline') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      opacity.setValue(1);
    }
  }, [status]);

  const getStatusColor = () => {
    switch (status) {
      case 'healthy': return theme.colors.success || '#4ade80';
      case 'degraded': return theme.colors.warning || '#facc15';
      case 'offline': return theme.colors.error || '#f87171';
      default: return theme.colors.textSecondary;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'healthy': return 'Brain Online';
      case 'degraded': return 'Waking Up...';
      case 'offline': return 'Brain Offline';
      default: return 'Checking Pulse...';
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.dot, { backgroundColor: getStatusColor(), opacity }]} />
      <Text style={styles.text}>{getStatusText()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

export default StatusIndicator;
