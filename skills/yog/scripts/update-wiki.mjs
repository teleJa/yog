#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { formatWikiError } from '../lib/wiki.mjs';
import { stageWikiGenerationInput } from '../lib/wiki-input-orchestrator.mjs';
import { updateProductWiki } from '../lib/wiki-lifecycle.mjs';
import { composeWikiModelInput } from '../lib/wiki-model-composer.mjs';

let publicInput = null;

try {
  publicInput = await readStdinJson();
  const input = composeWikiModelInput(stageWikiGenerationInput(publicInput));
  writeJson({ schemaVersion: 1, ...updateProductWiki(input) });
  process.exit(0);
} catch (error) {
  const code = String(error.code ?? '');
  const retryable = Array.isArray(publicInput?.confirmationDecisions) && publicInput.confirmationDecisions.length > 0
    && new Set(['wiki-publish-locked', 'wiki-publish-injected-failure', 'wiki-publish-recovery-failed']).has(code);
  writeJson({
    ...formatWikiError(error),
    ...(retryable ? {
      status: 'confirmed-pending-apply',
      retryable: true,
      decisionFingerprints: [...new Set(publicInput.confirmationDecisions.map((decision) => decision.decisionFingerprint).filter(Boolean))].sort(),
    } : {}),
  });
  process.exit(error.code === 'wiki-source-scope-unconfirmed' ? 3
    : code.startsWith('wiki-semantic') || code.startsWith('wiki-public') || code.startsWith('wiki-gap') || code.startsWith('decision-')
      || code.includes('input') || code.includes('invalid') || code.includes('config') ? 2 : 1);
}
