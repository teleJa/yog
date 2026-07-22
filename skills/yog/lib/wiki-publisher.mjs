import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const LOCK_RELATIVE_PATH = '.yog/wiki-publish.lock';
const JOURNAL_RELATIVE_PATH = '.yog/wiki-publish-transaction.json';
const FAILURE_POINTS = new Set(['after-prepared', 'prepared', 'after-backed-up', 'backed-up']);

function publisherError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function contentHash(value, field) {
  if (typeof value !== 'string') {
    throw publisherError('wiki-publish-manifest-invalid', `${field} must be a SHA-256 content hash.`, field);
  }
  const match = /^(?:sha256:)?([a-f0-9]{64})$/.exec(value);
  if (!match) {
    throw publisherError('wiki-publish-manifest-invalid', `${field} must be a SHA-256 content hash.`, field);
  }
  return match[1];
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function safeRelativePath(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw publisherError('wiki-publish-path-invalid', `${field} must be a non-empty relative path.`, field);
  }
  const normalized = value.replaceAll('\\', '/');
  if (isAbsolute(value) || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw publisherError('wiki-publish-path-invalid', `${field} escapes outputRoot.`, field);
  }
  return normalized.replace(/^\.\//, '');
}

function inside(root, relativePath, field) {
  const target = resolve(root, safeRelativePath(relativePath, field));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw publisherError('wiki-publish-path-invalid', `${field} escapes outputRoot.`, field);
  }
  return target;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw publisherError(code, `Invalid JSON at ${path}: ${error.message}`, path);
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(outputRoot) {
  const lockPath = join(outputRoot, LOCK_RELATIVE_PATH);
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token, createdAt: new Date().toISOString() })}\n`);
      closeSync(descriptor);
      return { lockPath, token };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try {
        lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      } catch {
        throw publisherError('wiki-publish-locked', 'Wiki publish lock exists and cannot be validated.', LOCK_RELATIVE_PATH);
      }
      if (processIsAlive(lock.pid)) {
        throw publisherError('wiki-publish-locked', `Another Wiki writer holds the repository lock (pid ${lock.pid}).`, LOCK_RELATIVE_PATH);
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  throw publisherError('wiki-publish-locked', 'Unable to acquire the Wiki publish lock.', LOCK_RELATIVE_PATH);
}

function releaseLock(lock) {
  if (!existsSync(lock.lockPath)) return;
  try {
    const current = JSON.parse(readFileSync(lock.lockPath, 'utf8'));
    if (current.token === lock.token) unlinkSync(lock.lockPath);
  } catch {
    // Do not remove a lock that cannot be proven to belong to this writer.
  }
}

function listFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, rel));
    else if (entry.isFile()) files.push(rel);
    else throw publisherError('wiki-publish-staging-invalid', `Snapshot contains unsupported entry: ${rel}.`, rel);
  }
  return files.sort();
}

function parseManagedManifest(snapshotRoot, expected = {}) {
  const manifestPath = join(snapshotRoot, '_meta', 'manifest.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
    throw publisherError('wiki-publish-manifest-missing', 'Snapshot has no _meta/manifest.json.', '_meta/manifest.json');
  }
  const content = readFileSync(manifestPath, 'utf8');
  const manifest = readJson(manifestPath, 'wiki-publish-manifest-invalid');
  if (manifest.managedBy !== 'yog:wiki' || manifest.kind !== 'yog-product-wiki-manifest') {
    throw publisherError('wiki-publish-root-unmanaged', 'Wiki root does not use the current Yog product Wiki contract.', '_meta/manifest.json');
  }
  if (expected.runId !== undefined && manifest.runId !== expected.runId) {
    throw publisherError('wiki-publish-manifest-mismatch', 'Manifest runId does not match the publish transaction.', '_meta/manifest.json');
  }
  if (expected.wikiRoot !== undefined && manifest.wikiRoot !== expected.wikiRoot) {
    throw publisherError('wiki-publish-manifest-mismatch', 'Manifest wikiRoot does not match the publish transaction.', '_meta/manifest.json');
  }
  if (expected.manifestHash !== undefined && sha256(content) !== expected.manifestHash) {
    throw publisherError('wiki-publish-manifest-mismatch', 'Manifest hash does not match the publish transaction.', '_meta/manifest.json');
  }
  if (!Array.isArray(manifest.pages)) {
    throw publisherError('wiki-publish-manifest-invalid', 'Manifest pages must be an array.', '_meta/manifest.json');
  }
  const pagePaths = new Set();
  for (const [index, page] of manifest.pages.entries()) {
    const pagePath = safeRelativePath(page?.path, `manifest.pages[${index}].path`);
    if (pagePaths.has(pagePath)) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest repeats page path ${pagePath}.`, '_meta/manifest.json');
    }
    pagePaths.add(pagePath);
    const absolute = inside(snapshotRoot, pagePath, `manifest.pages[${index}].path`);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest page is missing: ${pagePath}.`, pagePath);
    }
    const expectedHash = contentHash(page?.contentHash, `manifest.pages[${index}].contentHash`);
    if (sha256(readFileSync(absolute)) !== expectedHash) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest contentHash does not match page: ${pagePath}.`, pagePath);
    }
  }

  if (!Array.isArray(manifest.projections)) {
    throw publisherError('wiki-publish-manifest-invalid', 'Manifest projections must be an array.', '_meta/manifest.json');
  }
  const projectionPaths = new Set();
  let modelProjectionHash = null;
  for (const [index, projection] of manifest.projections.entries()) {
    const projectionPath = safeRelativePath(projection?.path, `manifest.projections[${index}].path`);
    if (!projectionPath.startsWith('_meta/') || projectionPath === '_meta/manifest.json') {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest projection has an invalid path: ${projectionPath}.`, projectionPath);
    }
    if (projectionPaths.has(projectionPath) || pagePaths.has(projectionPath)) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest repeats managed path ${projectionPath}.`, '_meta/manifest.json');
    }
    projectionPaths.add(projectionPath);
    const absolute = inside(snapshotRoot, projectionPath, `manifest.projections[${index}].path`);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest projection is missing: ${projectionPath}.`, projectionPath);
    }
    const expectedHash = contentHash(projection?.contentHash, `manifest.projections[${index}].contentHash`);
    if (sha256(readFileSync(absolute)) !== expectedHash) {
      throw publisherError('wiki-publish-manifest-invalid', `Manifest contentHash does not match projection: ${projectionPath}.`, projectionPath);
    }
    if (projectionPath === '_meta/model.json') modelProjectionHash = expectedHash;
  }
  if (modelProjectionHash === null) {
    throw publisherError('wiki-publish-manifest-invalid', 'Manifest must include the canonical _meta/model.json projection.', '_meta/manifest.json');
  }
  if (contentHash(manifest.modelHash, 'manifest.modelHash') !== modelProjectionHash) {
    throw publisherError('wiki-publish-manifest-invalid', 'Manifest modelHash does not match _meta/model.json.', '_meta/model.json');
  }

  const managedFiles = [...pagePaths, ...projectionPaths, '_meta/manifest.json'].sort();
  if (JSON.stringify(listFiles(snapshotRoot)) !== JSON.stringify(managedFiles)) {
    throw publisherError('wiki-publish-managed-files-mismatch', 'Snapshot files do not match the Manifest managed-file set.', snapshotRoot);
  }
  return { manifest, manifestHash: sha256(content), managedFiles };
}

function validateSnapshot(snapshotRoot, expected) {
  const parsed = parseManagedManifest(snapshotRoot, expected);
  if (expected.managedFiles) {
    const wanted = [...expected.managedFiles].sort();
    if (new Set(wanted).size !== wanted.length || JSON.stringify(parsed.managedFiles) !== JSON.stringify(wanted)) {
      throw publisherError('wiki-publish-managed-files-mismatch', 'Snapshot files do not match the transaction managed-file list.', snapshotRoot);
    }
  }
  return parsed;
}

function validateBuild(build) {
  if (!build || typeof build !== 'object') throw publisherError('wiki-publish-build-invalid', 'build must be an object.');
  if (typeof build.outputRoot !== 'string' || build.outputRoot.length === 0) {
    throw publisherError('wiki-publish-build-invalid', 'outputRoot must be a non-empty path.', '$.outputRoot');
  }
  const outputRoot = resolve(build.outputRoot);
  const wikiRoot = safeRelativePath(build.wikiRoot, '$.wikiRoot');
  if (typeof build.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(build.runId)) {
    throw publisherError('wiki-publish-build-invalid', 'runId must be a safe path segment.', '$.runId');
  }
  if (!Array.isArray(build.files) || build.files.length === 0) {
    throw publisherError('wiki-publish-build-invalid', 'build.files must be a non-empty array.', '$.files');
  }
  const files = build.files.map((file, index) => {
    const path = safeRelativePath(file?.path, `$.files[${index}].path`);
    if (typeof file?.content !== 'string') {
      throw publisherError('wiki-publish-build-invalid', 'Every build file must have string content.', `$.files[${index}].content`);
    }
    return { path, content: file.content };
  });
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) {
    throw publisherError('wiki-publish-build-invalid', 'build.files contains duplicate paths.', '$.files');
  }
  if (!paths.includes('_meta/manifest.json')) {
    throw publisherError('wiki-publish-manifest-missing', 'build.files must include _meta/manifest.json.', '$.files');
  }
  return { outputRoot, wikiRoot, files };
}

function writeSnapshot(root, files) {
  for (const file of files) {
    const absolute = inside(root, file.path, '$.files.path');
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content);
  }
}

function journalLocations(outputRoot, journal) {
  return {
    formalWiki: inside(outputRoot, journal.formalRoot, '$.journal.formalRoot'),
    stagingWiki: inside(outputRoot, journal.staging, '$.journal.staging'),
    backupWiki: inside(outputRoot, journal.backup, '$.journal.backup'),
  };
}

function removeJournal(outputRoot) {
  const path = join(outputRoot, JOURNAL_RELATIVE_PATH);
  if (existsSync(path)) unlinkSync(path);
}

function readJournal(outputRoot) {
  const path = join(outputRoot, JOURNAL_RELATIVE_PATH);
  if (!existsSync(path)) return null;
  const journal = readJson(path, 'wiki-publish-journal-invalid');
  if (journal.schemaVersion !== 1 || !['prepared', 'backed-up', 'committed'].includes(journal.status)) {
    throw publisherError('wiki-publish-journal-invalid', 'Wiki transaction journal has an invalid schema or status.', JOURNAL_RELATIVE_PATH);
  }
  if (!Array.isArray(journal.managedFiles) || typeof journal.manifestHash !== 'string') {
    throw publisherError('wiki-publish-journal-invalid', 'Wiki transaction journal is incomplete.', JOURNAL_RELATIVE_PATH);
  }
  return journal;
}

function writeJournal(outputRoot, journal) {
  atomicWriteJson(join(outputRoot, JOURNAL_RELATIVE_PATH), journal);
}

function cleanupStaging(stagingWiki) {
  const stagingRoot = dirname(stagingWiki);
  if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
}

function restoreBackup({ formalWiki, backupWiki, stagingWiki }) {
  if (existsSync(formalWiki)) rmSync(formalWiki, { recursive: true, force: true });
  mkdirSync(dirname(formalWiki), { recursive: true });
  renameSync(backupWiki, formalWiki);
  cleanupStaging(stagingWiki);
}

function recoverUnlocked(outputRoot, requestedWikiRoot) {
  const journal = readJournal(outputRoot);
  if (!journal) return { ok: true, recovered: false, action: 'none' };
  if (requestedWikiRoot !== undefined && safeRelativePath(requestedWikiRoot, '$.wikiRoot') !== journal.formalRoot) {
    throw publisherError('wiki-publish-recovery-root-mismatch', 'Pending Wiki transaction belongs to a different wikiRoot.', JOURNAL_RELATIVE_PATH);
  }
  const locations = journalLocations(outputRoot, journal);
  const expected = {
    runId: journal.targetRunId,
    wikiRoot: journal.formalRoot,
    manifestHash: journal.manifestHash,
    managedFiles: journal.managedFiles,
  };

  if (journal.status === 'prepared') {
    if (existsSync(locations.formalWiki)) {
      parseManagedManifest(locations.formalWiki);
      cleanupStaging(locations.stagingWiki);
      removeJournal(outputRoot);
      return { ok: true, recovered: true, action: 'kept-current', runId: journal.targetRunId };
    }
    validateSnapshot(locations.stagingWiki, expected);
    mkdirSync(dirname(locations.formalWiki), { recursive: true });
    renameSync(locations.stagingWiki, locations.formalWiki);
    writeJournal(outputRoot, { ...journal, status: 'committed', updatedAt: new Date().toISOString() });
    removeJournal(outputRoot);
    return { ok: true, recovered: true, action: 'committed-staging', runId: journal.targetRunId };
  }

  if (journal.status === 'backed-up') {
    if (existsSync(locations.formalWiki)) {
      try {
        validateSnapshot(locations.formalWiki, expected);
        cleanupStaging(locations.stagingWiki);
        writeJournal(outputRoot, { ...journal, status: 'committed', updatedAt: new Date().toISOString() });
        removeJournal(outputRoot);
        return { ok: true, recovered: true, action: 'kept-committed', runId: journal.targetRunId };
      } catch (error) {
        if (!existsSync(locations.backupWiki)) throw error;
      }
    }
    if (!existsSync(locations.backupWiki)) {
      throw publisherError('wiki-publish-recovery-failed', 'Backed-up transaction has neither a valid target nor a backup.', JOURNAL_RELATIVE_PATH);
    }
    parseManagedManifest(locations.backupWiki);
    restoreBackup({ ...locations });
    removeJournal(outputRoot);
    return { ok: true, recovered: true, action: 'restored-backup', runId: journal.targetRunId };
  }

  validateSnapshot(locations.formalWiki, expected);
  cleanupStaging(locations.stagingWiki);
  removeJournal(outputRoot);
  return { ok: true, recovered: true, action: 'finalized-commit', runId: journal.targetRunId };
}

function injectFailure(failurePoint, status) {
  if (failurePoint === status || failurePoint === `after-${status}`) {
    throw publisherError('wiki-publish-injected-failure', `Injected failure after ${status}.`, '$.failurePoint');
  }
}

export function recoverWikiTransaction({ outputRoot, wikiRoot } = {}) {
  if (typeof outputRoot !== 'string' || outputRoot.length === 0) {
    throw publisherError('wiki-publish-build-invalid', 'outputRoot must be a non-empty path.', '$.outputRoot');
  }
  const root = resolve(outputRoot);
  const lock = acquireLock(root);
  try {
    return recoverUnlocked(root, wikiRoot);
  } finally {
    releaseLock(lock);
  }
}

export function publishWikiSnapshot(build, { failurePoint } = {}) {
  if (failurePoint !== undefined && !FAILURE_POINTS.has(failurePoint)) {
    throw publisherError('wiki-publish-failure-point-invalid', `Unknown failurePoint: ${failurePoint}.`, '$.failurePoint');
  }
  const normalized = validateBuild(build);
  const lock = acquireLock(normalized.outputRoot);
  try {
    recoverUnlocked(normalized.outputRoot);
    const runRoot = join(normalized.outputRoot, '.yog', 'runs', 'wiki', build.runId);
    const stagingWiki = join(runRoot, 'staging', 'wiki');
    const backupWiki = join(runRoot, 'backup', 'wiki');
    const formalWiki = inside(normalized.outputRoot, normalized.wikiRoot, '$.wikiRoot');
    rmSync(runRoot, { recursive: true, force: true });
    mkdirSync(stagingWiki, { recursive: true });
    writeSnapshot(stagingWiki, normalized.files);
    const parsed = validateSnapshot(stagingWiki, {
      runId: build.runId,
      wikiRoot: normalized.wikiRoot,
      managedFiles: normalized.files.map((file) => file.path),
    });
    if (build.manifest !== undefined && !isDeepStrictEqual(parsed.manifest, build.manifest)) {
      throw publisherError('wiki-publish-manifest-mismatch', 'build.manifest differs from _meta/manifest.json.', '$.manifest');
    }

    const operation = existsSync(formalWiki) ? 'replace' : 'create';
    if (operation === 'replace') parseManagedManifest(formalWiki);
    const journal = {
      schemaVersion: 1,
      status: 'prepared',
      operation,
      formalRoot: normalized.wikiRoot,
      staging: toPosix(relative(normalized.outputRoot, stagingWiki)),
      backup: toPosix(relative(normalized.outputRoot, backupWiki)),
      targetRunId: build.runId,
      manifestHash: parsed.manifestHash,
      managedFiles: normalized.files.map((file) => file.path).sort(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJournal(normalized.outputRoot, journal);
    injectFailure(failurePoint, 'prepared');

    let backedUp = false;
    if (operation === 'replace') {
      mkdirSync(dirname(backupWiki), { recursive: true });
      renameSync(formalWiki, backupWiki);
      backedUp = true;
      journal.status = 'backed-up';
      journal.updatedAt = new Date().toISOString();
      writeJournal(normalized.outputRoot, journal);
      injectFailure(failurePoint, 'backed-up');
    }

    try {
      mkdirSync(dirname(formalWiki), { recursive: true });
      renameSync(stagingWiki, formalWiki);
    } catch (error) {
      if (backedUp && existsSync(backupWiki)) {
        restoreBackup({ formalWiki, backupWiki, stagingWiki });
        removeJournal(normalized.outputRoot);
      }
      throw error;
    }

    journal.status = 'committed';
    journal.updatedAt = new Date().toISOString();
    writeJournal(normalized.outputRoot, journal);
    removeJournal(normalized.outputRoot);
    return {
      ok: true,
      operation,
      runId: build.runId,
      wikiRoot: normalized.wikiRoot,
      written: normalized.files.map((file) => file.path).sort(),
      backupPath: operation === 'replace' ? toPosix(relative(normalized.outputRoot, backupWiki)) : null,
      manifestPath: `${normalized.wikiRoot}/_meta/manifest.json`,
      issues: build.issues ?? [],
    };
  } finally {
    releaseLock(lock);
  }
}
