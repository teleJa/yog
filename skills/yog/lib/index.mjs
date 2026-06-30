import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STATUS_RANK } from './constants.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { hasRealBodyContent, hasTemplatePlaceholder, normalizeGeneratedText } from './markdown.mjs';
import { contextPath, knowledgePath, repoRelative, resolveRepoContext } from './knowledge-root.mjs';

function issue(severity, message, path, details) {
  return details ? { severity, message, path, details } : { severity, message, path };
}

function parseContexts(contextMap, knowledgeRoot) {
  const contexts = [];
  const issues = [];
  const lines = contextMap.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- ([a-z][a-z0-9-]*): ([^-]+) - (.+)$/);
    if (!match) continue;
    const [, context, name, summary] = match;
    const path = lines[index + 1]?.match(/Path: `?([^`]+)`?/)?.[1] ?? `contexts/${context}/CONTEXT.md`;
    const responsibilities = lines[index + 2]?.match(/Responsibilities: (.+)$/)?.[1];
    const nonResponsibilities = lines[index + 3]?.match(/Non-responsibilities: (.+)$/)?.[1];
    if (path !== `contexts/${context}/CONTEXT.md`) {
      issues.push(issue('P1', 'CONTEXT-MAP context path is invalid.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md'), { context, path }));
    }
    if (!name.trim() || !summary.trim() || !responsibilities || !nonResponsibilities) {
      issues.push(issue('P1', 'CONTEXT-MAP context entry is incomplete.', knowledgePath(knowledgeRoot, 'CONTEXT-MAP.md'), { context }));
    }
    contexts.push({ context, name: name.trim(), summary: summary.trim(), path });
  }
  return { contexts, issues };
}

function statusRank(status) {
  return STATUS_RANK.get(status) ?? 99;
}

function sortEntries(entries) {
  const typeRank = new Map([['context', 0], ['adr', 1], ['capability', 0], ['evidence', 1], ['adr-link', 2]]);
  return [...entries].sort((left, right) => {
    const typeDelta = (typeRank.get(left.type) ?? 99) - (typeRank.get(right.type) ?? 99);
    if (typeDelta !== 0) return typeDelta;
    const statusDelta = statusRank(left.status) - statusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    return left.path.localeCompare(right.path);
  });
}

function readMarkdownFrontmatter(filePath) {
  return parseFrontmatter(readFileSync(filePath, 'utf8')).data;
}

function validateSourceMarkdown(repoRoot, absPath, label) {
  const path = repoRelative(repoRoot, absPath);
  if (!existsSync(absPath)) return [issue('P1', `${label} source does not exist.`, path)];
  const text = readFileSync(absPath, 'utf8');
  if (!hasRealBodyContent(text) || hasTemplatePlaceholder(text)) {
    return [issue('P1', `${label} source is an empty shell.`, path)];
  }
  return [];
}

function readAdrEntries(repoRoot, knowledgeAbs) {
  const adrDir = join(knowledgeAbs, 'adr');
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir)
    .filter((fileName) => fileName.endsWith('.md') && fileName !== 'README.md')
    .map((fileName) => {
      const abs = join(adrDir, fileName);
      const data = readMarkdownFrontmatter(abs);
      return {
        type: 'adr',
        name: data.name,
        summary: data.summary,
        status: data.status,
        path: repoRelative(repoRoot, abs),
        keywords: data.keywords ?? [],
        relatedContexts: [...new Set(data.related_contexts ?? [])],
      };
    });
}

export function buildIndexes(input = {}, options = { write: true }) {
  const { repoRoot, knowledgeRoot, knowledgeAbs } = resolveRepoContext(input);
  const contextMap = readFileSync(join(knowledgeAbs, 'CONTEXT-MAP.md'), 'utf8');
  const parsed = parseContexts(contextMap, knowledgeRoot);
  const contexts = parsed.contexts;
  const issues = [...parsed.issues];
  const contextIds = new Set(contexts.map((item) => item.context));
  const adrEntries = readAdrEntries(repoRoot, knowledgeAbs);
  for (const adr of adrEntries) {
    issues.push(...validateSourceMarkdown(repoRoot, join(repoRoot, adr.path), 'ADR'));
    for (const relatedContext of adr.relatedContexts) {
      if (!contextIds.has(relatedContext)) {
        issues.push(issue('P1', 'ADR related_contexts references an unknown context.', adr.path, { relatedContext }));
      }
    }
  }
  const globalEntries = [];
  const contextIndexes = [];
  for (const item of contexts) {
    const contextDir = join(knowledgeAbs, 'contexts', item.context);
    issues.push(...validateSourceMarkdown(repoRoot, join(knowledgeAbs, item.path), 'Context'));
    issues.push(...validateSourceMarkdown(repoRoot, join(contextDir, 'README.md'), 'Context README'));
    const capabilityDir = join(contextDir, 'capabilities');
    const evidenceDir = join(contextDir, 'evidence');
    const contextEntries = [];
    const evidenceFiles = existsSync(evidenceDir) ? readdirSync(evidenceDir).filter((file) => file.endsWith('.md')) : [];
    const evidenceByCapability = new Map();
    for (const fileName of evidenceFiles) {
      const abs = join(evidenceDir, fileName);
      issues.push(...validateSourceMarkdown(repoRoot, abs, 'Evidence'));
      const data = readMarkdownFrontmatter(abs);
      evidenceByCapability.set(data.capability, (evidenceByCapability.get(data.capability) ?? 0) + 1);
      contextEntries.push({
        type: 'evidence',
        context: item.context,
        capability: data.capability,
        evidenceKind: data.evidence_kind,
        name: data.name ?? fileName,
        summary: data.summary ?? '',
        status: data.status ?? 'draft',
        path: repoRelative(repoRoot, abs),
        keywords: data.keywords ?? [],
      });
    }
    const capabilityFiles = existsSync(capabilityDir) ? readdirSync(capabilityDir).filter((file) => file.endsWith('.md')) : [];
    for (const fileName of capabilityFiles) {
      const abs = join(capabilityDir, fileName);
      issues.push(...validateSourceMarkdown(repoRoot, abs, 'Capability'));
      const data = readMarkdownFrontmatter(abs);
      if (data.capability !== fileName.replace(/\.md$/, '')) {
        issues.push(issue('P1', 'Capability frontmatter does not match file name.', repoRelative(repoRoot, abs)));
      }
      contextEntries.push({
        type: 'capability',
        context: item.context,
        capability: data.capability,
        name: data.name,
        summary: data.summary,
        status: data.status,
        evidenceCount: evidenceByCapability.get(data.capability) ?? 0,
        path: repoRelative(repoRoot, abs),
        keywords: data.keywords ?? [],
      });
    }
    for (const adr of adrEntries) {
      if (!adr.relatedContexts.includes(item.context)) continue;
      contextEntries.push({
        type: 'adr-link',
        context: item.context,
        name: adr.name,
        summary: adr.summary,
        status: adr.status,
        path: adr.path,
      });
    }
    const contextIndex = {
      schemaVersion: 1,
      kind: 'context',
      context: item.context,
      generated_at: new Date().toISOString(),
      entries: sortEntries(contextEntries),
    };
    contextIndexes.push({
      path: join(contextDir, 'index.json'),
      index: contextIndex,
    });
    globalEntries.push({
      type: 'context',
      context: item.context,
      name: item.name,
      summary: item.summary,
        path: knowledgePath(knowledgeRoot, item.path),
        readmePath: contextPath(knowledgeRoot, item.context, 'README.md'),
        indexPath: contextPath(knowledgeRoot, item.context, 'index.json'),
      docsCount: contextIndex.entries.filter((entry) => entry.type === 'capability' || entry.type === 'evidence').length,
      keywords: [...new Set(contextIndex.entries.filter((entry) => entry.type === 'capability').flatMap((entry) => entry.keywords ?? []))],
    });
  }
  for (const adr of adrEntries) {
    globalEntries.push({
      type: 'adr',
      name: adr.name,
      summary: adr.summary,
      status: adr.status,
      path: adr.path,
      keywords: adr.keywords,
    });
  }
  const globalIndex = {
    schemaVersion: 1,
    kind: 'global',
    generated_at: new Date().toISOString(),
    entries: sortEntries(globalEntries),
  };
  if (issues.some((item) => item.severity === 'P0' || item.severity === 'P1')) {
    return { issues, globalIndex, contextIndexes };
  }
  if (options.write) {
    for (const contextIndex of contextIndexes) {
      writeFileSync(contextIndex.path, `${JSON.stringify(contextIndex.index, null, 2)}\n`);
    }
    writeFileSync(join(knowledgeAbs, 'index.json'), `${JSON.stringify(globalIndex, null, 2)}\n`);
    writeFileSync(join(knowledgeAbs, 'INDEX.md'), renderIndexMarkdown(globalIndex));
  }
  return { issues, globalIndex, contextIndexes };
}

export function renderIndexMarkdown(index) {
  const rows = index.entries.map((entry) => `| ${entry.name} | ${entry.type} | ${entry.status ?? ''} | ${entry.summary ?? ''} | ${entry.path} |`);
  return `# Knowledge Index

Generated at: ${index.generated_at}

This file is generated from Markdown frontmatter. Do not edit it by hand.

| Name | Type | Status | Summary | Path |
|---|---|---|---|---|
${rows.join('\n')}
`;
}

export function checkIndexes(input = {}) {
  const { repoRoot, knowledgeRoot, knowledgeAbs } = resolveRepoContext(input);
  const beforeJson = existsSync(join(knowledgeAbs, 'index.json')) ? normalizeGeneratedText(readFileSync(join(knowledgeAbs, 'index.json'), 'utf8')) : '';
  const beforeMd = existsSync(join(knowledgeAbs, 'INDEX.md')) ? normalizeGeneratedText(readFileSync(join(knowledgeAbs, 'INDEX.md'), 'utf8')) : '';
  const { issues, globalIndex, contextIndexes } = buildIndexes(input, { write: false });
  if (issues.length) return { issues };
  const afterJson = normalizeGeneratedText(`${JSON.stringify(globalIndex, null, 2)}\n`);
  const afterMd = normalizeGeneratedText(renderIndexMarkdown(globalIndex));
  if (beforeJson !== afterJson || beforeMd !== afterMd) {
    return { issues: [{ severity: 'P1', message: 'Generated indexes are stale.', path: knowledgePath(knowledgeRoot, 'index.json') }] };
  }
  for (const contextIndex of contextIndexes) {
    const beforeContext = existsSync(contextIndex.path) ? normalizeGeneratedText(readFileSync(contextIndex.path, 'utf8')) : '';
    const afterContext = normalizeGeneratedText(`${JSON.stringify(contextIndex.index, null, 2)}\n`);
    if (beforeContext !== afterContext) {
      return { issues: [{ severity: 'P1', message: 'Generated context index is stale.', path: repoRelative(repoRoot, contextIndex.path) }] };
    }
  }
  return { issues: [] };
}
