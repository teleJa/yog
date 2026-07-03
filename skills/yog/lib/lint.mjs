import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_KINDS, ID_PATTERN } from './constants.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { buildIndexes } from './index.mjs';
import { hasRealBodyContent, hasTemplatePlaceholder } from './markdown.mjs';
import { contextPath, knowledgePath, repoRelative, resolveRepoContext } from './knowledge-root.mjs';

function issue(severity, message, path, details) {
  return details ? { severity, message, path, details } : { severity, message, path };
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.md') && file !== 'README.md').map((file) => join(dir, file));
}

function contextDirectories(knowledgeAbs) {
  const contextsDir = join(knowledgeAbs, 'contexts');
  if (!existsSync(contextsDir)) return [];
  return readdirSync(contextsDir)
    .map((entry) => ({ entry, abs: join(contextsDir, entry) }))
    .filter((item) => statSync(item.abs).isDirectory())
    .map((item) => item.entry);
}

function confirmedContextIds(knowledgeAbs) {
  const contextMapPath = join(knowledgeAbs, 'CONTEXT-MAP.md');
  if (!existsSync(contextMapPath)) return new Set();
  const text = readFileSync(contextMapPath, 'utf8');
  return new Set(text.split('\n').flatMap((line) => {
    const match = line.match(/^- ([a-z][a-z0-9-]*): /);
    return match ? [match[1]] : [];
  }));
}

function normalizeDuplicateToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function candidateDuplicateIssues(context) {
  const { knowledgeAbs, knowledgeRoot } = context;
  const candidates = markdownFiles(join(knowledgeAbs, 'candidates')).map((file) => {
    const data = parseFrontmatter(readFileSync(file, 'utf8')).data;
    return {
      path: file,
      candidateId: file.split('/').pop().replace(/\.md$/, ''),
      name: data.name ?? '',
      status: data.status ?? 'needs-review',
      keywords: data.keywords ?? [],
      possible_contexts: data.possible_contexts ?? [],
    };
  });
  const issues = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const matchedFields = [];
      if (normalizeDuplicateToken(left.candidateId) === normalizeDuplicateToken(right.candidateId)) matchedFields.push('slug');
      if (normalizeDuplicateToken(left.name) === normalizeDuplicateToken(right.name)) matchedFields.push('name');
      const rightKeywords = new Set(right.keywords.map(normalizeDuplicateToken));
      const rightContexts = new Set(right.possible_contexts.map(normalizeDuplicateToken));
      if (left.keywords.map(normalizeDuplicateToken).some((keyword) => rightKeywords.has(keyword))) matchedFields.push('keywords');
      if (left.possible_contexts.map(normalizeDuplicateToken).some((context) => rightContexts.has(context))) matchedFields.push('possible_contexts');
      if (matchedFields.length > 0) {
        issues.push(issue('P2', 'Likely duplicate candidate documents found.', knowledgePath(knowledgeRoot, 'candidates'), {
          duplicates: [left, right].map((candidate) => ({
            path: knowledgePath(knowledgeRoot, 'candidates', `${candidate.candidateId}.md`),
            candidateId: candidate.candidateId,
            name: candidate.name,
            status: candidate.status,
            matchedFields,
          })),
        }));
      }
    }
  }
  return issues;
}

function relationshipIssues(context, contextIds) {
  const { knowledgeAbs, knowledgeRoot } = context;
  const contextMapPath = join(knowledgeAbs, 'CONTEXT-MAP.md');
  if (!existsSync(contextMapPath)) return [];
  const text = readFileSync(contextMapPath, 'utf8');
  const section = text;
  const seen = new Set();
  const issues = [];
  for (const line of section.split('\n').filter((item) => item.startsWith('- ') && item.includes('->'))) {
    if (/\{[^}\n]+\}/.test(line)) continue;
    const match = line.match(/^- ([a-z][a-z0-9-]*) -> ([a-z][a-z0-9-]*): (.+)$/);
    if (!match) {
      issues.push(issue('P1', 'CONTEXT-MAP relationship format is invalid.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
      continue;
    }
    const [, source, target, summary] = match;
    if (source === target) issues.push(issue('P1', 'CONTEXT-MAP relationship cannot be a self-loop.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
    if (!summary.trim()) issues.push(issue('P1', 'CONTEXT-MAP relationship summary is required.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
    if (!contextIds.has(source) || !contextIds.has(target)) issues.push(issue('P1', 'CONTEXT-MAP relationship references an unknown context.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
    const key = `${source}->${target}`;
    if (seen.has(key)) issues.push(issue('P1', 'CONTEXT-MAP relationship is duplicated.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
    seen.add(key);
  }
  return issues;
}

function statusIssues(type, status, path) {
  if (type === 'candidate' && status === 'verified') return [issue('P1', 'Candidate documents cannot use status verified.', path)];
  if (type !== 'adr' && status === 'accepted') return [issue('P1', 'Status accepted is only valid for ADR documents.', path)];
  if (type === 'adr' && status !== 'accepted') return [issue('P1', 'ADR status must be accepted.', path)];
  return [];
}

function adrIssues(context, contextIds) {
  const { repoRoot, knowledgeAbs } = context;
  const issues = [];
  for (const file of markdownFiles(join(knowledgeAbs, 'adr'))) {
    const path = repoRelative(repoRoot, file);
    const text = readFileSync(file, 'utf8');
    const data = parseFrontmatter(text).data;
    issues.push(...statusIssues('adr', data.status, path));
    if (!hasRealBodyContent(text) || hasTemplatePlaceholder(text)) issues.push(issue('P1', 'ADR source is an empty shell.', path));
    const relatedContexts = data.related_contexts ?? [];
    if (new Set(relatedContexts).size !== relatedContexts.length) issues.push(issue('P1', 'ADR related_contexts contains duplicate context ids.', path));
    for (const contextId of relatedContexts) {
      if (!contextIds.has(contextId)) issues.push(issue('P1', 'ADR related_contexts references an unknown context.', path, { contextId }));
    }
  }
  return issues;
}

function parseEvidenceFileName(fileName) {
  if (!fileName.endsWith('.md')) return null;
  const stem = fileName.replace(/\.md$/, '');
  const matchedKind = [...EVIDENCE_KINDS]
    .sort((left, right) => right.length - left.length)
    .find((kind) => stem.endsWith(`-${kind}`));
  if (!matchedKind) return null;
  const capabilityId = stem.slice(0, -(matchedKind.length + 1));
  if (!ID_PATTERN.test(capabilityId)) return null;
  return { capabilityId, evidenceKind: matchedKind };
}

function parseMarkdownSections(markdown) {
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

function missingSectionIssues(path, evidenceKind, text) {
  const sections = parseMarkdownSections(text);
  const issues = [];
  const p1Required = ['事实摘要'];
  const p2Recommended = ['入口路径', '限制与疑点'];
  const kindRequired = new Map([
    ['routes', ['路由 / 接口']],
    ['call-flow', ['调用关系']],
    ['data', ['数据 / 消息']],
  ]);
  for (const section of [...p1Required, ...(kindRequired.get(evidenceKind) ?? [])]) {
    if (!sections.get(section)) {
      issues.push(issue('P1', 'Evidence required section is empty.', path, { evidenceKind, section }));
    }
  }
  for (const section of p2Recommended) {
    if (!sections.get(section)) {
      issues.push(issue('P2', 'Evidence recommended section is empty.', path, { evidenceKind, section }));
    }
  }
  return issues;
}

function missingDocumentSectionIssues(path, label, text, p1Required, p2Recommended) {
  const sections = parseMarkdownSections(text);
  const issues = [];
  for (const section of p1Required) {
    if (!sections.get(section)) {
      issues.push(issue('P1', `${label} required section is empty.`, path, { section }));
    }
  }
  for (const section of p2Recommended) {
    if (!sections.get(section)) {
      issues.push(issue('P2', `${label} recommended section is empty.`, path, { section }));
    }
  }
  return issues;
}

function contextDocumentIssues(context, contextId, contextDir) {
  const { repoRoot, knowledgeRoot } = context;
  const contextFile = join(contextDir, 'CONTEXT.md');
  const readmeFile = join(contextDir, 'README.md');
  const issues = [];
  if (existsSync(contextFile)) {
    issues.push(...missingDocumentSectionIssues(
      repoRelative(repoRoot, contextFile),
      'Context',
      readFileSync(contextFile, 'utf8'),
      ['业务定位', '负责什么', '不负责什么'],
      ['核心业务语言', '避免混用', '相关上下文', '未确认问题'],
    ));
  }
  if (existsSync(readmeFile)) {
    issues.push(...missingDocumentSectionIssues(
      repoRelative(repoRoot, readmeFile),
      'Context README',
      readFileSync(readmeFile, 'utf8'),
      ['一句话定位', '业务边界', '主要能力'],
      ['上下游关系', '相关文档', '未确认问题'],
    ));
  }
  if (!existsSync(contextFile)) issues.push(issue('P1', 'Context document does not exist.', contextPath(knowledgeRoot, contextId, 'CONTEXT.md')));
  if (!existsSync(readmeFile)) issues.push(issue('P1', 'Context README does not exist.', contextPath(knowledgeRoot, contextId, 'README.md')));
  return issues;
}

function capabilityDocumentIssues(context, file) {
  return missingDocumentSectionIssues(
    repoRelative(context.repoRoot, file),
    'Capability',
    readFileSync(file, 'utf8'),
    ['一句话定位', '负责什么', '不负责什么', '典型流程'],
    ['关键业务对象', '上下游关系', '设计意图 / 架构取舍', '代码事实入口', '验证方式', '未确认问题'],
  );
}

function evidenceShapeIssues(context, contextId, file, capabilityIds) {
  const { repoRoot } = context;
  const path = repoRelative(repoRoot, file);
  const fileName = file.split('/').pop();
  const parsed = parseEvidenceFileName(fileName);
  const text = readFileSync(file, 'utf8');
  const data = parseFrontmatter(text).data;
  const issues = [];
  if (!parsed) return [issue('P1', 'Evidence file name is invalid.', path)];
  const { capabilityId, evidenceKind } = parsed;
  if (data.capability !== capabilityId) issues.push(issue('P1', 'Evidence file name capability does not match frontmatter capability.', path));
  if (data.evidence_kind !== evidenceKind) issues.push(issue('P1', 'Evidence file name kind does not match frontmatter evidence_kind.', path));
  if (!capabilityIds.has(data.capability)) issues.push(issue('P1', 'Evidence references an unknown capability.', path, { contextId, capability: data.capability }));
  issues.push(...missingSectionIssues(path, evidenceKind, text));
  return issues;
}

export function lintKnowledgeBase(input = {}) {
  const context = resolveRepoContext(input);
  const { repoRoot, knowledgeRoot, knowledgeAbs } = context;
  const issues = [];
  if (!existsSync(knowledgeAbs)) return [issue('P0', `${knowledgeRoot} does not exist.`, knowledgeRoot)];
  issues.push(...buildIndexes(input, { write: false }).issues);
  const contextIds = confirmedContextIds(knowledgeAbs);
  issues.push(...candidateDuplicateIssues(context));
  issues.push(...adrIssues(context, contextIds));
  for (const file of markdownFiles(join(knowledgeAbs, 'candidates'))) {
    const path = repoRelative(repoRoot, file);
    const text = readFileSync(file, 'utf8');
    const data = parseFrontmatter(text).data;
    issues.push(...statusIssues('candidate', data.status, path));
    if (!hasRealBodyContent(text) || hasTemplatePlaceholder(text)) issues.push(issue('P1', 'Candidate source is an empty shell.', path));
  }
  const contextMap = join(knowledgeAbs, 'CONTEXT-MAP.md');
  if (!existsSync(contextMap)) issues.push(issue('P0', 'CONTEXT-MAP.md does not exist.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md')));
  issues.push(...relationshipIssues(context, contextIds));
  for (const contextId of contextDirectories(knowledgeAbs)) {
    if (!contextIds.has(contextId)) issues.push(issue('P1', 'Context directory has no confirmed CONTEXT-MAP.md entry.', contextPath(knowledgeRoot, contextId)));
    if (!ID_PATTERN.test(contextId)) issues.push(issue('P1', 'Context id is invalid.', contextPath(knowledgeRoot, contextId)));
    const contextDir = join(knowledgeAbs, 'contexts', contextId);
    issues.push(...contextDocumentIssues(context, contextId, contextDir));
    const capabilityIds = new Set(markdownFiles(join(contextDir, 'capabilities')).map((file) => file.split('/').pop().replace(/\.md$/, '')));
    for (const file of markdownFiles(join(contextDir, 'capabilities'))) {
      const text = readFileSync(file, 'utf8');
      const data = parseFrontmatter(text).data;
      issues.push(...statusIssues('capability', data.status, repoRelative(repoRoot, file)));
      if (data.capability !== file.split('/').pop().replace(/\.md$/, '')) issues.push(issue('P1', 'Capability frontmatter does not match file name.', repoRelative(repoRoot, file)));
      if (!hasRealBodyContent(text) || hasTemplatePlaceholder(text)) issues.push(issue('P1', 'Capability source is an empty shell.', contextPath(knowledgeRoot, contextId, 'capabilities')));
      issues.push(...capabilityDocumentIssues(context, file));
      if (data.status === 'verified' && (!Array.isArray(data.confirmation_sources) || data.confirmation_sources.length === 0)) {
        issues.push(issue('P1', 'Verified capability requires confirmation_sources.', contextPath(knowledgeRoot, contextId, 'capabilities')));
      }
    }
    for (const file of markdownFiles(join(contextDir, 'evidence'))) {
      const text = readFileSync(file, 'utf8');
      const data = parseFrontmatter(text).data;
      issues.push(...statusIssues('evidence', data.status, repoRelative(repoRoot, file)));
      issues.push(...evidenceShapeIssues(context, contextId, file, capabilityIds));
      if (!EVIDENCE_KINDS.includes(data.evidence_kind)) issues.push(issue('P1', 'Evidence kind is not supported.', contextPath(knowledgeRoot, contextId, 'evidence')));
      if (data.status === 'verified' && (!data.source || !data.repo_commit || !data.generated_at || !data.generator || !data.generation_evidence)) {
        issues.push(issue('P1', 'Verified evidence requires generation confirmation fields.', contextPath(knowledgeRoot, contextId, 'evidence')));
      }
    }
  }
  return issues;
}
