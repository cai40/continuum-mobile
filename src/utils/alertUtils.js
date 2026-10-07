import { Alert, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

export const ERROR_ALERT_KEYWORDS = /error|fail|fault|crash|exception|invalid|reject|denied|problem|expired|unreachable|quota|limit exceeded|timed out|could not|cannot reach|refused|warning|alert|fatal|hiccup|wrong|unavailable|missing|disabled|required|unauthorized/i;

/**
 * Copies the alert title and message to the device clipboard and provides haptic feedback.
 */
export async function copyAlertText(title, message) {
  const parts = [title, message].filter(Boolean);
  const text = parts.join('\n\n');
  if (!text) return false;
  try {
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text);
    }
    try {
      if (Haptics?.notificationAsync) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {}
    return true;
  } catch (err) {
    console.warn('Failed to copy alert text to clipboard:', err);
    return false;
  }
}

/**
 * Checks if an alert title or message represents an error, failure, or problem.
 */
export function isErrorLikeAlert(title, message) {
  const combined = `${title || ''} ${message || ''}`.trim();
  return ERROR_ALERT_KEYWORDS.test(combined);
}

/**
 * Shows an alert guaranteed to have a 'Copy Error' button.
 */
export function showErrorAlert(title, message, buttons = [], options) {
  const copyBtn = {
    text: 'Copy Error',
    onPress: () => copyAlertText(title, message),
  };

  let finalButtons = [];
  if (!buttons || buttons.length === 0) {
    finalButtons = [copyBtn, { text: 'OK', style: 'cancel' }];
  } else {
    const hasCopy = buttons.some((b) => /copy/i.test(b?.text || ''));
    if (hasCopy) {
      finalButtons = buttons;
    } else {
      finalButtons = [copyBtn, ...buttons];
    }
  }

  return Alert.alert(title, message, finalButtons, options);
}

/**
 * Installs global monkey-patch on Alert.alert so that any error alert across
 * the app automatically includes a 'Copy Error' action button.
 */
export function setupCopyableAlerts() {
  if (typeof Alert === 'undefined' || !Alert.alert) return;
  if (Alert._copyableAlertsInstalled) return;
  Alert._copyableAlertsInstalled = true;

  const originalAlert = Alert.alert.bind(Alert);

  Alert.alert = function (title, message, buttons, options) {
    try {
      const isError = isErrorLikeAlert(title, message);

      if (isError) {
        const copyBtn = {
          text: 'Copy Error',
          onPress: () => copyAlertText(title, message),
        };

        if (!buttons || buttons.length === 0) {
          // Standard 1-button dismiss alert -> convert to [Copy Error, OK]
          buttons = [copyBtn, { text: 'OK', style: 'cancel' }];
        } else {
          const hasCopy = buttons.some((b) => /copy/i.test(b?.text || ''));
          if (!hasCopy) {
            // Android allows up to 3 buttons (positive, negative, neutral)
            // iOS allows unlimited buttons
            const canAddButton = Platform.OS !== 'android' || buttons.length < 3;
            if (canAddButton) {
              const cancelIdx = buttons.findIndex((b) => b?.style === 'cancel');
              if (cancelIdx >= 0) {
                buttons = [
                  ...buttons.slice(0, cancelIdx),
                  copyBtn,
                  ...buttons.slice(cancelIdx),
                ];
              } else {
                buttons = [...buttons, copyBtn];
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error in copyable Alert.alert wrapper:', err);
    }

    return originalAlert(title, message, buttons, options);
  };
}

// Automatically install upon import
setupCopyableAlerts();
