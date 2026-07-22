# Upgrade Workflow

Run internal `upgrade-guidance.mjs` with explicit apply intent. Refresh `docs/knowledge/AGENTS.md`, `docs/knowledge/README.md`, and the root `AGENTS.md` Yog managed block while preserving all human-owned content outside the block.

If the Codex Hook is already installed, also refresh its script and canonical Yog handler using the install-hooks contract. If it is not installed, do not add it. Never create artifacts for other agent surfaces or modify `.codex/config.toml`.
