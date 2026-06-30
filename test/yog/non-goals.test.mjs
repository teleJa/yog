import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshEvidence } from '../../skills/yog/lib/evidence.mjs';
import { createPrdExtractionChecklist } from '../../skills/yog/lib/prd.mjs';

test('refreshEvidence is an explicit first-version no-op adapter result', () => {
  assert.deepEqual(refreshEvidence({ provider: 'codegraph' }), {
    refreshed: false,
    issues: [
      {
        severity: 'P2',
        message: 'Evidence refresh is not implemented in the first version.',
        details: { provider: 'codegraph' },
      },
    ],
  });
});

test('createPrdExtractionChecklist returns durable extraction checklist text', () => {
  const checklist = createPrdExtractionChecklist({
    sourcePath: 'docs/archive/refund-prd.md',
    context: 'order',
    capability: 'refund',
  });
  assert.match(checklist, /Stable business terms/);
  assert.match(checklist, /docs\/archive\/refund-prd.md/);
  assert.doesNotMatch(checklist, /full PRD/);
});
