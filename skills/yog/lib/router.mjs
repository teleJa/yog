import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasRealBodyContent, hasTemplatePlaceholder } from './markdown.mjs';
import { adrPath, businessFlowPath, contextPath, knowledgePath, resolveRepoContext } from './knowledge-root.mjs';

function score(entry, queryTerms) {
  const haystack = [
    entry.context,
    entry.capability,
    entry.name,
    entry.summary,
    ...(entry.keywords ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  return queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

function issue(message, path, details = {}) {
  return { severity: 'P1', message, path, details };
}

function sourceIssue(repoRoot, path, label) {
  const abs = join(repoRoot, path);
  if (!existsSync(abs)) return issue(`${label} does not exist.`, path);
  const text = readFileSync(abs, 'utf8');
  if (!hasRealBodyContent(text) || hasTemplatePlaceholder(text)) return issue(`${label} is an empty shell.`, path);
  return null;
}

function contextFromIndexPath(knowledgeRoot, indexPath) {
  const prefix = `${knowledgeRoot}/contexts/`;
  const suffix = '/index.json';
  if (!indexPath.startsWith(prefix) || !indexPath.endsWith(suffix)) return null;
  const contextId = indexPath.slice(prefix.length, -suffix.length);
  return contextId.includes('/') ? null : contextId;
}

function validateContextCandidate(repoRoot, knowledgeRoot, entry) {
  const requiredFields = ['path', 'readmePath', 'indexPath'];
  for (const field of requiredFields) {
    if (!entry[field]) return issue(`Context ${field} is missing.`, knowledgePath(knowledgeRoot, 'index.json'), { context: entry.context, field });
  }
  const sourceIssues = [
    sourceIssue(repoRoot, entry.path, 'Context source'),
    sourceIssue(repoRoot, entry.readmePath, 'Context README'),
  ].filter(Boolean);
  if (sourceIssues.length) return sourceIssues[0];
  const contextIndexPath = join(repoRoot, entry.indexPath);
  if (!existsSync(contextIndexPath)) return issue('Context index does not exist.', entry.indexPath);
  const contextIndex = JSON.parse(readFileSync(contextIndexPath, 'utf8'));
  const pathContext = contextFromIndexPath(knowledgeRoot, entry.indexPath);
  if (contextIndex.context !== pathContext || contextIndex.context !== entry.context) {
    return issue('Context index context does not match its path.', entry.indexPath, { expected: entry.context, actual: contextIndex.context });
  }
  const contextPrefix = contextPath(knowledgeRoot, contextIndex.context, '');
  const adrPrefix = adrPath(knowledgeRoot, '');
  for (const contextEntry of contextIndex.entries) {
    if ((contextEntry.type === 'capability' || contextEntry.type === 'evidence') && contextEntry.context !== contextIndex.context) {
      return issue('Context index entry context does not match the index context.', entry.indexPath, { path: contextEntry.path });
    }
    if ((contextEntry.type === 'capability' || contextEntry.type === 'evidence') && !contextEntry.path.startsWith(contextPrefix)) {
      return issue('Context index entry path points outside its context.', entry.indexPath, { path: contextEntry.path });
    }
    if (contextEntry.type === 'adr-link' && !contextEntry.path.startsWith(adrPrefix)) {
      return issue('Context index adr-link path is invalid.', entry.indexPath, { path: contextEntry.path });
    }
  }
  return null;
}

function validateBusinessFlowCandidate(repoRoot, knowledgeRoot, entry) {
  if (!entry.path) return issue('Business flow path is missing.', knowledgePath(knowledgeRoot, 'index.json'), { flow: entry.flow });
  const prefix = businessFlowPath(knowledgeRoot, '');
  if (!entry.path.startsWith(prefix)) return issue('Business flow path is invalid.', knowledgePath(knowledgeRoot, 'index.json'), { path: entry.path });
  return sourceIssue(repoRoot, entry.path, 'Business flow source');
}

export function matchScope(input = {}) {
  const { repoRoot, knowledgeRoot, knowledgeAbs } = resolveRepoContext(input);
  const query = input.payload?.query ?? '';
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const globalPath = join(knowledgeAbs, 'index.json');
  if (!existsSync(globalPath)) {
    return {
      query,
      matches: [],
      issues: [{ severity: 'P1', message: 'Global index does not exist.', path: knowledgePath(knowledgeRoot, 'index.json') }],
    };
  }
  const global = JSON.parse(readFileSync(join(knowledgeAbs, 'index.json'), 'utf8'));
  const matches = [];
  for (const entry of global.entries) {
    const entryScore = score(entry, queryTerms);
    if (entryScore > 0) matches.push({ ...entry, score: entryScore });
    if (entry.type === 'business-flow') {
      const flowIssue = validateBusinessFlowCandidate(repoRoot, knowledgeRoot, entry);
      if (flowIssue) return { query, matches: [], issues: [flowIssue] };
    }
    if (entry.type === 'context') {
      const contextIssue = validateContextCandidate(repoRoot, knowledgeRoot, entry);
      if (contextIssue) return { query, matches: [], issues: [contextIssue] };
      const contextIndex = JSON.parse(readFileSync(join(repoRoot, entry.indexPath), 'utf8'));
      for (const contextEntry of contextIndex.entries) {
        const contextScore = score(contextEntry, queryTerms);
        if (contextScore > 0) matches.push({ ...contextEntry, score: contextScore });
      }
    }
  }
  const typeRank = new Map([['business-flow', 0], ['context', 1], ['capability', 2], ['evidence', 3], ['adr', 4], ['adr-link', 5]]);
  matches.sort((left, right) => (
    right.score - left.score
    || (typeRank.get(left.type) ?? 99) - (typeRank.get(right.type) ?? 99)
    || left.path.localeCompare(right.path)
  ));
  return { query, matches, issues: [] };
}
