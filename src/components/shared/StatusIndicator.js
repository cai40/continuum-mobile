import React from 'react';
import { theme } from '../../styles/theme';
import HeaderBadge from './HeaderBadge';

const StatusIndicator = ({ status }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'healthy': return theme.colors.success || '#4ade80';
      case 'degraded': return theme.colors.warning || '#facc15';
      case 'offline': return theme.colors.error || '#f87171';
      default: return theme.colors.gray;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'healthy': return 'BRAIN';
      case 'degraded': return 'SYNCING';
      case 'offline': return 'OFFLINE';
      default: return 'CONNECTING';
    }
  };

  return <HeaderBadge label={getStatusText()} color={getStatusColor()} />;
};

export default StatusIndicator;
