import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateStatusForDocument,
  parseSimpleYamlValue,
} from '../../skills/yog/lib/frontmatter.mjs';
import { hasTemplatePlaceholder, hasRealBodyContent, normalizeGeneratedText } from '../../skills/yog/lib/markdown.mjs';

test('parseFrontmatter supports strings booleans empty arrays inline arrays and indented lists', () => {
  const parsed = parseFrontmatter(`---
name: Refund
active: true
keywords: [refund, payment]
owners:
  - ops
  - finance
empty: []
---

# Refund
Body text.
`);
  assert.deepEqual(parsed.data, {
    name: 'Refund',
    active: true,
    keywords: ['refund', 'payment'],
    owners: ['ops', 'finance'],
    empty: [],
  });
  assert.equal(parsed.body.trim(), '# Refund\nBody text.');
});

test('parseFrontmatter rejects nested objects and block scalars', () => {
  assert.throws(() => parseSimpleYamlValue('{ nested: true }'), /unsupported YAML value/);
  assert.throws(() => parseSimpleYamlValue('|'), /unsupported YAML value/);
});

test('stringifyFrontmatter writes stable simple YAML', () => {
  assert.equal(
    stringifyFrontmatter({ name: 'Refund', keywords: ['refund', 'payment'], owners: [], active: true }),
    `---\nname: Refund\nkeywords: [refund, payment]\nowners: []\nactive: true\n---\n`,
  );
});

test('validateStatusForDocument enforces document type rules', () => {
  assert.deepEqual(validateStatusForDocument('candidate', 'verified'), ['Candidate documents cannot use status verified.']);
  assert.deepEqual(validateStatusForDocument('adr', 'accepted'), []);
  assert.deepEqual(validateStatusForDocument('capability', 'accepted'), ['Status accepted is only valid for ADR documents.']);
});

test('markdown helpers detect generated time and empty shell bodies', () => {
  assert.equal(hasTemplatePlaceholder('# {Name}\n'), true);
  assert.equal(hasTemplatePlaceholder('返回 URL 形如 https://{tenantDomain}/docx/{documentId}。'), false);
  assert.equal(hasRealBodyContent('---\nname: x\n---\n# Title\n## Section\n'), false);
  assert.equal(hasRealBodyContent('---\nname: x\n---\n# Title\nA real paragraph.'), true);
  assert.equal(hasRealBodyContent('# Flow\n1. 用户提交退费申请\n2. 系统记录申请状态\n3. 运营审核后同步售后结果\n'), true);
  assert.equal(hasRealBodyContent('# Flow\n1. TODO\n2. TBD\n'), false);
  assert.equal(hasRealBodyContent('# Flow\n- 待补充\n- 待确认\n'), false);
  assert.equal(hasRealBodyContent('# Flow\n1. {补充审核规则}\n'), false);
  assert.equal(hasRealBodyContent('# Flow\n## Open Questions\n- TODO\n'), true);
  assert.equal(hasRealBodyContent('# Flow\n## 未确认问题\n- 待确认\n'), true);
  assert.equal(normalizeGeneratedText('Generated at: 2026-06-22T00:00:00.000Z\nName'), 'Generated at:\nName');
});
