# Sync Workflow

Resolve `repoRoot` and `knowledgeRoot`, run internal `sync.mjs`, and report changed generated indexes plus issues by severity. Sync may rebuild `index.json` and `INDEX.md` and run lint, but it must not discover, create, promote, merge, split, rename, or change document status.
