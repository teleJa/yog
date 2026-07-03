import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, relative } from 'node:path';
import { KNOWLEDGE_ROOT_DEFAULT } from './constants.mjs';

function findUp(startDir, marker) {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function assertInsideRepo(repoRoot, targetPath) {
  const rel = relative(resolve(repoRoot), resolve(targetPath));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside repository root: ${targetPath}`);
  }
}

export function readRepoConfig(repoRoot) {
  const configPath = join(repoRoot, '.yog/config.json');
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function slashPath(path) {
  return path.split('\\').join('/');
}

export function repoRelative(repoRoot, targetPath) {
  return slashPath(relative(resolve(repoRoot), resolve(targetPath)));
}

export function knowledgePath(knowledgeRoot, ...parts) {
  return slashPath(join(knowledgeRoot, ...parts));
}

export function contextPath(knowledgeRoot, contextId, ...parts) {
  return knowledgePath(knowledgeRoot, 'contexts', contextId, ...parts);
}

export function businessFlowPath(knowledgeRoot, ...parts) {
  return knowledgePath(knowledgeRoot, 'business-flows', ...parts);
}

export function adrPath(knowledgeRoot, ...parts) {
  return knowledgePath(knowledgeRoot, 'adr', ...parts);
}

export function resolveRepoContext(input = {}) {
  const repoRoot = input.repoRoot
    ? resolve(input.repoRoot)
    : findUp(process.cwd(), '.yog/config.json') ?? findUp(process.cwd(), '.git');
  if (!repoRoot) {
    const error = new Error('Unable to resolve repository root.');
    error.code = 'repo-root-not-found';
    throw error;
  }
  const config = readRepoConfig(repoRoot);
  const knowledgeRoot = input.knowledgeRoot ?? config.knowledgeRoot ?? KNOWLEDGE_ROOT_DEFAULT;
  const knowledgeAbs = resolve(repoRoot, knowledgeRoot);
  assertInsideRepo(repoRoot, knowledgeAbs);
  return { repoRoot, knowledgeRoot: slashPath(knowledgeRoot), knowledgeAbs, config };
}
