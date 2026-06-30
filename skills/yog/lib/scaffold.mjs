import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_KINDS, ID_PATTERN } from './constants.mjs';
import { mergeConfig, writeConfig } from './config.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { hasRealBodyContent, hasTemplatePlaceholder } from './markdown.mjs';
import { contextPath, knowledgePath, readRepoConfig, repoRelative, resolveRepoContext } from './knowledge-root.mjs';
import { writeRootManagedBlocks } from './managed-block.mjs';

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
  return { issues };
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

function assertRealBody(body, field) {
  if (!body || hasTemplatePlaceholder(body) || !hasRealBodyContent(`# Body\n${body}`)) {
    return inputIssue(`${field} must contain real content.`, { field });
  }
  return null;
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

function writeMarkdown(target, markdown) {
  writeFileSync(target, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
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
  let contextMarkdown = replaceTemplateValue(contextTemplate.text, 'Context Name', payload.name);
  contextMarkdown = injectAfterHeading(contextMarkdown, '业务定位', payload.body);
  let readmeMarkdown = replaceTemplateValue(readmeTemplate.text, 'Context Name', payload.name);
  readmeMarkdown = injectAfterHeading(readmeMarkdown, '一句话定位', payload.summary);
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
  markdown = replaceTemplateValue(markdown, 'Business Capability Name', payload.name);
  markdown = injectAfterHeading(markdown, '一句话定位', payload.summary);
  markdown = injectAfterHeading(markdown, '负责什么', payload.responsibilities);
  markdown = injectAfterHeading(markdown, '不负责什么', payload.nonResponsibilities);
  markdown = injectAfterHeading(markdown, '典型流程', payload.body);
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
  writeMarkdown(target, markdown);
  return { code: 0, output: { issues: [] } };
}
