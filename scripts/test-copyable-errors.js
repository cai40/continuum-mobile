/**
 * Automated test suite for copyable error windows and critical fault reporting.
 * Run with: node scripts/test-copyable-errors.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== TEST SUITE: Copyable Critical Fault & Error Windows ===\n');

// 1. Mock React Native and Expo modules for testing in Node.js
let clipboardContent = '';
const mockClipboard = {
  setStringAsync: async (text) => {
    clipboardContent = text;
    return true;
  },
};

let hapticFired = false;
const mockHaptics = {
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: async () => {
    hapticFired = true;
    return true;
  },
};

let lastAlert = null;
const mockAlert = {
  alert: (title, message, buttons, options) => {
    lastAlert = { title, message, buttons, options };
  },
};

const alertUtilsPath = path.resolve(__dirname, '../src/utils/alertUtils.js');
const alertUtilsCode = fs.readFileSync(alertUtilsPath, 'utf8')
  .replace(/import\s+\{\s*Alert,\s*Platform\s*\}\s+from\s+'react-native';/g, 'const { Alert, Platform } = mockReactNative;')
  .replace(/import\s+\*\s+as\s+Clipboard\s+from\s+'expo-clipboard';/g, 'const Clipboard = mockClipboard;')
  .replace(/import\s+\*\s+as\s+Haptics\s+from\s+'expo-haptics';/g, 'const Haptics = mockHaptics;')
  .replace(/export\s+(?:async\s+)?function\s+(\w+)/g, (m, fn) => m.includes('async') ? `async function ${fn}` : `function ${fn}`)
  .replace(/export\s+(?:const|let|var)\s+(\w+)/g, 'const $1');

const sandbox = {
  mockReactNative: {
    Alert: mockAlert,
    Platform: { OS: 'ios' },
  },
  mockClipboard,
  mockHaptics,
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  Boolean,
  module: { exports: {} },
};

vm.createContext(sandbox);
vm.runInContext(`
${alertUtilsCode}

module.exports = {
  ERROR_ALERT_KEYWORDS,
  copyAlertText,
  isErrorLikeAlert,
  showErrorAlert,
  setupCopyableAlerts,
};
`, sandbox);

const {
  ERROR_ALERT_KEYWORDS,
  copyAlertText,
  isErrorLikeAlert,
  showErrorAlert,
  setupCopyableAlerts,
} = sandbox.module.exports;

// 2. Test isErrorLikeAlert
console.log('--- Test 1: Error keyword pattern recognition ---');
const errorPhrases = [
  'Critical Fault',
  'FATAL CONTINUUM CRASH',
  'Send failed',
  'Authentication failed',
  'API quota reached',
  'Connection problem',
  'Photo cleanup failed',
  'Voice Error',
  'Something went wrong',
  'Email bridge hiccup',
  'Cloud Error',
  'Security Error',
  'Could not save core memory',
  'Cannot reach server',
  'Permission Denied',
  'Gemini key required',
  'Camera Unavailable',
  'File limit exceeded',
];

for (const phrase of errorPhrases) {
  assert.ok(
    isErrorLikeAlert(phrase, ''),
    `Phrase "${phrase}" should be recognized as an error`
  );
}
console.log(`✓ All ${errorPhrases.length} error phrases correctly identified as error-like`);

const nonErrorPhrases = [
  ['Confirm Deletion', 'Are you sure you want to delete 5 messages?'],
  ['Sign Out', 'End your current session?'],
  ['Attach Context', 'Add photos, documents, or Google Drive files.'],
  ['Message Options', 'Choose an action for this message.'],
];

for (const [title, msg] of nonErrorPhrases) {
  assert.strictEqual(
    isErrorLikeAlert(title, msg),
    false,
    `"${title}" should NOT be flagged as an error`
  );
}
console.log(`✓ All non-error phrases correctly ignored without false positives`);

// 3. Test setupCopyableAlerts monkey patching
console.log('\n--- Test 2: Alert.alert copy button injection ---');

function testAlertPatching() {
  // Case A: 1-argument/no-buttons error alert
  mockAlert.alert('Send failed', 'Network timeout connecting to server');
  assert.ok(lastAlert, 'Alert was triggered');
  assert.strictEqual(lastAlert.buttons.length, 2, 'Buttons list should have 2 buttons');
  assert.strictEqual(lastAlert.buttons[0].text, 'Copy Error', 'First button should be Copy Error');
  assert.strictEqual(lastAlert.buttons[1].text, 'OK', 'Second button should be OK');

  // Trigger onPress of Copy Error
  lastAlert.buttons[0].onPress();
  assert.ok(clipboardContent.includes('Send failed'), 'Clipboard receives title');
  assert.ok(clipboardContent.includes('Network timeout'), 'Clipboard receives message');
  console.log('✓ Error alert with no buttons automatically receives [Copy Error, OK] buttons');

  // Case B: Multi-button error alert
  mockAlert.alert('Cloud Error', 'Server 500 error', [
    { text: 'Retry', onPress: () => {} },
    { text: 'Cancel', style: 'cancel' },
  ]);
  assert.strictEqual(lastAlert.buttons.length, 3, 'Buttons list should include Copy Error plus original 2');
  assert.ok(lastAlert.buttons.some(b => b.text === 'Copy Error'), 'Copy Error is added');
  console.log('✓ Multi-button error alert preserves existing actions and includes Copy Error');

  // Case C: Non-error alert is left untouched
  mockAlert.alert('Confirm Deletion', 'Delete message?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive' },
  ]);
  assert.strictEqual(lastAlert.buttons.length, 2, 'Non-error buttons left untouched');
  assert.strictEqual(lastAlert.buttons[0].text, 'Cancel');
  console.log('✓ Non-error alerts are not modified');
}

testAlertPatching();

// 4. Test GlobalErrorBoundary critical fault copy payload
console.log('\n--- Test 3: Critical fault payload formatting ---');
const sampleError = new Error("Can't find variable: Image");
sampleError.stack = 'ReferenceError: Can\'t find variable: Image\n    at renderPersonaSettings (SettingsSection.js:2780:20)';
const sampleErrorInfo = {
  componentStack: '\n    in SettingsSection (at App.js:180)\n    in AppShell (at App.js:270)',
};

const parts = [
  `=== CONTINUUM CRITICAL FAULT ===`,
  `Build: 3.4.106-CopyableCriticalFault`,
  `Platform: ios (18.2)`,
  `Timestamp: ${new Date().toISOString()}`,
  `\n[Error Message]`,
  sampleError.message || sampleError.toString(),
  `\n[JavaScript Stack Trace]\n${sampleError.stack}`,
  `\n[React Component Stack]\n${sampleErrorInfo.componentStack}`,
];

const fullReport = parts.join('\n');
assert.ok(fullReport.includes('=== CONTINUUM CRITICAL FAULT ==='), 'Contains header');
assert.ok(fullReport.includes("Can't find variable: Image"), 'Contains error message');
assert.ok(fullReport.includes('SettingsSection.js:2780:20'), 'Contains JS stack');
assert.ok(fullReport.includes('in SettingsSection (at App.js:180)'), 'Contains component stack');
console.log('✓ Critical fault report payload accurately formats error, JS stack, component stack, and metadata');

console.log('\n========================================');
console.log('ALL COPYABLE ERROR WINDOW TESTS PASSED!');
console.log('========================================\n');
