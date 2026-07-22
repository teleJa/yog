import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, posix, resolve } from 'node:path';
import { confirmDecisionRecord, decisionFingerprint, normalizeDecisionRecord, renderDecisionRecord } from './wiki-decision.mjs';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function storeError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function safeId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw storeError('decision-record-invalid', `${path} must be a stable lowercase ID.`, path);
  return value;
}

function safeRoot(value, path) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value === '..' || value.startsWith('../') || value.includes('/../')) {
    throw storeError('decision-record-invalid', `${path} must be repository-relative.`, path);
  }
  return posix.normalize(value.replace(/^\.\//, ''));
}

function pathWithin(path, root) {
  return root === '.' || path === root || path.startsWith(`${root}/`);
}

function decisionSource(outputRoot, decisionRoot) {
  const configPath = resolve(outputRoot, '.yog/config.json');
  if (!existsSync(configPath)) throw storeError('decision-source-not-configured', 'Missing .yog/config.json.', configPath);
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { throw storeError('decision-source-not-configured', 'Invalid .yog/config.json.', configPath); }
  const source = (config.wiki?.sources ?? []).find((item) => item.kind === 'spec' && item.provider === 'filesystem'
    && item.enabled === true && item.confirmation?.status === 'confirmed'
    && (item.scope?.paths ?? []).some((root) => pathWithin(decisionRoot, root)));
  if (!source) throw storeError('decision-source-not-configured', `No enabled, confirmed spec/filesystem Source covers ${decisionRoot}.`, '$.wiki.sources');
  return source;
}

function targetPath({ outputRoot, decisionRoot, systemId, featureId, decision }) {
  if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot)) throw storeError('decision-record-invalid', '$.outputRoot must be absolute.', '$.outputRoot');
  const root = safeRoot(decisionRoot ?? 'docs/wiki-inputs/decisions', '$.decisionRoot');
  decisionSource(outputRoot, root);
  const relativePath = posix.join(root, safeId(systemId, '$.systemId'), safeId(featureId, '$.featureId'), `${safeId(decision.target.id, '$.decision.target.id')}.md`);
  const absolutePath = resolve(outputRoot, relativePath);
  if (absolutePath !== resolve(outputRoot, relativePath) || !absolutePath.startsWith(`${resolve(outputRoot)}/`)) throw storeError('decision-record-invalid', 'Decision path escapes outputRoot.', '$.decisionRoot');
  return { root, relativePath, absolutePath };
}

function atomicWrite(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o644 });
  renameSync(temporary, path);
}

export function writeDraftDecision(input) {
  const decision = normalizeDecisionRecord({ ...input.decision, status: 'draft' });
  const target = targetPath({ ...input, decision });
  const content = renderDecisionRecord(decision);
  if (existsSync(target.absolutePath)) {
    const current = readFileSync(target.absolutePath, 'utf8');
    if (current !== content) throw storeError('decision-record-conflict', `Decision file already exists with different content: ${target.relativePath}.`, target.relativePath);
  } else atomicWrite(target.absolutePath, content);
  return { schemaVersion: 1, status: 'draft', path: target.relativePath, decision, proposedFingerprint: decisionFingerprint(decision), content };
}

export function writeConfirmedDecision(input) {
  const draft = normalizeDecisionRecord({ ...input.decision, status: 'draft' });
  if (draft.target.kind === 'review-item' && input.currentSourceFingerprint !== draft.target.sourceFingerprint) {
    throw storeError('wiki-review-source-fingerprint-mismatch', 'ReviewItem behavior changed after the Decision draft was created.', '$.currentSourceFingerprint');
  }
  const target = targetPath({ ...input, decision: draft });
  if (!existsSync(target.absolutePath)) throw storeError('decision-record-missing', `Draft Decision does not exist: ${target.relativePath}.`, target.relativePath);
  const expectedDraft = renderDecisionRecord(draft);
  if (readFileSync(target.absolutePath, 'utf8') !== expectedDraft) throw storeError('decision-confirmation-invalid', 'Draft Decision changed after review; recreate and confirm it again.', target.relativePath);
  const decision = confirmDecisionRecord(draft, {
    confirmedBy: input.confirmedBy,
    confirmedRole: input.confirmedRole,
    confirmedAt: input.confirmedAt,
  });
  const content = renderDecisionRecord(decision);
  atomicWrite(target.absolutePath, content);
  return { schemaVersion: 1, status: 'confirmed', path: target.relativePath, decision, content };
}
