import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertInsideRepo, slashPath } from './knowledge-root.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { isGapMarkdownPath } from './wiki-gap.mjs';
import {
  buildCatalogIndexProjections,
  buildFlowIndexProjections,
  buildGapIndexProjections,
  buildReviewIndexProjections,
} from './wiki.mjs';
import { assertPersistedWikiInputConfirmation } from './wiki-source-registry.mjs';

const TERMINAL_STATUSES = new Set([
  'not-found',
  'not-initialized',
  'not-managed',
  'unavailable',
  'invalid-wiki',
  'invalid-knowledge',
]);

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function sha256Fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: error.message };
  }
}

function issue(code, path, expected, actual) {
  return { code, path: slashPath(path), expected, actual };
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildFlowQueryReadSet({ systemRef, flowRef, catalogIndex, flowIndex, systemFlowIndex } = {}) {
  if (typeof systemRef !== 'string' || typeof flowRef !== 'string') throw new Error('systemRef and flowRef are required.');
  const catalogSystem = objectValue(catalogIndex).systems?.find((entry) => entry.ref === systemRef);
  const flowSystem = objectValue(flowIndex).systems?.find((entry) => entry.systemRef === systemRef);
  const entry = objectValue(systemFlowIndex).entries?.find((item) => item.ref === flowRef);
  if (!catalogSystem || !flowSystem || !entry) return [];
  return [
    '_meta/manifest.json',
    '_meta/catalog.json',
    catalogSystem.catalogPath,
    '_meta/flows.json',
    flowSystem.flowCatalogPath,
    '知识对象/业务流程/目录.md',
    entry.pagePath,
    '_meta/coverage.json',
  ];
}

export function buildReviewQueryReadSet({ systemRef, featureRef, catalogIndex, systemCatalog, reviewIndex, systemReviewIndex } = {}) {
  if (typeof systemRef !== 'string' || typeof featureRef !== 'string') throw new Error('systemRef and featureRef are required.');
  const catalogSystem = objectValue(catalogIndex).systems?.find((entry) => entry.ref === systemRef);
  const reviewSystem = objectValue(reviewIndex).systems?.find((entry) => entry.ref === systemRef);
  const feature = objectValue(systemCatalog).entries?.find((entry) => entry.ref === featureRef);
  const reviewEntry = objectValue(systemReviewIndex).entries?.find((entry) => entry.featureRef === featureRef);
  if (!catalogSystem || !reviewSystem || !feature || !reviewEntry) return [];
  return [...new Set([
    '_meta/manifest.json', '_meta/catalog.json', catalogSystem.catalogPath,
    '_meta/reviews.json', reviewSystem.reviewCatalogPath,
    reviewEntry.pagePath, feature.pagePath, '_meta/coverage.json',
  ])];
}

function parseAuditBlocks(path, content) {
  const blocks = [];
  const issues = [];
  const openingPattern = /<!-- yog:audit:(finding|resolution):([^ >]+) -->/g;
  const closingPattern = /<!-- \/yog:audit:(finding|resolution) -->/g;
  const openings = [...content.matchAll(openingPattern)];
  const closings = [...content.matchAll(closingPattern)];
  if (openings.length !== closings.length) {
    issues.push(issue('audit-malformed', path, 'paired Yog Audit blocks', 'unpaired block marker'));
    return { blocks, issues };
  }
  for (const match of openings) {
    const [, type, fingerprint] = match;
    const bodyStart = match.index + match[0].length;
    const closeMarker = `<!-- /yog:audit:${type} -->`;
    const bodyEnd = content.indexOf(closeMarker, bodyStart);
    if (bodyEnd < 0) {
      issues.push(issue('audit-malformed', path, `closing ${type} marker`, 'missing'));
      continue;
    }
    const json = content.slice(bodyStart, bodyEnd).match(/```json\s*\n([\s\S]*?)\n```/);
    if (!json) {
      issues.push(issue('audit-malformed', path, `${type} JSON block`, 'missing'));
      continue;
    }
    try {
      const value = JSON.parse(json[1]);
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.fingerprint !== fingerprint) {
        issues.push(issue('audit-malformed', path, `${type} fingerprint ${fingerprint}`, value?.fingerprint ?? 'missing'));
        continue;
      }
      blocks.push({ type, fingerprint, value, path });
    } catch (error) {
      issues.push(issue('audit-malformed', path, `valid ${type} JSON`, error.message));
    }
  }
  return { blocks, issues };
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateWikiAuditGate({
  repoRoot,
  auditRoot = 'docs/wiki-audits',
  wikiRunId,
  manifestHash,
  claimIds = [],
} = {}) {
  const root = resolve(repoRoot, auditRoot);
  assertInsideRepo(repoRoot, root);
  const empty = { result_status: 'ok', blockedClaimIds: [], wholeWikiBlocked: false, issues: [] };
  if (!existsSync(root)) return empty;
  if (typeof wikiRunId !== 'string' || wikiRunId.length === 0 || typeof manifestHash !== 'string' || manifestHash.length === 0) {
    return {
      result_status: 'invalid-wiki',
      blockedClaimIds: [],
      wholeWikiBlocked: true,
      issues: [issue('audit-identity-missing', root, 'current Wiki runId and manifestHash', { wikiRunId, manifestHash })],
    };
  }

  const blocks = [];
  const issues = [];
  try {
    for (const name of readdirSync(root).filter((entry) => /^\d{4}-\d{2}-\d{2}\.md$/.test(entry)).sort()) {
      const path = join(root, name);
      const parsed = parseAuditBlocks(path, readFileSync(path, 'utf8'));
      blocks.push(...parsed.blocks);
      issues.push(...parsed.issues);
    }
  } catch (error) {
    issues.push(issue('audit-malformed', root, 'readable Wiki Audit directory', error.message));
  }
  if (issues.length > 0) {
    return { result_status: 'invalid-wiki', blockedClaimIds: [], wholeWikiBlocked: true, issues };
  }

  const matchingFindings = blocks.filter(({ type, value }) => type === 'finding'
    && value.wikiRunId === wikiRunId
    && value.manifestHash === manifestHash);
  const resolutions = new Map();
  for (const { type, fingerprint, value } of blocks) {
    if (type !== 'resolution') continue;
    if (value.wikiRunId !== wikiRunId || value.manifestHash !== manifestHash) continue;
    const resolvedAt = timestamp(value.resolved_at);
    if (resolvedAt === null) {
      issues.push(issue('audit-malformed', value.path ?? root, 'valid resolution resolved_at', value.resolved_at ?? 'missing'));
      continue;
    }
    resolutions.set(fingerprint, Math.max(resolutions.get(fingerprint) ?? -Infinity, resolvedAt));
  }

  const knownClaimIds = new Set(claimIds);
  const blocked = new Set();
  let wholeWikiBlocked = false;
  for (const { fingerprint, value, path } of matchingFindings) {
    if (value.severity !== 'P0' && value.severity !== 'P1') continue;
    const detectedAt = timestamp(value.last_detected_at);
    if (detectedAt === null) {
      issues.push(issue('audit-malformed', path, 'valid finding last_detected_at', value.last_detected_at ?? 'missing'));
      continue;
    }
    if ((resolutions.get(fingerprint) ?? -Infinity) >= detectedAt) continue;
    if (value.affectedClaimIds === undefined || value.wholeWikiBlocked === true) {
      wholeWikiBlocked = true;
      continue;
    }
    if (!Array.isArray(value.affectedClaimIds) || value.affectedClaimIds.some((id) => typeof id !== 'string' || !knownClaimIds.has(id))) {
      issues.push(issue('audit-malformed', path, 'affectedClaimIds containing current Claim IDs', value.affectedClaimIds));
      continue;
    }
    if (value.affectedClaimIds.length === 0) wholeWikiBlocked = true;
    for (const id of value.affectedClaimIds) blocked.add(id);
  }
  if (issues.length > 0) {
    return { result_status: 'invalid-wiki', blockedClaimIds: [], wholeWikiBlocked: true, issues };
  }

  const blockedClaimIds = [...blocked].sort();
  if (knownClaimIds.size > 0 && blockedClaimIds.length === knownClaimIds.size) wholeWikiBlocked = true;
  return {
    result_status: wholeWikiBlocked ? 'invalid-wiki' : blockedClaimIds.length > 0 ? 'partial' : 'ok',
    blockedClaimIds,
    wholeWikiBlocked,
    issues: [],
  };
}

export function preflightKnowledge({ repoRoot, knowledgeRoot = 'docs/knowledge', explicitOwnership = false, indexFresh = true } = {}) {
  const root = resolve(repoRoot, knowledgeRoot);
  assertInsideRepo(repoRoot, root);
  if (!existsSync(root)) return { result_status: 'not-initialized', managed: false, issues: [] };

  const configPath = join(repoRoot, '.yog/config.json');
  const indexPath = join(root, 'index.json');
  const config = existsSync(configPath) ? readJson(configPath) : { value: null };
  const index = existsSync(indexPath) ? readJson(indexPath) : { value: null };
  const normalizedRoot = slashPath(knowledgeRoot).replace(/^\.\//, '');
  const configOwns = !config.error
    && config.value?.schemaVersion === 1
    && slashPath(config.value?.knowledgeRoot ?? '') === normalizedRoot;
  const indexOwns = !index.error && index.value?.schemaVersion === 1 && index.value?.kind === 'global';
  const managed = explicitOwnership || configOwns || indexOwns;
  if (!managed) return { result_status: 'not-managed', managed: false, issues: [] };

  const issues = [];
  if (existsSync(configPath) && (config.error || config.value?.schemaVersion !== 1 || slashPath(config.value?.knowledgeRoot ?? '') !== normalizedRoot)) {
    issues.push(issue('config-schema-invalid', configPath, `schemaVersion 1 with knowledgeRoot ${normalizedRoot}`, config.error ?? config.value));
  }
  if (!existsSync(indexPath)) issues.push(issue('index-missing', indexPath, 'Yog global index', 'missing'));
  else if (index.error || index.value?.schemaVersion !== 1 || index.value?.kind !== 'global' || !Array.isArray(index.value?.entries)) {
    issues.push(issue('index-schema-invalid', indexPath, 'schemaVersion 1 global index with entries[]', index.error ?? index.value));
  }
  for (const fileName of ['INDEX.md', 'CONTEXT-MAP.md']) {
    const path = join(root, fileName);
    if (!existsSync(path)) issues.push(issue(fileName === 'INDEX.md' ? 'index-markdown-missing' : 'context-map-missing', path, 'existing file', 'missing'));
  }
  if (!indexFresh) issues.push(issue('index-stale', indexPath, 'generated indexes match sources', 'stale'));

  if (issues.length === 0) {
    for (const entry of index.value.entries) {
      if (!entry?.path) continue;
      const referenced = resolve(repoRoot, entry.path);
      try {
        assertInsideRepo(repoRoot, referenced);
      } catch {
        issues.push(issue('broken-reference', indexPath, 'in-repository entry path', entry.path));
        continue;
      }
      if (!existsSync(referenced)) issues.push(issue('broken-reference', indexPath, 'existing entry path', entry.path));
    }
  }

  return issues.length > 0
    ? { result_status: 'invalid-knowledge', managed: true, issues }
    : { result_status: 'ok', managed: true, issues: [] };
}

export function preflightWiki({ repoRoot, wikiRoot = 'docs/wiki', explicitOwnership = false, auditRoot = null, now = new Date() } = {}) {
  const root = resolve(repoRoot, wikiRoot);
  assertInsideRepo(repoRoot, root);
  if (!existsSync(root)) return { result_status: 'unavailable', managed: false, issues: [] };

  const metaRoot = join(root, '_meta');
  const manifestPath = join(metaRoot, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : { value: null };
  const managed = explicitOwnership || (!manifest.error && manifest.value?.managedBy === 'yog:wiki');
  if (!managed) return { result_status: 'not-managed', managed: false, issues: [] };

  const issues = [];
  if (!existsSync(manifestPath)) issues.push(issue('manifest-missing', manifestPath, 'Yog Wiki manifest', 'missing'));
  else if (manifest.error || manifest.value?.schemaVersion !== 1 || manifest.value?.managedBy !== 'yog:wiki'
    || manifest.value?.kind !== 'yog-product-wiki-manifest' || !Array.isArray(manifest.value?.pages)
    || !Array.isArray(manifest.value?.projections)) {
    issues.push(issue('schema-invalid', manifestPath, 'current schemaVersion 1 Yog product Wiki manifest', manifest.error ?? manifest.value));
  }

  const documents = {};
  const catalogPath = join(metaRoot, 'catalog.json');
  const catalog = existsSync(catalogPath) ? readJson(catalogPath) : { value: null };
  documents.catalog = catalog.value;
  documents.systemCatalogs = new Map();
  if (!existsSync(catalogPath)) issues.push(issue('catalog-missing', catalogPath, 'Yog Wiki catalog index', 'missing'));
  else if (catalog.error || catalog.value?.schemaVersion !== 1
    || catalog.value?.kind !== 'yog-product-wiki-catalog-index' || !Array.isArray(catalog.value?.systems)) {
    issues.push(issue('schema-invalid', catalogPath, 'schemaVersion 1 Yog Wiki catalog index with systems[]', catalog.error ?? catalog.value));
  } else {
    const seenCatalogPaths = new Set();
    for (const system of catalog.value.systems) {
      if (typeof system?.catalogPath !== 'string' || !system.catalogPath.startsWith('_meta/catalog/') || seenCatalogPaths.has(system.catalogPath)) {
        issues.push(issue('schema-invalid', catalogPath, 'unique _meta/catalog/<system-id>.json path', system?.catalogPath));
        continue;
      }
      seenCatalogPaths.add(system.catalogPath);
      const path = resolve(root, system.catalogPath);
      try {
        assertInsideRepo(root, path);
      } catch {
        issues.push(issue('broken-reference', catalogPath, 'safe system catalog path', system.catalogPath));
        continue;
      }
      if (!existsSync(path)) {
        issues.push(issue('catalog-shard-missing', path, 'existing system catalog', 'missing'));
        continue;
      }
      const parsed = readJson(path);
      documents.systemCatalogs.set(system.catalogPath, parsed.value);
      if (parsed.error || parsed.value?.schemaVersion !== 1 || parsed.value?.kind !== 'yog-product-wiki-system-catalog'
        || !parsed.value?.system || !Array.isArray(parsed.value?.domains) || !Array.isArray(parsed.value?.modules)
        || !Array.isArray(parsed.value?.entries)) {
        issues.push(issue('schema-invalid', path, 'schemaVersion 1 Yog Wiki system catalog', parsed.error ?? parsed.value));
        continue;
      }
      const actualHash = `sha256:${sha256Text(readFileSync(path, 'utf8'))}`;
      if (system.catalogHash !== actualHash) issues.push(issue('content-hash-mismatch', path, system.catalogHash, actualHash));
    }
  }
  const flowsPath = join(metaRoot, 'flows.json');
  const flows = existsSync(flowsPath) ? readJson(flowsPath) : { value: null };
  documents.flows = flows.value;
  documents.systemFlows = new Map();
  if (!existsSync(flowsPath)) issues.push(issue('flows-missing', flowsPath, 'Yog Wiki Flow index', 'missing'));
  else if (flows.error || flows.value?.schemaVersion !== 1
    || flows.value?.kind !== 'yog-product-wiki-flow-index' || !Array.isArray(flows.value?.systems)) {
    issues.push(issue('schema-invalid', flowsPath, 'schemaVersion 1 Yog Wiki Flow index with systems[]', flows.error ?? flows.value));
  } else {
    const seenFlowPaths = new Set();
    for (const system of flows.value.systems) {
      if (typeof system?.systemRef !== 'string' || !Number.isInteger(system?.flowCount)
        || typeof system?.flowCatalogPath !== 'string' || !system.flowCatalogPath.startsWith('_meta/flows/')
        || seenFlowPaths.has(system.flowCatalogPath)) {
        issues.push(issue('schema-invalid', flowsPath, 'unique System Flow shard pointer', system));
        continue;
      }
      seenFlowPaths.add(system.flowCatalogPath);
      const path = resolve(root, system.flowCatalogPath);
      try {
        assertInsideRepo(root, path);
      } catch {
        issues.push(issue('broken-reference', flowsPath, 'safe System Flow shard path', system.flowCatalogPath));
        continue;
      }
      if (!existsSync(path)) {
        issues.push(issue('flow-shard-missing', path, 'existing System Flow shard', 'missing'));
        continue;
      }
      const parsed = readJson(path);
      documents.systemFlows.set(system.flowCatalogPath, parsed.value);
      if (parsed.error || parsed.value?.schemaVersion !== 1 || parsed.value?.kind !== 'yog-product-wiki-system-flow-index'
        || !parsed.value?.system || !Array.isArray(parsed.value?.entries) || parsed.value.entries.length !== system.flowCount) {
        issues.push(issue('schema-invalid', path, 'schemaVersion 1 System Flow index with matching entries[]', parsed.error ?? parsed.value));
      }
    }
  }
  const reviewsPath = join(metaRoot, 'reviews.json');
  const reviews = existsSync(reviewsPath) ? readJson(reviewsPath) : { value: null };
  documents.reviews = reviews.value;
  documents.systemReviews = new Map();
  if (!existsSync(reviewsPath)) issues.push(issue('reviews-missing', reviewsPath, 'Yog Wiki Review index', 'missing'));
  else if (reviews.error || reviews.value?.schemaVersion !== 1
    || reviews.value?.kind !== 'yog-product-wiki-review-index' || !reviews.value?.counts
    || !Array.isArray(reviews.value?.systems)) {
    issues.push(issue('schema-invalid', reviewsPath, 'schemaVersion 1 Yog Wiki Review index with systems[]', reviews.error ?? reviews.value));
  } else {
    const seenReviewPaths = new Set();
    for (const system of reviews.value.systems) {
      if (typeof system?.ref !== 'string' || !Number.isInteger(system?.reviewItemCount)
        || typeof system?.reviewCatalogPath !== 'string' || !system.reviewCatalogPath.startsWith('_meta/reviews/')
        || seenReviewPaths.has(system.reviewCatalogPath)) {
        issues.push(issue('schema-invalid', reviewsPath, 'unique System Review shard pointer', system));
        continue;
      }
      seenReviewPaths.add(system.reviewCatalogPath);
      const path = resolve(root, system.reviewCatalogPath);
      try {
        assertInsideRepo(root, path);
      } catch {
        issues.push(issue('broken-reference', reviewsPath, 'safe System Review shard path', system.reviewCatalogPath));
        continue;
      }
      if (!existsSync(path)) {
        issues.push(issue('review-shard-missing', path, 'existing System Review shard', 'missing'));
        continue;
      }
      const parsed = readJson(path);
      documents.systemReviews.set(system.reviewCatalogPath, parsed.value);
      if (parsed.error || parsed.value?.schemaVersion !== 1 || parsed.value?.kind !== 'yog-product-wiki-system-review-index'
        || !parsed.value?.system || !Array.isArray(parsed.value?.entries)
        || parsed.value.entries.length !== system.reviewItemCount) {
        issues.push(issue('schema-invalid', path, 'schemaVersion 1 System Review index with matching entries[]', parsed.error ?? parsed.value));
      }
    }
  }
  for (const [name, arrayKey] of [
    ['claims', 'claims'],
    ['evidence', 'evidence'],
    ['relationships', 'relationships'],
    ['state-machines', 'stateMachines'],
  ]) {
    const path = join(metaRoot, `${name}.json`);
    const parsed = existsSync(path) ? readJson(path) : { value: null };
    documents[name] = parsed.value;
    if (!existsSync(path)) issues.push(issue(`${name}-missing`, path, `schemaVersion 1 ${name}`, 'missing'));
    else if (parsed.error || parsed.value?.schemaVersion !== 1 || !Array.isArray(parsed.value?.[arrayKey])) {
      issues.push(issue('schema-invalid', path, `schemaVersion 1 with ${arrayKey}[]`, parsed.error ?? parsed.value));
    }
  }
  const coveragePath = join(metaRoot, 'coverage.json');
  const coverage = existsSync(coveragePath) ? readJson(coveragePath) : { value: null };
  documents.coverage = coverage.value;
  if (!existsSync(coveragePath)) issues.push(issue('coverage-missing', coveragePath, 'schemaVersion 1 coverage projection', 'missing'));
  else if (coverage.error || coverage.value?.schemaVersion !== 1 || !coverage.value?.sourceReadiness
    || !coverage.value?.publication || !coverage.value?.counts) {
    issues.push(issue('schema-invalid', coveragePath, 'schemaVersion 1 coverage projection', coverage.error ?? coverage.value));
  }

  const modelPath = join(metaRoot, 'model.json');
  const model = existsSync(modelPath) ? readJson(modelPath) : { value: null };
  documents.model = model.value;
  if (!existsSync(modelPath)) issues.push(issue('model-missing', modelPath, 'canonical Yog Wiki model', 'missing'));
  else if (model.error || model.value?.schemaVersion !== 1 || model.value?.kind !== 'yog-product-wiki-model'
    || !Array.isArray(model.value?.pages) || !model.value?.catalog || !model.value?.objects
    || !Array.isArray(model.value?.relationships) || !Array.isArray(model.value?.governance?.claims)
    || !Array.isArray(model.value?.governance?.evidence) || !Array.isArray(model.value?.governance?.gaps)
    || !model.value?.sourceSnapshot || !Array.isArray(model.value?.sourceSnapshot?.sources)) {
    issues.push(issue('schema-invalid', modelPath, 'schemaVersion 1 canonical Yog product Wiki model', model.error ?? model.value));
  } else {
    let inputConfirmation = null;
    try {
      inputConfirmation = assertPersistedWikiInputConfirmation({
        outputRoot: resolve(repoRoot),
        wikiRoot,
        inputConfirmation: model.value.inputConfirmation,
      });
    } catch (error) {
      issues.push(issue('input-confirmation-invalid', modelPath, 'confirmed Wiki input summary bound to the current output target', error.message));
    }
    if (inputConfirmation && (JSON.stringify(model.value.sourceSnapshot?.inputConfirmation) !== JSON.stringify(inputConfirmation)
      || JSON.stringify(manifest.value?.inputConfirmation) !== JSON.stringify(inputConfirmation))) {
      issues.push(issue('input-confirmation-mismatch', metaRoot, 'matching input confirmation in model Source Snapshot and Manifest', 'confirmation summaries differ'));
    }
    const actualModelHash = `sha256:${sha256Text(readFileSync(modelPath, 'utf8'))}`;
    if (manifest.value?.modelHash !== actualModelHash) {
      issues.push(issue('model-hash-mismatch', modelPath, manifest.value?.modelHash ?? 'manifest modelHash', actualModelHash));
    }
    const expectedCoverage = {
      schemaVersion: 1,
      sourceReadiness: model.value.sourceReadiness,
      publication: model.value.governance.publication,
      coverage: model.value.governance.coverage,
      counts: {
        systems: model.value.catalog.systems?.length,
        domains: model.value.catalog.domains?.length,
        modules: model.value.catalog.modules?.length,
        features: model.value.catalog.features?.length,
        objects: Object.values(model.value.objects).flat().length,
      },
    };
    let expectedCatalogProjections = [];
    let expectedGapProjections = [];
    let expectedFlowProjections = [];
    let expectedReviewProjections = [];
    let catalogProjectionMismatch = false;
    let flowProjectionMismatch = false;
    let reviewProjectionMismatch = false;
    try {
      expectedCatalogProjections = buildCatalogIndexProjections(model.value);
      expectedGapProjections = buildGapIndexProjections(model.value);
      expectedFlowProjections = buildFlowIndexProjections(model.value);
      expectedReviewProjections = buildReviewIndexProjections(model.value);
      const expectedByPath = new Map(expectedCatalogProjections.map((projection) => [projection.path, projection.value]));
      const actualByPath = new Map([
        ['_meta/catalog.json', documents.catalog],
        ...documents.systemCatalogs,
      ]);
      catalogProjectionMismatch = expectedByPath.size !== actualByPath.size
        || [...expectedByPath].some(([path, value]) => JSON.stringify(stableValue(value)) !== JSON.stringify(stableValue(actualByPath.get(path))));
      const expectedFlowsByPath = new Map(expectedFlowProjections.map((projection) => [projection.path, projection.value]));
      const actualFlowsByPath = new Map([['_meta/flows.json', documents.flows], ...documents.systemFlows]);
      flowProjectionMismatch = expectedFlowsByPath.size !== actualFlowsByPath.size
        || [...expectedFlowsByPath].some(([path, value]) => JSON.stringify(stableValue(value)) !== JSON.stringify(stableValue(actualFlowsByPath.get(path))));
      const expectedReviewsByPath = new Map(expectedReviewProjections.map((projection) => [projection.path, projection.value]));
      const actualReviewsByPath = new Map([['_meta/reviews.json', documents.reviews], ...documents.systemReviews]);
      reviewProjectionMismatch = expectedReviewsByPath.size !== actualReviewsByPath.size
        || [...expectedReviewsByPath].some(([path, value]) => JSON.stringify(stableValue(value)) !== JSON.stringify(stableValue(actualReviewsByPath.get(path))));
    } catch {
      catalogProjectionMismatch = true;
      flowProjectionMismatch = true;
      reviewProjectionMismatch = true;
    }
    if (JSON.stringify(model.value.pages) !== JSON.stringify(manifest.value?.pages)
      || catalogProjectionMismatch
      || flowProjectionMismatch
      || reviewProjectionMismatch
      || JSON.stringify(model.value.governance.claims) !== JSON.stringify(documents.claims?.claims)
      || JSON.stringify(model.value.governance.evidence) !== JSON.stringify(documents.evidence?.evidence)
      || JSON.stringify(model.value.relationships) !== JSON.stringify(documents.relationships?.relationships)
      || JSON.stringify(model.value.objects.stateMachines) !== JSON.stringify(documents['state-machines']?.stateMachines)
      || JSON.stringify(expectedCoverage) !== JSON.stringify(documents.coverage)) {
      issues.push(issue('projection-mismatch', metaRoot, 'Catalog and Flow index shards Claims Evidence Relationships State Machines and Coverage projected from model.json', 'projection differs'));
    }

    const expectedProjectionPaths = new Set([
      '_meta/model.json',
      ...expectedCatalogProjections.map((projection) => projection.path),
      ...expectedGapProjections.map((projection) => projection.path),
      ...expectedFlowProjections.map((projection) => projection.path),
      ...expectedReviewProjections.map((projection) => projection.path),
      '_meta/claims.json',
      '_meta/evidence.json',
      '_meta/relationships.json',
      '_meta/coverage.json',
      '_meta/state-machines.json',
    ]);
    const actualProjectionPaths = new Set(manifest.value?.projections?.map((entry) => entry.path) ?? []);
    if (expectedProjectionPaths.size !== actualProjectionPaths.size
      || [...expectedProjectionPaths].some((path) => !actualProjectionPaths.has(path))) {
      issues.push(issue('projection-set-mismatch', manifestPath, [...expectedProjectionPaths].sort(), [...actualProjectionPaths].sort()));
    }
    for (const projection of manifest.value?.projections ?? []) {
      const path = resolve(root, projection.path ?? '');
      try {
        assertInsideRepo(root, path);
      } catch {
        issues.push(issue('broken-reference', manifestPath, 'safe projection path', projection.path));
        continue;
      }
      if (!projection.path || !existsSync(path)) {
        issues.push(issue('broken-reference', manifestPath, 'existing projection', projection.path ?? 'missing path'));
        continue;
      }
      const actualHash = `sha256:${sha256Text(readFileSync(path))}`;
      if (projection.contentHash !== actualHash) issues.push(issue('projection-hash-mismatch', path, projection.contentHash, actualHash));
    }
  }

  if (issues.length === 0) {
    const pageIds = new Set();
    const managedPagePaths = new Set((manifest.value?.pages ?? []).map((page) => page.path));
    const claimIds = new Set(documents.claims.claims.map((claim) => claim.id));
    const evidenceIds = new Set(documents.evidence.evidence.map((evidence) => evidence.id));
    const gapIds = new Set(documents.model.governance.gaps.map((gap) => gap.id));
    const relationIds = new Set(documents.relationships.relationships.map((relation) => relation.id));
    const objectRefs = new Set([
      ...Object.values(documents.model.catalog).flat(),
      ...Object.values(documents.model.objects).flat(),
    ].map((node) => `${node.kind}:${node.id}`));
    for (const system of documents.catalog.systems) {
      if (!managedPagePaths.has(system.overviewPath)) issues.push(issue('broken-reference', catalogPath, 'managed System overview page', system.overviewPath));
      const shard = documents.systemCatalogs.get(system.catalogPath);
      for (const entry of shard?.entries ?? []) {
        if (!managedPagePaths.has(entry.pagePath)) issues.push(issue('broken-reference', resolve(root, system.catalogPath), 'managed catalog entry page', entry.pagePath));
      }
    }
    for (const system of documents.flows.systems) {
      if (!objectRefs.has(system.systemRef)) issues.push(issue('broken-reference', flowsPath, 'known System ref', system.systemRef));
      const shard = documents.systemFlows.get(system.flowCatalogPath);
      for (const entry of shard?.entries ?? []) {
        if (!objectRefs.has(entry.ref) || !managedPagePaths.has(entry.pagePath)) {
          issues.push(issue('broken-reference', resolve(root, system.flowCatalogPath), 'known Flow ref and managed Flow page', entry));
        }
      }
    }
    for (const system of documents.reviews.systems) {
      if (system.ref !== 'system:shared' && !objectRefs.has(system.ref)) {
        issues.push(issue('broken-reference', reviewsPath, 'known System ref', system.ref));
      }
      const shard = documents.systemReviews.get(system.reviewCatalogPath);
      for (const entry of shard?.entries ?? []) {
        if (!objectRefs.has(entry.featureRef) || !managedPagePaths.has(entry.pagePath)) {
          issues.push(issue('broken-reference', resolve(root, system.reviewCatalogPath), 'known Feature ref and managed Review page', entry));
        }
      }
    }
    for (const page of manifest.value?.pages ?? []) {
      const path = resolve(root, page.path ?? '');
      try {
        assertInsideRepo(root, path);
      } catch {
        issues.push(issue('broken-reference', join(metaRoot, 'catalog.json'), 'safe page path', page.path));
        continue;
      }
      if (!page.path || !existsSync(path)) {
        issues.push(issue('broken-reference', join(metaRoot, 'catalog.json'), 'existing page', page.path ?? 'missing path'));
        continue;
      }
      const actualContentHash = `sha256:${sha256Text(readFileSync(path))}`;
      if (typeof page.contentHash !== 'string' || page.contentHash !== actualContentHash) {
        issues.push(issue('content-hash-mismatch', path, page.contentHash ?? 'page contentHash', actualContentHash));
      }
      try {
        if (isGapMarkdownPath(page.path)) continue;
        const frontmatter = parseFrontmatter(readFileSync(path, 'utf8')).data;
        if (typeof frontmatter.pageId !== 'string' || pageIds.has(frontmatter.pageId)
          || frontmatter.generatedBy !== 'yog:wiki' || !Array.isArray(frontmatter.subjectRefs)) {
          issues.push(issue('identity-mismatch', path, 'unique pageId, generatedBy yog:wiki, and subjectRefs[]', frontmatter));
        } else pageIds.add(frontmatter.pageId);
        for (const ref of frontmatter.subjectRefs ?? []) if (!objectRefs.has(ref)) issues.push(issue('broken-reference', path, 'existing subject ref', ref));
        for (const id of frontmatter.claimIds ?? []) if (!claimIds.has(id)) issues.push(issue('broken-reference', path, 'existing claim id', id));
        for (const id of frontmatter.evidenceIds ?? []) if (!evidenceIds.has(id)) issues.push(issue('broken-reference', path, 'existing evidence id', id));
      } catch (error) {
        issues.push(issue('identity-mismatch', path, 'valid current Yog page frontmatter', error.message));
      }
    }
    for (const claim of documents.claims.claims) {
      for (const id of claim.evidenceIds ?? []) if (!evidenceIds.has(id)) issues.push(issue('broken-reference', join(metaRoot, 'claims.json'), 'existing evidence id', id));
      if (!objectRefs.has(claim.subjectRef)) issues.push(issue('broken-reference', join(metaRoot, 'claims.json'), 'existing claim subject ref', claim.subjectRef));
      if (!['confirmed', 'partial', 'needs-review'].includes(claim.factLevel)) issues.push(issue('schema-invalid', join(metaRoot, 'claims.json'), 'registered factLevel', claim.factLevel));
    }
    for (const relation of documents.relationships.relationships) {
      if (!objectRefs.has(relation.from) || !objectRefs.has(relation.to)) issues.push(issue('broken-reference', join(metaRoot, 'relationships.json'), 'existing relationship endpoints', relation));
      for (const id of relation.claimIds ?? []) if (!claimIds.has(id)) issues.push(issue('broken-reference', join(metaRoot, 'relationships.json'), 'existing claim id', id));
      for (const id of relation.evidenceIds ?? []) if (!evidenceIds.has(id)) issues.push(issue('broken-reference', join(metaRoot, 'relationships.json'), 'existing evidence id', id));
    }
    for (const node of [...Object.values(documents.model.catalog).flat(), ...Object.values(documents.model.objects).flat()]) {
      for (const id of node.claimIds ?? []) if (!claimIds.has(id)) issues.push(issue('broken-reference', modelPath, 'existing claim id', id));
      for (const id of node.evidenceIds ?? []) if (!evidenceIds.has(id)) issues.push(issue('broken-reference', modelPath, 'existing evidence id', id));
      for (const id of node.gapIds ?? []) if (!gapIds.has(id)) issues.push(issue('broken-reference', modelPath, 'existing gap id', id));
      for (const id of node.relationRefs ?? []) if (!relationIds.has(id)) issues.push(issue('broken-reference', modelPath, 'existing relationship id', id));
    }
  }

  if (issues.length > 0) return { result_status: 'invalid-wiki', managed: true, issues };
  const nowValue = now instanceof Date ? now : new Date(now);
  const staleSourceIds = new Set(documents.model.sourceSnapshot.sources
    .filter((source) => source.expiresAt && Date.parse(source.expiresAt) < nowValue.getTime())
    .map((source) => source.sourceId));
  const staleEvidenceIds = new Set(documents.model.governance.evidence
    .filter((item) => staleSourceIds.has(item.sourceId))
    .map((item) => item.id));
  const freshnessBlockedClaimIds = documents.model.governance.claims
    .filter((claim) => claim.evidenceIds.some((id) => staleEvidenceIds.has(id)))
    .map((claim) => claim.id);
  const auditGate = auditRoot !== null
    ? evaluateWikiAuditGate({
      repoRoot,
      auditRoot,
      wikiRunId: manifest.value.runId,
      manifestHash: `sha256:${sha256Text(readFileSync(manifestPath, 'utf8'))}`,
      claimIds: documents.claims.claims.map((claim) => claim.id),
    })
    : { result_status: 'ok', blockedClaimIds: [], wholeWikiBlocked: false, issues: [] };
  if (auditGate.result_status === 'invalid-wiki' && auditGate.wholeWikiBlocked) {
    return { ...auditGate, managed: true, sourceSnapshot: documents.model.sourceSnapshot, staleSourceIds: [...staleSourceIds].sort() };
  }
  const blockedClaimIds = [...new Set([...auditGate.blockedClaimIds, ...freshnessBlockedClaimIds])].sort();
  const wholeWikiBlocked = documents.claims.claims.length > 0 && blockedClaimIds.length === documents.claims.claims.length;
  return {
    result_status: wholeWikiBlocked ? 'invalid-wiki' : blockedClaimIds.length > 0 ? 'partial' : 'ok',
    managed: true,
    blockedClaimIds,
    wholeWikiBlocked,
    issues: auditGate.issues,
    sourceSnapshot: documents.model.sourceSnapshot,
    staleSourceIds: [...staleSourceIds].sort(),
  };
}

export function filterKnowledgeDocuments(documents = []) {
  const allowed = [];
  const rejected = [];
  for (const document of documents) {
    const kind = document.kind ?? 'document';
    const status = document.status;
    const accepted = status === 'verified'
      || status === 'draft'
      || (kind === 'context' && document.confirmed === true)
      || (kind === 'adr' && status === 'accepted');
    (accepted ? allowed : rejected).push(document);
  }
  return { allowed, rejected, result_status: allowed.length > 0 ? (allowed.some((item) => item.status === 'draft') ? 'partial' : 'ok') : 'not-found' };
}

export function filterWikiFacts(facts = []) {
  const allowed = facts.filter((fact) => {
    const level = fact.factLevel ?? fact.fact_level;
    return level === 'confirmed' || level === 'partial';
  });
  const rejected = facts.filter((fact) => !allowed.includes(fact));
  return { allowed, rejected, result_status: allowed.length > 0 ? (allowed.some((fact) => (fact.factLevel ?? fact.fact_level) === 'partial') ? 'partial' : 'ok') : 'not-found' };
}

export function evaluateCodeGraphCoverage({
  provider,
  queryOk = false,
  repoIdentityMatch = false,
  graphRevision,
  headRevision,
  relevantDirtyPaths = [],
  liveWorktreeCovered = false,
} = {}) {
  const provider_config_status = provider?.type === 'codegraph' && provider?.status === 'configured' ? 'configured' : 'not-configured';
  let coverage_status = 'covered';
  if (provider_config_status !== 'configured' || !queryOk || !repoIdentityMatch) coverage_status = 'not-covered';
  else if (!graphRevision || !headRevision) coverage_status = 'unknown';
  else if (graphRevision !== headRevision) coverage_status = 'not-covered';
  else if (relevantDirtyPaths.length > 0 && !liveWorktreeCovered) coverage_status = 'not-covered';
  return {
    provider_config_status,
    query_status: queryOk ? 'ok' : 'failed',
    repo_identity_match: repoIdentityMatch,
    graph_revision: graphRevision ?? null,
    head_revision: headRevision ?? null,
    relevant_dirty_paths: relevantDirtyPaths,
    coverage_status,
  };
}

export function classifyMismatch({ coverageStatus, directConflict = false, changeSignal = false, edgeIdentityClear = true } = {}) {
  if (coverageStatus !== 'covered' || !edgeIdentityClear) return 'insufficient-evidence';
  if (directConflict) return 'confirmed-conflict';
  if (changeSignal) return 'possible-stale';
  return null;
}

export function queryResultStatus({ terminalStatus, usedDraft = false, usedPartialFact = false, mismatchType = null, coverageStatus = 'covered', scopeTruncated = false, answeredPartially = false } = {}) {
  if (terminalStatus) {
    if (!TERMINAL_STATUSES.has(terminalStatus)) throw new Error(`Unknown terminal query status: ${terminalStatus}`);
    return terminalStatus;
  }
  return usedDraft || usedPartialFact || mismatchType || coverageStatus !== 'covered' || scopeTruncated || answeredPartially ? 'partial' : 'ok';
}

export function combineQueryResults(wikiStatus, knowledgeStatus) {
  const usable = (status) => status === 'ok' || status === 'partial';
  if (wikiStatus === 'ok' && knowledgeStatus === 'ok') return 'ok';
  if (usable(wikiStatus) || usable(knowledgeStatus)) return 'partial';
  return 'failed';
}

function auditFrontmatter({ reportType, period, wikiRoot }) {
  const lines = ['---', `report_type: ${reportType}`, `generated_at: "${new Date().toISOString()}"`, `period: "${period}"`];
  if (wikiRoot) lines.push(`wiki_root: "${wikiRoot}"`);
  lines.push(`status: ${reportType === 'wiki-integrity-audit' ? 'invalid' : 'draft'}`, '---', '');
  if (reportType === 'wiki-integrity-audit') {
    lines.push(
      '## 执行边界',
      '',
      '- 未扫描 Wiki 页面。',
      '- 未生成 Wiki。',
      '- 未修改 `docs/wiki` 源文件。',
      '- 未输出产品结论。',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

function blockPattern(type, fingerprint) {
  return new RegExp(`<!-- yog:audit:${type}:${fingerprint} -->[\\s\\S]*?<!-- /yog:audit:${type} -->`, 'm');
}

function renderBlock(type, id, fingerprint, value) {
  return [
    `<!-- yog:audit:${type}:${fingerprint} -->`,
    `### ${id}`,
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
    `<!-- /yog:audit:${type} -->`,
  ].join('\n');
}

function parseExistingBlock(content, type, fingerprint) {
  const match = content.match(blockPattern(type, fingerprint));
  if (!match) return null;
  const json = match[0].match(/```json\n([\s\S]*?)\n```/);
  if (!json) return null;
  try { return JSON.parse(json[1]); } catch { return null; }
}

function insertOrReplace(content, heading, type, id, fingerprint, value) {
  const block = renderBlock(type, id, fingerprint, value);
  const pattern = blockPattern(type, fingerprint);
  if (pattern.test(content)) return content.replace(pattern, block);
  if (!content.includes(`## ${heading}`)) return `${content.trimEnd()}\n\n## ${heading}\n\n${block}\n`;
  const headingLine = `## ${heading}`;
  const headingStart = content.indexOf(headingLine);
  const nextSection = content.indexOf('\n## ', headingStart + headingLine.length);
  const insertionPoint = nextSection === -1 ? content.length : nextSection;
  const before = content.slice(0, insertionPoint).trimEnd();
  const after = content.slice(insertionPoint).trimStart();
  return `${before}\n\n${block}\n${after ? `\n${after}` : ''}`;
}

function normalizeFinding(finding, existing, now, commit, prefix) {
  const fingerprint = finding.fingerprint ?? sha256Fingerprint({
    type: finding.type ?? finding.code,
    affectedObject: finding.affectedObject ?? finding.path,
    expected: finding.expected,
    actual: finding.actual,
  });
  const id = finding.finding_id ?? finding.issue_id ?? `${prefix}-${fingerprint.slice(0, 12)}`;
  return {
    ...finding,
    fingerprint,
    [prefix === 'DRIFT' ? 'finding_id' : 'issue_id']: id,
    first_detected_at: existing?.first_detected_at ?? finding.first_detected_at ?? now,
    last_detected_at: now,
    occurrence_count: (existing?.occurrence_count ?? 0) + 1,
    first_seen_commit: existing?.first_seen_commit ?? finding.first_seen_commit ?? commit ?? null,
    last_seen_commit: finding.last_seen_commit ?? commit ?? null,
  };
}

export function writeDailyAudit({
  repoRoot,
  auditRoot,
  reportType,
  period,
  findings = [],
  resolutions = [],
  commit = null,
  wikiRoot = null,
} = {}) {
  if (!repoRoot || !auditRoot || !reportType) throw new Error('repoRoot, auditRoot, and reportType are required.');
  const day = period ?? new Date().toISOString().slice(0, 10);
  const auditPath = resolve(repoRoot, auditRoot, `${day}.md`);
  assertInsideRepo(repoRoot, auditPath);
  mkdirSync(dirname(auditPath), { recursive: true });
  const lockPath = `${auditPath}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, 'wx');
  } catch {
    const error = new Error('Audit file is being updated by another process.');
    error.code = 'audit-concurrent-update';
    throw error;
  }

  const original = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : null;
  let content = original ?? auditFrontmatter({ reportType, period: day, wikiRoot });
  const now = new Date().toISOString();
  const written = [];
  try {
    for (const finding of findings) {
      const provisionalFingerprint = finding.fingerprint ?? sha256Fingerprint({
        type: finding.type ?? finding.code,
        affectedObject: finding.affectedObject ?? finding.path,
        expected: finding.expected,
        actual: finding.actual,
      });
      const existing = parseExistingBlock(content, 'finding', provisionalFingerprint);
      const prefix = finding.finding_id || finding.type === 'drift'
        ? 'DRIFT'
        : reportType === 'wiki-integrity-audit' ? 'WINT' : 'KINT';
      const normalized = normalizeFinding(finding, existing, now, commit, prefix);
      const id = normalized.finding_id ?? normalized.issue_id;
      const heading = prefix === 'DRIFT' ? '代码一致性检测' : '结构完整性检测';
      content = insertOrReplace(content, heading, 'finding', id, normalized.fingerprint, normalized);
      written.push({ type: 'finding', id, fingerprint: normalized.fingerprint });
    }
    for (const resolution of resolutions) {
      if (!resolution.fingerprint) throw new Error('Resolution fingerprint is required.');
      const existing = parseExistingBlock(content, 'resolution', resolution.fingerprint);
      const id = existing?.resolution_id ?? resolution.resolution_id ?? `RES-${resolution.fingerprint.slice(0, 12)}`;
      const normalized = {
        ...resolution,
        resolution_id: id,
        resolved_at: existing?.resolved_at ?? resolution.resolved_at ?? now,
        resolved_commit: resolution.resolved_commit ?? existing?.resolved_commit ?? commit,
      };
      content = insertOrReplace(content, 'Resolutions', 'resolution', id, resolution.fingerprint, normalized);
      written.push({ type: 'resolution', id, fingerprint: resolution.fingerprint });
    }

    const temporary = `${auditPath}.tmp-${process.pid}`;
    try {
      writeFileSync(temporary, content);
      if (original !== null && readFileSync(auditPath, 'utf8') !== original) {
        const error = new Error('Audit file changed during update.');
        error.code = 'audit-concurrent-update';
        throw error;
      }
      renameSync(temporary, auditPath);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  } finally {
    if (lock !== undefined) closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
  return { persisted: true, path: slashPath(auditPath.slice(resolve(repoRoot).length + 1)), period: day, written };
}
