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
    marginLeft: 4, // Subtle gap from previous badge
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  text: {
    fontSize: 8,
    fontWeight: '900',
    color: theme.colors.gray,
    textTransform: 'uppercase',
  },
});

export default StatusIndicator;
