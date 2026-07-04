import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_SYMBOL_PATTERN, EVIDENCE_KINDS, ID_PATTERN } from './constants.mjs';
import { mergeConfig, writeConfig } from './config.mjs';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';
import { hasRealBodyContent, hasTemplatePlaceholder } from './markdown.mjs';
import { contextPath, knowledgePath, readRepoConfig, repoRelative, resolveRepoContext } from './knowledge-root.mjs';
import { upsertManagedBlock, writeRootManagedBlocks } from './managed-block.mjs';

const pluginRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function renderKnowledgeRootTemplate(text, knowledgeRoot) {
  return text.split('{knowledgeRoot}').join(knowledgeRoot).split('docs/knowledge').join(knowledgeRoot);
}

function copyTreeNoOverwrite(sourceRoot, targetRoot, issues, repoRoot, knowledgeRoot) {
  mkdirSync(targetRoot, { recursive: true });
  for (const entry of readdirSync(sourceRoot)) {
    const source = join(sourceRoot, entry);
    const target = join(targetRoot, entry);
    if (statSync(source).isDirectory()) {
      copyTreeNoOverwrite(source, target, issues, repoRoot, knowledgeRoot);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      issues.push({
        severity: 'P2',
        message: 'Existing file skipped during init.',
        path: repoRelative(repoRoot, target),
      });
      continue;
    }
    writeFileSync(target, renderKnowledgeRootTemplate(readFileSync(source, 'utf8'), knowledgeRoot));
  }
}

export function initKnowledgeBase(input = {}) {
  const context = resolveRepoContext(input);
  const issues = [];
  copyTreeNoOverwrite(join(pluginRoot, 'templates/knowledge'), context.knowledgeAbs, issues, context.repoRoot, context.knowledgeRoot);
  const existing = readRepoConfig(context.repoRoot);
  const merged = mergeConfig(existing, {
    schemaVersion: 1,
    knowledgeRoot: context.knowledgeRoot,
    serena: input.payload?.serena ?? existing.serena ?? { enabled: true },
    codeFactProvider: input.payload?.codeFactProvider ?? existing.codeFactProvider ?? { type: 'codegraph', status: 'configured' },
  });
  writeConfig(context.repoRoot, merged);
  writeRootManagedBlocks(context.repoRoot, context.knowledgeRoot);
  return {
    issues,
    nextSteps: [
      {
        action: 'install-hooks',
        status: 'optional-recommended',
        message: `Offer to run install-hooks.mjs so future prompts automatically remind agents to route through ${context.knowledgeRoot}/index.json, INDEX.md, business-flow matches, and CONTEXT-MAP.md before business, design, interface, or implementation work.`,
      },
      {
        action: 'discover-candidates',
        status: 'gated',
        message: 'Run automatic discover-candidates only when Serena is available and CodeGraph is initialized for this repository.',
      },
    ],
  };
}

export function upgradeGuidance(input = {}) {
  const context = resolveRepoContext(input);
  const apply = input.payload?.apply === true;
  const guidanceFiles = ['AGENTS.md', 'README.md'];
  const issues = [];
  const changed = [];
  const unchanged = [];
  if (!existsSync(context.knowledgeAbs)) {
    return {
      issues: [{ severity: 'P0', message: `${context.knowledgeRoot} does not exist.`, path: context.knowledgeRoot }],
      applied: apply,
      changed,
      unchanged,
    };
  }
  for (const fileName of guidanceFiles) {
    const source = join(pluginRoot, 'templates/knowledge', fileName);
    const target = join(context.knowledgeAbs, fileName);
    const path = knowledgePath(context.knowledgeRoot, fileName);
    if (!existsSync(target)) {
      issues.push({ severity: 'P1', message: 'Guidance file is missing. Run init before upgrading guidance.', path });
      continue;
    }
    const expected = renderKnowledgeRootTemplate(readFileSync(source, 'utf8'), context.knowledgeRoot);
    const current = readFileSync(target, 'utf8');
    if (current === expected) {
      unchanged.push(path);
      continue;
    }
    changed.push(path);
    issues.push({
      severity: 'P2',
      message: apply ? 'Guidance file upgraded from current Yog template.' : 'Guidance file differs from current Yog template.',
      path,
    });
    if (apply) writeFileSync(target, expected);
  }
  for (const fileName of ['AGENTS.md', 'CLAUDE.md']) {
    const target = join(context.repoRoot, fileName);
    const path = fileName;
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const expected = upsertManagedBlock(current, context.knowledgeRoot);
    if (current === expected) {
      unchanged.push(path);
      continue;
    }
    changed.push(path);
    issues.push({
      severity: 'P2',
      message: apply ? 'Root managed block upgraded from current Yog template.' : 'Root managed block differs from current Yog template.',
      path,
    });
    if (apply) writeFileSync(target, expected);
  }
  return {
    issues,
    applied: apply,
    changed,
    unchanged,
  };
}

const HOOK_SCRIPT_SOURCE = join(pluginRoot, 'skills/yog/hooks/user-prompt-submit.mjs');
const HOOK_SCRIPT_NAME = 'yog-user-prompt-submit.mjs';
const ALL_HOOK_PLATFORMS = ['claude', 'codex'];

function copyHookScript(repoRoot, platformDir) {
  const targetDir = join(repoRoot, platformDir, 'hooks');
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, HOOK_SCRIPT_NAME);
  writeFileSync(target, readFileSync(HOOK_SCRIPT_SOURCE, 'utf8'));
  return repoRelative(repoRoot, target);
}

function installClaudeHook(repoRoot, scriptPath, installed) {
  const settingsPath = join(repoRoot, '.claude/settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      return { severity: 'P1', message: 'Existing .claude/settings.json is not valid JSON; skipped hook install.', path: '.claude/settings.json' };
    }
  }
  const command = `node ${scriptPath}`;
  settings.hooks = settings.hooks ?? {};
  const entries = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const already = entries.some((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command));
  if (!already) {
    entries.push({ hooks: [{ type: 'command', command }] });
    settings.hooks.UserPromptSubmit = entries;
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    installed.push('.claude/settings.json');
  }
  return null;
}

function codexManualHint(scriptPath) {
  return [
    'Codex hooks are not auto-configured. To enable the Yog UserPromptSubmit hook, add to your Codex config.toml:',
    '',
    '[features]',
    'hooks = true',
    '',
    '[hooks]',
    `UserPromptSubmit = [{ command = "node ${scriptPath}", timeout = 10 }]`,
    '',
    'The exact [hooks] array syntax may vary by Codex version; adjust if Codex reports a parse error.',
  ].join('\n');
}

export function installHooks(input = {}) {
  const context = resolveRepoContext(input);
  const requested = input.payload?.platforms ?? ALL_HOOK_PLATFORMS;
  const platforms = ALL_HOOK_PLATFORMS.filter((platform) => requested.includes(platform));
  const issues = [];
  const installed = [];
  let codexHint = null;
  if (platforms.length === 0) {
    return { issues: [{ severity: 'P1', message: 'No known platform requested. Use claude and/or codex.', path: '.yog/config.json' }], installed, platforms: [] };
  }
  if (platforms.includes('claude')) {
    const scriptPath = copyHookScript(context.repoRoot, '.claude');
    installed.push(scriptPath);
    const claudeIssue = installClaudeHook(context.repoRoot, scriptPath, installed);
    if (claudeIssue) issues.push(claudeIssue);
  }
  if (platforms.includes('codex')) {
    const scriptPath = copyHookScript(context.repoRoot, '.codex');
    installed.push(scriptPath);
    codexHint = codexManualHint(scriptPath);
    issues.push({ severity: 'P2', message: 'Codex hook script copied; enable it manually in config.toml.', path: scriptPath, details: { hint: codexHint } });
  }
  return { issues, installed, platforms, codexManualHint: codexHint };
}

function normalizeDuplicateToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
}

function formatInlineList(value) {
  return `[${normalizeList(value).join(', ')}]`;
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniquePreserve(values) {
  const seen = new Set();
  return (values ?? [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function readCandidateFrontmatter(filePath) {
  return parseFrontmatter(readFileSync(filePath, 'utf8')).data;
}

function findCandidateDuplicates(context, payload, options = {}) {
  const { knowledgeAbs, knowledgeRoot } = context;
  const candidateDir = join(knowledgeAbs, 'candidates');
  if (!existsSync(candidateDir)) return [];
  const candidateIds = normalizeList(payload.candidateIdsForDuplicateCheck ?? payload.candidateIds ?? payload.candidateId);
  const requested = {
    slugs: new Set(candidateIds.map(normalizeDuplicateToken)),
    name: normalizeDuplicateToken(payload.name),
    keywords: new Set(normalizeList(payload.keywords).map(normalizeDuplicateToken)),
    possible_contexts: new Set(normalizeList(payload.possibleContexts ?? payload.possible_contexts).map(normalizeDuplicateToken)),
    code_symbols: new Set(normalizeList(payload.code_symbols ?? payload.codeSymbols).map(normalizeDuplicateToken)),
  };
  return readdirSync(candidateDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .flatMap((fileName) => {
      const filePath = join(candidateDir, fileName);
      let data = {};
      try {
        data = readCandidateFrontmatter(filePath);
      } catch (error) {
        if (options.warnings) {
          options.warnings.push({
            severity: 'P2',
            message: 'Existing candidate frontmatter could not be parsed; skipped duplicate check for this file.',
            path: knowledgePath(knowledgeRoot, 'candidates', fileName),
            details: { reason: error.message },
          });
        }
        return [];
      }
      const matchedFields = [];
      if (requested.slugs.has(normalizeDuplicateToken(fileName.replace(/\.md$/, '')))) matchedFields.push('slug');
      if (requested.name && normalizeDuplicateToken(data.name) === requested.name) matchedFields.push('name');
      const existingKeywords = normalizeList(data.keywords).map(normalizeDuplicateToken);
      const existingContexts = normalizeList(data.possible_contexts).map(normalizeDuplicateToken);
      const existingSymbols = normalizeList(data.code_symbols).map(normalizeDuplicateToken);
      if (existingKeywords.some((keyword) => requested.keywords.has(keyword))) matchedFields.push('keywords');
      if (existingContexts.some((context) => requested.possible_contexts.has(context))) matchedFields.push('possible_contexts');
      if (existingSymbols.some((symbol) => requested.code_symbols.has(symbol))) matchedFields.push('code_symbols');
      return {
        path: knowledgePath(knowledgeRoot, 'candidates', fileName),
        candidateId: fileName.replace(/\.md$/, ''),
        name: data.name ?? '',
        status: data.status ?? 'needs-review',
        matchedFields,
      };
    })
    .filter((candidate) => candidate.matchedFields.length > 0);
}

function normalizeSymbolSegment(value) {
  const parts = String(value).split('.').filter(Boolean);
  return parts.at(-1) ?? '';
}

function canonicalizeCodeSymbol(value) {
  let symbol = String(value ?? '').trim();
  if (!symbol || /[/\\]/.test(symbol) || /\s/.test(symbol) || symbol.includes(':')) return null;
  symbol = symbol.replace(/\([^)]*\)$/, '');
  if (symbol.includes('#')) {
    const [rawClass, rawMember, ...rest] = symbol.split('#');
    if (rest.length > 0 || !rawClass || !rawMember) return null;
    const className = normalizeSymbolSegment(rawClass);
    const canonical = `${className}#${rawMember}`;
    return CODE_SYMBOL_PATTERN.test(canonical) ? canonical : null;
  }
  if (/^[A-Za-z_$][$A-Za-z0-9_]*(?:\.[A-Za-z_$][$A-Za-z0-9_]*)+$/.test(symbol)) {
    const parts = symbol.split('.');
    const className = parts.at(-2);
    const memberName = parts.at(-1);
    const canonical = `${className}#${memberName}`;
    return CODE_SYMBOL_PATTERN.test(canonical) ? canonical : null;
  }
  return CODE_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function inputIssue(message, details = {}) {
  return { severity: 'P1', message, details };
}

function targetIssue(message, path, details = {}) {
  return { severity: 'P1', message, path, details };
}

function assertValidId(value, field) {
  if (!value || !ID_PATTERN.test(value)) {
    return inputIssue(`${field} must match [a-z][a-z0-9-]*.`, { field });
  }
  return null;
}

function prefixIssue(issue, prefix) {
  return {
    ...issue,
    message: `${prefix}: ${issue.message}`,
    details: { ...(issue.details ?? {}), prefix },
  };
}

function assertRealBody(body, field) {
  if (!body || hasTemplatePlaceholder(body) || !hasRealBodyContent(`# Body\n${body}`)) {
    return inputIssue(`${field} must contain real content.`, { field });
  }
  return null;
}

function validateCapabilityPayload(capability, prefix = 'capability') {
  return [
    assertValidId(capability?.capabilityId, `${prefix}.capabilityId`),
    !capability?.name ? inputIssue(`${prefix}.name is required.`, { field: `${prefix}.name` }) : null,
    !capability?.summary ? inputIssue(`${prefix}.summary is required.`, { field: `${prefix}.summary` }) : null,
    !capability?.responsibilities ? inputIssue(`${prefix}.responsibilities is required.`, { field: `${prefix}.responsibilities` }) : null,
    !capability?.nonResponsibilities ? inputIssue(`${prefix}.nonResponsibilities is required.`, { field: `${prefix}.nonResponsibilities` }) : null,
    assertRealBody(capability?.body, `${prefix}.body`),
  ].filter(Boolean);
}

function validateEvidencePayload(evidence, prefix = 'evidence') {
  return [
    !EVIDENCE_KINDS.includes(evidence?.evidenceKind) ? inputIssue(`${prefix}.evidenceKind is not supported.`, { field: `${prefix}.evidenceKind` }) : null,
    !evidence?.name ? inputIssue(`${prefix}.name is required.`, { field: `${prefix}.name` }) : null,
    !evidence?.summary ? inputIssue(`${prefix}.summary is required.`, { field: `${prefix}.summary` }) : null,
    !evidence?.source ? inputIssue(`${prefix}.source is required.`, { field: `${prefix}.source` }) : null,
    !evidence?.generator ? inputIssue(`${prefix}.generator is required.`, { field: `${prefix}.generator` }) : null,
    !evidence?.generation_evidence ? inputIssue(`${prefix}.generation_evidence is required.`, { field: `${prefix}.generation_evidence` }) : null,
    assertRealBody(evidence?.body, `${prefix}.body`),
  ].filter(Boolean);
}

function validatePromoteKnowledgePayload(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return [inputIssue('capabilities must include at least one real capability with evidence.', { field: 'capabilities' })];
  }
  const seenCapabilities = new Set();
  const seenEvidence = new Set();
  return capabilities.flatMap((capability, capabilityIndex) => {
    const prefix = `capabilities[${capabilityIndex}]`;
    const issues = validateCapabilityPayload(capability, prefix);
    if (capability?.capabilityId) {
      if (seenCapabilities.has(capability.capabilityId)) {
        issues.push(inputIssue(`${prefix}.capabilityId is duplicated.`, { field: `${prefix}.capabilityId` }));
      }
      seenCapabilities.add(capability.capabilityId);
    }
    if (!Array.isArray(capability?.evidence) || capability.evidence.length === 0) {
      issues.push(inputIssue(`${prefix}.evidence must include at least one evidence document.`, { field: `${prefix}.evidence` }));
      return issues;
    }
    return issues.concat(capability.evidence.flatMap((evidence, evidenceIndex) => {
      const evidencePrefix = `${prefix}.evidence[${evidenceIndex}]`;
      const evidenceIssues = validateEvidencePayload(evidence, evidencePrefix);
      const evidenceKey = `${capability?.capabilityId ?? ''}-${evidence?.evidenceKind ?? ''}`;
      if (capability?.capabilityId && evidence?.evidenceKind) {
        if (seenEvidence.has(evidenceKey)) {
          evidenceIssues.push(inputIssue(`${evidencePrefix}.evidenceKind creates a duplicate evidence file.`, { field: `${evidencePrefix}.evidenceKind` }));
        }
        seenEvidence.add(evidenceKey);
      }
      return evidenceIssues;
    }));
  });
}

function readRequiredTemplate(context, templateName) {
  const { knowledgeAbs, knowledgeRoot } = context;
  const relPath = knowledgePath(knowledgeRoot, 'templates', templateName);
  const absPath = join(knowledgeAbs, 'templates', templateName);
  if (!existsSync(absPath)) {
    return {
      issue: targetIssue('Required target repository template is missing. Run init before creating documents.', relPath, { template: templateName }),
    };
  }
  return { text: readFileSync(absPath, 'utf8') };
}

function assertTargetsDoNotExist(targets) {
  const existing = targets.find((target) => existsSync(target.abs));
  return existing ? targetIssue('Target document already exists.', existing.path) : null;
}

function replaceLine(markdown, key, value) {
  const pattern = new RegExp(`^${key}:.*$`, 'm');
  if (pattern.test(markdown)) return markdown.replace(pattern, `${key}: ${value}`);
  const close = markdown.indexOf('\n---\n', 4);
  if (markdown.startsWith('---\n') && close !== -1) {
    return `${markdown.slice(0, close)}\n${key}: ${value}${markdown.slice(close)}`;
  }
  return markdown;
}

function replaceTemplateValue(markdown, token, value) {
  return markdown.split(`{${token}}`).join(value);
}

function injectAfterHeading(markdown, heading, content) {
  const marker = `## ${heading}`;
  if (!markdown.includes(marker)) return `${markdown.trim()}\n\n${content}\n`;
  return markdown.replace(marker, `${marker}\n\n${content}`);
}

function injectOptionalAfterHeading(markdown, heading, content) {
  if (!content) return markdown;
  return injectAfterHeading(markdown, heading, content);
}

const CANDIDATE_SECTIONS = [
  '触发信号',
  '可能的业务含义',
  '可能归属的上下文',
  '相关证据',
  '为什么暂不创建正式 Context',
  '需要确认的问题',
  '处理结果',
];

function fallbackText(value, fallback) {
  return asText(value) || fallback;
}

function extractSections(markdown) {
  const sections = new Map();
  let current = null;
  for (const rawLine of markdown.split('\n')) {
    const heading = rawLine.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(rawLine);
  }
  return new Map([...sections.entries()].map(([heading, lines]) => [heading, lines.join('\n').trim()]));
}

function sectionIsEmptyOrFallback(value) {
  const text = String(value ?? '').trim();
  return !text || /^\[待补充：/.test(text);
}

function mergeLineSection(existing, incoming) {
  return uniqueLines([existing, incoming]).join('\n');
}

function renderCandidateMarkdown(data, title, sections) {
  const body = [
    stringifyFrontmatter(data).trim(),
    '',
    `# ${title}`,
    '',
    ...CANDIDATE_SECTIONS.flatMap((heading) => [`## ${heading}`, '', sections.get(heading) ?? '', '']),
  ].join('\n');
  return body.replace(/\n{4,}/g, '\n\n\n');
}

function candidateSectionsFromPayload(payload) {
  const triggerSignals = fallbackText(
    payload.triggerSignals ?? payload.body,
    `[待补充：discover 阶段未提供触发信号，请在 review 时补齐]`,
  );
  const possibleContexts = normalizeList(payload.possibleContexts ?? payload.possible_contexts);
  return new Map([
    ['触发信号', triggerSignals],
    ['可能的业务含义', fallbackText(payload.businessMeaning, '[待补充：promote 阶段从文档/PRD 核实]')],
    ['可能归属的上下文', possibleContexts.length > 0 ? possibleContexts.map((item) => `- ${item}`).join('\n') : '[待补充：候选归属上下文需在 promote 阶段确认]'],
    ['相关证据', fallbackText(payload.evidence, '[待补充：代码符号、路径或执行结构证据需在 review 时补齐]')],
    ['为什么暂不创建正式 Context', fallbackText(payload.notFormalReason, 'needs-review：业务边界与归属待人工确认')],
    ['需要确认的问题', fallbackText(payload.openQuestions, '[待补充：业务边界与职责范围需在 promote 阶段确认]')],
    ['处理结果', '待 review / promote'],
  ]);
}

function candidateMissingFields(candidate) {
  const missing = [];
  if (!candidate.candidateId) missing.push('candidateId');
  if (!candidate.name) missing.push('name');
  if (!candidate.summary) missing.push('summary');
  if (normalizeList(candidate.code_symbols ?? candidate.codeSymbols).length === 0
    && normalizeList(candidate.identity_symbols ?? candidate.identitySymbols).length === 0) {
    missing.push('code_symbols');
  }
  if (normalizeList(candidate.evidence_paths ?? candidate.evidencePaths).length === 0) missing.push('evidence_paths');
  return missing;
}

function normalizeSymbolsForReduce(candidate) {
  const inputSymbols = normalizeList(candidate.code_symbols ?? candidate.codeSymbols);
  const explicitIdentitySymbols = normalizeList(candidate.identity_symbols ?? candidate.identitySymbols);
  const explicitSupportingSymbols = normalizeList(candidate.supporting_symbols ?? candidate.supportingSymbols);
  const identityInputSymbols = explicitIdentitySymbols.length > 0 ? explicitIdentitySymbols : inputSymbols;
  const supportingInputSymbols = explicitIdentitySymbols.length > 0
    ? uniquePreserve([...explicitSupportingSymbols, ...inputSymbols.filter((symbol) => !explicitIdentitySymbols.includes(symbol))])
    : explicitSupportingSymbols;
  const canonicalIdentitySymbols = [];
  const canonicalSupportingSymbols = [];
  const invalidSymbols = [];
  for (const symbol of identityInputSymbols) {
    const canonical = canonicalizeCodeSymbol(symbol);
    if (canonical) canonicalIdentitySymbols.push(canonical);
    else invalidSymbols.push(String(symbol ?? '').trim());
  }
  for (const symbol of supportingInputSymbols) {
    const canonical = canonicalizeCodeSymbol(symbol);
    if (canonical) canonicalSupportingSymbols.push(canonical);
    else invalidSymbols.push(String(symbol ?? '').trim());
  }
  return {
    inputSymbols,
    identityInputSymbols,
    supportingInputSymbols,
    canonicalIdentitySymbols: uniqueSorted(canonicalIdentitySymbols),
    canonicalSupportingSymbols: uniqueSorted(canonicalSupportingSymbols),
    invalidSymbols: uniquePreserve(invalidSymbols),
  };
}

function normalizeCandidateForReduce(candidate, agent, index) {
  const missing = candidateMissingFields(candidate);
  const symbols = normalizeSymbolsForReduce(candidate);
  if (symbols.canonicalIdentitySymbols.length === 0 && symbols.identityInputSymbols.length > 0) missing.push('canonical code_symbols');
  return {
    sourceIndex: index,
    agent,
    allowSameAgentJoin: candidate.allow_same_agent_join === true || candidate.allowSameAgentJoin === true,
    candidateId: candidate.candidateId ?? '',
    name: candidate.name ?? '',
    summary: candidate.summary ?? '',
    business_boundary: candidate.business_boundary ?? candidate.businessBoundary ?? '',
    responsibilities_hint: candidate.responsibilities_hint ?? candidate.responsibilitiesHint ?? '',
    non_responsibilities_hint: candidate.non_responsibilities_hint ?? candidate.nonResponsibilitiesHint ?? '',
    code_symbols: symbols.inputSymbols,
    identity_symbols: symbols.identityInputSymbols,
    supporting_symbols: symbols.supportingInputSymbols,
    canonicalIdentitySymbols: symbols.canonicalIdentitySymbols,
    canonicalSupportingSymbols: symbols.canonicalSupportingSymbols,
    canonicalSymbols: uniqueSorted([...symbols.canonicalIdentitySymbols, ...symbols.canonicalSupportingSymbols]),
    invalidSymbols: symbols.invalidSymbols,
    evidence_paths: uniqueSorted(normalizeList(candidate.evidence_paths ?? candidate.evidencePaths)),
    keywords: uniqueSorted(normalizeList(candidate.keywords)),
    possible_contexts: uniqueSorted(normalizeList(candidate.possible_contexts ?? candidate.possibleContexts)),
    confidence: candidate.confidence ?? '',
    confidence_reason: candidate.confidence_reason ?? candidate.confidenceReason ?? '',
    skip_reason: candidate.skip_reason ?? candidate.skipReason ?? '',
    missing,
  };
}

function makeRejectedCandidate(candidate, reasons) {
  return {
    agent: candidate.agent,
    candidateId: candidate.candidateId,
    name: candidate.name,
    reasons,
    invalidSymbols: candidate.invalidSymbols,
  };
}

function canJoinByIdentity(left, right) {
  if (left.agent !== right.agent) return true;
  if (normalizeDuplicateToken(left.candidateId) === normalizeDuplicateToken(right.candidateId)) return true;
  return left.allowSameAgentJoin === true && right.allowSameAgentJoin === true;
}

function candidateBrief(candidate) {
  return { candidateId: candidate.candidateId, name: candidate.name, agent: candidate.agent };
}

function connectedComponents(candidates) {
  const parents = candidates.map((_, index) => index);
  const joinConflicts = [];
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const symbolOwners = new Map();
  candidates.forEach((candidate, index) => {
    for (const symbol of candidate.canonicalIdentitySymbols) {
      if (symbolOwners.has(symbol)) {
        const ownerIndex = symbolOwners.get(symbol);
        const owner = candidates[ownerIndex];
        if (canJoinByIdentity(owner, candidate)) {
          union(ownerIndex, index);
        } else {
          joinConflicts.push({
            reason: 'same-agent-identity-symbol',
            symbol,
            left: candidateBrief(owner),
            right: candidateBrief(candidate),
          });
        }
      } else {
        symbolOwners.set(symbol, index);
      }
    }
  });
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate]);
  });
  return { groups: [...groups.values()], joinConflicts };
}

function representativeForCluster(items) {
  return [...items].sort((left, right) => {
    const rightEvidence = right.canonicalSymbols.length + right.evidence_paths.length;
    const leftEvidence = left.canonicalSymbols.length + left.evidence_paths.length;
    if (rightEvidence !== leftEvidence) return rightEvidence - leftEvidence;
    return left.candidateId.localeCompare(right.candidateId);
  })[0];
}

function scoreCluster(identitySymbols, supportingSymbols, evidencePaths, hitAgents) {
  const score = Math.min(identitySymbols.length, 10) * 2
    + Math.min(supportingSymbols.length, 10)
    + evidencePaths.length
    + (hitAgents.length >= 2 ? 3 : 0);
  const confidence = score >= 8 ? 'high' : (score >= 4 ? 'medium' : 'low');
  return { score, confidence };
}

function renderTriggerSignals(cluster, canonicalSymbols) {
  return uniquePreserve([
    ...cluster.items.map((item) => `- ${item.agent}: ${item.summary}`),
    `- hitAgents: ${cluster.hitAgents.join(', ')}`,
    `- code_symbols: ${canonicalSymbols.slice(0, 8).join(', ')}`,
  ]).join('\n');
}

function renderEvidence(canonicalSymbols, evidencePaths) {
  return [
    ...canonicalSymbols.map((symbol) => `- symbol: ${symbol}`),
    ...evidencePaths.map((path) => `- path: ${path}`),
  ].join('\n');
}

function renderOpenQuestions(cluster, possibleDuplicates = []) {
  const lines = [];
  for (const item of cluster.items) {
    if (item.responsibilities_hint) lines.push(`- 需确认是否负责：${item.responsibilities_hint}`);
    if (item.non_responsibilities_hint) lines.push(`- 需确认是否不负责：${item.non_responsibilities_hint}`);
  }
  for (const duplicate of possibleDuplicates) {
    lines.push(`- 疑似与 ${duplicate.right.candidateId} 重复，待确认。`);
  }
  return uniquePreserve(lines).join('\n') || '[待补充：业务边界与职责范围需在 promote 阶段确认]';
}

function clusterToPayload(cluster, duplicateHints = []) {
  const representative = cluster.representative;
  const triggerSignals = renderTriggerSignals(cluster, cluster.canonicalSymbols);
  return {
    candidateId: representative.candidateId,
    name: representative.name,
    summary: representative.summary,
    body: triggerSignals,
    triggerSignals,
    businessMeaning: representative.business_boundary || '[待补充：promote 阶段从文档/PRD 核实]',
    possibleContexts: cluster.possible_contexts,
    keywords: cluster.keywords,
    code_symbols: cluster.canonicalSymbols,
    identity_symbols: cluster.identitySymbols,
    supporting_symbols: cluster.supportingSymbols,
    evidence: renderEvidence(cluster.canonicalSymbols, cluster.evidence_paths),
    notFormalReason: 'needs-review：业务边界与归属待人工确认',
    openQuestions: renderOpenQuestions(cluster, duplicateHints),
    confidence: cluster.confidence,
    score: cluster.score,
    hitAgents: cluster.hitAgents,
    canonicalSymbols: cluster.canonicalSymbols,
    identitySymbols: cluster.identitySymbols,
    supportingSymbols: cluster.supportingSymbols,
    evidence_paths: cluster.evidence_paths,
    mergedFrom: cluster.items.map((item) => ({ candidateId: item.candidateId, agent: item.agent })),
    agent_confidence: cluster.items.map((item) => ({ agent: item.agent, confidence: item.confidence, reason: item.confidence_reason })),
    invalidSymbols: uniquePreserve(cluster.items.flatMap((item) => item.invalidSymbols)),
    candidateIdsForDuplicateCheck: uniqueSorted(cluster.items.map((item) => item.candidateId)),
  };
}

function clustersHaveSubjectiveOverlap(left, right) {
  const checks = [];
  if (normalizeDuplicateToken(left.representative.candidateId) === normalizeDuplicateToken(right.representative.candidateId)) checks.push('candidateId');
  if (normalizeDuplicateToken(left.representative.name) === normalizeDuplicateToken(right.representative.name)) checks.push('name');
  const rightKeywords = new Set(right.keywords.map(normalizeDuplicateToken));
  const rightContexts = new Set(right.possible_contexts.map(normalizeDuplicateToken));
  if (left.keywords.map(normalizeDuplicateToken).some((keyword) => rightKeywords.has(keyword))) checks.push('keywords');
  if (left.possible_contexts.map(normalizeDuplicateToken).some((context) => rightContexts.has(context))) checks.push('possible_contexts');
  return checks;
}

function findBatchDuplicatePlan(candidates) {
  const blocking = [];
  const slugOwners = new Map();
  const identityOwners = new Map();
  for (const payload of candidates) {
    const slug = normalizeDuplicateToken(payload.candidateId);
    if (slugOwners.has(slug)) {
      blocking.push({
        reason: 'same-candidate-id',
        candidateIds: [slugOwners.get(slug).candidateId, payload.candidateId],
        actionRequired: 'merge-or-rename',
      });
    } else {
      slugOwners.set(slug, payload);
    }
    for (const symbol of normalizeList(payload.identity_symbols ?? payload.identitySymbols)) {
      const canonical = canonicalizeCodeSymbol(symbol);
      if (!canonical) continue;
      if (identityOwners.has(canonical)) {
        blocking.push({
          reason: 'same-identity-symbol',
          symbol: canonical,
          candidateIds: [identityOwners.get(canonical).candidateId, payload.candidateId],
          actionRequired: 'merge-or-rename',
        });
      } else {
        identityOwners.set(canonical, payload);
      }
    }
  }
  return blocking;
}

export function reduceCandidates(input = {}) {
  const context = resolveRepoContext(input);
  const batches = input.payload?.batches;
  const maxCandidates = Number.isInteger(input.payload?.maxCandidates) ? input.payload.maxCandidates : 10;
  if (!Array.isArray(batches)) {
    return {
      code: 2,
      output: { issues: [inputIssue('payload.batches must be an array.', { field: 'payload.batches' })] },
    };
  }
  const invalidBatches = [];
  const rawCandidates = [];
  for (const [batchIndex, batch] of batches.entries()) {
    if (!batch || typeof batch !== 'object' || Array.isArray(batch) || !Array.isArray(batch.candidates)) {
      invalidBatches.push(inputIssue('Each batch must be an object with candidates array.', { batchIndex }));
      continue;
    }
    const agent = batch.agent ?? `batch-${batchIndex}`;
    batch.candidates.forEach((candidate, candidateIndex) => {
      rawCandidates.push(normalizeCandidateForReduce(candidate, agent, candidateIndex));
    });
  }
  if (invalidBatches.length > 0) {
    return { code: 2, output: { issues: invalidBatches } };
  }
  const rejected = [];
  const valid = [];
  for (const candidate of rawCandidates) {
    const reasons = [];
    if (candidate.candidateId && !ID_PATTERN.test(candidate.candidateId)) reasons.push('candidateId must match [a-z][a-z0-9-]*');
    if (candidate.missing.includes('candidateId')) reasons.push('candidateId is required');
    if (candidate.missing.includes('name')) reasons.push('name is required');
    if (candidate.missing.includes('summary')) reasons.push('summary is required');
    if (candidate.missing.includes('code_symbols')) reasons.push('code_symbols is required');
    if (candidate.missing.includes('canonical code_symbols')) reasons.push('code_symbols has no canonical entries');
    if (candidate.missing.includes('evidence_paths')) reasons.push('evidence_paths is required');
    if (reasons.length > 0) rejected.push(makeRejectedCandidate(candidate, reasons));
    else valid.push(candidate);
  }
  const components = connectedComponents(valid);
  const clusters = components.groups.map((items) => {
    const representative = representativeForCluster(items);
    const identitySymbols = uniqueSorted(items.flatMap((item) => item.canonicalIdentitySymbols));
    const supportingSymbols = uniqueSorted(items.flatMap((item) => item.canonicalSupportingSymbols)
      .filter((symbol) => !identitySymbols.includes(symbol)));
    const canonicalSymbols = uniqueSorted(items.flatMap((item) => item.canonicalSymbols));
    const evidencePaths = uniqueSorted(items.flatMap((item) => item.evidence_paths));
    const hitAgents = uniqueSorted(items.map((item) => item.agent));
    const { score, confidence } = scoreCluster(identitySymbols, supportingSymbols, evidencePaths, hitAgents);
    return {
      representative,
      items,
      identitySymbols,
      supportingSymbols,
      canonicalSymbols,
      evidence_paths: evidencePaths,
      hitAgents,
      keywords: uniqueSorted(items.flatMap((item) => item.keywords)),
      possible_contexts: uniqueSorted(items.flatMap((item) => item.possible_contexts)),
      score,
      confidence,
    };
  }).sort((left, right) => left.representative.candidateId.localeCompare(right.representative.candidateId));
  const baseStats = {
    raw: rawCandidates.length,
    afterFormat: valid.length,
    clusters: clusters.length,
    writable: 0,
    lowConfidence: 0,
    possibleDuplicates: 0,
    diskDuplicates: 0,
    joinConflicts: components.joinConflicts.length,
    rejected: rejected.length,
  };
  if (clusters.length > maxCandidates) {
    return {
      code: 1,
      output: {
        gate: 'narrow-scope-required',
        stats: baseStats,
        writable: [],
        lowConfidence: [],
        possibleDuplicates: [],
        joinConflicts: components.joinConflicts,
        rejected,
      },
    };
  }
  const possibleDuplicates = [];
  for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
      const matchedFields = clustersHaveSubjectiveOverlap(clusters[leftIndex], clusters[rightIndex]);
      if (matchedFields.length > 0) {
        possibleDuplicates.push({
          left: { candidateId: clusters[leftIndex].representative.candidateId, name: clusters[leftIndex].representative.name },
          right: { candidateId: clusters[rightIndex].representative.candidateId, name: clusters[rightIndex].representative.name },
          matchedFields,
        });
      }
    }
  }
  const duplicateHintsByCandidateId = new Map();
  for (const duplicate of possibleDuplicates) {
    duplicateHintsByCandidateId.set(duplicate.left.candidateId, [...(duplicateHintsByCandidateId.get(duplicate.left.candidateId) ?? []), duplicate]);
  }
  const writable = [];
  const lowConfidence = [];
  for (const cluster of clusters) {
    const payload = clusterToPayload(cluster, duplicateHintsByCandidateId.get(cluster.representative.candidateId) ?? []);
    if (cluster.confidence === 'low') lowConfidence.push(payload);
    else writable.push(payload);
  }
  const warnings = [];
  let diskDuplicateCount = 0;
  for (const payload of [...writable, ...lowConfidence]) {
    const duplicates = findCandidateDuplicates(context, payload, { warnings });
    if (duplicates.length > 0) {
      diskDuplicateCount += 1;
      payload.diskDuplicate = {
        matched: true,
        candidateIds: uniqueSorted(duplicates.map((duplicate) => duplicate.candidateId)),
      };
    }
  }
  const batchDuplicates = findBatchDuplicatePlan([...writable, ...lowConfidence]);
  const stats = {
    ...baseStats,
    writable: writable.length,
    lowConfidence: lowConfidence.length,
    possibleDuplicates: possibleDuplicates.length,
    diskDuplicates: diskDuplicateCount,
    batchDuplicates: batchDuplicates.length,
  };
  const gate = batchDuplicates.length > 0 ? 'batch-duplicates-require-resolution' : 'ok';
  return {
    code: (diskDuplicateCount > 0 || batchDuplicates.length > 0) ? 3 : 0,
    output: {
      gate,
      stats,
      writable,
      lowConfidence,
      possibleDuplicates,
      batchDuplicates,
      joinConflicts: components.joinConflicts,
      rejected,
      issues: warnings,
    },
  };
}

function evidenceSectionFallback(evidenceKind, heading) {
  const descriptions = {
    '路由 / 接口': '本证据类型未覆盖路由或接口；如需要该事实，请补充 routes evidence。',
    调用关系: '本证据类型未覆盖调用关系；如需要该事实，请补充 call-flow evidence。',
    '数据 / 消息': '本证据类型未覆盖数据或消息结构；如需要该事实，请补充 data evidence。',
    前端入口: '本轮未发现或未覆盖前端入口；如需要该事实，请补充 ui evidence 或前端路径证据。',
  };
  return descriptions[heading] ?? `本 ${evidenceKind} evidence 未覆盖该章节。`;
}

function injectEvidenceSection(markdown, evidenceKind, heading, content) {
  return injectAfterHeading(markdown, heading, sectionText(content, evidenceSectionFallback(evidenceKind, heading)));
}

function writeMarkdown(target, markdown) {
  writeFileSync(target, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
}

function asText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => `- ${item}`).join('\n');
  return String(value ?? '').trim();
}

function sectionText(value, fallback) {
  return asText(value) || fallback;
}

function contextMapSummary(value) {
  return asText(value)
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
    .join('; ');
}

function capabilitySummaryList(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return '';
  return capabilities
    .map((capability) => `- ${capability.capabilityId}: ${capability.name} - ${capability.summary}`)
    .join('\n');
}

function evidencePathList(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return '';
  return paths.map((path) => `- ${path}`).join('\n');
}

function collectEvidenceSection(capability, field) {
  return (capability.evidence ?? [])
    .map((evidence) => asText(evidence[field]))
    .filter(Boolean)
    .join('\n');
}

function uniqueLines(values) {
  const seen = new Set();
  return values
    .flatMap((value) => asText(value).split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function formatReadmeUpstreamDownstream(capabilities) {
  const routes = [];
  const callFlows = [];
  const dataDependencies = [];
  for (const capability of capabilities ?? []) {
    for (const evidence of capability.evidence ?? []) {
      if (evidence.evidenceKind === 'routes') routes.push(evidence.routes ?? evidence.callRelations);
      if (evidence.evidenceKind === 'call-flow') callFlows.push(evidence.callRelations);
      if (evidence.evidenceKind === 'data') dataDependencies.push(evidence.dataMessages ?? evidence.callRelations);
    }
  }
  const sections = [
    ['入口：', uniqueLines(routes)],
    ['主调用链：', uniqueLines(callFlows)],
    ['数据依赖：', uniqueLines(dataDependencies)],
  ].filter(([, lines]) => lines.length > 0);
  return sections
    .map(([heading, lines]) => `${heading}\n${lines.join('\n')}`)
    .join('\n\n');
}

function capabilityEvidencePaths(knowledgeRoot, contextId, capability) {
  return (capability.evidence ?? [])
    .map((evidence) => contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`));
}

function slugTimestamp(value = new Date()) {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
}

export function createCandidate(input) {
  const context = resolveRepoContext(input);
  const { knowledgeAbs, knowledgeRoot } = context;
  const payload = input.payload ?? {};
  const effectiveBody = payload.body ?? payload.triggerSignals;
  const issues = [
    assertValidId(payload.candidateId, 'candidateId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    assertRealBody(effectiveBody, 'body'),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const template = readRequiredTemplate(context, 'candidate.md');
  if (template.issue) return { code: 1, output: { issues: [template.issue] } };
  const candidateDir = join(knowledgeAbs, 'candidates');
  const updateCandidateId = payload.updateCandidateId;
  if (payload.updateExisting) {
    const updateIssues = [
      assertValidId(updateCandidateId, 'updateCandidateId'),
      !payload.confirmDuplicate ? inputIssue('confirmDuplicate is required when updateExisting is true.', { field: 'confirmDuplicate' }) : null,
    ].filter(Boolean);
    if (updateIssues.length) return { code: 2, output: { issues: updateIssues } };
    const target = join(candidateDir, `${updateCandidateId}.md`);
    if (!existsSync(target)) {
      return { code: 1, output: { issues: [targetIssue('Candidate to update does not exist.', knowledgePath(knowledgeRoot, 'candidates', `${updateCandidateId}.md`))] } };
    }
    const parsed = parseFrontmatter(readFileSync(target, 'utf8'));
    const oldData = parsed.data;
    const oldSections = extractSections(parsed.body);
    const incomingSections = candidateSectionsFromPayload({ ...payload, body: effectiveBody });
    const mergedSections = new Map(oldSections);
    const mergedFields = [];
    for (const key of ['keywords', 'possible_contexts', 'code_symbols', 'identity_symbols', 'supporting_symbols']) {
      const payloadValue = key === 'possible_contexts'
        ? (payload.possibleContexts ?? payload.possible_contexts)
        : (key === 'code_symbols'
            ? (payload.code_symbols ?? payload.codeSymbols)
            : (key === 'identity_symbols'
                ? (payload.identity_symbols ?? payload.identitySymbols)
                : (key === 'supporting_symbols' ? (payload.supporting_symbols ?? payload.supportingSymbols) : payload.keywords)));
      const merged = uniqueSorted([...normalizeList(oldData[key]), ...normalizeList(payloadValue)]);
      if (merged.join('\0') !== normalizeList(oldData[key]).join('\0')) mergedFields.push(key);
      oldData[key] = merged;
    }
    if (!oldData.name && payload.name) oldData.name = payload.name;
    oldData.status = oldData.status || 'needs-review';
    oldData.promoted_to = oldData.promoted_to ?? '';
    for (const heading of ['触发信号', '相关证据']) {
      const merged = mergeLineSection(mergedSections.get(heading), incomingSections.get(heading));
      if (merged !== (mergedSections.get(heading) ?? '')) mergedFields.push(heading);
      mergedSections.set(heading, merged);
    }
    for (const heading of ['可能的业务含义', '可能归属的上下文', '为什么暂不创建正式 Context', '需要确认的问题']) {
      if (sectionIsEmptyOrFallback(mergedSections.get(heading))) mergedSections.set(heading, incomingSections.get(heading));
    }
    if (sectionIsEmptyOrFallback(mergedSections.get('处理结果'))) mergedSections.set('处理结果', '待 review / promote');
    const title = oldData.name || payload.name;
    writeMarkdown(target, renderCandidateMarkdown(oldData, title, mergedSections));
    return {
      code: 0,
      output: {
        updated: true,
        created: false,
        candidateId: updateCandidateId,
        path: knowledgePath(knowledgeRoot, 'candidates', `${updateCandidateId}.md`),
        mergedFields: uniquePreserve(mergedFields),
        issues: [],
      },
    };
  }
  const duplicates = findCandidateDuplicates(context, payload);
  const target = join(candidateDir, `${payload.candidateId}.md`);
  if (duplicates.length > 0 && !payload.confirmDuplicate) {
    return {
      code: 3,
      output: {
        code: 'candidate-duplicates-found',
        duplicates,
      },
    };
  }
  const targetIssueResult = assertTargetsDoNotExist([{ abs: target, path: knowledgePath(knowledgeRoot, 'candidates', `${payload.candidateId}.md`) }]);
  if (targetIssueResult) return { code: 1, output: { issues: [targetIssueResult] } };
  mkdirSync(candidateDir, { recursive: true });
  let markdown = template.text;
  markdown = replaceLine(markdown, 'name', payload.name);
  markdown = replaceLine(markdown, 'keywords', formatInlineList(payload.keywords));
  markdown = replaceLine(markdown, 'possible_contexts', formatInlineList(payload.possibleContexts ?? payload.possible_contexts));
  markdown = replaceLine(markdown, 'code_symbols', formatInlineList(payload.code_symbols ?? payload.codeSymbols));
  markdown = replaceLine(markdown, 'identity_symbols', formatInlineList(payload.identity_symbols ?? payload.identitySymbols));
  markdown = replaceLine(markdown, 'supporting_symbols', formatInlineList(payload.supporting_symbols ?? payload.supportingSymbols));
  markdown = replaceTemplateValue(markdown, 'Candidate Name', payload.name);
  const sections = candidateSectionsFromPayload({ ...payload, body: effectiveBody });
  for (const [heading, content] of sections) markdown = injectAfterHeading(markdown, heading, content);
  writeMarkdown(target, markdown);
  return { code: 0, output: { created: true, updated: false, candidateId: payload.candidateId, path: knowledgePath(knowledgeRoot, 'candidates', `${payload.candidateId}.md`), issues: [] } };
}

function duplicateDecisionFor(payload, duplicateOutput, decisions) {
  const candidateId = payload.candidateId;
  const updateExisting = decisions.updateExisting?.[candidateId];
  if (updateExisting) {
    return {
      action: 'updateExisting',
      payload: {
        ...payload,
        updateExisting: true,
        updateCandidateId: updateExisting,
        confirmDuplicate: true,
      },
      reason: `update ${updateExisting}`,
    };
  }
  const accepted = new Set(normalizeList(decisions.acceptDistinct));
  if (accepted.has(candidateId)) {
    return {
      action: 'acceptDistinct',
      payload: { ...payload, confirmDuplicate: true },
      reason: 'confirmed distinct despite duplicate hints',
    };
  }
  return {
    action: 'blocked',
    payload,
    reason: 'duplicate decision required',
    duplicates: duplicateOutput.duplicates ?? [],
  };
}

function planCandidateWrites(input, candidates, decisions, reduceOutput = {}) {
  const results = [];
  const confirmedDuplicates = [];
  const blockedDuplicates = [];
  const plans = [];
  const batchDuplicates = findBatchDuplicatePlan(candidates);
  const acceptedBatchDuplicates = new Map();
  for (const duplicate of batchDuplicates) {
    blockedDuplicates.push({
      candidateId: duplicate.candidateIds.at(-1),
      duplicates: duplicate.candidateIds.map((candidateId) => ({ candidateId, matchedFields: [duplicate.reason] })),
      reason: duplicate.reason,
      actionRequired: duplicate.actionRequired,
      symbol: duplicate.symbol,
    });
  }
  if (blockedDuplicates.length > 0) {
    return { plans, results, confirmedDuplicates, blockedDuplicates };
  }
  const accepted = new Set(normalizeList(decisions.acceptDistinct));
  const pairAccepted = new Set();
  for (const duplicate of reduceOutput.possibleDuplicates ?? []) {
    const leftId = duplicate.left?.candidateId;
    const rightId = duplicate.right?.candidateId;
    if (!rightId) continue;
    if (accepted.has(rightId)) {
      acceptedBatchDuplicates.set(rightId, [...(acceptedBatchDuplicates.get(rightId) ?? []), duplicate]);
      if (leftId) pairAccepted.add(leftId);
      pairAccepted.add(rightId);
      continue;
    }
    blockedDuplicates.push({
      candidateId: rightId,
      duplicates: [duplicate.left, duplicate.right],
      reason: 'duplicate decision required',
      matchedFields: duplicate.matchedFields ?? [],
    });
    results.push({
      candidateId: rightId,
      action: 'blocked',
      exitCode: 3,
      output: {
        code: 'candidate-duplicates-found',
        duplicates: [duplicate.left, duplicate.right],
      },
    });
  }
  if (blockedDuplicates.length > 0) {
    return { plans, results, confirmedDuplicates, blockedDuplicates };
  }
  for (const candidatePayload of candidates) {
    const acceptedBatchDuplicate = acceptedBatchDuplicates.get(candidatePayload.candidateId);
    if (acceptedBatchDuplicate) {
      confirmedDuplicates.push({
        candidateId: candidatePayload.candidateId,
        action: 'acceptDistinct',
        reason: decisions.reasons?.[candidatePayload.candidateId] ?? 'confirmed distinct despite batch duplicate hints',
        duplicates: acceptedBatchDuplicate,
      });
      plans.push({
        candidateId: candidatePayload.candidateId,
        action: 'acceptDistinct',
        payload: { ...candidatePayload, confirmDuplicate: true },
      });
      continue;
    }
    if (pairAccepted.has(candidatePayload.candidateId)) {
      plans.push({
        candidateId: candidatePayload.candidateId,
        action: 'acceptDistinct',
        payload: { ...candidatePayload, confirmDuplicate: true },
      });
      continue;
    }
    const duplicates = findCandidateDuplicates(resolveRepoContext(input), candidatePayload);
    if (duplicates.length > 0) {
      const duplicateOutput = { code: 'candidate-duplicates-found', duplicates };
      const decision = duplicateDecisionFor(candidatePayload, duplicateOutput, decisions);
      if (decision.action === 'blocked') {
        blockedDuplicates.push({
          candidateId: candidatePayload.candidateId,
          duplicates: decision.duplicates,
          reason: decision.reason,
        });
        results.push({ candidateId: candidatePayload.candidateId, action: decision.action, exitCode: 3, output: duplicateOutput });
        continue;
      }
      confirmedDuplicates.push({
        candidateId: candidatePayload.candidateId,
        action: decision.action,
        reason: decisions.reasons?.[candidatePayload.candidateId] ?? decision.reason,
        duplicates,
      });
      plans.push({ candidateId: candidatePayload.candidateId, action: decision.action, payload: decision.payload });
      continue;
    }
    plans.push({ candidateId: candidatePayload.candidateId, action: 'created', payload: candidatePayload });
  }
  return { plans, results, confirmedDuplicates, blockedDuplicates };
}

export function writeCandidates(input = {}) {
  const payload = input.payload ?? {};
  const reduceOutput = payload.reduceOutput ?? payload;
  const candidates = [...(reduceOutput.writable ?? []), ...(reduceOutput.lowConfidence ?? [])];
  if (!Array.isArray(candidates)) {
    return { code: 2, output: { issues: [inputIssue('reduceOutput writable/lowConfidence must be arrays.', { field: 'payload.reduceOutput' })] } };
  }
  if (reduceOutput.gate && reduceOutput.gate !== 'ok') {
    return { code: 3, output: { issues: [inputIssue('reduceOutput gate is not ok; refusing to write candidates.', { gate: reduceOutput.gate })], written: 0, blocked: reduceOutput.batchDuplicates?.length ?? 0, results: [], confirmedDuplicates: [], blockedDuplicates: reduceOutput.batchDuplicates ?? [] } };
  }
  const decisions = payload.duplicateDecisions ?? {};
  const { plans, results, confirmedDuplicates, blockedDuplicates } = planCandidateWrites(input, candidates, decisions, reduceOutput);
  if (blockedDuplicates.length > 0) {
    return {
      code: 3,
      output: {
        issues: [],
        written: 0,
        blocked: blockedDuplicates.length,
        results,
        confirmedDuplicates,
        blockedDuplicates,
      },
    };
  }
  for (const plan of plans) {
    const result = createCandidate({ ...input, payload: plan.payload });
    results.push({ candidateId: plan.candidateId, action: result.code === 0 ? plan.action : 'failed', exitCode: result.code, output: result.output });
  }
  const failed = results.filter((result) => ![0, 1].includes(result.exitCode) && result.action !== 'blocked');
  const code = blockedDuplicates.length > 0 ? 3 : (failed.length > 0 ? 1 : 0);
  return {
    code,
    output: {
      issues: failed.flatMap((result) => result.output?.issues ?? []),
      written: results.filter((result) => result.exitCode === 0).length,
      blocked: blockedDuplicates.length,
      results,
      confirmedDuplicates,
      blockedDuplicates,
    },
  };
}

export function createContext(input) {
  const context = resolveRepoContext(input);
  const { knowledgeAbs, knowledgeRoot } = context;
  const payload = input.payload ?? {};
  const issues = [
    assertValidId(payload.contextId, 'contextId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    !payload.responsibilities ? inputIssue('responsibilities is required.', { field: 'responsibilities' }) : null,
    !payload.nonResponsibilities ? inputIssue('nonResponsibilities is required.', { field: 'nonResponsibilities' }) : null,
    assertRealBody(payload.body, 'body'),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const contextTemplate = readRequiredTemplate(context, 'context.md');
  const readmeTemplate = readRequiredTemplate(context, 'context-readme.md');
  const templateIssues = [contextTemplate.issue, readmeTemplate.issue].filter(Boolean);
  if (templateIssues.length) return { code: 1, output: { issues: templateIssues } };
  const contextDir = join(knowledgeAbs, 'contexts', payload.contextId);
  const targetIssueResult = assertTargetsDoNotExist([
    { abs: join(contextDir, 'CONTEXT.md'), path: contextPath(knowledgeRoot, payload.contextId, 'CONTEXT.md') },
    { abs: join(contextDir, 'README.md'), path: contextPath(knowledgeRoot, payload.contextId, 'README.md') },
  ]);
  if (targetIssueResult) return { code: 1, output: { issues: [targetIssueResult] } };
  mkdirSync(join(contextDir, 'capabilities'), { recursive: true });
  mkdirSync(join(contextDir, 'evidence'), { recursive: true });
  const relatedContexts = sectionText(
    payload.relatedContexts ?? payload.related_contexts,
    '暂无已确认相关上下文；如发现跨上下文依赖，应在 CONTEXT-MAP.md 补充关系。',
  );
  const openQuestions = sectionText(
    payload.openQuestions,
    '暂无未确认问题；如需升级 verified，应补充人工确认、测试记录或生产证据。',
  );
  let contextMarkdown = replaceTemplateValue(contextTemplate.text, 'Context Name', payload.name);
  contextMarkdown = injectAfterHeading(contextMarkdown, '业务定位', payload.body);
  contextMarkdown = injectAfterHeading(contextMarkdown, '负责什么', payload.responsibilities);
  contextMarkdown = injectAfterHeading(contextMarkdown, '不负责什么', payload.nonResponsibilities);
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '核心业务语言',
    sectionText(payload.coreBusinessLanguage, `核心术语围绕「${payload.name}」展开；主要能力、证据和代码入口应统一使用该上下文中的业务命名。`),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '避免混用',
    sectionText(payload.avoidConfusion, payload.nonResponsibilities),
  );
  contextMarkdown = injectAfterHeading(contextMarkdown, '相关上下文', relatedContexts);
  contextMarkdown = injectAfterHeading(contextMarkdown, '未确认问题', openQuestions);
  let readmeMarkdown = replaceTemplateValue(readmeTemplate.text, 'Context Name', payload.name);
  readmeMarkdown = injectAfterHeading(readmeMarkdown, '一句话定位', payload.summary);
  readmeMarkdown = injectAfterHeading(readmeMarkdown, '业务边界', `负责：${payload.responsibilities}\n\n不负责：${payload.nonResponsibilities}`);
  readmeMarkdown = injectAfterHeading(
    readmeMarkdown,
    '主要能力',
    sectionText(payload.primaryCapabilities, '暂无已确认主要能力；创建 capability 文档后补充到本节。'),
  );
  readmeMarkdown = injectAfterHeading(
    readmeMarkdown,
    '上下游关系',
    sectionText(payload.upstreamDownstream, relatedContexts),
  );
  readmeMarkdown = injectAfterHeading(
    readmeMarkdown,
    '相关文档',
    sectionText(payload.relatedDocs, '暂无已确认相关文档；创建 capability/evidence 后补充到本节。'),
  );
  readmeMarkdown = injectAfterHeading(readmeMarkdown, '未确认问题', openQuestions);
  writeMarkdown(join(contextDir, 'CONTEXT.md'), contextMarkdown);
  writeMarkdown(join(contextDir, 'README.md'), readmeMarkdown);
  const contextMapPath = join(knowledgeAbs, 'CONTEXT-MAP.md');
  const current = readFileSync(contextMapPath, 'utf8');
  const responsibilitiesSummary = contextMapSummary(payload.responsibilities);
  const nonResponsibilitiesSummary = contextMapSummary(payload.nonResponsibilities);
  const entry = `- ${payload.contextId}: ${payload.name} - ${payload.summary}
  - Path: contexts/${payload.contextId}/CONTEXT.md
  - Responsibilities: ${responsibilitiesSummary}
  - Non-responsibilities: ${nonResponsibilitiesSummary}`;
  const withoutTemplate = current
    .replace(/- `?\{context-id\}`?: `?\{Context Name\}`? - `?\{one sentence summary\}`?\n  - Path: `contexts\/\{context-id\}\/CONTEXT\.md`\n  - Responsibilities: `?\{short responsibility summary\}`?\n  - Non-responsibilities: `?\{short non-responsibility summary\}`?/, entry)
    .replace(/\n- `?\{source-context\}`? -> `?\{target-context\}`?: `?\{relationship summary\}`?/g, '')
    .replace(/\n- `?\{question\}`?/g, '');
  writeFileSync(contextMapPath, withoutTemplate.includes(entry) ? withoutTemplate : current.replace('## Relationships', `${entry}\n\n## Relationships`));
  return { code: 0, output: { issues: [] } };
}

export function promoteCandidate(input) {
  const context = resolveRepoContext(input);
  const { knowledgeAbs, knowledgeRoot, repoRoot } = context;
  const payload = input.payload ?? {};
  const candidateId = payload.candidateId;
  const contextId = payload.contextId ?? candidateId;
  const capabilities = payload.capabilities ?? [];
  const issues = [
    assertValidId(candidateId, 'candidateId'),
    assertValidId(contextId, 'contextId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    !payload.responsibilities ? inputIssue('responsibilities is required.', { field: 'responsibilities' }) : null,
    !payload.nonResponsibilities ? inputIssue('nonResponsibilities is required.', { field: 'nonResponsibilities' }) : null,
    assertRealBody(payload.body, 'body'),
    ...validatePromoteKnowledgePayload(capabilities),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const candidatePath = join(knowledgeAbs, 'candidates', `${candidateId}.md`);
  if (!existsSync(candidatePath)) {
    return { code: 1, output: { issues: [targetIssue('Candidate does not exist.', knowledgePath(knowledgeRoot, 'candidates', `${candidateId}.md`))] } };
  }
  const changeTemplate = readRequiredTemplate(context, 'change.md');
  if (changeTemplate.issue) return { code: 1, output: { issues: [changeTemplate.issue] } };
  const contextDocPath = contextPath(knowledgeRoot, contextId, 'CONTEXT.md');
  const contextReadmePath = contextPath(knowledgeRoot, contextId, 'README.md');
  const candidateRelPath = knowledgePath(knowledgeRoot, 'candidates', `${candidateId}.md`);
  const capabilityPaths = capabilities.map((capability) => contextPath(knowledgeRoot, contextId, 'capabilities', `${capability.capabilityId}.md`));
  const evidencePaths = capabilities.flatMap((capability) => capability.evidence.map((evidence) => contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`)));
  const generatedAt = new Date().toISOString();
  const changeId = payload.changeId ?? `${slugTimestamp(new Date(generatedAt))}-promote-candidate-${candidateId}`;
  const changeRelPath = knowledgePath(knowledgeRoot, 'changes', `${changeId}.md`);
  const changePath = join(knowledgeAbs, 'changes', `${changeId}.md`);
  const relatedDocs = evidencePathList(evidencePaths);
  const upstreamDownstream = formatReadmeUpstreamDownstream(capabilities);
  const coreBusinessLanguage = capabilities
    .map((capability) => `- ${capability.name}: ${capability.summary}`)
    .join('\n');
  const targetIssueResult = assertTargetsDoNotExist([
    { abs: changePath, path: changeRelPath },
    { abs: join(knowledgeAbs, 'contexts', contextId, 'CONTEXT.md'), path: contextDocPath },
    { abs: join(knowledgeAbs, 'contexts', contextId, 'README.md'), path: contextReadmePath },
    ...capabilities.map((capability) => ({
      abs: join(knowledgeAbs, 'contexts', contextId, 'capabilities', `${capability.capabilityId}.md`),
      path: contextPath(knowledgeRoot, contextId, 'capabilities', `${capability.capabilityId}.md`),
    })),
    ...capabilities.flatMap((capability) => capability.evidence.map((evidence) => ({
      abs: join(knowledgeAbs, 'contexts', contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`),
      path: contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`),
    }))),
  ]);
  if (targetIssueResult) return { code: 1, output: { issues: [targetIssueResult] } };
  const contextResult = createContext({
    ...input,
    payload: {
      contextId,
      name: payload.name,
      summary: payload.summary,
      responsibilities: payload.responsibilities,
      nonResponsibilities: payload.nonResponsibilities,
      body: payload.body,
      coreBusinessLanguage: payload.coreBusinessLanguage ?? coreBusinessLanguage,
      avoidConfusion: payload.avoidConfusion ?? payload.nonResponsibilities,
      relatedContexts: payload.relatedContexts,
      openQuestions: payload.openQuestions,
      primaryCapabilities: payload.primaryCapabilities ?? capabilitySummaryList(capabilities),
      upstreamDownstream: payload.upstreamDownstream ?? upstreamDownstream,
      relatedDocs: payload.relatedDocs ?? relatedDocs,
    },
  });
  if (contextResult.code !== 0) return contextResult;
  const createdCapabilityPaths = [];
  const createdEvidencePaths = [];
  for (const capability of capabilities) {
    const capabilityResult = createCapability({
      ...input,
      payload: {
        contextId,
        capabilityId: capability.capabilityId,
        name: capability.name,
        summary: capability.summary,
        responsibilities: capability.responsibilities,
        nonResponsibilities: capability.nonResponsibilities,
        body: capability.body,
        businessObjects: capability.businessObjects ?? collectEvidenceSection(capability, 'dataMessages'),
        upstreamDownstream: capability.upstreamDownstream || collectEvidenceSection(capability, 'callRelations') || collectEvidenceSection(capability, 'routes'),
        designIntent: capability.designIntent,
        codeFactEntries: capability.codeFactEntries ?? collectEvidenceSection(capability, 'entryPaths'),
        verificationMethod: capability.verificationMethod ?? (capability.evidence ?? [])
          .map((evidence) => `- ${evidence.evidenceKind}: ${evidence.generationMethod ?? evidence.generation_evidence}`)
          .join('\n'),
        openQuestions: capability.openQuestions ?? collectEvidenceSection(capability, 'limitations'),
        evidencePaths: capabilityEvidencePaths(knowledgeRoot, contextId, capability),
      },
    });
    if (capabilityResult.code !== 0) return {
      code: capabilityResult.code,
      output: { issues: (capabilityResult.output.issues ?? []).map((issue) => prefixIssue(issue, `capability ${capability.capabilityId}`)) },
    };
    createdCapabilityPaths.push(contextPath(knowledgeRoot, contextId, 'capabilities', `${capability.capabilityId}.md`));
    for (const evidence of capability.evidence) {
      const evidenceResult = createEvidence({
        ...input,
        payload: {
          ...evidence,
          contextId,
          capabilityId: capability.capabilityId,
        },
      });
      if (evidenceResult.code !== 0) return {
        code: evidenceResult.code,
        output: { issues: (evidenceResult.output.issues ?? []).map((issue) => prefixIssue(issue, `evidence ${capability.capabilityId}-${evidence.evidenceKind}`)) },
      };
      createdEvidencePaths.push(contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`));
    }
  }
  unlinkSync(candidatePath);
  mkdirSync(dirname(changePath), { recursive: true });
  let changeMarkdown = changeTemplate.text;
  changeMarkdown = replaceLine(changeMarkdown, 'generated_at', generatedAt);
  changeMarkdown = replaceLine(changeMarkdown, 'source_ref', candidateRelPath);
  changeMarkdown = replaceLine(changeMarkdown, 'changed_paths', formatInlineList([candidateRelPath, contextDocPath, contextReadmePath, ...createdCapabilityPaths, ...createdEvidencePaths]));
  changeMarkdown = replaceLine(changeMarkdown, 'affected_entries', formatInlineList([contextId, ...capabilities.map((capability) => capability.capabilityId)]));
  changeMarkdown = replaceLine(changeMarkdown, 'status', 'draft');
  changeMarkdown = changeMarkdown.replace('# Knowledge Change Impact Report', `# Promote Candidate: ${payload.name}`);
  changeMarkdown = injectAfterHeading(changeMarkdown, '变更来源', `Candidate \`${candidateRelPath}\` was promoted to formal context \`${contextDocPath}\` and then removed from candidates.`);
  changeMarkdown = injectAfterHeading(changeMarkdown, '可能影响的业务能力', createdCapabilityPaths.map((path) => `- ${path}`).join('\n'));
  changeMarkdown = injectAfterHeading(changeMarkdown, '可能影响的证据', createdEvidencePaths.map((path) => `- ${path}`).join('\n'));
  changeMarkdown = injectAfterHeading(changeMarkdown, '建议操作', 'Run sync/verify and review the generated capability and evidence documents before marking anything verified.');
  writeMarkdown(changePath, changeMarkdown);
  return {
    code: 0,
    output: {
      issues: [],
      candidatePath: candidateRelPath,
      candidateRemoved: true,
      contextPath: contextDocPath,
      contextReadmePath,
      capabilityPaths: createdCapabilityPaths,
      evidencePaths: createdEvidencePaths,
      changePath: changeRelPath,
      docsCount: createdCapabilityPaths.length + createdEvidencePaths.length,
    },
  };
}

export function createCapability(input) {
  const context = resolveRepoContext(input);
  const { knowledgeAbs, knowledgeRoot } = context;
  const payload = input.payload ?? {};
  const issues = [
    assertValidId(payload.contextId, 'contextId'),
    assertValidId(payload.capabilityId, 'capabilityId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    !payload.responsibilities ? inputIssue('responsibilities is required.', { field: 'responsibilities' }) : null,
    !payload.nonResponsibilities ? inputIssue('nonResponsibilities is required.', { field: 'nonResponsibilities' }) : null,
    assertRealBody(payload.body, 'body'),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const contextDir = join(knowledgeAbs, 'contexts', payload.contextId);
  if (!existsSync(join(contextDir, 'CONTEXT.md'))) {
    return { code: 1, output: { issues: [{ severity: 'P1', message: 'Context does not exist.', path: contextPath(knowledgeRoot, payload.contextId, 'CONTEXT.md') }] } };
  }
  const template = readRequiredTemplate(context, 'capability.md');
  if (template.issue) return { code: 1, output: { issues: [template.issue] } };
  const target = join(contextDir, 'capabilities', `${payload.capabilityId}.md`);
  const targetIssueResult = assertTargetsDoNotExist([{ abs: target, path: contextPath(knowledgeRoot, payload.contextId, 'capabilities', `${payload.capabilityId}.md`) }]);
  if (targetIssueResult) return { code: 1, output: { issues: [targetIssueResult] } };
  mkdirSync(join(contextDir, 'capabilities'), { recursive: true });
  let markdown = template.text;
  markdown = replaceLine(markdown, 'domain', payload.contextId);
  markdown = replaceLine(markdown, 'capability', payload.capabilityId);
  markdown = replaceLine(markdown, 'name', payload.name);
  markdown = replaceLine(markdown, 'summary', payload.summary);
  markdown = replaceLine(markdown, 'evidence', formatInlineList(payload.evidencePaths));
  markdown = replaceTemplateValue(markdown, 'Business Capability Name', payload.name);
  markdown = injectAfterHeading(markdown, '一句话定位', payload.summary);
  markdown = injectAfterHeading(markdown, '负责什么', payload.responsibilities);
  markdown = injectAfterHeading(markdown, '不负责什么', payload.nonResponsibilities);
  markdown = injectAfterHeading(
    markdown,
    '关键业务对象',
    sectionText(payload.businessObjects, `围绕「${payload.name}」能力中的请求、配置、状态和证据对象维护业务事实。`),
  );
  markdown = injectAfterHeading(markdown, '典型流程', payload.body);
  markdown = injectAfterHeading(
    markdown,
    '上下游关系',
    sectionText(payload.upstreamDownstream, '暂无已确认上下游关系；补充 call-flow/routes evidence 后维护本节。'),
  );
  markdown = injectAfterHeading(
    markdown,
    '设计意图 / 架构取舍',
    sectionText(payload.designIntent, `该能力聚焦 ${payload.summary}；边界外职责按“不负责什么”处理，避免把外部实现细节并入本能力。`),
  );
  markdown = injectAfterHeading(
    markdown,
    '代码事实入口',
    sectionText(payload.codeFactEntries, '暂无已确认代码事实入口；补充 routes/call-flow/data evidence 后维护本节。'),
  );
  markdown = injectAfterHeading(
    markdown,
    '验证方式',
    sectionText(payload.verificationMethod, '当前为 draft；升级 verified 前需要补充测试、人工确认或生产证据。'),
  );
  markdown = injectAfterHeading(
    markdown,
    '未确认问题',
    sectionText(payload.openQuestions, '暂无未确认问题；如发现证据缺口，应在本节记录。'),
  );
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
}

export function createEvidence(input) {
  const context = resolveRepoContext(input);
  const { knowledgeAbs, knowledgeRoot } = context;
  const payload = input.payload ?? {};
  const issues = [
    assertValidId(payload.contextId, 'contextId'),
    assertValidId(payload.capabilityId, 'capabilityId'),
    !EVIDENCE_KINDS.includes(payload.evidenceKind) ? inputIssue('evidenceKind is not supported.', { field: 'evidenceKind' }) : null,
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    !payload.source ? inputIssue('source is required.', { field: 'source' }) : null,
    !payload.generator ? inputIssue('generator is required.', { field: 'generator' }) : null,
    !payload.generation_evidence ? inputIssue('generation_evidence is required.', { field: 'generation_evidence' }) : null,
    assertRealBody(payload.body, 'body'),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const capabilityPath = join(knowledgeAbs, 'contexts', payload.contextId, 'capabilities', `${payload.capabilityId}.md`);
  if (!existsSync(capabilityPath)) {
    return { code: 1, output: { issues: [{ severity: 'P1', message: 'Capability does not exist.', path: contextPath(knowledgeRoot, payload.contextId, 'capabilities', `${payload.capabilityId}.md`) }] } };
  }
  const template = readRequiredTemplate(context, 'evidence.md');
  if (template.issue) return { code: 1, output: { issues: [template.issue] } };
  const evidenceDir = join(knowledgeAbs, 'contexts', payload.contextId, 'evidence');
  const target = join(evidenceDir, `${payload.capabilityId}-${payload.evidenceKind}.md`);
  const targetIssueResult = assertTargetsDoNotExist([{ abs: target, path: contextPath(knowledgeRoot, payload.contextId, 'evidence', `${payload.capabilityId}-${payload.evidenceKind}.md`) }]);
  if (targetIssueResult) return { code: 1, output: { issues: [targetIssueResult] } };
  mkdirSync(evidenceDir, { recursive: true });
  let markdown = template.text;
  markdown = replaceLine(markdown, 'evidence_kind', payload.evidenceKind);
  markdown = replaceLine(markdown, 'source', payload.source);
  markdown = replaceLine(markdown, 'generator', payload.generator);
  markdown = replaceLine(markdown, 'generation_evidence', payload.generation_evidence);
  markdown = replaceLine(markdown, 'capability', payload.capabilityId);
  markdown = replaceLine(markdown, 'name', payload.name);
  markdown = replaceLine(markdown, 'summary', payload.summary);
  markdown = replaceTemplateValue(markdown, 'Capability', payload.name);
  markdown = injectAfterHeading(markdown, '事实摘要', payload.body);
  markdown = injectAfterHeading(markdown, '入口路径', sectionText(payload.entryPaths, '本轮未记录具体入口路径；如需要可追溯代码事实，请补充文件路径和行号。'));
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '路由 / 接口', payload.routes);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '调用关系', payload.callRelations);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '数据 / 消息', payload.dataMessages);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '前端入口', payload.frontendEntries);
  markdown = injectAfterHeading(markdown, '限制与疑点', sectionText(payload.limitations, '暂无额外限制；升级 verified 前仍需补充确认来源。'));
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
}
