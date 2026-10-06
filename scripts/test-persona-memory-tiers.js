const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

console.log('Testing Persona-Specific Memory Architecture (DSP-CMA)...');

// Mock AsyncStorage in-memory implementation
const createMockAsyncStorage = () => {
  const store = new Map();
  return {
    getItem: async (key) => store.get(key) || null,
    setItem: async (key, value) => {
      store.set(key, String(value));
    },
    removeItem: async (key) => {
      store.delete(key);
    },
    clear: async () => {
      store.clear();
    },
    _dump: () => Object.fromEntries(store.entries()),
  };
};

const mockAsyncStorage = createMockAsyncStorage();

// Load personaMemoryManager into a VM context
const pmmPath = path.join(__dirname, '../src/utils/personaMemoryManager.js');
let pmmSrc = fs.readFileSync(pmmPath, 'utf8');

// Transform ES module imports/exports for CommonJS / VM
pmmSrc = pmmSrc
  .replace(/import\s+AsyncStorage\s+from\s+['"][^'"]+['"];?/g, '')
  .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1')
  .replace(/export\s*\{[^}]+\};?/g, '');

const pmmCode = `
${pmmSrc}
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
};
`;

const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  AsyncStorage: mockAsyncStorage,
  Date,
  Math,
  Set,
  Map,
  Array,
  Object,
  JSON,
  String,
  Boolean,
};

vm.runInNewContext(pmmCode, sandbox);
const {
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
} = sandbox.module.exports;

async function runTests() {
  // Test 1: Email Gating & Authorization
  console.log('\n--- Test 1: Email Gating & Authorization ---');
  assert.strictEqual(WANQING_AUTHORIZED_EMAIL, 'cai40@yahoo.com');
  assert.strictEqual(isWanqingAuthorized('cai40@yahoo.com'), true);
  assert.strictEqual(isWanqingAuthorized('CAI40@YAHOO.COM'), true);
  assert.strictEqual(isWanqingAuthorized('  cai40@yahoo.com  '), true);
  assert.strictEqual(isWanqingAuthorized('stranger@test.com'), false);
  assert.strictEqual(isWanqingAuthorized(''), false);
  assert.strictEqual(isWanqingAuthorized(null), false);

  // Unauthorized user cannot load Wanqing memory
  const unauthorizedMem = await loadPersonaMemory('wanqing', 'user-999', 'other@domain.com');
  assert.strictEqual(unauthorizedMem, null, 'Unauthorized email must receive null memory for Wanqing');

  const unauthorizedBlock = await buildPersonaGroundingBlock('wanqing', 'user-999', 'other@domain.com', '你好');
  assert.strictEqual(unauthorizedBlock, '', 'Unauthorized email must receive empty grounding block');

  const unauthorizedEvolve = await evolvePersonaState('wanqing', 'user-999', {
    userText: '你喜欢我吗',
    assistantText: '我是林婉清',
    userEmail: 'other@domain.com',
  });
  assert.strictEqual(unauthorizedEvolve, null, 'Unauthorized email cannot evolve Wanqing state');
  console.log('✓ Email gating strictly protects Wanqing sovereign memory from unauthorized access');

  // Test 2: Persona ID Detection
  console.log('\n--- Test 2: Persona ID Detection ---');
  assert.strictEqual(detectPersonaId('你是林婉清，23岁，现居美国波士顿'), 'wanqing');
  assert.strictEqual(detectPersonaId('Lin Wanqing preset background'), 'wanqing');
  assert.strictEqual(detectPersonaId('You are Yongyao\'s mother. You love your children.'), 'parent');
  assert.strictEqual(detectPersonaId('You are an empathetic co-pilot. Listen deeply.'), 'pilot');
  assert.strictEqual(detectPersonaId('You are a Silicon Valley Strategist.'), 'strategist');
  assert.strictEqual(detectPersonaId('You are a Stoic Mentor.'), 'mentor');
  assert.strictEqual(detectPersonaId('You are a helpful, thorough AI assistant.'), null);
  console.log('✓ Persona ID detection accurately identifies active personas');

  // Test 3: Default State & Memory Initialization
  console.log('\n--- Test 3: Default State & Memory Initialization ---');
  const authorizedUser = 'cai40@yahoo.com';
  const initialMem = await loadPersonaMemory('wanqing', 'user-cai', authorizedUser);
  assert.ok(initialMem, 'Authorized user gets valid memory state');
  assert.strictEqual(initialMem.personaId, 'wanqing');
  assert.strictEqual(initialMem.name, '林婉清');
  assert.ok(initialMem.innerState.mood.includes('温婉'), 'Initial mood set');
  assert.strictEqual(initialMem.innerState.closenessLevel, 92);
  assert.strictEqual(initialMem.episodic.length, 3, 'Initial core episodic memories populated');
  assert.ok(initialMem.episodic.some((e) => e.detail.includes('林振华')), 'Includes father info');
  assert.ok(initialMem.episodic.some((e) => e.detail.includes('173cm')), 'Includes physical attributes');
  console.log('✓ Initial sovereign memory tier initializes with correct archetype facts');

  // Test 4: ACT-R Activation Scoring
  console.log('\n--- Test 4: ACT-R Activation Scoring ---');
  const now = Date.now();
  const recentEpisode = {
    summary: '波士顿秋日漫步',
    detail: '在波士顿查尔斯河畔散步聊天',
    importance: 8,
    created_at: new Date(now - 1000 * 60 * 60).toISOString(),
    lastAccessedAt: new Date(now - 1000 * 60 * 60).toISOString(),
    accessCount: 5,
  };
  const oldEpisode = {
    summary: '日常问候',
    detail: '问候天气',
    importance: 3,
    created_at: new Date(now - 1000 * 60 * 60 * 200).toISOString(),
    lastAccessedAt: new Date(now - 1000 * 60 * 60 * 200).toISOString(),
    accessCount: 1,
  };

  const scoreRecent = scoreEpisodeActivation(recentEpisode, ['波士顿'], now);
  const scoreOld = scoreEpisodeActivation(oldEpisode, ['波士顿'], now);
  assert.ok(scoreRecent > scoreOld, 'Recent, important, high-access episode must outrank older low-importance episode');

  const scoreRelevance = scoreEpisodeActivation(recentEpisode, ['查尔斯河', '波士顿'], now);
  assert.ok(scoreRelevance > scoreRecent, 'Query relevance boosts activation score');
  console.log('✓ ACT-R activation function balances recency, salience, frequency, and semantic relevance');

  // Test 5: Dynamic Grounding Block Assembly
  console.log('\n--- Test 5: Dynamic Grounding Block Assembly ---');
  const grounding = await buildPersonaGroundingBlock('wanqing', 'user-cai', authorizedUser, '杭州和父母');
  assert.ok(grounding.includes('PERSONA PRIVATE INNER STATE & MEMORIES'), 'Contains sovereign header');
  assert.ok(grounding.includes('林婉清专属成长记忆'), 'Identifies Wanqing persona');
  assert.ok(grounding.includes('当前内心心境'), 'Includes dynamic mood');
  assert.ok(grounding.includes('彼此心灵默契'), 'Includes closeness bond');
  assert.ok(grounding.includes('杭州书香门第与父母背景'), 'Includes matching episodic memory for 杭州/父母');
  assert.ok(grounding.includes('切勿向用户生硬背诵'), 'Includes natural grounding directives');
  console.log('✓ Dynamic grounding block builds rich isolated context for prompt injection');

  // Test 6: Persona Evolution via Conversation
  console.log('\n--- Test 6: Persona Evolution via Conversation ---');
  // Turn 1: User expresses fatigue & stress
  const evolved1 = await evolvePersonaState('wanqing', 'user-cai', {
    userText: '今天公司开了一整天高管会议，项目压力很大，真的好累。',
    assistantText: '辛苦了，快坐下来歇一歇。无论外面风雨多大，在我这里你都可以彻底放松。',
    userEmail: authorizedUser,
  });

  assert.ok(evolved1.innerState.interactionCount >= 1, 'Interaction count increments');
  assert.ok(evolved1.innerState.mood.includes('疲惫') || evolved1.innerState.mood.includes('心疼') || evolved1.innerState.mood.includes('体贴'), 'Mood adapts to user fatigue');
  assert.ok(evolved1.episodic.some((e) => e.summary.includes('疲惫') || e.summary.includes('压力')), 'Episodic memory captured user vulnerability');
  assert.ok(evolved1.reflections.length >= 2, 'New reflection diary entry written');
  console.log('✓ State evolution successfully adjusts inner mood, records episode, and logs reflection on fatigue');

  // Turn 2: User expresses deep affection & intimacy
  const evolved2 = await evolvePersonaState('wanqing', 'user-cai', {
    userText: '婉清，有你这样温柔的避风港真好，我想你了。',
    assistantText: '我也一直在想你。能成为你心底最安心的停靠，是我最珍视的幸福。',
    userEmail: authorizedUser,
  });

  assert.ok(evolved2.innerState.closenessLevel > 92, 'Closeness increments with affection');
  assert.ok(evolved2.innerState.mood.includes('柔情') || evolved2.innerState.mood.includes('甜蜜'), 'Mood adapts to affection');
  assert.ok(evolved2.episodic.some((e) => e.summary.includes('情感共鸣') || e.summary.includes('倾心')), 'Affection milestone episode recorded');
  console.log('✓ Closeness bond and emotional valence evolve on intimate exchange');

  // Test 7: Multi-Persona Isolation
  console.log('\n--- Test 7: Multi-Persona Isolation ---');
  // Load pilot persona
  const pilotMem = await loadPersonaMemory('pilot', 'user-cai', authorizedUser);
  assert.strictEqual(pilotMem.personaId, 'pilot');
  assert.strictEqual(pilotMem.name, 'pilot');
  assert.ok(!JSON.stringify(pilotMem).includes('林婉清'), 'Pilot persona does NOT contain Wanqing memories');

  const wanqingRefreshed = await loadPersonaMemory('wanqing', 'user-cai', authorizedUser);
  assert.ok(JSON.stringify(wanqingRefreshed).includes('林婉清'), 'Wanqing persona retains exclusive memories');
  console.log('✓ Multi-persona sovereignty guarantees zero memory leakage across personas');

  // Test 8: Reset to Pure Initial State
  console.log('\n--- Test 8: Reset to Pure Initial State ---');
  const resetMem = await resetPersonaMemory('wanqing', 'user-cai', authorizedUser);
  assert.strictEqual(resetMem.innerState.interactionCount, 0, 'Interaction count resets');
  assert.strictEqual(resetMem.innerState.closenessLevel, 92, 'Closeness resets');
  assert.strictEqual(resetMem.episodic.length, 3, 'Episodic memories reset to initial seed');
  console.log('✓ Persona memory reset reliably restores clean archetype baseline');

  console.log('\nAll DSP-CMA Persona Memory Architecture tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
