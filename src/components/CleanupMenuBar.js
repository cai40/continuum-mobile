import React from 'react';
import { View } from 'react-native';
import CleanupRangePanel from './CleanupRangePanel';

/**
 * Chat toolbar: Email + Photos cleanup menu buttons.
 */
export default function CleanupMenuBar({
  onEmailCleanup,
  onPhotoPreview,
  onPhotoApply,
  emailDisabled,
  emailDisabledHint,
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingBottom: 4 }}>
      <CleanupRangePanel
        compact
        mode="email"
        onEmailCleanup={onEmailCleanup}
        emailDisabled={emailDisabled}
        emailDisabledHint={emailDisabledHint}
      />
      <CleanupRangePanel
        compact
        mode="photo"
        onPhotoPreview={onPhotoPreview}
        onPhotoApply={onPhotoApply}
      />
    </View>
  );
}
