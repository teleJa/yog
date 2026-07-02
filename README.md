# yog

A business knowledge base plugin for AI coding agents, organizing long-lived project knowledge by context, capability, evidence, and ADRs.

## First-Version Plugin Surface

Yog exposes one plugin skill at `skills/yog/SKILL.md`. The skill guides agents to call internal Node ESM scripts under `skills/yog/scripts/`.

Yog does not expose a public CLI, MCP server, user-visible commands, or user-visible agents in the first version.

`init` only creates the knowledge-base skeleton. Its result tells the agent to offer `install-hooks` as the optional next step, so future prompts can automatically remind agents to read `CONTEXT-MAP.md`. Automatic `discover-candidates` is an agent workflow and requires both Serena and CodeGraph to be available for the target repository before it writes `needs-review` candidate documents.

Existing repositories keep `init` no-overwrite behavior. Use the Yog skill's `upgrade-guidance.mjs` workflow when `docs/knowledge/AGENTS.md` or `README.md` should be refreshed from the current templates.

## Local Verification

```bash
npm test
```

The test suite uses temporary repositories and validates init, document creation, index generation, lint, verify, sync, and routing.
