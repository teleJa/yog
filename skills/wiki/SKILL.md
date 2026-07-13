---
name: wiki
description: Generate a focused Chinese product Wiki from a user-confirmed menu scope, optional Record business flows, optional Requirement Provider or Spec context, and user-provided code paths. TAPD is the default Requirement Provider. Use for yog:wiki generate and product-manual generation.
---

# Yog Wiki MVP

The public command surface contains exactly one command:

```text
yog:wiki generate
```

The MVP goal is to generate a useful Wiki first. Do not invoke the legacy engineering-wide Wiki workflow, require a symbol graph, or expand the request into a full repository Wiki.

## Input Gate

Collect these required inputs before analysis:

1. A menu description, pasted directly or referenced by an explicit JSON, Markdown, or text file path.
2. An absolute Wiki output root. The output root does not need to be a Git repository.
3. One or more absolute code paths supplied by the user.

Ask whether the user has any optional source:

- One or more explicit Record Skill directory paths. Each Record represents a small business flow and anchors related feature discovery.
- Requirement work item IDs, links, or a user-confirmed bounded project scope. TAPD MCP is the default provider and transport.
- Explicit Spec file or directory paths.

Record, Requirement, and Spec sources are optional. Their absence never blocks menu + code generation. Do not install or invoke TAPD CLI in the MVP. Never ask the user to paste a token.

When `<outputRoot>/.yog/config.json` exists, read `wiki.requirementProvider` before collecting Requirement evidence. The MVP accepts `provider: tapd`, `transport: mcp`, and a configured MCP `serverRef`; otherwise use TAPD MCP as the default. The configuration is routing metadata only and never contains a token.

Do not infer missing paths from personal directories or scan all user skills. Echo the authorized inputs before reading them.

## Scope First

First establish the exact generation scope:

1. Parse the menu into first-level groups and second-level features.
2. When Record is provided, map each business flow to one or more second-level features.
3. If the supplied menu covers more features than the Record mappings and the user did not explicitly choose a scope, stop and ask whether to generate only Record-related features or the full supplied menu scope.
4. Do not scan ambiguous features or write the formal Wiki before the user answers.
5. Record the decision as `scopeDecision.mode` with `confirmedByUser: true`.

Then use Record artifacts, when present, to narrow the code scope before reading implementation details:

1. Parse `SKILL.md`, `artifacts/workflow.json`, `artifacts/network.json`, and available screenshots without replaying the workflow.
2. Extract page routes, accessible UI names, HTTP method when captured, normalized network paths, and operation discriminators.
3. Search only the user-provided code paths for these exact fingerprints.
4. Identify the smallest set of related Git repositories and files.
5. Do not generate pages for unrelated repositories or for other features that merely share generic words.
6. After a second-level feature enters the confirmed scope, inspect its complete product surface, not only the controls exercised by the Record. Include all related page regions, actions, configuration options, rules, success behavior, limitations, and directly associated product views found in code.

CodeGraph or an equivalent symbol graph may enrich the selected implementation path. When unavailable, use exact route/network matches and `rg`; mark deeper implementation relationships partial instead of blocking generation.

## Requirement Retrieval Gate

Treat TAPD as the default `requirement` provider, not as a source type understood by the Wiki renderer. Apply the following workflow before creating requirement evidence:

1. Require a user-confirmed workspace, project, or explicit work-item scope. Never search every project visible to the account.
2. Record layered queries in order: explicit IDs or links, exact first/second-level menu names, confirmed page/Record capability terms, then real hierarchy expansion.
3. Restore parent/child relationships only from provider fields and relations. Never infer hierarchy from an ID format or title prefix.
4. Classify every candidate as direct, supporting, out-of-scope, or weak; record an adoption, exclusion, or conflict decision and its reason.
5. Normalize the provider status using the selected project workflow. Only completed product requirements may become current `requirementEvidenceIds`.
6. Exclude development tasks, test items, defects, broad keyword matches, other-menu features, terminated work, and in-progress work from current capability claims.
7. Cross-check every adopted requirement against current code evidence from the user-authorized paths. A completed requirement without current implementation evidence is intent or a product-review gap, not a current capability.
8. When requirement and code conflict, do not choose a winner. Stop if the conflict changes scope or ownership; otherwise create a product-review gap and keep the requirement out of current evidence.
9. Requirement results cannot create menu features or user scenarios. A high-relevance result outside the confirmed menu scope requires user confirmation before any expansion.

Represent each collected platform as a generic `requirement` source with `provider`, `providerLabel`, confirmed `scope`, `capturedAt`, `transport`, layered `queries`, and classified `candidates`. Each adopted candidate records its stable external ID, title, real parent ID, raw and normalized status, mapped feature IDs, requirement Evidence ID, and code Evidence IDs. The generator rejects adopted candidates that did not pass these gates and renders the source label from the normalized candidate instead of trusting free-form Evidence prose.

## Source Authority

- Menu description defines first-level Feature Groups and second-level Menu Features. It is the only source allowed to create product feature names.
- Record Workflow is the only source allowed to create User Scenario pages. Treat it as a small business flow and a code-location anchor, not as runtime acceptance evidence for the product manual.
- Requirement sources and Spec can enrich goals, rules, intended results, and terminology inside an existing Menu Feature. They cannot create features or scenarios.
- Code proves the current product surface, configuration choices, validation, success behavior, state changes, side effects, and related operations. It does not prove original product intent.

Missing screenshots, HTTP methods, request fields, or final status are internal Record-quality diagnostics and do not appear in the product reading path. Invalid JSON, broken artifact references, unredacted secrets, or fabricated captured evidence still block that Record source.

## Build The MVP Model

Construct a JSON model accepted by `skills/yog/scripts/generate-wiki-mvp.mjs`:

- `outputRoot` and `wikiRoot` identify the destination.
- `scopeDecision` records whether the user selected the supplied menu scope or only Record-related features. It must be explicitly user-confirmed.
- `sources[]` assigns stable IDs to menu, Record, code, optional Spec, and optional generic Requirement inputs. TAPD is expressed as `type: requirement` plus `provider: tapd`.
- `evidence[]` uses a source ID plus a source-relative path and line range, or a non-local locator. Do not put absolute paths in facts or rendered prose.
- `featureGroups[]` contains first-level groups and second-level features. Each feature must include a complete product model: purpose, capabilities, page areas, operations, configuration, rules, current system behavior, limitations, and concise implementation associations.
- `scenarios[]` contains only Record-backed business flows associated with features in one group. It describes business goal, conditions, steps, key configuration, product outcome, and usage notes.
- `gaps[]` uses `audience: product-review` for missing product meaning or conflicting rules, and `audience: internal` for source-quality diagnostics.

Every fact keeps evidence references in `_meta`. Requirement query scope, query tiers, candidate status, adoption/exclusion reasons, code cross-validation, evidence levels, file paths, line ranges, hashes, network diagnostics, and Record capture quality do not appear in the default product prose.

Invoke the script by sending the complete JSON model on stdin. The script validates evidence paths and line ranges, hashes source files, renders the Chinese Wiki, checks sensitive values and internal links, and publishes from staging.

## Output Contract

The default output is:

```text
docs/wiki/
  目录.md
  产品功能/
    <一级菜单>/
      <二级菜单>.md
  用户场景/
    <一级菜单>/
      <Record 场景名称>.md
  待确认问题.md
  _meta/
    catalog.json
    claims.json
    evidence.json
    manifest.json
```

Generate `待确认问题.md` only when gaps exist. Do not generate feature indexes, first-level menu pages, scenario indexes, acceptance pages, third-level feature pages, business-flow pages, or separate architecture/module/API directories in the MVP.

Feature pages are product-review drafts. They lead with overview, complete feature inventory, roles, usage conditions, page entry points, operations, configuration guidance, business rules, current system behavior, limitations, and typical business flows. Scenario pages turn Record workflows into reusable business procedures rather than recording audit reports.

Keep the default reading path product-first:

- Do not render evidence-level badges or per-claim source lists.
- Do not render screenshots missing, pending responses, OPTIONS status, unrecorded branches, or other capture diagnostics.
- Keep only concise technical associations such as the owning frontend, backend service, and external system. Detailed paths, line ranges, hashes, and request mappings remain in `_meta`.
- Generate `待确认问题.md` only from `product-review` gaps. Internal gaps remain in metadata.

Every generated Markdown page starts with YAML frontmatter for Agent routing. It includes stable `pageId`, `pageType`, `title`, `status`, and `generatedBy` fields, plus page-specific menu, feature, scenario, route, and relationship fields. Do not render document status as visible body copy. `_meta/catalog.json` is the global machine-readable index and must retain the same page identity, status, ownership, and relationship fields.

## Publish Boundary

- Publish only to the user-provided output root.
- A missing target is created.
- An existing target may be fully replaced only when `_meta/manifest.json` declares `managedBy: yog:wiki-mvp`.
- An unmanaged target blocks publication.
- Publication keeps the previous managed Wiki as a run-local backup and restores it if the replacement fails.
- Formal metadata must never contain machine-local source roots, Record temporary paths, tokens, cookies, request bodies, or customer data.

## Completion

Return the generated paths, selected code source IDs, adopted and excluded requirement counts, gaps, and manifest path. Record issues found during real generation, especially query scope, candidate counts, adoption/exclusion reasons, conflicts, evidence gaps, source ambiguity, false code matches, unsafe Record artifacts, and output-quality problems. Do not claim completion until the generated Wiki answers:

1. What product feature is covered?
2. What complete set of capabilities and related operations does the feature provide?
3. What do its configuration choices mean, and how do they affect system behavior?
4. What rules, limitations, success outcomes, and related product views must a product reviewer confirm?
5. Can a product reviewer understand the feature without reading source paths or Record diagnostics?
