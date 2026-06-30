# yog

A business knowledge base plugin for AI coding agents, organizing long-lived project knowledge by context, capability, evidence, and ADRs.

## First-Version Plugin Surface

Yog exposes one plugin skill at `skills/yog/SKILL.md`. The skill guides agents to call internal Node ESM scripts under `skills/yog/scripts/`.

Yog does not expose a public CLI, MCP server, user-visible commands, or user-visible agents in the first version.

## Local Verification

```bash
npm test
```

The test suite uses temporary repositories and validates init, document creation, index generation, lint, verify, sync, and routing.
