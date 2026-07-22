#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { writeDailyAudit } from '../lib/query-contract.mjs';
import { resolveRepoContext } from '../lib/knowledge-root.mjs';

const input = await readStdinJson();
try {
  const context = resolveRepoContext(input);
  const wikiRoot = input.payload?.wikiRoot ?? 'docs/wiki';
  const output = writeDailyAudit({
    repoRoot: context.repoRoot,
    auditRoot: input.payload?.auditRoot ?? 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    findings: input.payload?.findings ?? [],
    resolutions: input.payload?.resolutions ?? [],
    commit: input.payload?.commit ?? null,
    wikiRoot,
  });
  writeJson({ issues: [], ...output });
  process.exit(0);
} catch (error) {
  writeJson({ issues: [{ severity: 'P1', code: error.code ?? 'wiki-audit-failed', message: error.message }], persisted: false });
  process.exit(1);
}
