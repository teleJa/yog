# Init Workflow

1. Resolve the current Git repository as `repoRoot`; use `docs/knowledge` unless the user gives another in-repository root.
2. Run internal `init.mjs`. Preserve existing `docs/knowledge/**` files and write `.yog/config.json` with `schemaVersion`, `language`, `codeFactProvider`, and `discover.maxMidLowCandidates`.
3. Upsert only the root `AGENTS.md` Yog managed block. Do not create files for other agent surfaces.
4. Run internal `verify.mjs` and report command status and P0/P1/P2 issues.
5. Report whether the Candidate template and CodeGraph are available.
6. Offer `yog:knowledge install-hooks`; then ask whether to run `yog:knowledge discover-candidates`.

Missing CodeGraph never blocks init. Do not discover candidates without the user's follow-up authorization.
