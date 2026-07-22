# Install Hooks Workflow

Run internal `install-hooks.mjs` for the current target repository. It manages only:

- `.codex/hooks/yog-user-prompt-submit.mjs`;
- the unique Yog `UserPromptSubmit` command handler in `.codex/hooks.json`.

It must preserve unrelated events, matcher groups, and handlers; reject invalid existing JSON without changing either managed artifact; remain idempotent; and never create or modify `.codex/config.toml` or artifacts for other agent surfaces.

When the handler is new or its definition changed, return `reviewRequired: true` and tell the user to inspect and trust it through `/hooks`. Yog never writes Codex trust state.
