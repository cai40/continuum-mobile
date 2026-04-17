import React from 'react';
import { View, Text } from 'react-native';
import { theme } from '../../styles/theme';

const LatencyHeatmap = ({ data }) => {
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  
  return (
    <View style={{flexDirection: 'row', marginTop: 8, height: 4, borderRadius: 2, overflow: 'hidden'}}>
      {data.map((point, idx) => {
        let color = '#34C759'; // Good
        if (point.latency > 1000) color = '#FFCC00'; // Warning
        if (point.latency > 3000) color = '#FF3B30'; // Critical
        
        return (
          <View 
            key={idx} 
            style={{
              flex: 1, 
              backgroundColor: color, 
              marginRight: idx < data.length - 1 ? 1 : 0
            }} 
          />
        );
      })}
    </View>
  );
};

export default LatencyHeatmap;
