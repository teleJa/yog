import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_SYMBOL_PATTERN, EVIDENCE_KINDS, ID_PATTERN } from './constants.mjs';
import { DEFAULT_DISCOVER_CONFIG, mergeConfig, writeConfig } from './config.mjs';
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
    codeFactProvider: input.payload?.codeFactProvider ?? existing.codeFactProvider ?? { type: 'codegraph', status: 'configured' },
    discover: existing.discover ?? DEFAULT_DISCOVER_CONFIG,
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
        message: 'Run automatic discover-candidates only when CodeGraph is initialized for this repository.',
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
  const issues = [
    !EVIDENCE_KINDS.includes(evidence?.evidenceKind) ? inputIssue(`${prefix}.evidenceKind is not supported.`, { field: `${prefix}.evidenceKind` }) : null,
    !evidence?.name ? inputIssue(`${prefix}.name is required.`, { field: `${prefix}.name` }) : null,
    !evidence?.summary ? inputIssue(`${prefix}.summary is required.`, { field: `${prefix}.summary` }) : null,
    !evidence?.source ? inputIssue(`${prefix}.source is required.`, { field: `${prefix}.source` }) : null,
    !evidence?.generator ? inputIssue(`${prefix}.generator is required.`, { field: `${prefix}.generator` }) : null,
    !evidence?.generation_evidence ? inputIssue(`${prefix}.generation_evidence is required.`, { field: `${prefix}.generation_evidence` }) : null,
    assertRealBody(evidence?.body, `${prefix}.body`),
  ].filter(Boolean);
  if (evidence?.evidenceKind === 'call-flow') issues.push(...validateCallFlowEvidence(evidence, prefix));
  if (evidence?.evidenceKind === 'external') issues.push(...validateExternalEvidence(evidence, prefix));
  return issues;
}

function validateCallFlowEvidence(evidence, prefix) {
  const lines = uniqueLines([evidence.callRelations]);
  const chainPattern = /^[A-Z][$A-Za-z0-9_]*#[A-Za-z_$][$A-Za-z0-9_]*(?:\s*->\s*[A-Z][$A-Za-z0-9_]*#[A-Za-z_$][$A-Za-z0-9_]*)+$/;
  if (lines.length === 0) {
    return [inputIssue(`${prefix}.callRelations is required for call-flow evidence.`, { field: `${prefix}.callRelations` })];
  }
  if (lines.some((line) => !chainPattern.test(line.replace(/^[-*]\s+/, '').trim()))) {
    return [inputIssue(`${prefix}.callRelations must contain directed Class#method -> Class#method chains.`, { field: `${prefix}.callRelations` })];
  }
  return [];
}

const EXTERNAL_DEPENDENCY_TYPES = new Set(['rpc', 'http-api', 'mq', 'cache', 'object-storage', 'file-service', 'third-party-sdk', 'downstream-service']);

function validateExternalEvidence(evidence, prefix) {
  const required = [
    ['dependencyAnchors', evidence.dependencyAnchors ?? evidence.externalDependencies],
    ['callers', evidence.callers],
    ['downstreamInterfaces', evidence.downstreamInterfaces],
    ['dependencyType', evidence.dependencyType],
    ['triggerConditions', evidence.triggerConditions],
    ['failureHandling', evidence.failureHandling],
    ['boundaryNotes', evidence.boundaryNotes],
    ['limitations', evidence.limitations],
  ];
  const issues = required
    .filter(([, value]) => !asText(value))
    .map(([field]) => inputIssue(`${prefix}.${field} is required for external evidence.`, { field: `${prefix}.${field}` }));
  if (evidence.dependencyType && !EXTERNAL_DEPENDENCY_TYPES.has(evidence.dependencyType)) {
    issues.push(inputIssue(`${prefix}.dependencyType is not supported.`, { field: `${prefix}.dependencyType`, allowed: [...EXTERNAL_DEPENDENCY_TYPES] }));
  }
  return issues;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectAfterHeading(markdown, heading, content) {
  const marker = `## ${heading}`;
  const pattern = new RegExp(`^${escapeRegExp(marker)}$`, 'm');
  if (!pattern.test(markdown)) return `${markdown.trim()}\n\n${content}\n`;
  return markdown.replace(pattern, `${marker}\n\n${content}`);
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

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function resolveDiscoverThreshold(input, context) {
  const payloadValue = input.payload?.maxCandidates;
  if (payloadValue !== undefined && !isPositiveInteger(payloadValue)) {
    return {
      issues: [inputIssue('payload.maxCandidates must be a positive integer.', { field: 'payload.maxCandidates' })],
    };
  }
  if (payloadValue !== undefined) {
    return { threshold: payloadValue, thresholdSource: 'payload', issues: [] };
  }
  const configValue = context.config?.discover?.maxMidLowCandidates;
  if (isPositiveInteger(configValue)) {
    return { threshold: configValue, thresholdSource: 'config', issues: [] };
  }
  const issues = configValue === undefined
    ? []
    : [{
        severity: 'P2',
        message: 'Invalid discover.maxMidLowCandidates config; defaulting to 10.',
        path: '.yog/config.json',
        details: { field: 'discover.maxMidLowCandidates', value: configValue },
      }];
  return { threshold: DEFAULT_DISCOVER_CONFIG.maxMidLowCandidates, thresholdSource: 'default', issues };
}

function gatedCandidateBrief(payload) {
  return {
    candidateId: payload.candidateId,
    name: payload.name,
    confidence: payload.confidence,
    score: payload.score,
    hitAgents: payload.hitAgents ?? [],
    identitySymbols: payload.identitySymbols ?? payload.identity_symbols ?? [],
  };
}

function filterPossibleDuplicatesForCandidates(possibleDuplicates, candidates) {
  const ids = new Set(candidates.map((candidate) => candidate.candidateId));
  return (possibleDuplicates ?? []).filter((duplicate) => ids.has(duplicate.left?.candidateId) && ids.has(duplicate.right?.candidateId));
}

function renderGatedCandidatesReport(reduceOutput) {
  const stats = reduceOutput.stats ?? {};
  const gatedCandidates = reduceOutput.gatedCandidates ?? [];
  const mediumCount = gatedCandidates.filter((candidate) => candidate.confidence === 'medium').length;
  const lowCount = gatedCandidates.filter((candidate) => candidate.confidence === 'low').length;
  const rows = gatedCandidates.map((candidate) => {
    const hitAgents = normalizeList(candidate.hitAgents).join(', ');
    const identitySymbols = normalizeList(candidate.identitySymbols ?? candidate.identity_symbols).join(', ');
    return `| ${candidate.candidateId} | ${candidate.name} | ${candidate.confidence} | ${candidate.score} | ${hitAgents} | ${identitySymbols} |`;
  });
  return [
    '# 被门禁挡下的中低信度候选',
    '',
    `> 生成时间: ${new Date().toISOString()}`,
    `> 阈值: maxMidLowCandidates = ${stats.threshold ?? DEFAULT_DISCOVER_CONFIG.maxMidLowCandidates}(来源: ${stats.thresholdSource ?? 'default'})`,
    `> 本次被挡: ${gatedCandidates.length} 个 (medium ${mediumCount} / low ${lowCount})`,
    `> 已自动写入的 high 候选: ${stats.high ?? 0} 个`,
    '',
    '## 说明',
    '',
    '本次自动发现的中低信度候选数量超过阈值,已挡下不写入正式候选区。',
    '请缩小扫描范围重跑,或用 payload.maxCandidates 放宽后重跑。',
    '',
    '## 被挡候选清单',
    '',
    '| candidateId | name | confidence | score | hitAgents | identity_symbols |',
    '|---|---|---|---|---|---|',
    ...(rows.length ? rows : ['|  |  |  |  |  |  |']),
    '',
  ].join('\n');
}

function writeGatedCandidatesReport(input, reduceOutput) {
  if (reduceOutput.gate !== 'mid-low-scope-required' && !(reduceOutput.gatedCandidates?.length > 0)) return null;
  const context = resolveRepoContext(input);
  const reportDir = join(context.knowledgeAbs, 'candidates', '_gated');
  const reportPath = join(reportDir, 'gated-candidates.md');
  mkdirSync(reportDir, { recursive: true });
  writeMarkdown(reportPath, renderGatedCandidatesReport(reduceOutput));
  return knowledgePath(context.knowledgeRoot, 'candidates', '_gated', 'gated-candidates.md');
}

export function reduceCandidates(input = {}) {
  const context = resolveRepoContext(input);
  const batches = input.payload?.batches;
  const threshold = resolveDiscoverThreshold(input, context);
  if (threshold.issues?.some((issue) => issue.details?.field === 'payload.maxCandidates')) {
    return { code: 2, output: { issues: threshold.issues } };
  }
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
    high: 0,
    midLow: 0,
    threshold: threshold.threshold,
    thresholdSource: threshold.thresholdSource,
    possibleDuplicates: 0,
    diskDuplicates: 0,
    joinConflicts: components.joinConflicts.length,
    rejected: rejected.length,
  };
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
  const highConfidence = [];
  const midLowPayloads = [];
  for (const cluster of clusters) {
    const payload = clusterToPayload(cluster, duplicateHintsByCandidateId.get(cluster.representative.candidateId) ?? []);
    if (cluster.confidence === 'high') highConfidence.push(payload);
    else midLowPayloads.push(payload);
    if (cluster.confidence === 'low') lowConfidence.push(payload);
    else writable.push(payload);
  }
  const midLowGateTriggered = midLowPayloads.length > threshold.threshold;
  const effectiveWritable = midLowGateTriggered ? highConfidence : writable;
  const effectiveLowConfidence = midLowGateTriggered ? [] : lowConfidence;
  const effectiveCandidates = [...effectiveWritable, ...effectiveLowConfidence];
  const effectivePossibleDuplicates = filterPossibleDuplicatesForCandidates(possibleDuplicates, effectiveCandidates);
  const warnings = [];
  let diskDuplicateCount = 0;
  for (const payload of effectiveCandidates) {
    const duplicates = findCandidateDuplicates(context, payload, { warnings });
    if (duplicates.length > 0) {
      diskDuplicateCount += 1;
      payload.diskDuplicate = {
        matched: true,
        candidateIds: uniqueSorted(duplicates.map((duplicate) => duplicate.candidateId)),
      };
    }
  }
  const batchDuplicates = findBatchDuplicatePlan(effectiveCandidates);
  const stats = {
    ...baseStats,
    writable: effectiveWritable.length,
    lowConfidence: effectiveLowConfidence.length,
    high: highConfidence.length,
    midLow: midLowPayloads.length,
    possibleDuplicates: effectivePossibleDuplicates.length,
    diskDuplicates: diskDuplicateCount,
    batchDuplicates: batchDuplicates.length,
  };
  const gate = batchDuplicates.length > 0
    ? 'batch-duplicates-require-resolution'
    : (midLowGateTriggered ? 'mid-low-scope-required' : 'ok');
  return {
    code: (diskDuplicateCount > 0 || batchDuplicates.length > 0) ? 3 : 0,
    output: {
      gate,
      stats,
      writable: effectiveWritable,
      lowConfidence: effectiveLowConfidence,
      gatedCandidates: midLowGateTriggered ? midLowPayloads.map(gatedCandidateBrief) : [],
      possibleDuplicates: effectivePossibleDuplicates,
      batchDuplicates,
      joinConflicts: components.joinConflicts,
      rejected,
      issues: [...(threshold.issues ?? []), ...warnings],
    },
  };
}

function evidenceSectionFallback(evidenceKind, heading) {
  const descriptions = {
    '路由 / 接口': '本证据类型未覆盖路由或接口；如需要该事实，请补充 routes evidence。',
    调用关系: '本证据类型未覆盖调用关系；如需要该事实，请补充 call-flow evidence。',
    '数据 / 消息': '本证据类型未覆盖数据或消息结构；如需要该事实，请补充 data evidence。',
    前端入口: '本轮未发现或未覆盖前端入口；如需要该事实，请补充 ui evidence 或前端路径证据。',
    边界外依赖: '本证据类型未覆盖边界外依赖；如需要该事实，请补充 external evidence。',
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

function collectEvidenceKindSection(capability, evidenceKind, field) {
  return (capability.evidence ?? [])
    .filter((evidence) => evidence.evidenceKind === evidenceKind)
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

function normalizeObjectList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [value].filter((item) => item && typeof item === 'object');
}

function normalizeAnchorList(...values) {
  return uniquePreserve(values.flatMap((value) => normalizeList(value)));
}

function anchorFromLensItem(item) {
  return {
    entryPath: normalizeAnchorList(item.entryPath, item.entryPaths, item.controller, item.controllers),
    serviceRoots: normalizeAnchorList(item.serviceRoot, item.serviceRoots, item.service, item.services, item.callRelations),
    dataObjects: normalizeAnchorList(item.dataObject, item.dataObjects, item.mapper, item.mappers, item.entity, item.entities, item.table, item.tables, item.dataMessages),
    externalDependencies: normalizeAnchorList(item.externalDependency, item.externalDependencies, item.downstream, item.downstreams, item.rpc, item.topic, item.cache),
    operations: normalizeAnchorList(item.operation, item.operations, item.name, item.summary),
  };
}

function mergeAnchor(target, source, sourceLens) {
  for (const field of ['entryPath', 'serviceRoots', 'dataObjects', 'externalDependencies', 'operations']) {
    target[field] = uniquePreserve([...(target[field] ?? []), ...(source[field] ?? [])]);
  }
  target.sourceLens = uniquePreserve([...(target.sourceLens ?? []), sourceLens].filter(Boolean));
  return target;
}

function hasAnyTraceableAnchor(candidate) {
  return ['entryPaths', 'serviceRoots', 'dataObjects', 'externalDependencies']
    .some((field) => normalizeList(candidate?.[field]).length > 0);
}

function anchorKey(anchor) {
  return normalizeDuplicateToken([
    ...normalizeList(anchor.entryPath),
    ...normalizeList(anchor.serviceRoots),
    ...normalizeList(anchor.dataObjects),
    ...normalizeList(anchor.externalDependencies),
  ][0] ?? normalizeList(anchor.operations)[0] ?? 'unassigned');
}

function normalizeTraceLimitation(item, index, issues, prefix = 'traceLimitations') {
  const allowedAnchorTypes = ['entryPath', 'serviceRoot', 'dataObject', 'externalDependency'];
  const allowedReasons = ['dynamic-dispatch', 'reflection', 'framework-callback', 'missing-index', 'source-unavailable', 'ambiguous-symbol'];
  const allowedDecisions = ['pending', 'allow', 'reject', 'needs-more-evidence'];
  const limitation = {
    anchor: String(item?.anchor ?? '').trim(),
    anchorType: item?.anchorType,
    reason: item?.reason,
    impact: String(item?.impact ?? '').trim(),
    manualDecision: item?.manualDecision ?? 'pending',
    note: item?.note,
    decidedBy: item?.decidedBy,
    decidedAt: item?.decidedAt,
  };
  const field = `${prefix}[${index}]`;
  if (!limitation.anchor) issues.push(inputIssue(`${field}.anchor is required.`, { field: `${field}.anchor` }));
  if (limitation.anchorType && !allowedAnchorTypes.includes(limitation.anchorType)) issues.push(inputIssue(`${field}.anchorType is not supported.`, { field: `${field}.anchorType` }));
  if (!allowedReasons.includes(limitation.reason)) issues.push(inputIssue(`${field}.reason is not supported.`, { field: `${field}.reason` }));
  if (!limitation.impact) issues.push(inputIssue(`${field}.impact is required.`, { field: `${field}.impact` }));
  if (!allowedDecisions.includes(limitation.manualDecision)) issues.push(inputIssue(`${field}.manualDecision is not supported.`, { field: `${field}.manualDecision` }));
  if (limitation.manualDecision === 'allow' && (!limitation.decidedBy || !limitation.decidedAt)) {
    issues.push(inputIssue(`${field}.decidedBy and ${field}.decidedAt are required when manualDecision is allow.`, { field }));
  }
  return Object.fromEntries(Object.entries(limitation).filter(([, value]) => value !== undefined && value !== ''));
}

export function extractPromoteAnchors(input = {}) {
  const payload = input.payload ?? input;
  const contextId = payload.contextId ?? payload.candidateId ?? '';
  const rawLenses = payload.lenses ?? payload.lensOutputs ?? payload.sources ?? [];
  const anchorsByKey = new Map();
  const unassignedAnchors = [];
  const items = [
    ...normalizeObjectList(payload.candidate).map((item) => ({ item, lens: 'candidate' })),
    ...normalizeObjectList(payload).filter((item) => item !== payload).map((item) => ({ item, lens: 'payload' })),
    ...normalizeObjectList(rawLenses).flatMap((lens, lensIndex) => {
      const lensName = lens.agent ?? lens.lens ?? lens.name ?? `lens-${lensIndex + 1}`;
      return [
        ...normalizeObjectList(lens),
        ...normalizeObjectList(lens.candidates),
        ...normalizeObjectList(lens.anchors),
        ...normalizeObjectList(lens.items),
      ].map((item) => ({ item, lens: lensName }));
    }),
  ];
  for (const { item, lens } of items) {
    const anchor = anchorFromLensItem(item);
    const key = anchorKey(anchor);
    const hasTrace = ['entryPath', 'serviceRoots', 'dataObjects', 'externalDependencies'].some((field) => anchor[field].length > 0);
    if (!hasTrace) {
      if (anchor.operations.length > 0) unassignedAnchors.push({ operations: anchor.operations, sourceLens: [lens], reason: 'no-traceable-anchor' });
      continue;
    }
    const existing = anchorsByKey.get(key) ?? { entryPath: [], serviceRoots: [], dataObjects: [], externalDependencies: [], operations: [], sourceLens: [] };
    anchorsByKey.set(key, mergeAnchor(existing, anchor, lens));
  }
  return {
    code: 0,
    output: {
      contextId,
      anchors: [...anchorsByKey.values()],
      unassignedAnchors,
    },
  };
}

function capabilityFromAnchor(contextId, anchor, index) {
  const primary = normalizeList(anchor.operations)[0] ?? normalizeList(anchor.entryPath)[0] ?? normalizeList(anchor.serviceRoots)[0] ?? `${contextId}-capability-${index + 1}`;
  const idSource = [
    ...normalizeList(anchor.entryPath),
    ...normalizeList(anchor.serviceRoots),
    ...normalizeList(anchor.dataObjects),
    ...normalizeList(anchor.externalDependencies),
  ][0] ?? `${contextId}-capability-${index + 1}`;
  const capabilityId = normalizeDuplicateToken(idSource.replace(/[#.].*$/, '')) || `${contextId}-capability-${index + 1}`;
  return {
    capabilityId,
    name: primary,
    summary: `Handle ${primary}.`,
    entryPaths: normalizeList(anchor.entryPath),
    serviceRoots: normalizeList(anchor.serviceRoots),
    dataObjects: normalizeList(anchor.dataObjects),
    externalDependencies: normalizeList(anchor.externalDependencies),
    operations: normalizeList(anchor.operations),
    confidence: anchor.confidence ?? 'draft',
  };
}

function qualityIssue(code, contextId, capabilityId, message, extra = {}) {
  return {
    code,
    severity: 'quality',
    context: contextId,
    capability: capabilityId,
    blocksWrite: false,
    blocksVerified: true,
    message,
    ...extra,
  };
}

function plannedCapabilityQualityIssues(contextId, capability, allCapabilities, traceLimitations = []) {
  const issues = [];
  if (allCapabilities.length === 1 && !capability.splitConfirmationReason && !capability.noSplitReason) {
    issues.push(qualityIssue('possible-under-split', contextId, capability.capabilityId, 'Single capability plan needs manual review for possible under-splitting.'));
  }
  if (normalizeList(capability.entryPaths).length === 0) issues.push(qualityIssue('missing-entry-path', contextId, capability.capabilityId, 'No entry path anchor was found.'));
  if (normalizeList(capability.serviceRoots).length === 0) issues.push(qualityIssue('missing-service-root', contextId, capability.capabilityId, 'No service root anchor was found.'));
  if (normalizeList(capability.dataObjects).length === 0 && normalizeList(capability.externalDependencies).length === 0) {
    issues.push(qualityIssue('missing-data-and-external', contextId, capability.capabilityId, 'No data object or external dependency anchor was found.'));
  }
  for (const limitation of traceLimitations.filter((item) => item.manualDecision !== 'allow')) {
    const code = limitation.manualDecision === 'reject' ? 'trace-rejected' : 'trace-pending';
    issues.push(qualityIssue(code, contextId, capability.capabilityId, `Trace limitation ${limitation.anchor} is ${limitation.manualDecision}.`, { traceLimitation: limitation }));
  }
  return issues;
}

function normalizeCapabilityPlan(payload) {
  return payload.capabilityPlan ?? payload.planOutput ?? payload.plan;
}

function validatePromotePlan(payload, contextId, capabilities) {
  const plan = normalizeCapabilityPlan(payload);
  if (!plan || typeof plan !== 'object') {
    return [inputIssue('capabilityPlan is required before promote-candidate writes documents.', { field: 'capabilityPlan' })];
  }
  if (plan.contextId && plan.contextId !== contextId) {
    return [inputIssue('capabilityPlan.contextId must match contextId.', { field: 'capabilityPlan.contextId' })];
  }
  const candidates = normalizeObjectList(plan.capabilityCandidates);
  if (candidates.length === 0) {
    return [inputIssue('capabilityPlan.capabilityCandidates must include at least one planned capability.', { field: 'capabilityPlan.capabilityCandidates' })];
  }
  const plannedById = new Map(candidates.map((candidate) => [candidate.capabilityId, candidate]));
  return capabilities.flatMap((capability, index) => {
    const prefix = `capabilities[${index}]`;
    const planned = plannedById.get(capability.capabilityId);
    if (!planned) {
      return [inputIssue(`${prefix}.capabilityId is not present in capabilityPlan.`, { field: `${prefix}.capabilityId` })];
    }
    if (!hasAnyTraceableAnchor(planned)) {
      return [inputIssue(`${prefix} planned capability must include at least one traceable anchor.`, { field: prefix })];
    }
    return [];
  });
}

export function planCapabilities(input = {}) {
  const payload = input.payload ?? input;
  const contextId = payload.contextId ?? '';
  const anchors = normalizeObjectList(payload.anchors);
  const unassignedAnchors = normalizeObjectList(payload.unassignedAnchors);
  const capabilityCandidates = normalizeObjectList(payload.capabilityCandidates).length > 0
    ? normalizeObjectList(payload.capabilityCandidates)
    : anchors.map((anchor, index) => capabilityFromAnchor(contextId, anchor, index));
  const issues = [
    assertValidId(contextId, 'contextId'),
    capabilityCandidates.length === 0 ? inputIssue('capabilityCandidates must include at least one capability candidate.', { field: 'capabilityCandidates' }) : null,
  ].filter(Boolean);
  const traceIssues = [];
  const traceLimitations = normalizeObjectList(payload.traceLimitations).map((item, index) => normalizeTraceLimitation(item, index, traceIssues));
  issues.push(...traceIssues);
  capabilityCandidates.forEach((capability, index) => {
    const prefix = `capabilityCandidates[${index}]`;
    issues.push(assertValidId(capability.capabilityId, `${prefix}.capabilityId`));
    if (!capability.name) issues.push(inputIssue(`${prefix}.name is required.`, { field: `${prefix}.name` }));
    if (!capability.summary && normalizeList(capability.operations).length === 0) {
      issues.push(inputIssue(`${prefix}.summary or ${prefix}.operations is required.`, { field: prefix }));
    }
    if (!hasAnyTraceableAnchor(capability)) issues.push(inputIssue(`${prefix} must include at least one traceable anchor.`, { field: prefix }));
  });
  if (unassignedAnchors.length > 0 && !payload.unassignedAnchorDecision) {
    issues.push(inputIssue('unassignedAnchors require unassignedAnchorDecision before writing documents.', { field: 'unassignedAnchorDecision' }));
  }
  if (issues.filter(Boolean).length > 0) {
    return { code: 1, output: { issues: issues.filter(Boolean), capabilityCandidates, traceLimitations } };
  }
  const qualityIssues = capabilityCandidates.flatMap((capability) => plannedCapabilityQualityIssues(contextId, capability, capabilityCandidates, traceLimitations));
  if (unassignedAnchors.length > 0) {
    qualityIssues.push(qualityIssue('unassigned-anchors-present', contextId, '', 'Unassigned anchors remain after planning.', { unassignedAnchors, decision: payload.unassignedAnchorDecision }));
  }
  const statusDecisions = capabilityCandidates.map((capability) => ({
    type: 'capability',
    id: capability.capabilityId,
    status: qualityIssues.some((issue) => issue.capability === capability.capabilityId && ['trace-rejected', 'trace-pending'].includes(issue.code)) ? 'needs-review' : 'draft',
    reasonCodes: qualityIssues.filter((issue) => issue.capability === capability.capabilityId).map((issue) => issue.code),
  }));
  return {
    code: 0,
    output: {
      contextId,
      capabilityCandidates,
      traceLimitations,
      qualityIssues,
      statusDecisions,
    },
  };
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

function formatCapabilityFlow(capability, fallbackBody) {
  const callFlow = collectEvidenceKindSection(capability, 'call-flow', 'callRelations') || asText(capability.callFlow);
  if (callFlow) return callFlow;
  if (fallbackBody) return fallbackBody;
  return '待补充 call-flow evidence；当前不得用 summary 或定位语替代典型流程。';
}

function formatCapabilityUpstreamDownstream(capability) {
  if (capability.upstreamDownstream) return capability.upstreamDownstream;
  const callFlow = collectEvidenceKindSection(capability, 'call-flow', 'callRelations');
  if (callFlow) return callFlow;
  const routes = collectEvidenceSection(capability, 'routes');
  if (routes) return `仅入口路由，缺调用因果：\n${routes}`;
  return '';
}

function formatCapabilityVerification(capability) {
  return asText(capability.verificationMethod);
}

function currentRepoCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function evidenceRepoCommitValue(evidence, repoCommit) {
  return evidence.repo_commit ?? evidence.repoCommit ?? repoCommit ?? 'unknown';
}

function repoCommitGateIssues(capabilities, repoCommit, knowledgeRoot, contextId) {
  if (!repoCommit) return [];
  return capabilities.flatMap((capability, capabilityIndex) => (capability.evidence ?? []).flatMap((evidence, evidenceIndex) => {
    const value = evidenceRepoCommitValue(evidence, repoCommit);
    if (value && value !== 'unknown') return [];
    return [inputIssue(`capabilities[${capabilityIndex}].evidence[${evidenceIndex}].repo_commit cannot be unknown when git HEAD is available.`, {
      field: `capabilities[${capabilityIndex}].evidence[${evidenceIndex}].repo_commit`,
      path: contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`),
    })];
  }));
}

function unknownRepoCommitEvidence(capabilities, repoCommit, knowledgeRoot, contextId) {
  if (repoCommit) return [];
  return capabilities.flatMap((capability) => (capability.evidence ?? []).map((evidence) => ({
    path: contextPath(knowledgeRoot, contextId, 'evidence', `${capability.capabilityId}-${evidence.evidenceKind}.md`),
    capability: capability.capabilityId,
    evidenceKind: evidence.evidenceKind,
    reason: 'git-head-unavailable',
  })));
}

function evidenceDepthForCapability(capability) {
  const kinds = new Set((capability.evidence ?? []).map((evidence) => evidence.evidenceKind));
  return {
    routes: kinds.has('routes'),
    callFlow: kinds.has('call-flow'),
    data: kinds.has('data'),
    external: kinds.has('external'),
  };
}

function promoteQualityForCapability(contextId, capability, capabilities, guidanceIssues = []) {
  const depth = evidenceDepthForCapability(capability);
  const issues = [];
  if (capabilities.length === 1 && !capability.splitConfirmationReason && !capability.noSplitReason) {
    issues.push(qualityIssue('possible-under-split', contextId, capability.capabilityId, 'Single capability promotion needs manual review for possible under-splitting.'));
  }
  if (uniqueLines([capability.entryPaths, collectEvidenceSection(capability, 'entryPaths')]).length === 0) {
    issues.push(qualityIssue('missing-entry-path', contextId, capability.capabilityId, 'No entry path was provided.'));
  }
  if (!depth.callFlow) issues.push(qualityIssue('missing-call-flow', contextId, capability.capabilityId, 'No call-flow evidence was generated.', { evidenceKind: 'call-flow' }));
  if (!depth.data) issues.push(qualityIssue('missing-data', contextId, capability.capabilityId, 'No data evidence was generated.', { evidenceKind: 'data' }));
  if (!depth.external) issues.push(qualityIssue('missing-external', contextId, capability.capabilityId, 'No external evidence was generated.', { evidenceKind: 'external' }));
  if (depth.routes && !depth.callFlow && !depth.data && !depth.external) {
    issues.push(qualityIssue('routes-only', contextId, capability.capabilityId, 'Only routes evidence is present.'));
  }
  if (guidanceIssues.some((issue) => issue.capability === capability.capabilityId)) {
    issues.push(qualityIssue('guidance-anchor-not-found', contextId, capability.capabilityId, 'Some structured guidance anchors were rejected.'));
  }
  return issues;
}

function statusFromQuality(capabilityId, qualityIssues) {
  const reasonCodes = qualityIssues.filter((issue) => issue.capability === capabilityId).map((issue) => issue.code);
  return {
    type: 'capability',
    id: capabilityId,
    status: reasonCodes.includes('trace-rejected') || reasonCodes.includes('guidance-empty') ? 'needs-review' : 'draft',
    reasonCodes,
  };
}

function evidenceStatusDecisions(capability, qualityIssues) {
  return (capability.evidence ?? []).map((evidence) => {
    const evidenceKindCode = evidence.evidenceKind === 'call-flow' ? 'missing-call-flow' : `missing-${evidence.evidenceKind}`;
    const blockedByCapability = qualityIssues
      .filter((issue) => issue.capability === capability.capabilityId && issue.blocksVerified)
      .map((issue) => issue.code)
      .filter((code) => code !== evidenceKindCode);
    return {
      type: 'evidence',
      id: `${capability.capabilityId}-${evidence.evidenceKind}`,
      status: 'draft',
      reasonCodes: blockedByCapability,
    };
  });
}

const GUIDANCE_ANCHOR_TYPES = new Set(['symbol', 'route', 'table', 'cache', 'topic', 'external']);

function evidenceAnchorSet(capability) {
  const anchors = new Set();
  for (const evidence of capability.evidence ?? []) {
    for (const field of ['entryPaths', 'routes', 'callRelations', 'dataMessages', 'frontendEntries', 'externalDependencies', 'dependencyAnchors']) {
      for (const line of uniqueLines([evidence[field]])) {
        anchors.add(line.replace(/^[-*]\s+/, '').trim());
        for (const token of line.match(/[A-Z][$A-Za-z0-9_]*(?:#[A-Za-z_$][$A-Za-z0-9_]*)?/g) ?? []) anchors.add(token);
        for (const route of line.match(/[A-Z]+ \/[^,\s]+/g) ?? []) anchors.add(route);
      }
    }
  }
  return anchors;
}

function validateStructuredGuidance(capability) {
  const schemas = {
    structuredMisjudgments: ['misjudgment', 'correctJudgment', 'reason', 'anchors'],
    structuredReuseGuidance: ['instruction', 'reason', 'anchors'],
    structuredDoNotReuseGuidance: ['instruction', 'reason', 'anchors'],
    structuredConfirmationRequired: ['condition', 'reason', 'anchors', 'decisionNeeded'],
  };
  const accepted = {};
  const rendered = {};
  const issues = [];
  const anchors = evidenceAnchorSet(capability);
  for (const [field, required] of Object.entries(schemas)) {
    accepted[field] = 0;
    rendered[field] = [];
    for (const [index, item] of normalizeObjectList(capability[field]).entries()) {
      const missing = required.filter((key) => key === 'anchors' ? normalizeObjectList(item.anchors).length === 0 : !String(item[key] ?? '').trim());
      if (missing.length > 0) {
        issues.push({ code: 'guidance-empty', capability: capability.capabilityId, field: `${field}[${index}]`, message: `Missing required fields: ${missing.join(', ')}.` });
        continue;
      }
      const invalidAnchor = normalizeObjectList(item.anchors).find((anchor) => !GUIDANCE_ANCHOR_TYPES.has(anchor.type) || !anchors.has(String(anchor.value ?? '').trim()));
      if (invalidAnchor) {
        issues.push({ code: 'guidance-anchor-not-found', capability: capability.capabilityId, field: `${field}[${index}].anchors`, message: `Anchor ${invalidAnchor.value ?? ''} is not present in this context evidence.` });
        continue;
      }
      accepted[field] += 1;
      rendered[field].push(item);
    }
  }
  return { accepted, rendered, issues };
}

function renderStructuredGuidance(payload, validation) {
  const reuse = validation.rendered.structuredReuseGuidance.map((item) => `- ${item.instruction}\n  原因：${item.reason}${item.appliesWhen ? `\n  适用：${item.appliesWhen}` : ''}`).join('\n');
  const doNotReuse = validation.rendered.structuredDoNotReuseGuidance.map((item) => `- ${item.instruction}\n  原因：${item.reason}${item.appliesWhen ? `\n  适用：${item.appliesWhen}` : ''}`).join('\n');
  const confirm = validation.rendered.structuredConfirmationRequired.map((item) => `- 条件：${item.condition}\n  需要确认：${item.decisionNeeded}\n  原因：${item.reason}${item.appliesWhen ? `\n  适用：${item.appliesWhen}` : ''}`).join('\n');
  return {
    ...payload,
    reuseGuidance: reuse || payload.reuseGuidance,
    doNotReuseGuidance: doNotReuse || payload.doNotReuseGuidance,
    confirmationRequired: confirm || payload.confirmationRequired,
    commonMisjudgments: validation.rendered.structuredMisjudgments.length > 0
      ? validation.rendered.structuredMisjudgments.map((item) => `- 误判：${item.misjudgment}\n  正确判断：${item.correctJudgment}\n  原因：${item.reason}${item.verification ? `\n  验证：${item.verification}` : ''}`).join('\n')
      : payload.commonMisjudgments,
  };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function capabilityMatrixFromCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return '';
  const rows = capabilities.map((capability) => {
    const entry = asText(capability.codeFactEntries) || asText(collectEvidenceSection(capability, 'entryPaths')) || '待确认';
    const usage = asText(capability.responsibilities).split('\n').find(Boolean) ?? capability.summary;
    const nonUsage = asText(capability.nonResponsibilities).split('\n').find(Boolean) ?? '按不负责边界确认';
    return `| ${capability.name} | ${capability.summary} | ${entry} | ${usage} | ${nonUsage} |`;
  });
  return ['| 能力 | 作用 | 主要入口 | 适用场景 | 不适用场景 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

function agentDevelopmentGuidance(payload) {
  if (payload.agentDevelopmentGuidance) return payload.agentDevelopmentGuidance;
  const reuse = sectionText(payload.reuseGuidance, '- 优先复用本能力既有入口和服务实现，避免新增平行链路。');
  const doNotReuse = sectionText(payload.doNotReuseGuidance, '- 不要承担“不负责什么”中列出的边界外职责。');
  const confirm = sectionText(payload.confirmationRequired, '- 需求触及外部依赖、状态口径、数据一致性或相邻上下文边界时，先确认契约。');
  const breakdown = sectionText(
    payload.developmentTaskBreakdown,
    [
      '- 契约变更：确认 controller/Dubbo/消息入口与 DTO/VO。',
      '- 业务规则：确认 service/manager 中的规则落点。',
      '- 数据落库：确认 mapper/entity/table 或缓存变更。',
      '- 外部依赖：确认下游 wrapper、平台 API 或消息生产方契约。',
      '- 测试验证：覆盖主路径、边界情况和错误路径。',
    ].join('\n'),
  );
  const verification = sectionText(payload.developmentVerification, payload.verificationMethod ?? '- 按本能力验证方式和 linked evidence 设计最小回归。');
  return [
    '### 优先复用',
    '',
    reuse,
    '',
    '### 不要复用',
    '',
    doNotReuse,
    '',
    '### 停下来确认',
    '',
    confirm,
    '',
    '### 开发任务拆分',
    '',
    breakdown,
    '',
    '### 验证方式',
    '',
    verification,
  ].join('\n');
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
  const allowedGate = !reduceOutput.gate || ['ok', 'mid-low-scope-required'].includes(reduceOutput.gate);
  if (!allowedGate) {
    return { code: 3, output: { issues: [inputIssue('reduceOutput gate is not ok; refusing to write candidates.', { gate: reduceOutput.gate })], written: 0, blocked: reduceOutput.batchDuplicates?.length ?? 0, results: [], confirmedDuplicates: [], blockedDuplicates: reduceOutput.batchDuplicates ?? [] } };
  }
  const gatedReportPath = writeGatedCandidatesReport(input, reduceOutput);
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
        gatedReportPath,
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
      gatedReportPath,
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
  contextMarkdown = replaceLine(contextMarkdown, 'guidance_reviewed_at', payload.guidanceReviewedAt ?? payload.guidance_reviewed_at ?? todayDate());
  contextMarkdown = replaceLine(contextMarkdown, 'guidance_review_interval', payload.guidanceReviewInterval ?? payload.guidance_review_interval ?? 90);
  contextMarkdown = injectAfterHeading(contextMarkdown, '业务定位', payload.body);
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '何时使用',
    sectionText(payload.whenToUse ?? payload.triggerSignals, `需求明确命中「${payload.name}」的业务边界、能力、入口或术语时使用本 Context。`),
  );
  contextMarkdown = injectAfterHeading(contextMarkdown, '负责什么', payload.responsibilities);
  contextMarkdown = injectAfterHeading(contextMarkdown, '不负责什么', payload.nonResponsibilities);
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '核心业务语言',
    sectionText(payload.coreBusinessLanguage, `核心术语围绕「${payload.name}」展开；主要能力、证据和代码入口应统一使用该上下文中的业务命名。`),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '能力清单',
    sectionText(payload.capabilityMatrix ?? payload.primaryCapabilities, '暂无已确认能力清单；创建 capability 文档后补充到本节。'),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '上游触发',
    sectionText(payload.upstreamTriggers, 'API/Event/Job/Internal 触发入口待补充；开发前应结合 capability/evidence 确认。'),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '需求路由规则',
    sectionText(payload.routingRules, `先判断需求是否属于「${payload.name}」边界，再选择匹配 capability 和 linked evidence；命中不负责事项时转相关上下文。`),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '避免混用',
    sectionText(payload.avoidConfusion, payload.nonResponsibilities),
  );
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '常见误判',
    sectionText(payload.commonMisjudgments, '暂无已确认域级误判；如发现 Agent 高频误路由，应补充误判、正确判断和原因。'),
  );
  contextMarkdown = injectAfterHeading(contextMarkdown, '相关上下文', relatedContexts);
  contextMarkdown = injectAfterHeading(
    contextMarkdown,
    '验证入口',
    sectionText(payload.verificationEntry, '先读取相关 capability 的验证方式和 evidence 的开发验证建议，再执行代码级验证。'),
  );
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
    '能力清单',
    sectionText(payload.capabilityMatrix ?? payload.primaryCapabilities, '暂无已确认能力清单；创建 capability 文档后补充到本节。'),
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
  const repoCommit = currentRepoCommit(repoRoot);
  const issues = [
    assertValidId(candidateId, 'candidateId'),
    assertValidId(contextId, 'contextId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    !payload.responsibilities ? inputIssue('responsibilities is required.', { field: 'responsibilities' }) : null,
    !payload.nonResponsibilities ? inputIssue('nonResponsibilities is required.', { field: 'nonResponsibilities' }) : null,
    assertRealBody(payload.body, 'body'),
    ...validatePromoteKnowledgePayload(capabilities),
    ...validatePromotePlan(payload, contextId, capabilities),
    ...repoCommitGateIssues(capabilities, repoCommit, knowledgeRoot, contextId),
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
  const unknownRepoCommitEvidenceList = unknownRepoCommitEvidence(capabilities, repoCommit, knowledgeRoot, contextId);
  const guidanceValidations = new Map(capabilities.map((capability) => [capability.capabilityId, validateStructuredGuidance(capability)]));
  const guidanceIssues = [...guidanceValidations.values()].flatMap((validation) => validation.issues);
  const guidanceAccepted = Object.fromEntries([...guidanceValidations.entries()].map(([capabilityId, validation]) => [capabilityId, validation.accepted]));
  const qualityIssues = capabilities.flatMap((capability) => promoteQualityForCapability(contextId, capability, capabilities, guidanceIssues));
  const evidenceDepth = Object.fromEntries(capabilities.map((capability) => [capability.capabilityId, evidenceDepthForCapability(capability)]));
  const statusDecisions = capabilities.flatMap((capability) => [
    statusFromQuality(capability.capabilityId, qualityIssues),
    ...evidenceStatusDecisions(capability, qualityIssues),
  ]);
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
      capabilityMatrix: payload.capabilityMatrix ?? capabilityMatrixFromCapabilities(capabilities),
      upstreamDownstream: payload.upstreamDownstream ?? upstreamDownstream,
      relatedDocs: payload.relatedDocs ?? relatedDocs,
      whenToUse: payload.whenToUse ?? payload.triggerSignals,
      upstreamTriggers: payload.upstreamTriggers,
      routingRules: payload.routingRules,
      commonMisjudgments: payload.commonMisjudgments,
      verificationEntry: payload.verificationEntry,
      guidanceReviewedAt: payload.guidanceReviewedAt ?? payload.guidance_reviewed_at ?? generatedAt.slice(0, 10),
      guidanceReviewInterval: payload.guidanceReviewInterval ?? payload.guidance_review_interval,
    },
  });
  if (contextResult.code !== 0) return contextResult;
  const createdCapabilityPaths = [];
  const createdEvidencePaths = [];
  for (const capability of capabilities) {
    const guidanceValidation = guidanceValidations.get(capability.capabilityId);
    const capabilityPayload = renderStructuredGuidance(capability, guidanceValidation);
    const acceptedGuidanceCount = Object.values(guidanceValidation.accepted).reduce((sum, count) => sum + count, 0);
    const shouldStampGuidance = acceptedGuidanceCount > 0;
    const capabilityResult = createCapability({
      ...input,
      payload: {
        contextId,
        capabilityId: capabilityPayload.capabilityId,
        name: capabilityPayload.name,
        summary: capabilityPayload.summary,
        responsibilities: capabilityPayload.responsibilities,
        nonResponsibilities: capabilityPayload.nonResponsibilities,
        body: formatCapabilityFlow(capabilityPayload),
        businessObjects: capabilityPayload.businessObjects ?? collectEvidenceSection(capabilityPayload, 'dataMessages'),
        upstreamDownstream: formatCapabilityUpstreamDownstream(capabilityPayload),
        designIntent: capabilityPayload.designIntent,
        codeFactEntries: capabilityPayload.codeFactEntries ?? collectEvidenceSection(capabilityPayload, 'entryPaths'),
        agentDevelopmentGuidance: capabilityPayload.agentDevelopmentGuidance,
        reuseGuidance: capabilityPayload.reuseGuidance,
        doNotReuseGuidance: capabilityPayload.doNotReuseGuidance,
        confirmationRequired: capabilityPayload.confirmationRequired,
        developmentTaskBreakdown: capabilityPayload.developmentTaskBreakdown,
        commonMisjudgments: capabilityPayload.commonMisjudgments,
        developmentVerification: capabilityPayload.developmentVerification,
        verificationMethod: formatCapabilityVerification(capability),
        openQuestions: capability.openQuestions ?? collectEvidenceSection(capability, 'limitations'),
        evidencePaths: capabilityEvidencePaths(knowledgeRoot, contextId, capability),
        guidanceReviewedAt: capability.guidanceReviewedAt ?? capability.guidance_reviewed_at ?? (shouldStampGuidance ? generatedAt.slice(0, 10) : ''),
        guidanceReviewInterval: capability.guidanceReviewInterval ?? capability.guidance_review_interval,
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
          repo_commit: evidenceRepoCommitValue(evidence, repoCommit),
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
      qualityIssues,
      statusDecisions,
      evidenceDepth,
      guidanceIssues,
      guidanceAccepted,
      repoCommit: repoCommit ?? 'unknown',
      unknownRepoCommitEvidence: unknownRepoCommitEvidenceList,
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
  markdown = replaceLine(markdown, 'guidance_reviewed_at', payload.guidanceReviewedAt ?? payload.guidance_reviewed_at ?? todayDate());
  markdown = replaceLine(markdown, 'guidance_review_interval', payload.guidanceReviewInterval ?? payload.guidance_review_interval ?? 90);
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
  markdown = injectAfterHeading(markdown, 'Agent 开发指引', agentDevelopmentGuidance(payload));
  markdown = injectAfterHeading(
    markdown,
    '常见误判',
    sectionText(payload.commonMisjudgments, '暂无已确认能力级误判；如发现 Agent 改错链路，应补充误判、正确判断和原因。'),
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
    ...validateEvidencePayload(payload),
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
  markdown = replaceLine(markdown, 'repo_commit', payload.repo_commit ?? payload.repoCommit ?? 'unknown');
  markdown = replaceLine(markdown, 'generated_at', payload.generated_at ?? payload.generatedAt ?? new Date().toISOString());
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
  markdown = injectOptionalAfterHeading(markdown, '边界外依赖', sectionText(
    payload.externalDependencies ?? payload.dependencyAnchors,
    payload.evidenceKind === 'external' ? 'external evidence 缺少依赖锚点；补证前不得标为 verified。' : '',
  ));
  markdown = injectOptionalAfterHeading(markdown, '调用方', sectionText(payload.callers, payload.evidenceKind === 'external' ? 'external evidence 缺少调用方；补证前不得标为 verified。' : ''));
  markdown = injectOptionalAfterHeading(markdown, '下游接口', sectionText(payload.downstreamInterfaces, payload.evidenceKind === 'external' ? 'external evidence 缺少下游接口；补证前不得标为 verified。' : ''));
  markdown = injectOptionalAfterHeading(markdown, '依赖类型', sectionText(payload.dependencyType, payload.evidenceKind === 'external' ? 'external evidence 缺少依赖类型；补证前不得标为 verified。' : ''));
  markdown = injectOptionalAfterHeading(markdown, '触发条件', sectionText(payload.triggerConditions, payload.evidenceKind === 'external' ? 'external evidence 缺少触发条件；补证前不得标为 verified。' : ''));
  markdown = injectOptionalAfterHeading(markdown, '失败 / 超时处理', sectionText(payload.failureHandling, payload.evidenceKind === 'external' ? 'external evidence 缺少失败/超时处理；补证前不得标为 verified。' : ''));
  markdown = injectOptionalAfterHeading(markdown, '边界说明', sectionText(payload.boundaryNotes, payload.evidenceKind === 'external' ? 'external evidence 缺少边界说明；补证前不得标为 verified。' : ''));
  markdown = injectAfterHeading(markdown, '生成证据', payload.generation_evidence);
  markdown = injectAfterHeading(
    markdown,
    '开发验证建议',
    sectionText(payload.developmentVerification, '当前 evidence 仅提供代码事实；开发验证需结合 capability 验证方式补充。'),
  );
  markdown = injectAfterHeading(markdown, '限制与疑点', sectionText(payload.limitations, '暂无额外限制；升级 verified 前仍需补充确认来源。'));
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
}
