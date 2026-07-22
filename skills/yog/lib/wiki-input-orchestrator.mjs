import { isAbsolute } from 'node:path';
import {
  assertWikiSourceConfirmations,
  assertArtifactWithinSource,
  buildWikiInputConfirmation,
  normalizeArtifact,
  normalizeSourceResult,
  validateWikiConfig,
} from './wiki-source-registry.mjs';
import { validateSemanticDraft } from './wiki-model-composer.mjs';

const PUBLIC_INPUT_FIELDS = new Set([
  'config',
  'outputRoot',
  'runId',
  'generatedAt',
  'sourceResults',
  'artifacts',
  'semanticDraft',
  'confirmationDecisions',
]);

function inputError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError('wiki-input-invalid', `${path} must be an object.`, path);
  }
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) throw inputError('wiki-input-invalid', `${path} must be an array.`, path);
  return value;
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw inputError('wiki-input-invalid', `${path} must be a non-empty string.`, path);
  }
  return value;
}

export function createSourceArtifactEnvelope(sourceInput, {
  capturedAt,
  sourceRevision,
  transportIds,
  artifactKind = null,
} = {}) {
  const source = requireObject(sourceInput, '$.source');
  assertWikiSourceConfirmations([source]);
  const timestamp = requireText(capturedAt, '$.capturedAt');
  if (Number.isNaN(Date.parse(timestamp))) throw inputError('wiki-input-invalid', 'capturedAt must be an ISO timestamp.', '$.capturedAt');
  if (Date.parse(timestamp) < Date.parse(source.confirmation.confirmedAt)) {
    throw inputError(
      'wiki-source-scope-unconfirmed',
      `Artifact for Source ${source.id} was captured before its scope was confirmed.`,
      '$.capturedAt',
    );
  }
  const revision = requireText(sourceRevision, '$.sourceRevision');
  const enabledTransportIds = new Set((source.transports ?? []).filter((transport) => transport.enabled).map((transport) => transport.id));
  const selectedTransportIds = requireArray(transportIds, '$.transportIds');
  if (selectedTransportIds.length === 0 || selectedTransportIds.some((id) => !enabledTransportIds.has(id))) {
    throw inputError('wiki-input-invalid', `Artifact transport is outside the confirmed Source ${source.id}.`, '$.transportIds');
  }
  const kind = artifactKind ?? `${source.kind}-artifact`;
  if (kind === 'decision-artifact' && source.kind !== 'spec') {
    throw inputError('wiki-input-invalid', 'Decision Artifacts require a spec/filesystem Source.', '$.artifactKind');
  }
  if (kind !== `${source.kind}-artifact` && kind !== 'decision-artifact') {
    throw inputError('wiki-input-invalid', `Unsupported Artifact kind ${kind} for Source ${source.id}.`, '$.artifactKind');
  }
  return {
    kind,
    sourceId: source.id,
    capturedAt: timestamp,
    sourceRevision: revision,
    provenance: {
      provider: source.provider,
      transportIds: [...new Set(selectedTransportIds)].sort(),
      scopeFingerprint: source.confirmation.scopeFingerprint,
    },
  };
}

function validateCollectedSources(sources, sourceResultsInput, artifactsInput) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceResults = requireArray(sourceResultsInput, '$.sourceResults').map((result) => {
    const source = sourceById.get(result?.sourceId);
    if (!source) throw inputError('wiki-input-invalid', `Source Result is not configured: ${result?.sourceId}.`, '$.sourceResults');
    return normalizeSourceResult(result, source);
  });
  const resultIds = new Set();
  for (const result of sourceResults) {
    if (resultIds.has(result.sourceId)) throw inputError('wiki-input-invalid', `Duplicate Source Result: ${result.sourceId}.`, '$.sourceResults');
    resultIds.add(result.sourceId);
  }
  for (const source of sources.filter((item) => item.enabled)) {
    if (!resultIds.has(source.id)) throw inputError('wiki-input-invalid', `Enabled Source has no collection result: ${source.id}.`, '$.sourceResults');
  }
  const artifacts = requireArray(artifactsInput, '$.artifacts').map((artifact) => {
    const source = sourceById.get(artifact?.sourceId);
    if (!source || !source.enabled) throw inputError('wiki-input-invalid', `Artifact Source is not enabled: ${artifact?.sourceId}.`, '$.artifacts');
    if (artifact?.provenance?.scopeFingerprint !== source.confirmation.scopeFingerprint) {
      throw inputError('wiki-source-scope-unconfirmed', `Artifact scope differs from confirmed Source ${source.id}.`, `$.artifacts.${source.id}.provenance.scopeFingerprint`);
    }
    return assertArtifactWithinSource(normalizeArtifact(artifact, source.kind), source);
  });
  const artifactsBySource = new Map();
  for (const artifact of artifacts) {
    if (!resultIds.has(artifact.sourceId)) {
      throw inputError('wiki-input-invalid', `Artifact has no Source Result: ${artifact.sourceId}.`, '$.artifacts');
    }
    if (!artifactsBySource.has(artifact.sourceId)) artifactsBySource.set(artifact.sourceId, []);
    artifactsBySource.get(artifact.sourceId).push(artifact);
  }
  for (const result of sourceResults) {
    const sourceArtifacts = artifactsBySource.get(result.sourceId) ?? [];
    if (result.artifactCount !== sourceArtifacts.length) {
      throw inputError('wiki-input-invalid', `Source Result artifactCount does not match ${result.sourceId} Artifacts.`, '$.sourceResults');
    }
    if (sourceArtifacts.some((artifact) => artifact.provenance.provider !== result.provider
      || (artifact.kind !== `${result.kind}-artifact` && !(result.kind === 'spec' && artifact.kind === 'decision-artifact')))) {
      throw inputError('wiki-input-invalid', `Artifact identity does not match Source Result ${result.sourceId}.`, '$.artifacts');
    }
  }
  return { sourceResults, artifacts };
}

export function stageWikiGenerationInput(input) {
  const value = requireObject(input, '$');
  for (const key of Object.keys(value)) {
    if (!PUBLIC_INPUT_FIELDS.has(key)) {
      throw inputError(
        ['catalog', 'objects', 'relationships', 'governance', 'coverage', 'publication', 'manifest', 'files', 'pages'].includes(key)
          ? 'wiki-public-final-model-forbidden'
          : 'wiki-public-input-field-unsupported',
        `Public Wiki input cannot contain ${key}.`,
        `$.${key}`,
      );
    }
  }
  const config = requireObject(value.config, '$.config');
  const outputRoot = requireText(value.outputRoot, '$.outputRoot');
  if (!isAbsolute(outputRoot)) throw inputError('wiki-input-invalid', 'outputRoot must be absolute.', '$.outputRoot');
  const { root: wikiRoot, sources, confirmation } = validateWikiConfig(config);
  assertWikiSourceConfirmations(sources);
  const inputConfirmation = buildWikiInputConfirmation({
    outputRoot,
    wikiRoot,
    sources,
    confirmation,
  });
  const normalized = validateCollectedSources(sources, value.sourceResults, value.artifacts);
  const semanticDraft = validateSemanticDraft(value.semanticDraft);
  const staged = structuredClone(value);
  delete staged.config;
  delete staged.configuredSources;
  staged.schemaVersion = 1;
  staged.outputRoot = outputRoot;
  staged.wikiRoot = wikiRoot;
  staged.configuredSources = sources;
  staged.inputConfirmation = inputConfirmation;
  staged.sourceResults = normalized.sourceResults;
  staged.artifacts = normalized.artifacts;
  staged.semanticDraft = semanticDraft;
  return staged;
}
