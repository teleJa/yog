import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_KINDS, ID_PATTERN } from './constants.mjs';
import { mergeConfig, writeConfig } from './config.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
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
    serena: input.payload?.serena ?? existing.serena ?? { enabled: false },
    codeFactProvider: input.payload?.codeFactProvider ?? existing.codeFactProvider ?? { type: 'none', status: 'not-configured' },
  });
  writeConfig(context.repoRoot, merged);
  writeRootManagedBlocks(context.repoRoot, context.knowledgeRoot);
  return {
    issues,
    nextSteps: [
      {
        action: 'install-hooks',
        status: 'optional-recommended',
        message: `Offer to run install-hooks.mjs so future prompts automatically remind agents to read ${context.knowledgeRoot}/CONTEXT-MAP.md before business, design, interface, or implementation work.`,
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

function readCandidateFrontmatter(filePath) {
  return parseFrontmatter(readFileSync(filePath, 'utf8')).data;
}

function findCandidateDuplicates(context, payload) {
  const { knowledgeAbs, knowledgeRoot } = context;
  const candidateDir = join(knowledgeAbs, 'candidates');
  if (!existsSync(candidateDir)) return [];
  const requested = {
    slug: normalizeDuplicateToken(payload.candidateId),
    name: normalizeDuplicateToken(payload.name),
    keywords: new Set(normalizeList(payload.keywords).map(normalizeDuplicateToken)),
    possible_contexts: new Set(normalizeList(payload.possibleContexts ?? payload.possible_contexts).map(normalizeDuplicateToken)),
  };
  return readdirSync(candidateDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const filePath = join(candidateDir, fileName);
      const data = readCandidateFrontmatter(filePath);
      const matchedFields = [];
      if (normalizeDuplicateToken(fileName.replace(/\.md$/, '')) === requested.slug) matchedFields.push('slug');
      if (normalizeDuplicateToken(data.name) === requested.name) matchedFields.push('name');
      const existingKeywords = normalizeList(data.keywords).map(normalizeDuplicateToken);
      const existingContexts = normalizeList(data.possible_contexts).map(normalizeDuplicateToken);
      if (existingKeywords.some((keyword) => requested.keywords.has(keyword))) matchedFields.push('keywords');
      if (existingContexts.some((context) => requested.possible_contexts.has(context))) matchedFields.push('possible_contexts');
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
  const issues = [
    assertValidId(payload.candidateId, 'candidateId'),
    !payload.name ? inputIssue('name is required.', { field: 'name' }) : null,
    !payload.summary ? inputIssue('summary is required.', { field: 'summary' }) : null,
    assertRealBody(payload.body, 'body'),
  ].filter(Boolean);
  if (issues.length) return { code: 2, output: { issues } };
  const template = readRequiredTemplate(context, 'candidate.md');
  if (template.issue) return { code: 1, output: { issues: [template.issue] } };
  const duplicates = findCandidateDuplicates(context, payload);
  const target = join(knowledgeAbs, 'candidates', `${payload.candidateId}.md`);
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
  mkdirSync(join(knowledgeAbs, 'candidates'), { recursive: true });
  let markdown = template.text;
  markdown = replaceLine(markdown, 'name', payload.name);
  markdown = replaceLine(markdown, 'keywords', formatInlineList(payload.keywords));
  markdown = replaceLine(markdown, 'possible_contexts', formatInlineList(payload.possibleContexts ?? payload.possible_contexts));
  markdown = replaceTemplateValue(markdown, 'Candidate Name', payload.name);
  markdown = injectAfterHeading(markdown, '触发信号', payload.body);
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
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
  const entry = `- ${payload.contextId}: ${payload.name} - ${payload.summary}
  - Path: contexts/${payload.contextId}/CONTEXT.md
  - Responsibilities: ${payload.responsibilities}
  - Non-responsibilities: ${payload.nonResponsibilities}`;
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
  markdown = injectAfterHeading(markdown, '生成方式', sectionText(payload.generationMethod, payload.generation_evidence));
  markdown = injectAfterHeading(markdown, '入口路径', sectionText(payload.entryPaths, '本轮未记录具体入口路径；如需要可追溯代码事实，请补充文件路径和行号。'));
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '路由 / 接口', payload.routes);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '调用关系', payload.callRelations);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '数据 / 消息', payload.dataMessages);
  markdown = injectEvidenceSection(markdown, payload.evidenceKind, '前端入口', payload.frontendEntries);
  markdown = injectAfterHeading(markdown, '限制与疑点', sectionText(payload.limitations, '暂无额外限制；升级 verified 前仍需补充确认来源。'));
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
}
