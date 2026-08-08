const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('jszip');

// Load the pure DOCX extraction module by transforming its ESM imports to CJS.
const srcPath = path.join(__dirname, '../src/utils/docxTextExtract.js');
let src = fs.readFileSync(srcPath, 'utf8');
src = src.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g, 'const { $1 } = require("$2");');
src = src.replace(/import\s+(\w+)\s+from\s*'([^']+)';/g, 'const $1 = require("$2");');
src = src.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1');
src = src.replace(/export\s+function\s+(\w+)/g, 'function $1');
src += '\nmodule.exports = { extractDocxTextFromXml, extractDocxTextFromBase64 };\n';

const sandbox = { module: { exports: {} }, exports: {}, require, console, process };
vm.runInNewContext(src, sandbox, { filename: srcPath });
const { extractDocxTextFromXml, extractDocxTextFromBase64 } = sandbox.module.exports;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

async function buildDocx(documentXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  return Buffer.from(bytes).toString('base64');
}

function wrap(documentXml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${documentXml}</w:body>
</w:document>`;
}

async function checkDocx(name, documentXml, expected) {
  const base64 = await buildDocx(wrap(documentXml));
  const got = await extractDocxTextFromBase64(base64);
  assert.strictEqual(got, expected, `[${name}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  console.log(`ok - ${name}`);
}

async function run() {
  await checkDocx(
    'paragraphs, runs, entities, tabs, breaks, fields, bookmarks',
    `
    <w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Quarterly Report</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r></w:p>
    <w:p><w:r><w:t>Costs a &gt; b &amp; savings</w:t></w:r></w:p>
    <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs></w:pPr><w:r><w:t>No leading tab</w:t></w:r></w:p>
    <w:p><w:r><w:t>One</w:t><w:tab/><w:t>Two</w:t></w:r></w:p>
    <w:p><w:r><w:t>First line</w:t><w:br/><w:t>Second line</w:t></w:r></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>12</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:p><w:bookmarkStart w:id="0" w:name="Bookmark1"/><w:r><w:t>Bookmarked</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>
    <w:p><w:r><w:t>Non-breaking&#160;space</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    `,
    [
      'Quarterly Report',
      'Hello world',
      'Costs a > b & savings',
      'No leading tab',
      'One\tTwo',
      'First line',
      'Second line',
      '12',
      'Bookmarked',
      'Non-breaking space',
      'Cell A',
      'Cell B',
    ].join('\n'),
  );

  await checkDocx(
    'literal > inside text is preserved (DOM parsing, not regex)',
    '<w:p><w:r><w:t>Arrow -&gt; and also a > b</w:t></w:r></w:p>',
    'Arrow -> and also a > b',
  );

  await checkDocx(
    'textbox content via w:txbxContent',
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
      <wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <w:txbxContent><w:p><w:r><w:t>TextBox text</w:t></w:r></w:p></w:txbxContent>
      </wps:txbx>
    </wp:inline></w:drawing></w:r></w:p>`,
    'TextBox text',
  );

  // Strict OOXML namespace variant (no double XML declaration).
  const strictXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Strict doc</w:t></w:r></w:p></w:body>
    </w:document>`;
  const strictText = await extractDocxTextFromBase64(await buildDocx(strictXml));
  assert.strictEqual(strictText, 'Strict doc');
  console.log('ok - strict OOXML namespace');

  // Unescaped '>' in text is legal XML and must survive parsing.
  assert.strictEqual(
    extractDocxTextFromXml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:r><w:t>a > b</w:t></w:r></w:p></w:body></w:document>',
    ),
    'a > b',
  );

  // Base64 containing line breaks (Android readAsStringAsync can emit them).
  const nlBase64 = (await buildDocx(wrap('<w:p><w:r><w:t>Newline base64</w:t></w:r></w:p>'))).replace(/.{48}/g, '$&\n');
  assert.strictEqual(
    await extractDocxTextFromBase64(nlBase64),
    'Newline base64',
  );
  console.log('ok - base64 with embedded newlines');

  // Document with no extractable text -> friendly error.
  const emptyDocx = await buildDocx(wrap('<w:p><w:pPr/></w:p>'));
  await assert.rejects(
    () => extractDocxTextFromBase64(emptyDocx),
    /No text found/,
  );

  // A zip that is not a docx -> friendly error.
  const notDocxZip = new JSZip();
  notDocxZip.file('readme.txt', 'hello');
  const notDocxBase64 = Buffer.from(
    await notDocxZip.generateAsync({ type: 'uint8array' }),
  ).toString('base64');
  await assert.rejects(
    () => extractDocxTextFromBase64(notDocxBase64),
    /No readable content/,
  );

  // Corrupt input (not a zip) -> friendly error.
  await assert.rejects(
    () => extractDocxTextFromBase64(Buffer.from('this is not a zip').toString('base64')),
    /Could not read this Word file/,
  );

  console.log('docxTextExtract: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
