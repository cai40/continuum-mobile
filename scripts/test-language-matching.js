const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test groundingPrompt.js exports
const groundingJson = require('../shared/grounding-prompt.json');

// Test shared/grounding-prompt.json rule 12
assert.ok(groundingJson.globalGroundingPrompt.includes('12. LANGUAGE MATCHING'), 'shared/grounding-prompt.json must include Rule 12 LANGUAGE MATCHING');
assert.ok(groundingJson.globalGroundingPrompt.includes('respond in Chinese'), 'Rule 12 must specify Chinese response');

// Load src/utils/groundingPrompt.js
const promptSrcPath = path.join(__dirname, '../src/utils/groundingPrompt.js');
let promptSrc = fs.readFileSync(promptSrcPath, 'utf8');
promptSrc = promptSrc
  .replace(/import\s+grounding\s+from\s+['"][^'"]+['"];?/g, 'const grounding = ' + JSON.stringify(groundingJson) + ';')
  .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s*\{[^}]+\};?/g, '');

const promptModuleCode = `
${promptSrc}
module.exports = {
  detectLangFromText,
  replyLanguageAppend,
  VOICE_MODE_APPEND,
  hasLatin,
  GLOBAL_GROUNDING_PROMPT,
};
`;

const vm = require('vm');
const sandbox = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(promptModuleCode, sandbox);
const { detectLangFromText, replyLanguageAppend, VOICE_MODE_APPEND, hasLatin } = sandbox.module.exports;

// 1. Test detectLangFromText
// CJK single characters
assert.strictEqual(detectLangFromText('好'), 'zh-CN', 'Single CJK character 好 should detect zh-CN');
assert.strictEqual(detectLangFromText('对'), 'zh-CN', 'Single CJK character 对 should detect zh-CN');
assert.strictEqual(detectLangFromText('是'), 'zh-CN', 'Single CJK character 是 should detect zh-CN');
assert.strictEqual(detectLangFromText('你好呀'), 'zh-CN', 'CJK phrase should detect zh-CN');

// Mixed CJK and Latin (technical terms / brand names)
assert.strictEqual(detectLangFromText('什么是 React'), 'zh-CN', 'Mixed CJK with Latin should detect zh-CN');
assert.strictEqual(detectLangFromText('怎么连 WiFi'), 'zh-CN', 'Mixed CJK with Latin should detect zh-CN');
assert.strictEqual(detectLangFromText('iPhone 截屏'), 'zh-CN', 'Mixed CJK with Latin should detect zh-CN');
assert.strictEqual(detectLangFromText('查一下 Python 的文档'), 'zh-CN', 'Mixed CJK with Latin should detect zh-CN');

// English sentences and greetings
assert.strictEqual(detectLangFromText('hello there, how are you?'), 'en-US', 'English sentence should detect en-US');
assert.strictEqual(detectLangFromText('hi what is the weather today?'), 'en-US', 'English greeting should detect en-US');
assert.strictEqual(detectLangFromText('can you help me with this?'), 'en-US', 'English query should detect en-US');

// Spanish sentences
assert.strictEqual(detectLangFromText('hola como estas?'), 'es-ES', 'Spanish greeting should detect es-ES');
assert.strictEqual(detectLangFromText('muchas gracias por tu ayuda'), 'es-ES', 'Spanish phrase should detect es-ES');
assert.strictEqual(detectLangFromText('¿donde esta el restaurante?'), 'es-ES', 'Spanish with accents/marks should detect es-ES');

// Indeterminate / short words
assert.strictEqual(detectLangFromText('12345'), '', 'Numbers should be indeterminate');
assert.strictEqual(detectLangFromText(''), '', 'Empty string should be indeterminate');
assert.strictEqual(detectLangFromText(null), '', 'Null should be indeterminate');

// 2. Test replyLanguageAppend
assert.ok(replyLanguageAppend('zh-CN').includes('Chinese'), 'zh-CN should map to Chinese');
assert.ok(replyLanguageAppend('en-US').includes('English'), 'en-US should map to English');
assert.ok(replyLanguageAppend('es-ES').includes('Spanish'), 'es-ES should map to Spanish');
assert.ok(replyLanguageAppend('ja-JP').includes('Japanese'), 'ja-JP should map to Japanese');
assert.strictEqual(replyLanguageAppend('xyz'), '', 'Unknown language should return empty string');
assert.strictEqual(replyLanguageAppend(null), '', 'Null language should return empty string');

// 3. Test VOICE_MODE_APPEND
assert.ok(VOICE_MODE_APPEND.includes('LANGUAGE MATCHING:'), 'VOICE_MODE_APPEND must include LANGUAGE MATCHING');
assert.ok(VOICE_MODE_APPEND.includes('If the user speaks Chinese, reply entirely in Chinese'), 'VOICE_MODE_APPEND must explicitly mention Chinese');

console.log('test-language-matching: all tests passed successfully!');
