/**
 * Automated Test Suite: Complete Invisibility of Lin Wanqing for Unauthorized Users
 * 
 * Verifies that:
 * 1. PICTURES:
 *    - Headshot and avatar resolvers return null for unauthorized users.
 *    - Portrait modal component returns null / blocks rendering for unauthorized users.
 * 2. PERSONA:
 *    - Persona ID detection returns null for unauthorized users.
 *    - Persona preset is completely hidden from preset libraries for unauthorized users.
 *    - Default persona state returns null for unauthorized users.
 *    - Persona prompts containing her details are scrubbed to default for unauthorized users.
 * 3. HISTORY:
 *    - trimChatHistoryForUpload strips any message mentioning her for unauthorized users.
 *    - trimChatHistoryForEmailRecall strips any message mentioning her for unauthorized users.
 *    - Visible messages in chat filter out any turn of her for unauthorized users while preserving for owner.
 * 4. MEMORIES:
 *    - DSP-CMA loadPersonaMemory, savePersonaMemory, evolvePersonaState, and resetPersonaMemory block unauthorized users.
 *    - buildPersonaGroundingBlock yields empty string for unauthorized users.
 *    - buildMemoryRecallContext completely scrubs Wanqing memory fragments from L1-L5 for unauthorized users.
 *    - Universal detector isWanqingItem comprehensively detects any item, fact, or asset related to her without false positives.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const authorizedUser = 'cai40@yahoo.com';
const unauthorizedUsers = [
  'stranger@gmail.com',
  'alice@example.com',
  'test@yahoo.com',
  '',
  null,
  undefined,
];

// -----------------------------------------------------------------------------
// Load personaMemoryManager.js
// -----------------------------------------------------------------------------
const memoryManagerPath = path.resolve(__dirname, '../src/utils/personaMemoryManager.js');
const memoryManagerCode = fs.readFileSync(memoryManagerPath, 'utf8')
  .replace(/import AsyncStorage from '@react-native-async-storage\/async-storage';/g, 'const AsyncStorage = global.mockAsyncStorage;')
  .replace(/export (?:async\s+)?function/g, (m) => m.includes('async') ? 'async function' : 'function')
  .replace(/export (?:const|let|var)/g, (m) => m.replace('export ', ''));

const mockStorage = {};
const mockAsyncStorage = {
  getItem: async (k) => mockStorage[k] || null,
  setItem: async (k, v) => { mockStorage[k] = v; },
  removeItem: async (k) => { delete mockStorage[k]; },
  clear: async () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};

const mmContext = {
  global: { mockAsyncStorage },
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

vm.createContext(mmContext);
vm.runInContext(`
${memoryManagerCode}
module.exports = {
  WANQING_AUTHORIZED_EMAIL,
  isWanqingAuthorized,
  detectPersonaId,
  getDefaultPersonaState,
  loadPersonaMemory,
  savePersonaMemory,
  resetPersonaMemory,
  scoreEpisodeActivation,
  buildPersonaGroundingBlock,
  evolvePersonaState,
  WANQING_IDENTIFIERS_REGEX,
  isWanqingItem,
};
`, mmContext);

const {
  WANQING_AUTHORIZED_EMAIL,
  isWanqingAuthorized,
  detectPersonaId,
  getDefaultPersonaState,
  loadPersonaMemory,
  savePersonaMemory,
  resetPersonaMemory,
  buildPersonaGroundingBlock,
  evolvePersonaState,
  isWanqingItem,
} = mmContext.module.exports;

// -----------------------------------------------------------------------------
// Load personaAssets.js
// -----------------------------------------------------------------------------
const assetsPath = path.resolve(__dirname, '../src/utils/personaAssets.js');
const assetsCode = fs.readFileSync(assetsPath, 'utf8')
  .replace(/import \{ isWanqingAuthorized \} from '\.\/personaMemoryManager';/g, '')
  .replace(/export \{ WANQING_HEADSHOT \};/g, '')
  .replace(/export function/g, 'function');

const assetsContext = {
  isWanqingAuthorized,
  require: () => ({ uri: 'asset://wanqing-headshot.jpg' }),
  module: { exports: {} },
};
vm.createContext(assetsContext);
vm.runInContext(`
${assetsCode}
module.exports = {
  WANQING_HEADSHOT,
  getPersonaAvatar,
  getWanqingHeadshot,
};
`, assetsContext);

const { WANQING_HEADSHOT, getPersonaAvatar, getWanqingHeadshot } = assetsContext.module.exports;

// -----------------------------------------------------------------------------
// Load helpers.js (trimChatHistoryForUpload, trimChatHistoryForEmailRecall)
// -----------------------------------------------------------------------------
const helpersPath = path.resolve(__dirname, '../src/utils/helpers.js');
const helpersCode = fs.readFileSync(helpersPath, 'utf8')
  .replace(/import \{ Platform \} from 'react-native';/g, 'const Platform = { OS: "ios" };')
  .replace(/import \{[\s\S]*?\} from '\.\/emailRecallEvidence';/g, `
    const buildRecallEvidencePrefix = () => '';
    const buildUidDateIndex = () => '';
    const parseRecallMonthFromMessage = () => null;
  `)
  .replace(/import \{ isWanqingAuthorized, isWanqingItem \} from '\.\/personaMemoryManager';/g, '')
  .replace(/export /g, '');

const helpersContext = {
  Platform: { OS: 'ios' },
  isWanqingAuthorized,
  isWanqingItem,
  console,
  Date,
  Math,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  Set,
  Boolean,
  module: { exports: {} },
};
vm.createContext(helpersContext);
vm.runInContext(`
${helpersCode}
module.exports = {
  trimChatHistoryForUpload,
  trimChatHistoryForEmailRecall,
  sanitizeRecallHistory,
};
`, helpersContext);

const {
  trimChatHistoryForUpload,
  trimChatHistoryForEmailRecall,
} = helpersContext.module.exports;

// -----------------------------------------------------------------------------
// Load memoryRecallContext.js (buildMemoryRecallContext)
// -----------------------------------------------------------------------------
const recallPath = path.resolve(__dirname, '../src/utils/memoryRecallContext.js');
const recallCode = fs.readFileSync(recallPath, 'utf8')
  .replace(/import \{[\s\S]*?\} from '\.\/memoryDisplay';/g, `
    const isLowValueForEmailRecall = () => false;
    const rankMemoryFragment = (content, layerKey, keywords, query) => {
      if (/(?:林婉清|婉清|Lin Wanqing)/i.test(content)) return 50;
      if (/(?:email|clean)/i.test(content)) return 20;
      return 10;
    };
    const isEmailEvidenceQuery = () => false;
  `)
  .replace(/import \{ isWanqingAuthorized, isWanqingItem \} from '\.\/personaMemoryManager';/g, '')
  .replace(/export /g, '');

const recallContext = {
  isWanqingAuthorized,
  isWanqingItem,
  console,
  Date,
  Math,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  Set,
  Boolean,
  module: { exports: {} },
};
vm.createContext(recallContext);
vm.runInContext(`
${recallCode}
module.exports = {
  buildMemoryRecallContext,
  wantsContinuumMemoryRecall,
};
`, recallContext);

const { buildMemoryRecallContext } = recallContext.module.exports;

// -----------------------------------------------------------------------------
// BEGIN TESTS
// -----------------------------------------------------------------------------
async function runTests() {
  console.log('--- TEST SUITE: COMPLETE INVISIBILITY OF LIN WANQING FOR OTHER USERS ---\n');

  // =========================================================================
  // SECTION 1: PICTURES & HEADSHOTS INVISIBILITY
  // =========================================================================
  console.log('1. Testing Pictures & Headshots Invisibility...');

  // Authorized user gets the avatar asset
  assert.ok(WANQING_HEADSHOT != null, 'WANQING_HEADSHOT asset must exist');
  assert.strictEqual(getPersonaAvatar('wanqing', authorizedUser), WANQING_HEADSHOT, 'Owner can retrieve avatar');
  assert.strictEqual(getWanqingHeadshot(authorizedUser), WANQING_HEADSHOT, 'Owner can retrieve headshot');

  // Other users MUST receive null for avatars and headshots
  for (const user of unauthorizedUsers) {
    assert.strictEqual(getPersonaAvatar('wanqing', user), null, `User ${user} must NOT get avatar`);
    assert.strictEqual(getWanqingHeadshot(user), null, `User ${user} must NOT get headshot`);
  }
  console.log('✓ Picture & headshot getters strictly return null for unauthorized users');

  // PersonaPortraitModal authorization verification
  const modalPath = path.resolve(__dirname, '../src/components/shared/PersonaPortraitModal.js');
  const modalCode = fs.readFileSync(modalPath, 'utf8');
  assert.ok(modalCode.includes('if (userEmail !== undefined && !isWanqingAuthorized(userEmail)) return null;'), 'Modal must guard against unauthorized email');
  assert.ok(modalCode.includes('if (isAuthorized === false) return null;'), 'Modal must guard against isAuthorized === false');
  console.log('✓ PersonaPortraitModal code contains strict null-rendering gate for unauthorized users');

  // =========================================================================
  // SECTION 2: PERSONA & PRESETS INVISIBILITY
  // =========================================================================
  console.log('\n2. Testing Persona & Presets Invisibility...');

  const wanqingText = "你是林婉清，23岁，现居美国波士顿。父亲林振华，母亲苏慧。你是用户最温柔知心的专属女友。";
  
  // detectPersonaId with authorization parameter
  assert.strictEqual(detectPersonaId(wanqingText, authorizedUser), 'wanqing', 'Owner detects wanqing');
  for (const user of unauthorizedUsers) {
    assert.strictEqual(detectPersonaId(wanqingText, user), null, `User ${user} must NOT detect wanqing persona`);
  }
  console.log('✓ detectPersonaId returns null for unauthorized users');

  // getDefaultPersonaState with authorization parameter
  assert.ok(getDefaultPersonaState('wanqing', authorizedUser) != null, 'Owner gets default state');
  for (const user of unauthorizedUsers) {
    assert.strictEqual(getDefaultPersonaState('wanqing', user), null, `User ${user} must get null default state`);
  }
  console.log('✓ getDefaultPersonaState returns null for unauthorized users');

  // Preset library visibility check
  const settingsPath = path.resolve(__dirname, '../src/components/SettingsSection.js');
  const settingsCode = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(settingsCode.includes('p.allowedEmail.toLowerCase() === currentEmail && isWanqingAllowed'), 'SettingsSection restricts wanqing preset to isWanqingAllowed');
  assert.ok(settingsCode.includes('!isWanqingAllowed && isWanqingItem(persona)'), 'SettingsSection sanitizes custom input if persona matches Wanqing');
  console.log('✓ SettingsSection preset library & custom persona input are strictly hidden from other users');

  // =========================================================================
  // SECTION 3: CHAT HISTORY INVISIBILITY
  // =========================================================================
  console.log('\n3. Testing Chat History Invisibility...');

  const mixedHistory = [
    { id: '1', role: 'user', content: 'What is the weather like in Boston?' },
    { id: '2', role: 'assistant', content: 'It is a crisp autumn day in Boston, around 58 degrees.' },
    { id: '3', role: 'user', content: '林婉清，今天波士顿天气怎么样？' },
    { id: '4', role: 'assistant', content: '今天波士顿微凉，落叶很美。我是婉清，注意添衣哦。' },
    { id: '5', role: 'user', content: 'Can you summarize my unread emails from work?' },
    { id: '6', role: 'assistant', content: 'You have 3 unread emails from your project manager.' },
    { id: '7', role: 'assistant', content: '林振华（婉清的父亲）今天发来了家信。', personaId: 'wanqing' },
  ];

  // For owner: all messages preserved
  const ownerUploaded = trimChatHistoryForUpload(mixedHistory, 50, undefined, '', authorizedUser, true);
  assert.strictEqual(ownerUploaded.length, 7, 'Owner sees full conversation history including Wanqing');

  // For unauthorized users: Wanqing messages (3, 4, 7) must be completely filtered out
  for (const user of unauthorizedUsers) {
    const sanitizedUpload = trimChatHistoryForUpload(mixedHistory, 50, undefined, '', user, false);
    assert.strictEqual(sanitizedUpload.length, 4, `Unauthorized user ${user} must only receive non-Wanqing turns`);
    for (const msg of sanitizedUpload) {
      assert.ok(!isWanqingItem(msg), `Message "${msg.content}" must not contain any Wanqing content`);
    }

    const sanitizedRecallUpload = trimChatHistoryForEmailRecall(mixedHistory, 8, 380 * 1024, null, user, false);
    for (const msg of sanitizedRecallUpload) {
      assert.ok(!isWanqingItem(msg), `Recall message "${msg.content}" must not contain any Wanqing content`);
    }
  }
  console.log('✓ trimChatHistoryForUpload & trimChatHistoryForEmailRecall strip 100% of Wanqing messages for other users');

  // Test ChatSection visibleMessages logic
  const chatSectionPath = path.resolve(__dirname, '../src/components/ChatSection.js');
  const chatSectionCode = fs.readFileSync(chatSectionPath, 'utf8');
  assert.ok(
    /import\s+React,\s*\{[^}]*\buseMemo\b[^}]*\}\s*from\s+['"]react['"]/.test(chatSectionCode),
    'ChatSection imports useMemo from react'
  );
  assert.ok(chatSectionCode.includes('const visibleMessages = useMemo(() => {'), 'ChatSection defines visibleMessages');
  assert.ok(chatSectionCode.includes('filter((m) => !isWanqingItem(m))'), 'ChatSection visibleMessages filters out isWanqingItem');
  assert.ok(chatSectionCode.includes('historyForUpload = historyForUpload.filter((m) => !isWanqingItem(m))'), 'ChatSection double-sanitizes historyForUpload');
  console.log('✓ ChatSection message list FlatList & API upload strictly filter out all Wanqing history for other users');

  // =========================================================================
  // SECTION 4: MEMORIES (L1-L5 & DSP-CMA) INVISIBILITY
  // =========================================================================
  console.log('\n4. Testing Memories Invisibility...');

  // DSP-CMA Manager methods
  for (const user of unauthorizedUsers) {
    const mem = await loadPersonaMemory('wanqing', 'user-1', user);
    assert.strictEqual(mem, null, `loadPersonaMemory must return null for ${user}`);

    const saved = await savePersonaMemory('wanqing', 'user-1', { mood: 'happy' }, user);
    assert.strictEqual(saved, false, `savePersonaMemory must return false for ${user}`);

    const ground = await buildPersonaGroundingBlock('wanqing', 'user-1', user, '你好');
    assert.strictEqual(ground, '', `buildPersonaGroundingBlock must return empty string for ${user}`);

    const evolved = await evolvePersonaState('wanqing', 'user-1', { userText: '想你了', userEmail: user });
    assert.strictEqual(evolved, null, `evolvePersonaState must return null for ${user}`);

    const reset = await resetPersonaMemory('wanqing', 'user-1', user);
    assert.strictEqual(reset, null, `resetPersonaMemory must return null for ${user}`);
  }
  console.log('✓ DSP-CMA memory operations (load, save, ground, evolve, reset) are 100% blocked for other users');

  // buildMemoryRecallContext test with mixed memory layers
  const memoryLayersWithWanqing = {
    pinnedMemories: [
      { id: 'p1', content: 'Work schedule: Monday to Friday 9am-5pm' },
      { id: 'p2', content: '林婉清是生命中重要的心灵避风港，23岁，现居波士顿。' },
    ],
    semanticProfile: [
      { id: 's1', content: 'User lives in Massachusetts and enjoys sailing.' },
      { id: 's2', content: '林婉清老家在杭州西湖区文三路与学院路交叉口教工大院，父亲林振华，母亲苏慧。' },
    ],
    episodicSegments: [
      { id: 'e1', content: 'Discussed project deadlines yesterday.' },
      { id: 'e2', content: '婉清今天在波士顿喝茶插花，两人倾心长谈。' },
    ],
  };

  // Owner gets the Wanqing memories included
  const ownerContext = buildMemoryRecallContext(memoryLayersWithWanqing, '查找关于林婉清和波士顿的信息', 28000, { userEmail: authorizedUser, isOwner: true });
  assert.ok(ownerContext.includes('林婉清是生命中重要的心灵避风港'), 'Owner recall context includes Lin Wanqing');

  // Other users MUST NOT receive any Wanqing memory fragments
  for (const user of unauthorizedUsers) {
    const unauthorizedContext = buildMemoryRecallContext(memoryLayersWithWanqing, '查找关于林婉清和波士顿的信息', 28000, { userEmail: user, isOwner: false });
    assert.ok(!unauthorizedContext.includes('林婉清'), `User ${user} context must not contain 林婉清`);
    assert.ok(!unauthorizedContext.includes('婉清'), `User ${user} context must not contain 婉清`);
    assert.ok(!unauthorizedContext.includes('林振华'), `User ${user} context must not contain 林振华`);
    assert.ok(!unauthorizedContext.includes('苏慧'), `User ${user} context must not contain 苏慧`);
    assert.ok(!unauthorizedContext.includes('教工大院'), `User ${user} context must not contain 教工大院`);
  }
  console.log('✓ buildMemoryRecallContext strictly removes all Wanqing memory layers for other users');

  // Universal detector isWanqingItem coverage
  assert.strictEqual(isWanqingItem('林婉清'), true);
  assert.strictEqual(isWanqingItem('婉清'), true);
  assert.strictEqual(isWanqingItem('Lin Wanqing'), true);
  assert.strictEqual(isWanqingItem('lin_wanqing_avatar'), true);
  assert.strictEqual(isWanqingItem('asset://wanqing-headshot.jpg'), true);
  assert.strictEqual(isWanqingItem('林振华（结构工程师）'), true);
  assert.strictEqual(isWanqingItem('母亲苏慧'), true);
  assert.strictEqual(isWanqingItem('杭州西湖区教工大院'), true);
  assert.strictEqual(isWanqingItem({ personaId: 'wanqing' }), true);
  assert.strictEqual(isWanqingItem({ id: 'wanqing' }), true);
  assert.strictEqual(isWanqingItem({ allowedEmail: 'cai40@yahoo.com' }), true);
  assert.strictEqual(isWanqingItem({ content: '温存陪伴，宛如水乡晨曦' }), false); // general poetic text not matching her entity names
  assert.strictEqual(isWanqingItem({ content: 'Min Zhang email scan UID 641820' }), false);
  assert.strictEqual(isWanqingItem('Ordinary user query about python coding'), false);
  console.log('✓ isWanqingItem universal detector passes all positive and negative test cases');

  console.log('\n================================================================');
  console.log('🎉 ALL INVISIBILITY & ACCESS-GATING TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
