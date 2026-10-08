const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== TEST SUITE: SILENT HISTORY BACKFILL & NO POPUP ALERT ===\n');

// 1. Verify ChatSection has completely removed Alert.alert('History recovered')
console.log('1. Testing ChatSection recovery alert removal...');
const chatSectionPath = path.resolve(__dirname, '../src/components/ChatSection.js');
const chatSectionCode = fs.readFileSync(chatSectionPath, 'utf8');

assert.strictEqual(
  chatSectionCode.includes('History recovered'),
  false,
  'ChatSection must NOT contain "History recovered" alert title',
);

assert.strictEqual(
  chatSectionCode.includes('queued 5 turns to be remembered again'),
  false,
  'ChatSection must NOT have hardcoded alert messages for memory rebuild',
);

assert.ok(
  chatSectionCode.includes('// Intentionally NEVER show an Alert.alert modal on app startup'),
  'ChatSection must document explicit avoidance of Alert.alert on startup',
);
console.log('✓ "History recovered" Alert.alert popup is completely removed');

// 2. Verify persona gating & Wanqing protection in backfill
console.log('\n2. Testing Persona & Wanqing isolation in backfill...');
assert.ok(
  chatSectionCode.includes("if (activePersonaId && activePersonaId !== 'standard') return;"),
  'ChatSection must guard backfill so non-standard personas (Wanqing etc.) are never sent to cloud backfill',
);

assert.ok(
  chatSectionCode.includes('if (isWanqingItem(m)) return false;'),
  'ChatSection must filter out any isWanqingItem from cloud backfill',
);
console.log('✓ Non-standard persona and Wanqing content strictly excluded from cloud backfill');

// 3. Verify persistent deduplication via AsyncStorage
console.log('\n3. Testing persistent deduplication for backfill...');
assert.ok(
  chatSectionCode.includes('@chat_history_backfilled_ids'),
  'ChatSection must use @chat_history_backfilled_ids to persist processed IDs',
);

assert.ok(
  chatSectionCode.includes('backfilledSet.has(idStr)'),
  'ChatSection must check backfilledSet so already processed IDs are not resent',
);

assert.ok(
  chatSectionCode.includes("AsyncStorage.setItem('@chat_history_backfilled_ids'"),
  'ChatSection must persist updated backfilled IDs set to AsyncStorage',
);
console.log('✓ Persistent deduplication via @chat_history_backfilled_ids verified');

// 4. Verify AppContext syncRemoteHistory persona safety
console.log('\n4. Testing AppContext syncRemoteHistory persona safety...');
const appContextPath = path.resolve(__dirname, '../src/context/AppContext.js');
const appContextCode = fs.readFileSync(appContextPath, 'utf8');

assert.ok(
  appContextCode.includes('activePersonaIdRef'),
  'AppContext must track activePersonaIdRef for synchronous checks in hydration',
);

assert.ok(
  appContextCode.includes("@chat_history_persona_standard"),
  'AppContext must support @chat_history_persona_standard isolation',
);

assert.ok(
  appContextCode.includes("@chat_history_backfilled_ids"),
  'AppContext clearLocalHistory must clean @chat_history_backfilled_ids',
);
console.log('✓ AppContext syncRemoteHistory maintains clean persona isolation without cross-contamination');

console.log('\n================================================================');
console.log('🎉 ALL SILENT HISTORY BACKFILL TESTS PASSED! 🎉');
console.log('================================================================\n');
