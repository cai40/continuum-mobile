const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Testing Chat & Memory Reading improvements...');

// 1. Test shared/grounding-prompt.json
const groundingJson = require('../shared/grounding-prompt.json');
const gp = groundingJson.globalGroundingPrompt;

assert.ok(gp.includes('conversation history'), 'Rule 1 must include conversation history');
assert.ok(gp.includes('PRIOR CHAT & CONVERSATION HISTORY'), 'Rule 4 must be PRIOR CHAT & CONVERSATION HISTORY');
assert.ok(gp.includes('Never claim you cannot read the chat window'), 'Rule 4 must forbid disclaiming inability to read chat window');
assert.ok(gp.includes('10. RECALL & CHAT REVIEW'), 'Must include Rule 10 RECALL & CHAT REVIEW');
assert.ok(gp.includes('13. NO READING META-DENIALS'), 'Must include Rule 13 NO READING META-DENIALS');
console.log('✓ Grounding prompt rules verified');

// 2. Test src/utils/helpers.js (sanitizeRecallHistory & trimChatHistoryForUpload)
const helpersSrcPath = path.join(__dirname, '../src/utils/helpers.js');
let helpersSrc = fs.readFileSync(helpersSrcPath, 'utf8');

// Strip imports/exports for vm execution
helpersSrc = helpersSrc
  .replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
  .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s*\{[^}]+\};?/g, '');

const helpersCode = `
${helpersSrc}
module.exports = {
  sanitizeRecallHistory,
  trimChatHistoryForUpload,
  safeJsonStringify,
};
`;

const helpersSandbox = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(helpersCode, helpersSandbox);
const { sanitizeRecallHistory, trimChatHistoryForUpload, safeJsonStringify } = helpersSandbox.module.exports;

// Test sanitizeRecallHistory with reading meta-denials
const testMessages = [
  { role: 'user', content: '告诉我林婉清是谁' },
  { role: 'assistant', content: '抱歉，我无法读取当前聊天窗口的内容。' },
  { role: 'assistant', content: '查阅了当前对话历史，并未找到关于林婉清的任何信息。' },
  { role: 'assistant', content: 'As an AI, I do not have access to the current chat history or past messages.' },
  { role: 'assistant', content: '林婉清23岁，住在波士顿，毕业于浙大并在当地从事艺术设计。' },
];

const sanitized = sanitizeRecallHistory(testMessages);
assert.strictEqual(sanitized[0].content, '告诉我林婉清是谁', 'User message untouched');
assert.ok(sanitized[1].content.includes('Superseded — prior meta-denial'), 'Chinese cannot-read denial superseded');
assert.ok(sanitized[2].content.includes('Superseded — prior meta-denial'), 'Chinese not-found denial superseded');
assert.ok(sanitized[3].content.includes('Superseded — prior meta-denial'), 'English cannot-read denial superseded');
assert.ok(sanitized[4].content.includes('林婉清23岁'), 'Valid assistant answer preserved');
console.log('✓ sanitizeRecallHistory properly supersedes chat reading meta-denials');

// Test trimChatHistoryForUpload with entity keyword retention
const longHistory = [];
// Message 0-1 mentions 林婉清
longHistory.push({ id: '1', role: 'user', content: '林婉清今年23岁，住在波士顿，是从杭州来留学的。' });
longHistory.push({ id: '2', role: 'assistant', content: '好的，我已经记下了林婉清的背景信息。' });
// Add 55 filler turns
for (let i = 3; i <= 58; i++) {
  longHistory.push({ id: String(i), role: i % 2 === 1 ? 'user' : 'assistant', content: `Filler message number ${i} about general work topics.` });
}
// Query asking about 林婉清
const trimmedWithQuery = trimChatHistoryForUpload(longHistory, 50, 900 * 1024, '林婉清的人设是什么？');
assert.ok(trimmedWithQuery.some(m => m.content.includes('林婉清今年23岁')), 'trimChatHistoryForUpload must retain older turn mentioning 林婉清');
console.log('✓ trimChatHistoryForUpload retains query-relevant entity history');

// 3. Test memoryDisplay.js and memoryRecallContext.js
const displaySrcPath = path.join(__dirname, '../src/utils/memoryDisplay.js');
let displaySrc = fs.readFileSync(displaySrcPath, 'utf8')
  .replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
  .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s*\{[^}]+\};?/g, '');

const recallSrcPath = path.join(__dirname, '../src/utils/memoryRecallContext.js');
let recallSrc = fs.readFileSync(recallSrcPath, 'utf8')
  .replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
  .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s*\{[^}]+\};?/g, '');

const memCode = `
${displaySrc}
${recallSrc}
module.exports = {
  rankMemoryFragment,
  extractKeywords,
  wantsContinuumMemoryRecall,
  buildMemoryRecallContext,
  shouldOfferMemoryPin,
  extractMemoryForPin,
};
`;

const memSandbox = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(memCode, memSandbox);
const {
  rankMemoryFragment,
  extractKeywords,
  wantsContinuumMemoryRecall,
  buildMemoryRecallContext,
  shouldOfferMemoryPin,
  extractMemoryForPin,
} = memSandbox.module.exports;

// Test wantsContinuumMemoryRecall
assert.ok(wantsContinuumMemoryRecall('Review current chat and extract information about 林婉清, store in long term memory'));
assert.ok(wantsContinuumMemoryRecall('Find out the persona of my lover who is a young girl in Boston based on your memories and chat history'));
assert.ok(wantsContinuumMemoryRecall('从记忆中查找林婉清'));
assert.ok(wantsContinuumMemoryRecall('婉清的身高体重是多少'));
assert.ok(wantsContinuumMemoryRecall('林婉清父母叫什么'));
assert.ok(wantsContinuumMemoryRecall('提取当前聊天记录并保存到长时记忆'));
assert.ok(wantsContinuumMemoryRecall('你还记得她的背景信息吗'));
assert.ok(wantsContinuumMemoryRecall('查看核心记忆中的人设'));
console.log('✓ wantsContinuumMemoryRecall detects English & Chinese recall queries');

// Test extractKeywords
const kwLin = extractKeywords('Review current chat and extract information about 林婉清, store in long term memory');
assert.ok(kwLin.includes('林婉清'), 'Must extract CJK phrase 林婉清');
assert.ok(kwLin.includes('婉清'), 'Must extract CJK n-gram 婉清');
assert.ok(kwLin.includes('information'), 'Must extract English keyword information');

const kwBoston = extractKeywords('Find out the persona of my lover who is a young girl in Boston based on your memories');
assert.ok(kwBoston.includes('persona'), 'Must extract persona');
assert.ok(kwBoston.includes('lover'), 'Must extract lover');
assert.ok(kwBoston.includes('boston'), 'Must extract boston');
console.log('✓ extractKeywords successfully extracts CJK and English keywords');

// Test rankMemoryFragment
const linMemory = '林婉清：23岁，波士顿，杭州西湖区长大，文化创意艺术设计。';
const emailMemory = 'Subject: April invoice UID 641820 Date: 2026-04-12 Preview: boundary terms';

const linScore = rankMemoryFragment(linMemory, 'l3', kwLin, 'Review current chat and extract information about 林婉清');
const emailScoreForLinQuery = rankMemoryFragment(emailMemory, 'l2', kwLin, 'Review current chat and extract information about 林婉清');

assert.ok(linScore > 10, 'Memory matching 林婉清 must score high (>10)');
assert.ok(linScore > emailScoreForLinQuery, 'Lin memory must outrank unrelated email memory on Lin query');
console.log('✓ rankMemoryFragment prioritizes relevant topic memory over unrelated email evidence');

// Test buildMemoryRecallContext for non-email query
const sampleLayers = {
  pinnedMemories: [{ content: '林婉清是重要的伴侣，23岁，在波士顿生活。' }],
  semanticProfile: [{ content: '林婉清父亲林振华，母亲苏慧，家庭教工大院。' }],
};

const recallCtx = buildMemoryRecallContext(sampleLayers, 'Find out the persona of 林婉清 in Boston based on your memories');
assert.ok(recallCtx.includes('林婉清是重要的伴侣'), 'Must include matching L1 pin');
assert.ok(recallCtx.includes('林婉清父亲林振华'), 'Must include matching L3 fact');
assert.ok(!recallCtx.includes('Min and Kids folder IMAP'), 'Must NOT inject email IMAP bridge instructions for non-email query');

// Test empty memory response for non-email query
const emptyCtx = buildMemoryRecallContext({}, '谁是张三丰？');
assert.ok(!emptyCtx.includes('No email evidence'), 'Must NOT say No email evidence for general query');
assert.ok(!emptyCtx.includes('Offer a Min and Kids folder fetch'), 'Must NOT offer Min folder fetch for general query');
assert.ok(emptyCtx.includes('conversation history'), 'Must direct model to conversation history');
console.log('✓ buildMemoryRecallContext produces clean non-email memory contexts');

// Test shouldOfferMemoryPin and extractMemoryForPin
assert.ok(shouldOfferMemoryPin('Review current chat and extract information about 林婉清, store in long term memory'));
assert.ok(shouldOfferMemoryPin('提取并保存到长时记忆'));
assert.ok(shouldOfferMemoryPin('请记住这段人设并存入记忆'));
assert.ok(shouldOfferMemoryPin('请记住婉清的身高体重'));
assert.ok(shouldOfferMemoryPin('帮我记住'));
assert.ok(shouldOfferMemoryPin('remember this'));
assert.ok(!shouldOfferMemoryPin('今天天气怎么样'));

const extractedPin = extractMemoryForPin('林婉清（23岁，波士顿）：杭州人，艺术设计，与用户有深厚感情。');
assert.strictEqual(extractedPin, '林婉清（23岁，波士顿）：杭州人，艺术设计，与用户有深厚感情。');
console.log('✓ Memory pin offering and extraction for chat works correctly');

console.log('\nAll tests passed successfully!');
