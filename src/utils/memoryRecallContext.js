/** Search L2–L4 (+ L1 pins) and build an injection block for cross-session recall. */

import {
  isLowValueForEmailRecall,
  rankMemoryFragment,
  isEmailEvidenceQuery,
} from './memoryDisplay';

const DEFAULT_KEYWORDS = [
  'min zhang', 'min folder', '敏', 'boundary', '641820', '641814', '641826', '641807',
  'april 2026', '2026-04', 'child-related', 'boys',
];

const STOP_WORDS = new Set([
  'the', 'and', 'you', 'your', 'yours', 'what', 'when', 'where', 'which', 'who',
  'why', 'how', 'can', 'could', 'would', 'should', 'this', 'that', 'these', 'those',
  'have', 'has', 'had', 'for', 'with', 'without', 'from', 'about', 'into', 'out',
  'are', 'was', 'were', 'been', 'being', 'will', 'shall', 'may', 'might', 'must',
  'not', 'but', 'all', 'any', 'some', 'our', 'their', 'his', 'her', 'its', 'they',
  'them', 'him', 'she', 'does', 'did', 'done', 'doing', 'find', 'tell', 'show',
  'give', 'look', 'make', 'please', 'help', 'know', 'think', 'based', 'current',
]);

function itemText(item) {
  return String(item?.content || item?.text || item?.summary || '').trim();
}

function itemDate(item) {
  return item?.created_at || item?.timestamp || item?.date || '';
}

export function extractKeywords(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const keys = [...DEFAULT_KEYWORDS];
  const month = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\w*\s+(20\d{2})\b/i);
  if (month) keys.push(`${month[1]} ${month[2]}`.toLowerCase());
  const uid = lower.match(/\b641\d{3}\b/g);
  if (uid) keys.push(...uid);
  if (/\bmin\b/i.test(lower)) keys.push('min');
  if (/\bboundary\b/i.test(lower)) keys.push('boundary');
  if (/\bemail/i.test(lower)) keys.push('email');

  // Extract CJK words and n-grams with particle-aware segmentation
  const cjkSegments = text.split(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|(?:的|是|在|和|与|了|吗|呢|什么|关于|告诉|一个|这个|那个|谁|如何|怎样|我想|请问)+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  for (const seg of cjkSegments) {
    keys.push(seg);
    if (seg.length > 2) {
      for (let i = 0; i <= seg.length - 2; i++) {
        keys.push(seg.slice(i, i + 2));
      }
    }
  }

  // Extract meaningful English words
  const words = text.match(/[A-Za-z]{3,20}/g) || [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (!STOP_WORDS.has(lw)) {
      keys.push(lw);
    }
  }

  return [...new Set(keys.filter(Boolean))];
}

export function wantsContinuumMemoryRecall(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/\b(?:what do you remember|from (?:continuum )?memor(?:y|ies)|in (?:continuum )?memor(?:y|ies)|check (?:continuum )?memory|memory store|memory vault|brain memory|long[- ]term memory|core memory)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:based on (?:your )?(?:memories|memory|chat history))\b/i.test(text)) {
    return true;
  }
  if (/\b(?:load|save|store|feed|ingest|record|archive)\b/i.test(text)
    && /\b(?:continuum|memory|memories|brain|vault|into\s+memory)\b/i.test(text)) {
    return true;
  }
  if (/\bremember\b/i.test(text) && /\b(?:min|zhang|\u654f|boundary|email|persona|who|her|him|lover|friend)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:persona|profile|biography|background)\b/i.test(text) && /\b(?:lover|girlfriend|wife|partner|friend|family|who is)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:review|extract|summarize)\b/i.test(text) && /\b(?:chat|conversation|history|window)\b/i.test(text)) {
    return true;
  }
  // Chinese memory & chat recall triggers
  if (/(?:记忆|长时记忆|长期记忆|核心记忆|回忆|还记得|记不记得|存入记忆|保存到记忆|记录到记忆|从记忆|查.*记忆|搜索记忆)/i.test(text)) {
    return true;
  }
  if (/(?:聊天记录|当前聊天|当前对话|对话历史|聊天历史|聊天窗口)/i.test(text)) {
    return true;
  }
  if (/(?:回顾.*(?:聊天|对话)|从.*(?:聊天|对话).*提取|提取.*信息)/i.test(text)) {
    return true;
  }
  if (/(?:人设|人物画像|人物设定|背景资料|身份信息)/i.test(text)) {
    return true;
  }
  if (/(?:林婉清|婉清|Lin Wanqing)/i.test(text)) {
    return true;
  }
  return false;
}

export function buildMemoryRecallContext(layers, message, maxBytes = 28000, options = {}) {
  const liveFetchScheduled = !!options.liveFetchScheduled;
  const fullFolderFetch = !!options.fullFolderFetch;
  const isEmailQuery = isEmailEvidenceQuery(message) || liveFetchScheduled;
  const keywords = extractKeywords(message);
  const pools = [
    ...(layers?.pinnedMemories || layers?.pinned || []).map((item) => ({ layer: 'L1', item })),
    ...(layers?.episodicSegments || []).map((item) => ({ layer: 'L2', item })),
    ...(layers?.semanticProfile || []).map((item) => ({ layer: 'L3', item })),
    ...(layers?.temporalEvents || []).map((item) => ({ layer: 'L4', item })),
    ...(layers?.knowledgeBase || []).map((item) => ({ layer: 'L5', item })),
  ];

  const ranked = pools
    .map(({ layer, item }) => {
      const content = itemText(item);
      if (!content) return null;
      const layerKey = String(layer).toLowerCase();
      if (layerKey !== 'l1' && isLowValueForEmailRecall(content, layerKey)) return null;
      let score = rankMemoryFragment(content, layerKey, keywords, message);
      if (fullFolderFetch && /\b18[\s-]?email|\bapril\s+2026\b/i.test(content) && !/\b287\b/i.test(content)) {
        score -= 40;
      }
      return score > 0 ? { layer, content, date: itemDate(item), score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));

  if (!ranked.length) {
    if (isEmailQuery) {
      return [
        '[CONTINUUM MEMORY — retrieval for this turn]',
        'No email evidence (UID+Date) found in L1–L5 — only question logs or unrelated facts may exist.',
        liveFetchScheduled
          ? (fullFolderFetch
            ? 'FULL FOLDER SCAN runs this turn (2022 through today) — stale April-only memory batches are NOT the full corpus; cite UID+Date from live inbox below.'
            : 'Min and Kids folder IMAP runs synchronously this turn before your reply — cite UID and Date from the live inbox block below when present. If inbox is empty, answer from any L1 facts above and state UID+Date proof is missing. Do NOT write meta-denial lists or say you await a fetch.')
          : 'Answer from any L1 facts above; note missing UID+Date proof. Offer a Min and Kids folder fetch — do NOT claim OOM unless shown in this turn. Do NOT say you await fetch completion.',
      ].join('\n');
    }
    return [
      '[CONTINUUM MEMORY — retrieval for this turn]',
      'No specific memory fragments in L1–L5 matched this query.',
      'Answer directly from current conversation history, user-provided details, and core background.',
      'Do NOT state that you lack capabilities or cannot read the chat window.',
    ].join('\n');
  }

  const lines = [
    '[CONTINUUM MEMORY — L1–L5 retrieval for this turn]',
    'Use ONLY the fragments below for cross-session recall and context. Cite layer and date when quoting.',
    'Do NOT say you lack persistent memory or cannot read memory when this block is present.',
    'Do NOT invent facts, UIDs, or dates not listed here.',
    ...(isEmailQuery ? [
      liveFetchScheduled
        ? (fullFolderFetch
          ? 'FULL FOLDER SCAN below overrides stale April-only memory — prefer UID+Date from live inbox.'
          : 'Live Min and Kids folder inbox data may appear below this block — prefer UID+Date from inbox when present; use memory fragments for gaps only.')
        : 'Do NOT say email content is not present yet or that you await a fetch — answer now from these fragments and chat history.',
    ] : [
      'Answer the user directly from these memory fragments and conversation history.',
    ]),
    '',
  ];

  let bytes = lines.join('\n').length;
  for (const row of ranked.slice(0, 40)) {
    const chunk = `- [${row.layer}${row.date ? ` | ${row.date}` : ''}] ${row.content}`;
    if (bytes + chunk.length > maxBytes) break;
    lines.push(chunk);
    bytes += chunk.length + 1;
  }

  return lines.join('\n');
}
