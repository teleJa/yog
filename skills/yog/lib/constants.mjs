export const KNOWLEDGE_ROOT_DEFAULT = 'docs/knowledge';
export const STATUS_ORDER = ['accepted', 'verified', 'draft', 'needs-review', 'stale', 'deprecated'];
export const STATUS_RANK = new Map(STATUS_ORDER.map((status, index) => [status, index]));
export const ISSUE_ORDER = new Map([
  ['P0', 0],
  ['P1', 1],
  ['P2', 2],
]);
export const EVIDENCE_KINDS = ['routes', 'call-flow', 'data', 'prd', 'tests', 'ui', 'ops'];
export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const CODE_SYMBOL_PATTERN = /^[A-Z][$A-Za-z0-9_]*(?:#[A-Za-z_$][$A-Za-z0-9_]*)?$/;
export const MANAGED_BLOCK_START = '<!-- YOG MANAGED BLOCK START -->';
export const MANAGED_BLOCK_END = '<!-- YOG MANAGED BLOCK END -->';
