#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { writeDailyAudit } from '../lib/query-contract.mjs';
import { resolveRepoContext } from '../lib/knowledge-root.mjs';

const input = await readStdinJson();
try {
  const context = resolveRepoContext(input);
  const output = writeDailyAudit({
    repoRoot: context.repoRoot,
    auditRoot: `${context.knowledgeRoot}/audits`,
    reportType: 'audit',
    findings: input.payload?.findings ?? [],
    resolutions: input.payload?.resolutions ?? [],
    commit: input.payload?.commit ?? null,
  });
  writeJson({ issues: [], ...output });
  process.exit(0);
} catch (error) {
  writeJson({ issues: [{ severity: 'P1', code: error.code ?? 'knowledge-audit-failed', message: error.message }], persisted: false });
  process.exit(1);
}
