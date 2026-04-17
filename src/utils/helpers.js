import { Platform } from 'react-native';

export const formatFullDate = (isoString) => {
  if (!isoString) return 'Pending...';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) { return 'Date Format Err'; }
};

export const getImportanceColor = (score) => {
  const s = parseInt(score);
  if (s >= 8) return '#FF3B30'; // Critical (Red)
  if (s >= 5) return '#FFCC00'; // High/Med (Gold)
  return '#10b981'; // Moderate/Trivial (Green/Emerald)
};

export const getPowerScore = (importance, recall) => {
  const imp = parseFloat(importance) || 1;
  const rec = parseFloat(recall) || 0;
  // Score = Importance + (Log10(Recall + 1) * 2)
  const score = imp + (Math.log10(rec + 1) * 2);
  return score.toFixed(2);
};

export const maskKey = (key) => {
  if (!key || key.length < 12) return key;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
};

export const stringifyContent = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(i => stringifyContent(i)).join('\n');
  if (typeof content === 'object' && content !== null) return content.text || JSON.stringify(content);
  return String(content);
};
