import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { isGapMarkdownPath } from './wiki-gap.mjs';
import { buildProductWiki, projectProductWikiModel, publishProductWiki } from './wiki.mjs';

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function lifecycleError(code, message, path = '$', issues = null) {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  if (issues) error.issues = issues;
  return error;
}

function inside(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return absolute;
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw lifecycleError(code, `Invalid JSON at ${path}: ${error.message}`, path);
  }
}

function finding(identity, { code, message, path, expected, actual, severity = 'P1', affectedClaimIds = null }) {
  const result = {
    type: 'wiki-integrity',
    severity,
    code,
    message,
    path,
    expected,
    actual,
    wikiRunId: identity.wikiRunId,
    manifestHash: identity.manifestHash,
    sourceSnapshotId: identity.sourceSnapshotId,
    ...(affectedClaimIds ? { affectedClaimIds: [...new Set(affectedClaimIds)].sort() } : { wholeWikiBlocked: true }),
  };
  return { ...result, fingerprint: sha256(JSON.stringify(result)) };
}

function readManagedWiki(input) {
  if (!input || typeof input !== 'object') throw lifecycleError('wiki-lifecycle-input-invalid', 'Input must be an object.');
  if (typeof input.outputRoot !== 'string' || !isAbsolute(input.outputRoot) || !existsSync(input.outputRoot) || !statSync(input.outputRoot).isDirectory()) {
    throw lifecycleError('wiki-output-root-invalid', 'outputRoot must be an existing absolute directory.', '$.outputRoot');
  }
  const outputRoot = resolve(input.outputRoot);
  const wikiRoot = input.wikiRoot ?? 'docs/wiki';
  const root = inside(outputRoot, wikiRoot);
  if (!root) throw lifecycleError('wiki-path-invalid', 'wikiRoot escapes outputRoot.', '$.wikiRoot');
  const manifestPath = join(root, '_meta', 'manifest.json');
  const modelPath = join(root, '_meta', 'model.json');
  if (!existsSync(manifestPath) || !existsSync(modelPath)) throw lifecycleError('wiki-canonical-model-missing', 'Manifest or canonical model is missing.', '_meta');
  const manifestContent = readFileSync(manifestPath, 'utf8');
  const modelContent = readFileSync(modelPath, 'utf8');
  const manifest = readJson(manifestPath, 'wiki-manifest-invalid');
  const model = readJson(modelPath, 'wiki-model-invalid');
  if (manifest.schemaVersion !== 1 || manifest.managedBy !== 'yog:wiki' || manifest.kind !== 'yog-product-wiki-manifest'
    || model.schemaVersion !== 1 || model.kind !== 'yog-product-wiki-model') {
    throw lifecycleError('wiki-schema-invalid', 'Wiki does not use the current Yog product Wiki contract.', '_meta');
  }
  return { outputRoot, wikiRoot, root, manifestPath, modelPath, manifestContent, modelContent, manifest, model };
}

function pageContents(state) {
  const pages = new Map();
  for (const page of state.manifest.pages ?? []) {
    const absolute = inside(state.root, page.path);
    if (!absolute || !existsSync(absolute)) throw lifecycleError('wiki-page-missing', `Missing page: ${page.path}.`, page.path);
    pages.set(page.path, readFileSync(absolute, 'utf8'));
  }
  return pages;
}

function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(join(root, entry.name), path));
    else files.push(path);
  }
  return files.sort();
}

function affectedClaimsForEvidence(model, evidenceId) {
  return model.governance.claims.filter((claim) => claim.evidenceIds.includes(evidenceId)).map((claim) => claim.id).sort();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function nodesByRef(model) {
  return new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
}

function changedIds(oldItems, newItems) {
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  const newById = new Map(newItems.map((item) => [item.id, item]));
  return [...new Set([...oldById.keys(), ...newById.keys()])]
    .filter((id) => !same(oldById.get(id), newById.get(id)));
}

function changedObjectRefs(oldModel, newModel) {
  const oldNodes = nodesByRef(oldModel);
  const newNodes = nodesByRef(newModel);
  const refs = new Set([...oldNodes.keys(), ...newNodes.keys()]);
  const changed = new Set([...refs].filter((ref) => !same(oldNodes.get(ref), newNodes.get(ref))));

  const oldClaims = new Map(oldModel.governance.claims.map((claim) => [claim.id, claim]));
  const newClaims = new Map(newModel.governance.claims.map((claim) => [claim.id, claim]));
  for (const id of changedIds(oldModel.governance.claims, newModel.governance.claims)) {
    if (oldClaims.get(id)?.subjectRef) changed.add(oldClaims.get(id).subjectRef);
    if (newClaims.get(id)?.subjectRef) changed.add(newClaims.get(id).subjectRef);
  }

  const changedEvidenceIds = new Set(changedIds(oldModel.governance.evidence, newModel.governance.evidence));
  if (changedEvidenceIds.size > 0) {
    for (const claim of [...oldModel.governance.claims, ...newModel.governance.claims]) {
      if (claim.evidenceIds.some((id) => changedEvidenceIds.has(id))) changed.add(claim.subjectRef);
    }
  }

  const oldGaps = new Map(oldModel.governance.gaps.map((gap) => [gap.id, gap]));
  const newGaps = new Map(newModel.governance.gaps.map((gap) => [gap.id, gap]));
  for (const id of changedIds(oldModel.governance.gaps, newModel.governance.gaps)) {
    for (const ref of oldGaps.get(id)?.subjectRefs ?? []) changed.add(ref);
    for (const ref of newGaps.get(id)?.subjectRefs ?? []) changed.add(ref);
  }

  const oldReviews = new Map((oldModel.governance.reviewItems ?? []).map((item) => [item.id, item]));
  const newReviews = new Map((newModel.governance.reviewItems ?? []).map((item) => [item.id, item]));
  for (const id of changedIds(oldModel.governance.reviewItems ?? [], newModel.governance.reviewItems ?? [])) {
    const oldItem = oldReviews.get(id);
    const newItem = newReviews.get(id);
    if (oldItem?.featureRef) changed.add(oldItem.featureRef);
    if (newItem?.featureRef) changed.add(newItem.featureRef);
    for (const ref of oldItem?.subjectRefs ?? []) changed.add(ref);
    for (const ref of newItem?.subjectRefs ?? []) changed.add(ref);
  }

  const oldRelations = new Map(oldModel.relationships.map((relation) => [relation.id, relation]));
  const newRelations = new Map(newModel.relationships.map((relation) => [relation.id, relation]));
  for (const id of changedIds(oldModel.relationships, newModel.relationships)) {
    const oldRelation = oldRelations.get(id);
    const newRelation = newRelations.get(id);
    if (oldRelation) {
      changed.add(oldRelation.from);
      changed.add(oldRelation.to);
    }
    if (newRelation) {
      changed.add(newRelation.from);
      changed.add(newRelation.to);
    }
  }
  return changed;
}

function objectReferences(value, knownRefs, refs = new Set()) {
  if (typeof value === 'string') {
    if (knownRefs.has(value)) refs.add(value);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) objectReferences(item, knownRefs, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) objectReferences(item, knownRefs, refs);
  }
  return refs;
}

function transitiveImpactRefs(changedRefs, relationships, nodes) {
  const impacted = new Set(changedRefs);
  const knownRefs = new Set(nodes.keys());
  const references = new Map([...nodes].map(([ref, node]) => [ref, objectReferences(node, knownRefs)]));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const relation of relationships) {
      const candidates = relation.type === 'contains'
        ? (impacted.has(relation.to) ? [relation.from] : [])
        : [
            ...(impacted.has(relation.from) ? [relation.to] : []),
            ...(impacted.has(relation.to) ? [relation.from] : []),
          ];
      for (const ref of candidates) {
        if (impacted.has(ref)) continue;
        impacted.add(ref);
        expanded = true;
      }
    }
    for (const [ref, node] of nodes) {
      const candidates = [];
      if ([...(references.get(ref) ?? [])].some((target) => impacted.has(target))) candidates.push(ref);
      if (impacted.has(ref)) candidates.push(...(node.subjectRefs ?? []));
      for (const candidate of candidates) {
        if (!knownRefs.has(candidate) || impacted.has(candidate)) continue;
        impacted.add(candidate);
        expanded = true;
      }
    }
  }
  return impacted;
}

function pagePathsBySubject(pageMap) {
  const paths = new Map();
  for (const [path, content] of pageMap) {
    try {
      const refs = parseFrontmatter(content).data.subjectRefs;
      for (const ref of Array.isArray(refs) ? refs : []) {
        if (!paths.has(ref)) paths.set(ref, new Set());
        paths.get(ref).add(path);
      }
    } catch {
      // Verify reports identity errors; update still keeps byte-level comparison available.
    }
  }
  return paths;
}

function calculateUpdateImpact(current, build, oldPages, newPages) {
  const changedRefs = changedObjectRefs(current.model, build.model);
  const relationships = [...new Map([...current.model.relationships, ...build.model.relationships]
    .map((relation) => [relation.id, relation])).values()];
  const oldNodes = nodesByRef(current.model);
  const newNodes = nodesByRef(build.model);
  const nodes = new Map([...oldNodes, ...newNodes]);
  const impactRefs = transitiveImpactRefs(changedRefs, relationships, nodes);
  const pathsByRef = new Map();
  for (const mapping of [pagePathsBySubject(oldPages), pagePathsBySubject(newPages)]) {
    for (const [ref, paths] of mapping) {
      if (!pathsByRef.has(ref)) pathsByRef.set(ref, new Set());
      for (const path of paths) pathsByRef.get(ref).add(path);
    }
  }
  const affected = new Set();
  for (const ref of impactRefs) for (const path of pathsByRef.get(ref) ?? []) affected.add(path);
  if (changedRefs.size > 0
    || !same(current.model.sourceReadiness, build.model.sourceReadiness)
    || !same(current.model.sourceSnapshot, build.model.sourceSnapshot)
    || !same(current.model.governance.coverage, build.model.governance.coverage)
    || !same(current.model.governance.publication, build.model.governance.publication)) {
    affected.add('质量治理/目录覆盖与质量报告.md');
  }
  if (!same(current.model.governance.gaps, build.model.governance.gaps)) {
    for (const path of new Set([...oldPages.keys(), ...newPages.keys()])) if (isGapMarkdownPath(path)) affected.add(path);
  }
  return { affected, impactRefs: [...impactRefs].sort() };
}

export function verifyProductWiki(input) {
  const state = readManagedWiki(input);
  const identity = {
    wikiRunId: state.manifest.runId ?? state.model.runId ?? 'unknown',
    manifestHash: sha256(state.manifestContent),
    sourceSnapshotId: state.manifest.sourceSnapshotId ?? state.model.sourceSnapshot?.id ?? 'unknown',
  };
  const findings = [];
  if (state.manifest.modelHash !== sha256(state.modelContent)) findings.push(finding(identity, {
    code: 'wiki-model-hash-mismatch', message: 'Canonical model hash does not match Manifest.', path: '_meta/model.json', expected: state.manifest.modelHash, actual: sha256(state.modelContent), severity: 'P0',
  }));
  const pages = pageContents(state);
  for (const page of state.manifest.pages ?? []) {
    const content = pages.get(page.path);
    const actualHash = sha256(content);
    if (page.contentHash !== actualHash) findings.push(finding(identity, {
      code: 'wiki-page-hash-mismatch', message: `Page hash mismatch: ${page.path}.`, path: page.path, expected: page.contentHash, actual: actualHash, severity: 'P0',
    }));
    try {
      const modelPage = state.model.pages.find((item) => item.path === page.path);
      if (isGapMarkdownPath(page.path)) {
        if (modelPage?.contentHash !== page.contentHash) findings.push(finding(identity, {
          code: 'wiki-page-identity-mismatch', message: `Gap Markdown identity is inconsistent: ${page.path}.`, path: page.path, expected: 'matching model page hash', actual: modelPage, severity: 'P0',
        }));
        continue;
      }
      const parsed = parseFrontmatter(content);
      if (!parsed.data.pageId || parsed.data.generatedBy !== 'yog:wiki' || modelPage?.contentHash !== page.contentHash) findings.push(finding(identity, {
        code: 'wiki-page-identity-mismatch', message: `Page identity is inconsistent: ${page.path}.`, path: page.path, expected: 'generatedBy yog:wiki and matching model page hash', actual: parsed.data, severity: 'P0',
      }));
    } catch (error) {
      findings.push(finding(identity, { code: 'wiki-page-frontmatter-invalid', message: error.message, path: page.path, expected: 'valid Yog page frontmatter', actual: 'invalid', severity: 'P0' }));
    }
  }
  let projected;
  try {
    projected = projectProductWikiModel(state.model, { outputRoot: state.outputRoot, wikiRoot: state.wikiRoot });
  } catch (error) {
    findings.push(finding(identity, { code: error.code ?? 'wiki-projection-invalid', message: error.message, path: error.path ?? '_meta', expected: 'valid deterministic projection', actual: 'projection failed', severity: 'P0' }));
  }
  if (projected) {
    const projectedByPath = new Map(projected.files.map((file) => [file.path, file.content]));
    const expectedPagePaths = new Set(projected.manifest.pages.map((page) => page.path));
    const actualPagePaths = new Set((state.manifest.pages ?? []).map((page) => page.path));
    const expectedProjectionPaths = new Set(projected.manifest.projections.map((projection) => projection.path));
    const actualProjectionPaths = new Set((state.manifest.projections ?? []).map((projection) => projection.path));
    if (!same(state.manifest, projected.manifest)) findings.push(finding(identity, {
      code: 'wiki-manifest-projection-drift', message: 'Manifest does not match the canonical model projection.', path: '_meta/manifest.json', expected: projected.manifest, actual: state.manifest, severity: 'P0',
    }));
    const expectedFiles = projected.files.map((file) => file.path).sort();
    const actualFiles = listFiles(state.root);
    if (!same(actualFiles, expectedFiles)) findings.push(finding(identity, {
      code: 'wiki-managed-files-mismatch', message: 'Wiki files do not match the canonical managed-file set.', path: state.wikiRoot, expected: expectedFiles, actual: actualFiles, severity: 'P0',
    }));
    if (expectedPagePaths.size !== actualPagePaths.size || [...expectedPagePaths].some((path) => !actualPagePaths.has(path))) findings.push(finding(identity, {
      code: 'wiki-page-set-mismatch', message: 'Manifest page set does not match the canonical projection.', path: '_meta/manifest.json', expected: [...expectedPagePaths].sort(), actual: [...actualPagePaths].sort(), severity: 'P0',
    }));
    if (expectedProjectionPaths.size !== actualProjectionPaths.size || [...expectedProjectionPaths].some((path) => !actualProjectionPaths.has(path))) findings.push(finding(identity, {
      code: 'wiki-projection-set-mismatch', message: 'Manifest projection set does not match the canonical projection.', path: '_meta/manifest.json', expected: [...expectedProjectionPaths].sort(), actual: [...actualProjectionPaths].sort(), severity: 'P0',
    }));
    for (const page of projected.manifest.pages) {
      const expectedContent = projectedByPath.get(page.path);
      const actualContent = pages.get(page.path);
      if (expectedContent !== actualContent) findings.push(finding(identity, {
        code: 'wiki-page-projection-drift', message: `Page is not the current deterministic projection: ${page.path}.`, path: page.path, expected: sha256(expectedContent), actual: actualContent === undefined ? 'missing' : sha256(actualContent), severity: 'P0',
      }));
    }
    for (const projection of state.manifest.projections ?? []) {
      const absolute = inside(state.root, projection.path);
      const expectedContent = projectedByPath.get(projection.path);
      if (!absolute || !existsSync(absolute) || expectedContent === undefined) findings.push(finding(identity, {
        code: 'wiki-projection-missing', message: `Projection is missing: ${projection.path}.`, path: projection.path, expected: 'deterministic projection', actual: 'missing', severity: 'P0',
      }));
      else if (readFileSync(absolute, 'utf8') !== expectedContent) findings.push(finding(identity, {
        code: 'wiki-projection-drift', message: `Projection drift: ${projection.path}.`, path: projection.path, expected: sha256(expectedContent), actual: sha256(readFileSync(absolute, 'utf8')), severity: 'P0',
      }));
      else if (projection.contentHash !== sha256(expectedContent)) findings.push(finding(identity, {
        code: 'wiki-projection-hash-mismatch', message: `Projection hash mismatch: ${projection.path}.`, path: projection.path, expected: sha256(expectedContent), actual: projection.contentHash, severity: 'P0',
      }));
    }
    if (state.manifest.sourceSnapshotId !== state.model.sourceSnapshot.id
      || state.manifest.sourceReadiness !== state.model.sourceReadiness.status
      || JSON.stringify(state.manifest.inputConfirmation) !== JSON.stringify(state.model.inputConfirmation)
      || JSON.stringify(state.model.sourceSnapshot?.inputConfirmation) !== JSON.stringify(state.model.inputConfirmation)
      || JSON.stringify(state.manifest.publication) !== JSON.stringify(state.model.governance.publication)) findings.push(finding(identity, {
      code: 'wiki-manifest-model-mismatch', message: 'Manifest source or publication summary differs from the canonical model.', path: '_meta/manifest.json', expected: {
        sourceSnapshotId: state.model.sourceSnapshot.id,
        sourceReadiness: state.model.sourceReadiness.status,
        inputConfirmation: state.model.inputConfirmation,
        publication: state.model.governance.publication,
      }, actual: {
        sourceSnapshotId: state.manifest.sourceSnapshotId,
        sourceReadiness: state.manifest.sourceReadiness,
        inputConfirmation: state.manifest.inputConfirmation,
        publication: state.manifest.publication,
      }, severity: 'P0',
    }));
  }
  const now = input.now ? new Date(input.now) : new Date();
  for (const source of state.model.sourceSnapshot?.sources ?? []) {
    if (source.expiresAt && Date.parse(source.expiresAt) < now.getTime()) {
      const evidenceIds = state.model.governance.evidence.filter((item) => item.sourceId === source.sourceId).map((item) => item.id);
      findings.push(finding(identity, {
        code: 'wiki-source-stale', message: `Source snapshot is stale: ${source.sourceId}.`, path: `_meta/sourceSnapshot/${source.sourceId}`, expected: source.expiresAt, actual: now.toISOString(), affectedClaimIds: evidenceIds.flatMap((id) => affectedClaimsForEvidence(state.model, id)),
      }));
    }
  }
  for (const expected of input.sourceSnapshots ?? []) {
    const actual = state.model.sourceSnapshot?.sources?.find((source) => source.sourceId === expected.sourceId);
    if (!actual || (expected.sourceRevision && actual.sourceRevision !== expected.sourceRevision) || (expected.fingerprint && actual.fingerprint !== expected.fingerprint)) findings.push(finding(identity, {
      code: 'wiki-source-snapshot-mismatch', message: `Source snapshot mismatch: ${expected.sourceId}.`, path: `_meta/sourceSnapshot/${expected.sourceId}`, expected, actual: actual ?? 'missing',
    }));
  }
  return {
    ok: findings.length === 0,
    result_status: findings.length === 0 ? 'valid' : 'invalid-wiki',
    runId: state.model.runId,
    wikiRoot: state.wikiRoot,
    findings,
    issues: findings,
  };
}

export function updateProductWiki(input, options = {}) {
  const current = readManagedWiki(input);
  const preflight = verifyProductWiki({
    outputRoot: current.outputRoot,
    wikiRoot: current.wikiRoot,
    now: current.model.generatedAt,
  });
  if (!preflight.ok) throw lifecycleError('wiki-maintenance-preflight-invalid', 'Current Wiki failed update integrity preflight.', '_meta', preflight.findings);
  const oldPages = pageContents(current);
  const build = buildProductWiki(input);
  const newPages = new Map(build.files.filter((file) => file.path.endsWith('.md')).map((file) => [file.path, file.content]));
  const impact = calculateUpdateImpact(current, build, oldPages, newPages);
  for (const path of new Set([...oldPages.keys(), ...newPages.keys()])) {
    if (oldPages.get(path) !== newPages.get(path)) impact.affected.add(path);
  }
  const affectedPages = [...impact.affected].sort();
  const unaffectedPages = [...newPages.keys()].filter((path) => !impact.affected.has(path) && oldPages.get(path) === newPages.get(path)).sort();
  const result = publishProductWiki(build, options);
  return { ...result, affectedPages, unaffectedPages, impactRefs: impact.impactRefs };
}

export function syncProductWiki(input, options = {}) {
  const state = readManagedWiki(input);
  const preflight = verifyProductWiki(input);
  if (!preflight.ok) throw lifecycleError('wiki-maintenance-preflight-invalid', 'Current Wiki failed sync integrity and freshness preflight.', '_meta', preflight.findings);
  const pages = pageContents(state);
  const nextModel = {
    ...state.model,
    runId: input.runId ?? state.model.runId,
    generatedAt: input.generatedAt ?? state.model.generatedAt,
  };
  const build = projectProductWikiModel(nextModel, { pageContents: pages, outputRoot: state.outputRoot, wikiRoot: state.wikiRoot });
  const beforeHashes = new Map([...pages].map(([path, content]) => [path, sha256(content)]));
  const result = publishProductWiki(build, options);
  const afterPages = new Map(build.files.filter((file) => file.path.endsWith('.md')).map((file) => [file.path, file.content]));
  const changedPages = [...afterPages].filter(([path, content]) => beforeHashes.get(path) !== sha256(content)).map(([path]) => path).sort();
  if (changedPages.length > 0) throw lifecycleError('wiki-sync-page-drift', 'Sync must not change Markdown page bytes.', '$.pages');
  return { ...result, changedPages };
}

export const __private = { calculateUpdateImpact, readManagedWiki, sha256, transitiveImpactRefs };
