import React from 'react';
import { ScrollView, View } from 'react-native';
import { useAppContext } from '../context/AppContext';
import { styles, theme } from '../styles/theme';
import CleanupRangePanel from './CleanupRangePanel';

export default function EmailCleanupSection() {
  const { renderEmailEnabled, setActiveTab, setPendingChatMessage } = useAppContext();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.groupedCard}>
        <CleanupRangePanel
          mode="email"
          emailDisabled={!renderEmailEnabled}
          emailDisabledHint="Turn on Render cloud email in Setup → OpenClaw Gateway and set your bridge secret."
          onEmailCleanup={(msg) => {
            setPendingChatMessage(msg);
            setActiveTab('chat');
          }}
        />
      </View>
    </ScrollView>
  );
}
