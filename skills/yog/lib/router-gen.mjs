// generate-router: multi-repo router extension (NOT part of the core single-repo protocol).
// Pure list transformation — takes a repository manifest and produces a thin
// repository-location index. It never reads any repository's internals, so it
// does not require repositories to be mounted and does not violate the single-repo
// boundary that the core scripts hold. See ADR 0002.
import { ID_PATTERN } from './constants.mjs';

function issue(message, details) {
  return details ? { severity: 'P1', message, details } : { severity: 'P1', message };
}

// Validate and normalize one repository entry from router-input.repositories.
// Returns { entry, issues }. On a blocking problem the entry is still returned
// (best-effort) but with an accompanying P1 so the caller can surface it.
function normalizeRepo(raw, index) {
  const issues = [];
  const where = { index };

  const repo = typeof raw?.repo === 'string' ? raw.repo.trim() : '';
  if (!repo) {
    issues.push(issue('Repository entry is missing "repo".', where));
  } else if (!ID_PATTERN.test(repo)) {
    issues.push(issue('Repository "repo" must match [a-z][a-z0-9-]*.', { ...where, repo }));
  }

  const path = typeof raw?.path === 'string' ? raw.path.trim() : '';
  const remote = typeof raw?.remote === 'string' ? raw.remote.trim() : '';
  if (!path && !remote) {
    issues.push(issue('Repository entry needs at least one of "path" or "remote".', { ...where, repo }));
  }

  const knowledgeRoot = typeof raw?.knowledgeRoot === 'string' && raw.knowledgeRoot.trim()
    ? raw.knowledgeRoot.trim()
    : '';
  const yogInitialized = raw?.yogInitialized === true;

  // A structurally invalid entry (bad/missing repo id, or no locator) is reported
  // as a P1 and EXCLUDED from entries — the index must only contain usable location
  // records. This is distinct from yogInitialized:false, which is a valid repo that
  // simply has no yog yet and MUST still appear (so consumers can degrade). See ADR 0002.
  const valid = Boolean(repo) && ID_PATTERN.test(repo) && Boolean(path || remote);
  if (!valid) return { entry: null, repo, issues };

  const entry = { type: 'repository', repo };
  if (path) entry.path = path;
  if (remote) entry.remote = remote;
  if (knowledgeRoot) entry.knowledgeRoot = knowledgeRoot;
  entry.yogInitialized = yogInitialized;

  return { entry, repo, issues };
}

export function generateRouter(input = {}) {
  const repositories = Array.isArray(input?.repositories) ? input.repositories : null;
  if (!repositories) {
    return {
      schemaVersion: 1,
      kind: 'router',
      generated_at: new Date().toISOString(),
      entries: [],
      issues: [issue('router-input must contain a "repositories" array.')],
    };
  }

  const entries = [];
  const issues = [];
  const seen = new Set();
  for (const [index, raw] of repositories.entries()) {
    const { entry, repo, issues: repoIssues } = normalizeRepo(raw, index);
    issues.push(...repoIssues);
    // Structurally invalid entries are reported (above) but never enter the index.
    if (!entry) continue;
    // Dedup on repo id; a duplicate is reported and dropped.
    if (seen.has(repo)) {
      issues.push(issue('Duplicate "repo" in router-input.', { index, repo }));
      continue;
    }
    seen.add(repo);
    entries.push(entry);
  }

  // Stable ordering: by repo id, so regenerating a stable manifest yields a stable file.
  entries.sort((left, right) => String(left.repo).localeCompare(String(right.repo)));

  return {
    schemaVersion: 1,
    kind: 'router',
    generated_at: new Date().toISOString(),
    entries,
    issues,
  };
}
