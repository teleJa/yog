import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { publishWikiSnapshot, recoverWikiTransaction } from '../../skills/yog/lib/wiki-publisher.mjs';

const retiredWikiOwner = ['yog', ['wiki', 'mvp'].join('-')].join(':');

function hash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function fixture(t) {
  const outputRoot = mkdtempSync(join(tmpdir(), 'yog-wiki-publisher-'));
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  return outputRoot;
}

function build(outputRoot, runId, pageContent = `# Wiki ${runId}\n`) {
  const wikiRoot = 'docs/wiki';
  const pagePath = '产品目录/示例.md';
  const modelContent = '{"schemaVersion":1}\n';
  const catalogContent = '{"schemaVersion":1}\n';
  const manifest = {
    schemaVersion: 1,
    managedBy: 'yog:wiki',
    kind: 'yog-product-wiki-manifest',
    generatorVersion: 'test',
    runId,
    wikiRoot,
    modelHash: hash(modelContent),
    pages: [{ id: 'feature-example', path: pagePath, contentHash: hash(pageContent) }],
    projections: [
      { path: '_meta/model.json', contentHash: hash(modelContent) },
      { path: '_meta/catalog.json', contentHash: hash(catalogContent) },
    ],
  };
  return {
    outputRoot,
    wikiRoot,
    runId,
    manifest,
    files: [
      { path: pagePath, content: pageContent },
      { path: '_meta/model.json', content: modelContent },
      { path: '_meta/catalog.json', content: catalogContent },
      { path: '_meta/manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    ],
    issues: [],
  };
}

function currentPage(outputRoot) {
  return readFileSync(join(outputRoot, 'docs/wiki/产品目录/示例.md'), 'utf8');
}

test('publisher creates and replaces a complete managed snapshot under one transaction', (t) => {
  const outputRoot = fixture(t);
  const created = publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'));
  assert.equal(created.operation, 'create');
  assert.equal(created.backupPath, null);
  assert.equal(created.manifestPath, 'docs/wiki/_meta/manifest.json');
  assert.deepEqual(created.written, ['_meta/catalog.json', '_meta/manifest.json', '_meta/model.json', '产品目录/示例.md']);
  assert.equal(currentPage(outputRoot), '# A\n');
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish-transaction.json')), false);
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish.lock')), false);

  const replaced = publishWikiSnapshot(build(outputRoot, 'run-b', '# B\n'));
  assert.equal(replaced.operation, 'replace');
  assert.equal(currentPage(outputRoot), '# B\n');
  assert.equal(readFileSync(join(outputRoot, replaced.backupPath, '产品目录/示例.md'), 'utf8'), '# A\n');
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish-transaction.json')), false);
});

test('publisher validates the complete staging snapshot before moving the formal Wiki', (t) => {
  const outputRoot = fixture(t);
  publishWikiSnapshot(build(outputRoot, 'run-a', '# Stable\n'));

  const missingPage = build(outputRoot, 'run-b', '# Broken\n');
  missingPage.files = missingPage.files.filter((file) => !file.path.endsWith('示例.md'));
  assert.throws(() => publishWikiSnapshot(missingPage), { code: 'wiki-publish-manifest-invalid' });
  assert.equal(currentPage(outputRoot), '# Stable\n');
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish-transaction.json')), false);

  const unmanaged = build(outputRoot, 'run-c');
  unmanaged.manifest.managedBy = 'human';
  unmanaged.files.find((file) => file.path === '_meta/manifest.json').content = `${JSON.stringify(unmanaged.manifest)}\n`;
  assert.throws(() => publishWikiSnapshot(unmanaged), { code: 'wiki-publish-root-unmanaged' });
  assert.equal(currentPage(outputRoot), '# Stable\n');

  const wrongContentHash = build(outputRoot, 'run-d', '# Changed\n');
  wrongContentHash.manifest.pages[0].contentHash = '0'.repeat(64);
  wrongContentHash.files.find((file) => file.path === '_meta/manifest.json').content = `${JSON.stringify(wrongContentHash.manifest)}\n`;
  assert.throws(() => publishWikiSnapshot(wrongContentHash), { code: 'wiki-publish-manifest-invalid' });
  assert.equal(currentPage(outputRoot), '# Stable\n');

  const wrongModelHash = build(outputRoot, 'run-e');
  wrongModelHash.manifest.modelHash = `sha256:${'0'.repeat(64)}`;
  wrongModelHash.files.find((file) => file.path === '_meta/manifest.json').content = `${JSON.stringify(wrongModelHash.manifest)}\n`;
  assert.throws(() => publishWikiSnapshot(wrongModelHash), { code: 'wiki-publish-manifest-invalid' });
  assert.equal(currentPage(outputRoot), '# Stable\n');

  const wrongProjectionHash = build(outputRoot, 'run-f');
  wrongProjectionHash.manifest.projections.find((projection) => projection.path === '_meta/catalog.json').contentHash = `sha256:${'0'.repeat(64)}`;
  wrongProjectionHash.files.find((file) => file.path === '_meta/manifest.json').content = `${JSON.stringify(wrongProjectionHash.manifest)}\n`;
  assert.throws(() => publishWikiSnapshot(wrongProjectionHash), { code: 'wiki-publish-manifest-invalid' });
  assert.equal(currentPage(outputRoot), '# Stable\n');
});

test('prepared replacement failure leaves the current Wiki intact and startup recovery discards staging', (t) => {
  const outputRoot = fixture(t);
  publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'));

  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-b', '# B\n'), { failurePoint: 'after-prepared' }),
    { code: 'wiki-publish-injected-failure' },
  );
  assert.equal(currentPage(outputRoot), '# A\n');
  const journalPath = join(outputRoot, '.yog/wiki-publish-transaction.json');
  assert.equal(JSON.parse(readFileSync(journalPath, 'utf8')).status, 'prepared');

  const recovered = recoverWikiTransaction({ outputRoot, wikiRoot: 'docs/wiki' });
  assert.equal(recovered.action, 'kept-current');
  assert.equal(currentPage(outputRoot), '# A\n');
  assert.equal(existsSync(journalPath), false);
});

test('backed-up replacement failure is restored on startup without losing the formal Wiki', (t) => {
  const outputRoot = fixture(t);
  publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'));

  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-b', '# B\n'), { failurePoint: 'after-backed-up' }),
    { code: 'wiki-publish-injected-failure' },
  );
  assert.equal(existsSync(join(outputRoot, 'docs/wiki')), false);
  const journalPath = join(outputRoot, '.yog/wiki-publish-transaction.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  assert.equal(journal.status, 'backed-up');
  assert.equal(existsSync(join(outputRoot, journal.backup)), true);

  const recovered = recoverWikiTransaction({ outputRoot });
  assert.equal(recovered.action, 'restored-backup');
  assert.equal(currentPage(outputRoot), '# A\n');
  assert.equal(existsSync(journalPath), false);
});

test('startup recovery completes a validated initial snapshot prepared before interruption', (t) => {
  const outputRoot = fixture(t);
  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'), { failurePoint: 'prepared' }),
    { code: 'wiki-publish-injected-failure' },
  );
  assert.equal(existsSync(join(outputRoot, 'docs/wiki')), false);

  const recovered = recoverWikiTransaction({ outputRoot });
  assert.equal(recovered.action, 'committed-staging');
  assert.equal(currentPage(outputRoot), '# A\n');
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish-transaction.json')), false);
});

test('startup recovery refuses a prepared snapshot with a tampered canonical model', (t) => {
  const outputRoot = fixture(t);
  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'), { failurePoint: 'prepared' }),
    { code: 'wiki-publish-injected-failure' },
  );
  const journalPath = join(outputRoot, '.yog/wiki-publish-transaction.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  writeFileSync(join(outputRoot, journal.staging, '_meta/model.json'), '{"schemaVersion":2}\n');

  assert.throws(() => recoverWikiTransaction({ outputRoot }), { code: 'wiki-publish-manifest-invalid' });
  assert.equal(existsSync(join(outputRoot, journal.formalRoot)), false);
  assert.equal(existsSync(journalPath), true);
});

test('startup recovery recognizes a target renamed before committed journal update', (t) => {
  const outputRoot = fixture(t);
  publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'));
  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-b', '# B\n'), { failurePoint: 'backed-up' }),
    { code: 'wiki-publish-injected-failure' },
  );
  const journal = JSON.parse(readFileSync(join(outputRoot, '.yog/wiki-publish-transaction.json'), 'utf8'));
  mkdirSync(dirname(join(outputRoot, journal.formalRoot)), { recursive: true });
  renameSync(join(outputRoot, journal.staging), join(outputRoot, journal.formalRoot));

  const recovered = recoverWikiTransaction({ outputRoot });
  assert.equal(recovered.action, 'kept-committed');
  assert.equal(currentPage(outputRoot), '# B\n');
  assert.equal(existsSync(join(outputRoot, journal.backup)), true);
});

test('startup recovery restores backup when a renamed target projection was tampered', (t) => {
  const outputRoot = fixture(t);
  publishWikiSnapshot(build(outputRoot, 'run-a', '# A\n'));
  assert.throws(
    () => publishWikiSnapshot(build(outputRoot, 'run-b', '# B\n'), { failurePoint: 'backed-up' }),
    { code: 'wiki-publish-injected-failure' },
  );
  const journal = JSON.parse(readFileSync(join(outputRoot, '.yog/wiki-publish-transaction.json'), 'utf8'));
  mkdirSync(dirname(join(outputRoot, journal.formalRoot)), { recursive: true });
  renameSync(join(outputRoot, journal.staging), join(outputRoot, journal.formalRoot));
  writeFileSync(join(outputRoot, journal.formalRoot, '_meta/catalog.json'), '{"tampered":true}\n');

  const recovered = recoverWikiTransaction({ outputRoot });
  assert.equal(recovered.action, 'restored-backup');
  assert.equal(currentPage(outputRoot), '# A\n');
  assert.equal(existsSync(join(outputRoot, '.yog/wiki-publish-transaction.json')), false);
});

test('repository lock rejects a second live writer and stale process locks are recoverable', (t) => {
  const outputRoot = fixture(t);
  const lockPath = join(outputRoot, '.yog/wiki-publish.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'other-writer' })}\n`);
  assert.throws(() => publishWikiSnapshot(build(outputRoot, 'run-a')), { code: 'wiki-publish-locked' });
  assert.equal(existsSync(join(outputRoot, 'docs/wiki')), false);
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).token, 'other-writer');

  writeFileSync(lockPath, `${JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, token: 'stale-writer' })}\n`);
  const result = publishWikiSnapshot(build(outputRoot, 'run-a'));
  assert.equal(result.ok, true);
  assert.equal(currentPage(outputRoot), '# Wiki run-a\n');
  assert.equal(existsSync(lockPath), false);
});

test('publisher rejects overwrite when the formal root is not Yog-managed', (t) => {
  const outputRoot = fixture(t);
  mkdirSync(join(outputRoot, 'docs/wiki'), { recursive: true });
  writeFileSync(join(outputRoot, 'docs/wiki/README.md'), '# Human Wiki\n');
  assert.throws(() => publishWikiSnapshot(build(outputRoot, 'run-a')), { code: 'wiki-publish-manifest-missing' });
  assert.equal(readFileSync(join(outputRoot, 'docs/wiki/README.md'), 'utf8'), '# Human Wiki\n');
});

test('publisher rejects the retired Yog Wiki ownership contract', (t) => {
  const outputRoot = fixture(t);
  const legacy = build(outputRoot, 'run-legacy');
  legacy.manifest.managedBy = retiredWikiOwner;
  legacy.files.find((file) => file.path === '_meta/manifest.json').content = `${JSON.stringify(legacy.manifest, null, 2)}\n`;
  assert.throws(() => publishWikiSnapshot(legacy), { code: 'wiki-publish-root-unmanaged' });
});
