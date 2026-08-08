/**
 * Convert assistant markdown into plain spoken text for TTS.
 * Removes emphasis markers (*, **, _, __), headings, code fences, links, and table pipes
 * so voices do not say "asterisk" / "star".
 */
function stripMarkdownForSpeech(input) {
  if (input == null) return '';
  let text = String(input);

  // Fenced code blocks → keep inner text
  text = text.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_, code) => `\n${code.trim()}\n`);
  // Inline code
  text = text.replace(/`([^`]+)`/g, '$1');
  // Images ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Links [label](url) → label
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Headings
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Blockquote markers
  text = text.replace(/^>\s?/gm, '');
  // Bold / italic / strikethrough wrappers (repeat to unwind nesting)
  for (let i = 0; i < 4; i += 1) {
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    text = text.replace(/___([^_]+)___/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/\*([^*\n]+)\*/g, '$1');
    text = text.replace(/_([^_\n]+)_/g, '$1');
    text = text.replace(/~~([^~]+)~~/g, '$1');
  }
  // Any leftover lone emphasis markers (common in streaming / lists)
  text = text.replace(/(^|[\s(])\*+(?=\s|$)/g, '$1');
  text = text.replace(/(^|[\s(])_+(?=\s|$)/g, '$1');
  text = text.replace(/\*+/g, '');
  // Unordered / ordered list markers at line start
  text = text.replace(/^[ \t]*[-+][ \t]+/gm, '');
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, '');
  // Tables: drop alignment separators, flatten cells (line-based so \s cannot eat newlines)
  text = text.split('\n').map((line) => {
    if (/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/.test(line)) {
      return '';
    }
    const row = line.match(/^[ \t]*\|(.+)\|[ \t]*$/);
    if (row) {
      return row[1].split('|').map((c) => c.trim()).filter(Boolean).join(', ');
    }
    return line;
  }).join('\n');
  // Horizontal rules
  text = text.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '');
  // Collapse whitespace for clearer speech
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

export { stripMarkdownForSpeech };
